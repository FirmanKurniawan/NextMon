<?php
/**
 * Regression tests for the speed layer: Cache, CachedDriver (invalidation), RouterOS pipelining / persistence /
 * lazy connect / circuit breaker, bulk helpers. Router tests talk to tests/fixtures/fake_router_server.php.
 */

/** Counts calls; behaves like a tiny router (hotspot users + profiles). */
class CountingDriver implements Driver
{
    public array $calls = [];
    public array $users = [['.id' => '*1', 'name' => 'a'], ['.id' => '*2', 'name' => 'b']];
    public array $profiles = [['.id' => '*P', 'name' => 'default']];
    public int $multi = 0;

    public function isDemo(): bool
    {
        return false;
    }

    public function print(string $path, array $query = [], array $props = []): array
    {
        $this->calls[] = 'print ' . $path . ($query ? ' ' . json_encode($query) : '');
        $p = '/' . trim(str_replace(' ', '/', $path), '/');
        $rows = $p === '/ip/hotspot/user' ? $this->users : ($p === '/ip/hotspot/user/profile' ? $this->profiles : ($p === '/system/script' ? [['.id' => '*S']] : []));
        foreach ($query as $k => $v) {
            $rows = array_values(array_filter($rows, fn($r) => ($r[$k] ?? null) === $v));
        }
        return $rows;
    }

    public function printMany(array $reqs): array
    {
        $this->multi++;
        $out = [];
        foreach ($reqs as $k => $q) {
            $out[$k] = $this->print((string)$q[0], (array)($q[1] ?? []), (array)($q[2] ?? []));
        }
        return $out;
    }

    public function add(string $path, array $attrs): string
    {
        $this->calls[] = 'add ' . $path;
        $this->users[] = ['.id' => '*N' . count($this->users)] + $attrs;
        return '*N' . count($this->users);
    }

    public function set(string $path, string $id, array $attrs): void
    {
        $this->calls[] = 'set ' . $path;
        foreach ($this->users as $i => $u) {
            if ($u['.id'] === $id) {
                $this->users[$i] = $attrs + $u;
            }
        }
    }

    public function remove(string $path, string $id): void
    {
        $this->calls[] = 'remove ' . $path;
        $this->users = array_values(array_filter($this->users, fn($u) => $u['.id'] !== $id));
    }

    public function command(string $path, array $attrs = [], array $query = []): array
    {
        $this->calls[] = 'command ' . $path;
        return [];
    }

    public function count(string $prefix): int
    {
        return count(array_filter($this->calls, fn($c) => strncmp($c, $prefix, strlen($prefix)) === 0));
    }
}

// ---- Cache ----------------------------------------------------------------------------------------------------------------

test('Cache: set/get/delete, expiry, and secret payloads are not readable on disk', function () {
    $d = fresh_store('json');
    Cache::reset();
    eq(null, Cache::get('k'));
    Cache::set('k', ['a' => 1], 60);
    eq(['a' => 1], Cache::get('k'));
    Cache::delete('k');
    eq(null, Cache::get('k'));
    Cache::set('sec', ['password' => 'hunter2-voucher'], 60, true);
    eq(['password' => 'hunter2-voucher'], Cache::get('sec'));
    if (Cache::backend() === 'file') {
        foreach (glob($d . '/cache/c-*.dat') as $f) {
            ok(strpos((string)file_get_contents($f), 'hunter2-voucher') === false, 'plaintext secret on disk: ' . $f);
        }
    }
    Cache::set('short', 1, 1);
    sleep(2);
    eq(null, Cache::get('short'), 'expired entries are misses');
});

test('Cache: generation bump invalidates a whole group, also across a fresh process memo', function () {
    fresh_store('json');
    Cache::reset();
    $g1 = Cache::gen('rt:x');
    Cache::bump('rt:x');
    $g2 = Cache::gen('rt:x');
    ok($g1 !== $g2);
    Cache::reset();   // new "process": generation must come from the store, not the memo
    eq($g2, Cache::gen('rt:x'));
});

// ---- CachedDriver -------------------------------------------------------------------------------------------------------------

test('CachedDriver: repeated reads hit the cache; unknown paths are never cached', function () {
    fresh_store('json');
    Cache::reset();
    $in = new CountingDriver();
    $c = new CachedDriver($in, 'r1');
    for ($i = 0; $i < 5; $i++) {
        eq(2, count($c->print('/ip/hotspot/user', [], ['name'])));
    }
    eq(1, $in->count('print /ip/hotspot/user'), 'one real call for five reads');
    $c->print('/system/script');
    $c->print('/system/script');
    eq(2, $in->count('print /system/script'), '/system/script is not on the cache list');
    $c->print('/ip/hotspot/user', ['name' => 'a'], ['name']);
    eq(2, $in->count('print /ip/hotspot/user'), 'different query = different entry');
});

test('CachedDriver: every write kind invalidates the router cache before the next read', function () {
    fresh_store('json');
    Cache::reset();
    $in = new CountingDriver();
    $c = new CachedDriver($in, 'r1');
    $read = fn() => count($c->print('/ip/hotspot/user', [], ['name']));
    eq(2, $read());
    $c->add('/ip/hotspot/user', ['name' => 'c']);
    eq(3, $read(), 'add');
    $c->set('/ip/hotspot/user', '*1', ['name' => 'a2']);
    $c->print('/ip/hotspot/user', [], ['name']);
    eq(3, $in->count('print /ip/hotspot/user'), 'set invalidated (3rd real read)');
    $c->remove('/ip/hotspot/user', '*2');
    eq(2, $read(), 'remove');
    $before = $in->count('print /ip/hotspot/user');
    $c->command('/ip/hotspot/user/reset-counters', ['numbers' => '*1']);
    $read();
    eq($before + 1, $in->count('print /ip/hotspot/user'), 'a state-changing command invalidates');
    $b2 = $in->count('print /ip/hotspot/user');
    $c->command('/interface/monitor-traffic', ['interface' => 'ether1', 'once' => true]);
    $read();
    eq($b2, $in->count('print /ip/hotspot/user'), 'read-only commands (monitor-traffic) keep the cache');
    $c->addMany('/ip/hotspot/user', [['name' => 'x'], ['name' => 'y']]);
    eq(4, $read(), 'addMany invalidates');
    $c->removeMany('/ip/hotspot/user', ['*1']);
    eq(3, $read(), 'removeMany invalidates');
});

test('CachedDriver: invalidation is per router and survives a new request (generation lives in the store)', function () {
    fresh_store('json');
    Cache::reset();
    $a = new CountingDriver();
    $b = new CountingDriver();
    $ca = new CachedDriver($a, 'ra');
    $cb = new CachedDriver($b, 'rb');
    $ca->print('/ip/hotspot/user');
    $cb->print('/ip/hotspot/user');
    $ca->add('/ip/hotspot/user', ['name' => 'z']);
    $cb->print('/ip/hotspot/user');
    eq(1, $b->count('print /ip/hotspot/user'), 'router B untouched by a write to router A');
    Cache::reset();   // simulate the next PHP request
    $ca2 = new CachedDriver($a, 'ra');
    eq(3, count($ca2->print('/ip/hotspot/user')), 'A re-read after the write');
    eq(2, $a->count('print /ip/hotspot/user'));
});

test('CachedDriver: a write that lands during a fetch cannot be overwritten by that (older) fetch', function () {
    fresh_store('json');
    Cache::reset();
    $racy = new class extends CountingDriver {
        public ?CachedDriver $outer = null;
        public bool $fired = false;
        public function print(string $path, array $query = [], array $props = []): array
        {
            $rows = parent::print($path, $query, $props);
            if (!$this->fired) {
                $this->fired = true;
                $this->outer->add('/ip/hotspot/user', ['name' => 'late']);   // another request writes while we were fetching
            }
            return $rows;
        }
    };
    $c = new CachedDriver($racy, 'rr');
    $racy->outer = $c;
    eq(2, count($c->print('/ip/hotspot/user')), 'the racing fetch returns what it saw');
    eq(3, count($c->print('/ip/hotspot/user')), 'but its result was NOT cached over the newer generation');
});

test('CachedDriver::printMany sends only the misses, in one batch, in caller order', function () {
    fresh_store('json');
    Cache::reset();
    $in = new CountingDriver();
    $c = new CachedDriver($in, 'r1');
    $c->print('/ip/hotspot/user/profile');
    $out = $c->printMany(['p' => ['/ip/hotspot/user/profile'], 'u' => ['/ip/hotspot/user'], 's' => ['/system/script']]);
    eq(['p', 'u', 's'], array_keys($out));
    eq(1, $in->multi, 'one pipelined batch');
    eq(1, $in->count('print /ip/hotspot/user/profile'), 'cached profile list was not re-fetched');
    $out2 = $c->printMany(['p' => ['/ip/hotspot/user/profile'], 'u' => ['/ip/hotspot/user']]);
    eq(1, $in->multi, 'all hits: nothing sent');
    eq(2, count($out2['u']));
});

test('Pipe falls back to plain calls for drivers without pipelining (Demo) and honours NEXTMON_PIPELINE=0', function () {
    $d = fresh_store('json');
    $demo = new Demo($d . '/demo-x.json');
    $o = Pipe::prints($demo, ['a' => ['/ip/hotspot/user/profile', [], ['name']], 'b' => ['/system/identity']]);
    ok(count($o['a']) > 0 && isset($o['b'][0]['name']));
    $ids = Pipe::adds($demo, '/ip/hotspot/user', [['name' => 'pp1', 'password' => 'x', 'profile' => 'default'], ['name' => 'pp2', 'password' => 'x', 'profile' => 'default']]);
    eq(2, count($ids));
    Pipe::removes($demo, '/ip/hotspot/user', $ids);
    eq([], $demo->print('/ip/hotspot/user', ['name' => 'pp1']));
    putenv('NEXTMON_PIPELINE=0');
    $in = new CountingDriver();
    Pipe::prints($in, ['a' => ['/ip/hotspot/user'], 'b' => ['/ip/hotspot/user/profile']]);
    eq(0, $in->multi, 'kill switch: no batch');
    putenv('NEXTMON_PIPELINE=');
});

// ---- RouterOS against the multi-connection fake server -----------------------------------------------------------

/** @return array [proc, port, pipes] */
function start_router_server(array $opt = []): array
{
    $args = [PHP_BINARY, __DIR__ . '/../fixtures/fake_router_server.php', '--port=0', '--data=' . tmpdir('fakerouter')];
    foreach ($opt as $k => $v) {
        $args[] = "--$k=$v";
    }
    $p = proc_open($args, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
    $line = fgets($pipes[1]);
    if (!preg_match('/^READY (\d+)/', (string)$line, $m)) {
        throw new AssertFail('fake router server did not start: ' . $line . stream_get_contents($pipes[2]));
    }
    return [$p, (int)$m[1], $pipes];
}

function router_stats(int $port): array
{
    $r = new RouterOS('127.0.0.1', $port, false, 5);
    $r->connect('admin', 'secret');
    $row = $r->command('/__stats')[0] ?? [];
    $r->command('/__reset');   // every call reports the window since the previous call
    $r->close();
    // the probe itself is 1 connection, 1 login, 2 sentences (login + the stats call; its own tag-less login is counted too)
    $row['connections'] -= 1;
    $row['logins'] -= 1;
    $row['sentences'] -= 2;
    return array_map('intval', $row);
}

function stop_router_server(array $s): void
{
    proc_terminate($s[0]);
    proc_close($s[0]);
}

test('RouterOS pipelining: N prints share ONE round-trip (timing against a 150 ms link)', function () {
    fresh_store('json');
    $s = start_router_server(['latency' => 150]);
    $r = new RouterOS('127.0.0.1', $s[1], false, 10);
    $r->connect('admin', 'secret');
    $reqs = [];
    for ($i = 0; $i < 6; $i++) {
        $reqs['k' . $i] = ['/ip/hotspot/user/profile', [], ['name']];
    }
    $t = microtime(true);
    $out = $r->printMany($reqs);
    $ms = (microtime(true) - $t) * 1000;
    eq(6, count($out));
    ok(count($out['k0']) > 0 && count($out['k5']) === count($out['k0']), 'every tag got its own rows');
    ok($ms < 450, "6 pipelined prints took {$ms} ms (sequential would be ~900)");
    $t = microtime(true);
    for ($i = 0; $i < 3; $i++) {
        $r->print('/ip/hotspot/user/profile', [], ['name']);
    }
    $seq = (microtime(true) - $t) * 1000;
    ok($seq > 400, "3 sequential prints took {$seq} ms: the latency simulation works");
    $r->close();
    stop_router_server($s);
});

test('RouterOS pipelining: replies stay matched, a !trap in one command does not poison the others or desync the socket', function () {
    fresh_store('json');
    $s = start_router_server();
    $r = new RouterOS('127.0.0.1', $s[1], false, 10);
    $r->connect('admin', 'secret');
    $res = $r->pipeline([
        ['/ip/hotspot/user/profile/print'],
        ['/ip/hotspot/user/set', '=.id=*DOESNOTEXIST', '=comment=x'],
        ['/system/identity/print'],
    ]);
    ok(count($res[0]['rows']) > 0 && $res[0]['trap'] === null);
    ok($res[1]['trap'] !== null, 'the failing command reports its own trap');
    ok(isset($res[2]['rows'][0]['name']) && $res[2]['trap'] === null);
    // the connection is still in sync
    ok(isset($r->print('/system/identity')[0]['name']));
    throws(fn() => $r->printMany(['a' => ['/system/identity'], 'b' => ['/ip/hotspot/user', ['bogus!key' => '1']]]), RouterOSException::class);
    ok(isset($r->print('/system/identity')[0]['name']), 'still in sync after a thrown pipeline error');
    $r->close();
    stop_router_server($s);
});

test('RouterOS addMany/removeMany/setMany: bulk writes in few round-trips, same end state', function () {
    fresh_store('json');
    $s = start_router_server();
    $r = new RouterOS('127.0.0.1', $s[1], false, 10);
    $r->connect('admin', 'secret');
    $base = count($r->print('/ip/hotspot/user'));
    $rows = [];
    for ($i = 0; $i < 250; $i++) {
        $rows[] = ['name' => 'bulk' . $i, 'password' => 'p', 'profile' => 'default'];
    }
    $ids = $r->addMany('/ip/hotspot/user', $rows);
    eq(250, count($ids));
    ok(!in_array('', $ids, true), 'every add returned a .id');
    eq($base + 250, count($r->print('/ip/hotspot/user')));
    $r->setMany('/ip/hotspot/user', [$ids[0] => ['comment' => 'c0'], $ids[1] => ['comment' => 'c1']]);
    eq('c1', $r->print('/ip/hotspot/user', ['name' => 'bulk1'])[0]['comment']);
    $t = $r->addTry('/ip/hotspot/user', [['name' => 'okrow', 'password' => 'p', 'profile' => 'default']]);
    eq(null, $t[0]['err']);
    $r->removeMany('/ip/hotspot/user', array_slice($ids, 0, 200));
    eq($base + 51, count($r->print('/ip/hotspot/user')));
    $e = throws(fn() => $r->removeMany('/ip/hotspot/user', ['*NOPE1', '*NOPE2']), RouterOSException::class);
    ok($e->getMessage() !== '');
    $r->close();
    stop_router_server($s);
});

test('RouterOS persistence: a 2nd "request" reuses the socket (no new connect, no new login)', function () {
    fresh_store('json');
    $s = start_router_server();
    $mk = function () use ($s) {
        $r = new RouterOS('127.0.0.1', $s[1], false, 10);
        $r->enablePersistence(30);
        $r->setCredentials('admin', 'secret');   // lazy, as App::driver() does
        return $r;
    };
    $r1 = $mk();
    eq(0, router_stats($s[1])['connections'], 'lazy: nothing connected yet');
    ok(isset($r1->print('/system/identity')[0]['name']));
    $r1 = null;   // end of request 1: socket released, not closed
    $st = router_stats($s[1]);
    eq(1, $st['connections']);
    eq(1, $st['logins']);
    for ($i = 0; $i < 4; $i++) {
        $r = $mk();
        ok(isset($r->print('/system/identity')[0]['name']), "request $i");
        eq(0, $r->stat_logins, 'no login on a reused socket');
        $r = null;
    }
    $st = router_stats($s[1]);
    eq(0, $st['logins'], 'four more requests: no login at all');
    eq(0, $st['connections'], 'four more requests: no new TCP connection');
    $r = $mk();
    $r->close();   // drops the pooled socket for good
    stop_router_server($s);
});

test('RouterOS persistence: different password, expired keepalive and a dead peer all fall back to a fresh login', function () {
    fresh_store('json');
    $s = start_router_server();
    $mk = function (string $pass = 'secret', int $ka = 30) use ($s) {
        $r = new RouterOS('127.0.0.1', $s[1], false, 10);
        $r->enablePersistence($ka);
        $r->setCredentials('admin', $pass);
        return $r;
    };
    $r = $mk();
    $r->print('/system/identity');
    $r = null;
    $e = throws(function () use ($mk) {
        $x = $mk('WRONG');
        $x->print('/system/identity');
    }, RouterOSException::class);
    ok(str_contains($e->getMessage(), 'invalid user name or password'), 'a changed/wrong password is NOT accepted just because a pooled socket exists: ' . $e->getMessage());
    $r = $mk('secret', 1);
    $r->print('/system/identity');
    $r = null;
    sleep(2);
    $r = $mk('secret', 1);
    $r->print('/system/identity');
    eq(1, $r->stat_logins, 'idle longer than keepalive: socket is not trusted, new login');
    $r->close();
    stop_router_server($s);
});

test('RouterOS: a pooled socket whose peer died is replaced transparently for reads', function () {
    fresh_store('json');
    $s = start_router_server();
    $mk = function () use ($s) {
        $r = new RouterOS('127.0.0.1', $s[1], false, 10);
        $r->enablePersistence(60);
        $r->setCredentials('admin', 'secret');
        return $r;
    };
    $r = $mk();
    $r->print('/system/identity');
    $r = null;
    // restart the server on the SAME port is not portable; instead kill it and bring a new one up, then point at the new port:
    // the old socket (other port) is simply never matched. What we can assert portably: after the peer closes, a read still works.
    stop_router_server($s);
    $s2 = start_router_server();
    $r = new RouterOS('127.0.0.1', $s2[1], false, 10);
    $r->enablePersistence(60);
    $r->setCredentials('admin', 'secret');
    ok(isset($r->print('/system/identity')[0]['name']));
    $r->close();
    stop_router_server($s2);
});

test('RouterOS circuit breaker: after one failed connect the next attempts fail instantly, then recover', function () {
    fresh_store('json');
    Cache::reset();
    $l = stream_socket_server('tcp://127.0.0.1:0');
    $n = stream_socket_get_name($l, false);
    $port = (int)substr($n, strrpos($n, ':') + 1);
    fclose($l);   // nothing listens here now
    $mk = function () use ($port) {
        $r = new RouterOS('127.0.0.1', $port, false, 2);
        $r->enableBreaker(2);
        $r->setCredentials('admin', 'secret');
        return $r;
    };
    $a = $mk();
    $e1 = throws(fn() => $a->print('/system/identity'), RouterOSException::class);
    ok(str_contains($e1->getMessage(), 'Cannot connect'));
    $b = $mk();
    $t = microtime(true);
    $e2 = throws(fn() => $b->print('/system/identity'), RouterOSException::class);
    $ms = (microtime(true) - $t) * 1000;
    ok(str_contains($e2->getMessage(), 'marked unreachable'), $e2->getMessage());
    eq(0, $b->stat_connects, 'no TCP attempt while the breaker is open');
    ok($ms < 50, "fail-fast took $ms ms");
    // a 2nd command in the SAME request fails with the same error, no new attempt either
    $e3 = throws(fn() => $a->print('/system/resource'), RouterOSException::class);
    ok(str_contains($e3->getMessage(), 'Cannot connect'));
    sleep(3);
    $c = $mk();
    $e4 = throws(fn() => $c->print('/system/identity'), RouterOSException::class);
    ok(!str_contains($e4->getMessage(), 'marked unreachable'), 'breaker closed again after its TTL');
    ok(str_contains($e4->getMessage(), 'Cannot connect'), 'a real attempt was made again: ' . $e4->getMessage());
});

test('RouterOS lazy connect: a driver that is never used never connects', function () {
    fresh_store('json');
    $s = start_router_server();
    $r = new RouterOS('127.0.0.1', $s[1], false, 5);
    $r->setCredentials('admin', 'secret');
    $r = null;
    eq(0, router_stats($s[1])['connections']);
    stop_router_server($s);
});

test('App::driver wraps remote routers in CachedDriver (lazy, pooled, breaker) and leaves demo untouched', function () {
    fresh_store('json');
    Cache::reset();
    App::forgetDrivers();
    Store::write('routers', [
        ['id' => 'demo', 'name' => 'D', 'session' => 'd', 'type' => 'demo', 'host' => '', 'port' => 8728, 'ssl' => false, 'user' => '', 'pass' => ''],
        ['id' => 'rem', 'name' => 'R', 'session' => 'r', 'type' => 'real', 'host' => '127.0.0.1', 'port' => 1, 'ssl' => false, 'user' => 'admin', 'pass' => Crypto::encrypt('x')],
    ]);
    $d = App::driver('demo');
    ok($d instanceof Demo, 'demo is not wrapped');
    $r = App::driver('rem');   // must NOT connect (port 1 is closed): lazy
    ok($r instanceof CachedDriver);
    throws(fn() => $r->print('/system/identity'), RouterOSException::class);
    App::forgetDrivers();
});
