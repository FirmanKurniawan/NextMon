<?php
/**
 * Multi-tenant core: Workspace, Store namespacing (both backends), fail-closed, migration, shares (ro/rw), suspension, indexes, scheduler.
 * The HTTP-level attack suite lives in tests/tenant_isolation_test.php.
 */

/** Fresh data dir + backend, no workspace active, helper users/workspaces created through the real API. */
function tn_store(string $be = ''): string
{
    $d = fresh_store($be);
    Workspace::set('main');
    $_SESSION = [];
    Auth::forget();
    App::$impersonating = false;
    App::forgetDrivers();
    Cache::reset();
    return $d;
}

function tn_ws(string $name, string $owner, array $extra = []): array
{
    return Workspace::create(['name' => $name, 'owner' => $owner, 'password' => 'Tenant-Pass-9x!', 'limits' => $extra['limits'] ?? []] + $extra);
}

foreach (['json', 'sqlite'] as $be) {
    $skip = $be === 'sqlite' && !SqliteStore::available();
    $T = function (string $n, callable $f) use ($be, $skip) {
        test("[$be] tenant: $n", function () use ($be, $skip, $f) {
            if ($skip) {
                return;
            }
            $d = tn_store($be);
            eq($be, Store::backendName(), 'backend');
            $f($d);
        });
    };

    $T('per-workspace collections are isolated, global ones are shared', function () {
        $a = tn_ws('Alpha', 'alice')['id'];
        $b = tn_ws('Beta', 'bob')['id'];
        Workspace::run($a, function () {
            Store::write('routers', [['id' => 'r-a']]);
            Store::appendLog('audit.log', ['ts' => 1, 'm' => 'A']);
            Store::saveSettings(['hotspot_name' => 'A-net']);
            Store::append('ledger', ['id' => 'x1']);
        });
        Workspace::run($b, function () {
            eq([], Store::read('routers', []), 'B does not see A routers');
            eq([], Store::tailLog('audit.log', 10), 'B does not see A log');
            eq(0, Store::count('ledger'));
            ok(!Store::has('routers'));
            Store::write('routers', [['id' => 'r-b']]);
            Store::appendLog('audit.log', ['ts' => 2, 'm' => 'B']);
            eq('Beta', Store::setting('hotspot_name'), 'settings are per workspace (set at creation)');
        });
        Workspace::run($a, function () {
            eq([['id' => 'r-a']], Store::read('routers'));
            eq('A-net', Store::setting('hotspot_name'), 'settings cache follows the workspace');
            eq(1, Store::count('audit.log'));
            eq('A', Store::tailLog('audit.log', 1)[0]['m']);
            ok(in_array('routers', Store::names()) && !in_array('users', Store::names()), 'names() lists this workspace only');
        });
        // global docs: same data from anywhere
        ok(count(Auth::allUsers()) >= 2);
        eq(count(Auth::allUsers()), count(Store::global('users')->read([])));
        throws(fn() => Store::global('routers'), InvalidArgumentException::class, 'routers is not a global collection');
    });

    $T('no active workspace: per-workspace access throws, globals still work (fail closed)', function () {
        Workspace::clear();
        foreach ([
            fn() => Store::read('routers', []), fn() => Store::write('routers', []), fn() => Store::update('settings', fn($x) => $x, []),
            fn() => Store::appendLog('audit.log', ['ts' => 1]), fn() => Store::tailLog('audit.log'), fn() => Store::rows('ledger'),
            fn() => Store::count('ledger'), fn() => Store::prune('ledger', 1), fn() => Store::has('routers'), fn() => Store::delete('routers'),
            fn() => Workspace::id(), fn() => Workspace::dir('orders'), fn() => Orders::dir(),
        ] as $i => $fn) {
            throws($fn, NoWorkspaceException::class, "call #$i must fail closed");
        }
        eq([], Store::read('users', []));
        eq([], Store::read('workspaces', []));
        Store::write('rate_limits', ['k' => 1]);
        eq(['k' => 1], Store::read('rate_limits'));
        // settings never throw and never expose tenant data
        eq('Asia/Jakarta', Store::setting('timezone'));
        Workspace::set('main');
        Store::saveSettings(['currency' => 'EUR']);
        Workspace::clear();
        eq('Rp', Store::setting('currency'), 'logged-out pages see defaults, not a tenant');
    });

    $T('Workspace::run restores the previous workspace, also when the callback throws', function () {
        $a = tn_ws('Alpha', 'alice')['id'];
        Workspace::set('main');
        eq($a, Workspace::run($a, fn() => Workspace::id()));
        eq('main', Workspace::id());
        throws(fn() => Workspace::run($a, function () {
            throw new RuntimeException('boom');
        }), RuntimeException::class);
        eq('main', Workspace::id());
        Workspace::clear();
        Workspace::run($a, fn() => 1);
        eq(null, Workspace::idOrNull());
        throws(fn() => Workspace::run('../../etc', fn() => 1), InvalidArgumentException::class);
        throws(fn() => Workspace::set('w_XYZ'), InvalidArgumentException::class);
    });

    $T('workspace ids and the storage key cannot be used for path traversal', function ($d) {
        $b = Store::backend();
        foreach (['../x', 'ws/../x', 'ws/w_12345678/../../x', 'ws/w_1234567/x', 'a/b'] as $bad) {
            if ($b instanceof JsonStore) {
                throws(fn() => $b->write($bad, [1]), InvalidArgumentException::class, $bad);
            }
        }
        $a = tn_ws('Alpha', 'alice')['id'];
        Workspace::run($a, function () {
            Store::write('we/../ird', [1]);   // sanitised inside the workspace, never escapes it
            eq([1], Store::read('we_.._ird'));
        });
        ok(!is_file(dirname($d) . '/x.json'));
    });

    $T('workspace dirs: orders / backups / cache / demo live under ws/<id>', function ($d) {
        $a = tn_ws('Alpha', 'alice')['id'];
        $b = tn_ws('Beta', 'bob')['id'];
        $da = Workspace::run($a, fn() => Workspace::dir('orders'));
        $db = Workspace::run($b, fn() => Workspace::dir('orders'));
        ok($da !== $db && is_dir($da) && is_dir($db));
        ok(str_contains($da, "/ws/$a/orders"));
        Workspace::run($a, function () {
            $o = Orders::create(['id' => 'p1', 'profile' => '1Jam', 'price' => 1000, 'label' => '1 Jam'], ['name' => 'N', 'phone' => '', 'email' => ''], 'manual', 30, 'r1');
            ok(preg_match('/^KL\d{6}-[A-F0-9]{6}-[A-F0-9]{8}$/', $o['id']) === 1, 'order id carries the workspace: ' . $o['id']);
            eq(Workspace::id(), Orders::workspaceOf($o['id']));
            eq(Workspace::id(), Orders::workspaceOf('payload {"order_id":"' . $o['id'] . '"}'));
            $GLOBALS['__o'] = $o;
        });
        Workspace::run($b, fn() => eq(null, Orders::get($GLOBALS['__o']['id']), 'B cannot read A order even with the exact id'));
        eq('main', Orders::workspaceOf('KL250101-ABCDEF'), 'legacy ids belong to main');
        eq(null, Orders::workspaceOf('nothing here'));
    });

    $T('concurrent updates from several processes stay inside their workspace', function ($d) use ($be) {
        $a = tn_ws('Alpha', 'alice')['id'];
        $b = tn_ws('Beta', 'bob')['id'];
        $worker = tmpdir('w') . '/worker.php';
        file_put_contents($worker, '<?php require ' . var_export(dirname(__DIR__) . '/bootstrap.php', true)
            . '; putenv("NEXTMON_DATA=' . $d . '"); putenv("NEXTMON_STORAGE=' . $be . '"); Store::reset(); Workspace::set($argv[1]);'
            . 'for ($i = 0; $i < 20; $i++) { Store::update("counter", fn($c) => ["n" => ($c["n"] ?? 0) + 1], []); Store::appendLog("w.log", ["ts" => $i]); }');
        $procs = [];
        foreach ([$a, $a, $b, $b] as $w) {
            $procs[] = [proc_open([PHP_BINARY, $worker, $w], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes), $pipes];
        }
        $err = '';
        foreach ($procs as [$p, $pipes]) {
            $err .= stream_get_contents($pipes[1]) . stream_get_contents($pipes[2]);
            proc_close($p);
        }
        Store::reset();
        putenv('NEXTMON_DATA=' . $d);
        putenv('NEXTMON_STORAGE=' . $be);
        Workspace::set($a);
        eq(40, Store::read('counter')['n'], 'A counter ' . trim($err));
        eq(40, Store::count('w.log'));
        Workspace::set($b);
        eq(40, Store::read('counter')['n'], 'B counter');
        eq(40, Store::count('w.log'));
        Workspace::set('main');
        eq(0, Store::count('w.log'), 'main untouched');
    });

    $T('Workspace::create: record, owner account, slug rules, limits, delete', function () {
        $w = tn_ws('Warung Budi', 'budi', ['limits' => ['routers' => 2]]);
        ok(preg_match('/^w_[a-f0-9]{8}$/', $w['id']) === 1);
        eq('warung-budi', $w['slug']);
        eq('active', $w['status']);
        $u = Auth::find('budi');
        eq($w['id'], $u['workspace']);
        eq('admin', $u['role']);
        eq($u['id'], Workspace::get($w['id'])['owner']);
        eq(2, Workspace::limits($w['id'])['routers']);
        eq(Workspace::LIMIT_DEFAULTS['staff'], Workspace::limits($w['id'])['staff'], 'platform default applies');
        eq('Warung Budi', Workspace::run($w['id'], fn() => Store::setting('hotspot_name')));
        eq($w['id'], Workspace::bySlug('WARUNG-budi')['id']);
        foreach ([['slug' => 'warung-budi', 'owner' => 'other'], ['slug' => 'x', 'owner' => 'other2'], ['slug' => 'platform', 'owner' => 'other3'], ['slug' => 'ok-slug', 'owner' => 'budi'], ['slug' => 'ok-slug', 'owner' => 'bad name']] as $bad) {
            throws(fn() => Workspace::create(['name' => 'N', 'password' => 'Tenant-Pass-9x!'] + $bad), InvalidArgumentException::class, json_encode($bad));
        }
        throws(fn() => Workspace::create(['name' => 'N', 'slug' => 'weakpw', 'owner' => 'weak', 'password' => '123']), InvalidArgumentException::class, 'password policy');
        eq(null, Auth::find('weak'), 'failed create leaves no account');
        eq(null, Workspace::bySlug('weakpw'), 'failed create leaves no workspace');
        ok(Workspace::allows('routers', 1, $w['id']) && !Workspace::allows('routers', 2, $w['id']));
        Workspace::update($w['id'], ['limits' => ['routers' => 0]]);
        ok(Workspace::allows('routers', 99, $w['id']), '0 = unlimited');
        Workspace::run($w['id'], function () {
            Store::write('routers', [['id' => 'x']]);
            Workspace::indexKey('abc123');
        });
        ok(Workspace::delete($w['id']));
        eq(null, Workspace::get($w['id']));
        eq(null, Auth::find('budi'), 'owner account removed with the workspace');
        eq(null, Workspace::wsByKeyHash('abc123'), 'index entries removed');
        eq([], Workspace::run('main', fn() => Store::names()) ? [] : [], 'sanity');
        ok(!in_array("ws/{$w['id']}/routers", Store::allNames()), 'documents purged');
        ok(!Workspace::delete('main'), 'main cannot be deleted');
    });

    $T('suspended workspace: login blocked, platform admin exempt, cron skips it, public resolution refuses', function () {
        I18n::init('en');
        $w = tn_ws('Gamma', 'gina');
        Auth::create('root', 'Tenant-Pass-9x!', 'platform', '', 'main');
        Workspace::setStatus($w['id'], 'suspended');
        ok(!Workspace::isActive($w['id']) && Workspace::status($w['id']) === 'suspended');
        [$ok, $msg] = Auth::attempt('gina', 'Tenant-Pass-9x!', '10.9.9.9');
        ok(!$ok && str_contains($msg, 'suspended'), $msg);
        [$ok, $msg] = Auth::attempt('gina', 'wrong', '10.9.9.8');
        ok(!$ok && !str_contains($msg, 'suspended'), 'a wrong password must not reveal the suspension');
        // an existing session of a suspended workspace is dropped on the next request
        $_SESSION = ['uid' => Auth::find('gina')['id']];
        Auth::forget();
        eq(null, Auth::user(), 'session of a suspended workspace is dead');
        // platform admin may enter a suspended workspace (to manage it) but its own home may be suspended without lockout
        $_SESSION = ['uid' => Auth::find('root')['id'], 'ws_switch' => $w['id']];
        Auth::forget();
        eq('root', Auth::user()['username']);
        eq($w['id'], Workspace::id());
        ok(App::$impersonating);
        // a non-platform user can never use ws_switch
        $_SESSION = ['uid' => Auth::find('gina')['id'], 'ws_switch' => 'main'];
        Auth::forget();
        eq(null, Auth::user());
        Workspace::setStatus($w['id'], 'active');
        $_SESSION = ['uid' => Auth::find('gina')['id'], 'ws_switch' => 'main'];
        Auth::forget();
        eq($w['id'], Auth::user() ? Workspace::id() : null, 'ws_switch from a normal user is ignored');
        // public + api + cron
        Workspace::setStatus($w['id'], 'suspended');
        Workspace::run($w['id'], fn() => Store::write('routers', [['id' => 'r1', 'name' => 'R', 'session' => 'gsess', 'type' => 'demo']]));
        Workspace::run($w['id'], fn() => Workspace::reindexSessions());
        eq(null, Workspace::bySession('gsess'), 'suspended workspace is not resolvable by session name');
        $_GET = ['w' => $w['slug']];
        eq([null, 'suspended'], Workspace::resolvePublic('/shop'));
        $_GET = [];
        $res = Scheduler::run([], true, 'test');
        ok(!in_array($w['id'], array_column($res['jobs'], 'ws'), true), 'cron skips suspended workspaces');
        Workspace::setStatus($w['id'], 'active');
        $_GET = ['w' => $w['slug']];
        eq([$w['id'], null], Workspace::resolvePublic('/shop'));
        $_GET = ['w' => 'nope'];
        eq([null, 'unknown'], Workspace::resolvePublic('/shop'));
        $_GET = [];
        eq(['main', null], Workspace::resolvePublic('/shop'), 'no ?w= falls back to main');
    });

    $T('indexes: api key hash -> workspace, status session -> workspace (ambiguity needs ?w=)', function () {
        $a = tn_ws('Alpha', 'alice')['id'];
        $b = tn_ws('Beta', 'bob')['id'];
        foreach ([$a, $b] as $w) {
            Workspace::run($w, function () {
                Store::write('routers', [['id' => 'r1', 'name' => 'R', 'session' => 'hotspot1', 'type' => 'demo']]);
                Workspace::reindexSessions();
            });
        }
        Workspace::run($a, fn() => Workspace::indexKey(hash('sha256', 'kl_key_a')));
        eq($a, Workspace::wsByKeyHash(hash('sha256', 'kl_key_a')));
        eq(null, Workspace::wsByKeyHash(hash('sha256', 'kl_key_b')));
        Workspace::run($a, fn() => Workspace::unindexKey(hash('sha256', 'kl_key_a')));
        eq(null, Workspace::wsByKeyHash(hash('sha256', 'kl_key_a')));
        eq(null, Workspace::bySession('hotspot1'), 'same session name in two workspaces is ambiguous without ?w=');
        $slugB = Workspace::get($b)['slug'];
        eq($b, Workspace::bySession('HotSpot1', $slugB)['ws']);
        eq('r1', Workspace::bySession('hotspot1', $slugB)['rid']);
        eq(null, Workspace::bySession('hotspot1', 'unknown-slug'));
        Workspace::run($b, function () {
            Store::write('routers', []);
            Workspace::reindexSessions();
        });
        eq($a, Workspace::bySession('hotspot1')['ws'], 'unique again once B dropped it');
    });

    $T('audit rows carry workspace + actor, and via=platform when impersonating', function () {
        $a = tn_ws('Alpha', 'alice');
        $root = Auth::create('root', 'Tenant-Pass-9x!', 'platform', '', 'main');
        $_SESSION = ['uid' => Auth::find('alice')['id']];
        Auth::forget();
        Auth::user();
        Audit::log('x.test', 'hello');
        $r = Store::tailLog('audit.log', 1)[0];
        eq($a['id'], $r['workspace']);
        eq('alice', $r['actor']);
        ok(!isset($r['via']));
        $_SESSION = ['uid' => $root['id'], 'ws_switch' => $a['id']];
        Auth::forget();
        Auth::user();
        Audit::log('x.test2');
        $r = Store::tailLog('audit.log', 1)[0];
        eq($a['id'], $r['workspace']);
        eq('root', $r['actor']);
        eq('platform', $r['via'] ?? null);
        eq(0, Workspace::run('main', fn() => Store::count('audit.log')), 'nothing leaked into main');
    });

    $T('Cache keys include the workspace', function () {
        $a = tn_ws('Alpha', 'alice')['id'];
        $b = tn_ws('Beta', 'bob')['id'];
        Workspace::run($a, fn() => Cache::set('dash:r1', ['A'], 60));
        eq(['A'], Workspace::run($a, fn() => Cache::get('dash:r1')));
        eq(null, Workspace::run($b, fn() => Cache::get('dash:r1')), 'B never sees A cache entry');
        Workspace::run($a, fn() => Cache::bump('x'));
        $ga = Workspace::run($a, fn() => Cache::gen('x'));
        $gb = Workspace::run($b, fn() => Cache::gen('x'));
        ok($ga !== '0' && $gb === '0', 'generations are per workspace');
        // router-scoped namespaces carry the OWNER workspace
        eq("rt:$a:r1", CachedDriver::nsFor('r1', $a));
    });

    $T('scheduler runs every active workspace in its own context', function () {
        putenv('NEXTMON_DEMO=1');
        $a = tn_ws('Alpha', 'alice')['id'];
        $b = tn_ws('Beta', 'bob')['id'];
        foreach ([$a, $b] as $w) {
            Workspace::run($w, fn() => Store::write('routers', [['id' => 'r-' . substr(Workspace::id(), 2, 3), 'name' => 'R', 'session' => 's', 'type' => 'demo']]));
        }
        $res = Scheduler::run(['poll'], true, 'test');
        $by = [];
        foreach ($res['jobs'] as $j) {
            $by[$j['ws']] = $j;
            ok($j['ok'], $j['ws'] . ': ' . $j['msg']);
        }
        ok(isset($by[$a]) && isset($by[$b]), 'both workspaces ran');
        $ha = Workspace::run($a, fn() => array_keys(array_filter(Store::names(), fn($n) => str_starts_with($n, 'monitor-hist-'))));
        $hb = Workspace::run($b, fn() => array_keys(array_filter(Store::names(), fn($n) => str_starts_with($n, 'monitor-hist-'))));
        eq(1, count($ha));
        eq(1, count($hb));
        ok(Workspace::run($a, fn() => Store::names()) !== [] && !in_array('monitor-hist-r-' . substr($b, 2, 3), Workspace::run($a, fn() => Store::names())), 'A has no history of B router');
        eq(0, count(Workspace::run('main', fn() => array_filter(Store::names(), fn($n) => str_starts_with($n, 'monitor-hist-')))), 'main has none');
        $only = Scheduler::run(['poll'], true, 'test', [$a]);
        eq([$a], array_values(array_unique(array_column($only['jobs'], 'ws'))), 'restricted to one workspace');
        // tokens: platform token = all, workspace token = that workspace only, garbage = nothing
        $tokA = Workspace::run($a, fn() => Monitor::token());
        eq([$a], Scheduler::tokenScope($tokA));
        eq(['*'], Scheduler::tokenScope(Workspace::platformCronToken()));
        eq(null, Scheduler::tokenScope('nope'));
        eq(null, Scheduler::tokenScope(''));
        Workspace::setStatus($a, 'suspended');
        eq(null, Scheduler::tokenScope($tokA), 'a suspended workspace token stops working');
        putenv('NEXTMON_DEMO=');
    });

    $T('router limit and staff limit are enforced through the allows() contract', function () {
        $w = tn_ws('Delta', 'dan', ['limits' => ['routers' => 1, 'staff' => 1]]);
        $l = Workspace::limits($w['id']);
        eq(1, $l['routers']);
        ok(Workspace::allows('routers', 0, $w['id']));
        ok(!Workspace::allows('routers', 1, $w['id']));
        ok(!Workspace::allows('staff', 1, $w['id']));
    });

    // ---- shares ----------------------------------------------------------------------------------------------

    $T('shared router: ro denies every write centrally, rw allows, credentials never reach the recipient, revoke cuts access', function () {
        putenv('NEXTMON_DEMO=1');   // every "real" router resolves to a Demo driver: no device needed, state lives in the OWNER workspace
        $a = tn_ws('Alpha', 'alice')['id'];
        $b = tn_ws('Beta', 'bob')['id'];
        $secret = Crypto::encrypt('SUPER-SECRET-ROUTER-PASSWORD');
        Workspace::run($a, function () use ($secret) {
            Store::write('routers', [
                ['id' => 'r1', 'name' => 'Shared one', 'session' => 'sh', 'type' => 'real', 'host' => '203.0.113.7', 'port' => 8728, 'ssl' => false, 'user' => 'apiuser-a', 'pass' => $secret, 'hotspot_name' => 'A'],
                ['id' => 'priv', 'name' => 'Private', 'session' => 'pv', 'type' => 'real', 'host' => '203.0.113.8', 'port' => 8728, 'ssl' => false, 'user' => 'u', 'pass' => $secret],
                ['id' => 'demo', 'name' => 'Demo', 'session' => 'dm', 'type' => 'demo'],
            ]);
            throws(fn() => Share::grant('nope', 'beta', 'ro'), InvalidArgumentException::class, 'unknown router');
            throws(fn() => Share::grant('r1', Workspace::id(), 'ro'), InvalidArgumentException::class, 'self');
            throws(fn() => Share::grant('r1', 'w_00000000', 'ro'), InvalidArgumentException::class, 'unknown target');
        });
        // nothing is visible before sharing
        eq([], Workspace::run($b, fn() => array_column(App::routers(), 'id')), 'B has no routers of its own');
        $share = Workspace::run($a, fn() => Share::grant('r1', Workspace::get($b)['slug'], 'ro'));
        eq('ro', $share['mode']);
        Workspace::run($b, function () use ($a) {
            $list = App::routers();
            $ids = array_column($list, 'id');
            ok(in_array('r1', $ids, true) && !in_array('priv', $ids, true), 'only the shared router appears');
            $r = App::routerCfg('r1');
            ok(!empty($r['shared']) && $r['mode'] === 'ro' && $r['owner_ws'] === $a);
            $dump = json_encode($list);
            foreach (['SUPER-SECRET', 'v1:', 'apiuser-a', '203.0.113.7', 'Private'] as $needle) {
                ok(!str_contains($dump, $needle), "recipient UI data leaks '$needle'");
            }
            eq(null, App::routerCfg('priv'), 'unshared router id guessed by B is unknown');
            throws(fn() => App::driver('priv'), RouterOSException::class);
            ok(App::isShared('r1') && !App::isShared('nope'));
            eq($a, App::routerOwner('r1'));
            // reads work ...
            $d = App::driver('r1');
            ok($d instanceof ReadOnlyDriver);
            ok(is_array($d->print('/ip/hotspot/user/profile')), 'read');
            ok(is_array(Pipe::prints($d, ['a' => ['/ip/hotspot/user'], 'b' => ['/ip/hotspot/active']])), 'pipelined read');
            ok(is_array($d->command('/tool/ping', ['address' => '1.1.1.1'])), 'read-only command');
            // ... every write is refused before it can reach the device
            foreach ([
                fn() => $d->add('/ip/hotspot/user', ['name' => 'evil']), fn() => $d->set('/ip/hotspot/user', '*1', ['disabled' => 'yes']),
                fn() => $d->remove('/ip/hotspot/user', '*1'), fn() => $d->command('/system/backup/save', ['name' => 'x']),
                fn() => $d->command('/system/reset-configuration'), fn() => $d->command('/export', ['file' => 'x']),
                fn() => Pipe::adds($d, '/ip/hotspot/user', [['name' => 'a'], ['name' => 'b']]), fn() => Pipe::tryAdds($d, '/ip/hotspot/user', [['name' => 'a'], ['name' => 'b']]),
                fn() => $d->removeMany('/ip/hotspot/user', ['*1']), fn() => $d->setMany('/ip/hotspot/user', ['*1' => ['x' => 'y']]),
            ] as $i => $w) {
                throws($w, RouterOSException::class, "ro write #$i");
            }
            // the same refusal through the other entry point (Orders / Monitor / Status use driverFor)
            throws(fn() => App::driverFor(App::routerCfg('r1'))->add('/ip/hotspot/user', ['name' => 'evil']), RouterOSException::class);
        });
        Workspace::run($a, fn() => eq([], array_filter(App::driver('r1')->print('/ip/hotspot/user'), fn($u) => ($u['name'] ?? '') === 'evil'), 'nothing was written'));

        // upgrade to rw
        Workspace::run($a, fn() => Share::grant('r1', $b, 'rw'));
        eq(1, count(Workspace::run($a, fn() => Share::outgoing('r1'))), 're-sharing replaces, never duplicates');
        Workspace::run($b, function () {
            App::forgetDrivers();
            $d = App::driver('r1');
            ok(!($d instanceof ReadOnlyDriver));
            $d->add('/ip/hotspot/user', ['name' => 'viaB', 'password' => 'p', 'profile' => 'default']);
            eq(1, count($d->print('/ip/hotspot/user', ['name' => 'viaB'])));
        });
        Workspace::run($a, function () {
            App::forgetDrivers();
            eq(1, count(App::driver('r1')->print('/ip/hotspot/user', ['name' => 'viaB'])), 'the write landed on the OWNER router state');
        });
        // revoke (by the owner)
        $sid = Workspace::run($a, fn() => Share::outgoing('r1')[0]['id']);
        ok(!Workspace::run($b, fn() => Share::revoke('deadbeef')), 'unknown share');
        ok(Workspace::run($a, fn() => Share::revoke($sid)));
        Workspace::run($b, function () {
            App::forgetDrivers();
            eq(null, App::routerCfg('r1'));
            throws(fn() => App::driver('r1'), RouterOSException::class);
            eq(null, Share::for('r1'));
        });
        // suspended owner cuts the share off too
        Workspace::run($a, fn() => Share::grant('r1', $b, 'ro'));
        Workspace::setStatus($a, 'suspended');
        eq([], Workspace::run($b, fn() => array_values(array_filter(array_column(App::routers(), 'id'), fn($i) => $i === 'r1'))));
        // a third workspace cannot revoke someone else's share
        Workspace::setStatus($a, 'active');
        $c = tn_ws('Gamma', 'gina')['id'];
        $sid = Workspace::run($a, fn() => Share::outgoing('r1')[0]['id']);
        ok(!Workspace::run($c, fn() => Share::revoke($sid)), 'third party cannot revoke');
        // recipient may drop what it received; deleting the router drops its shares
        ok(Workspace::run($b, fn() => Share::revoke($sid)));
        Workspace::run($a, function () {
            Share::grant('r1', 'gamma', 'ro');
            Share::dropRouter('r1');
            eq([], Share::outgoing());
        });
        putenv('NEXTMON_DEMO=');
    });

    $T('platform switch: only role platform may switch; the workspace comes from the server session', function () {
        $a = tn_ws('Alpha', 'alice');
        $b = tn_ws('Beta', 'bob');
        Auth::create('root', 'Tenant-Pass-9x!', 'platform', '', 'main');
        ok(Auth::can('platform') === false, 'nobody logged in');
        $_SESSION = ['uid' => Auth::find('alice')['id']];
        Auth::forget();
        ok(!Auth::can('platform') && Auth::can('admin'));
        eq($a['id'], Workspace::id());
        $_SESSION = ['uid' => Auth::find('root')['id']];
        Auth::forget();
        ok(Auth::can('platform') && Auth::can('admin') && Auth::can('write'));
        eq('main', Workspace::id());
        ok(!App::$impersonating);
        $_SESSION['ws_switch'] = $b['id'];
        Auth::forget();
        Auth::user();
        eq($b['id'], Workspace::id());
        ok(App::$impersonating);
        $_SESSION['ws_switch'] = 'w_deadbeef';   // unknown: ignored, back home
        Auth::forget();
        Auth::user();
        eq('main', Workspace::id());
        ok(!App::$impersonating);
        $_SESSION['ws_switch'] = '../../x';
        Auth::forget();
        Auth::user();
        eq('main', Workspace::id());
        // users() is scoped to the active workspace, allUsers() is global
        Workspace::set($a['id']);
        eq(['alice'], array_column(Auth::users(), 'username'));
        ok(count(Auth::allUsers()) === 3);
        eq(null, Auth::inWorkspace(Auth::find('bob')['id']), 'a user id from another workspace is invisible');
    });
}

// ---- migration (JSON + SQLite) --------------------------------------------------------------------------------

foreach (['json', 'sqlite'] as $be) {
    $skip = $be === 'sqlite' && !SqliteStore::available();
    test("[$be] tenant migration: legacy single-owner data moves into workspace main (backup, idempotent)", function () use ($be, $skip) {
        if ($skip) {
            return;
        }
        $d = fresh_store($be);
        Workspace::clear();
        putenv('NEXTMON_TENANT_AUTO=0');   // build the legacy layout first
        Store::reset();
        $legacyUsers = [
            ['id' => 'u1', 'username' => 'owner', 'name' => 'Owner', 'hash' => Auth::hash('x'), 'role' => 'admin', 'created' => 100],
            ['id' => 'u2', 'username' => 'second', 'name' => 'Second', 'hash' => Auth::hash('x'), 'role' => 'admin', 'created' => 200],
            ['id' => 'u3', 'username' => 'op', 'name' => 'Op', 'hash' => Auth::hash('x'), 'role' => 'operator', 'created' => 300],
        ];
        $legacyRouters = [['id' => 'abc12345', 'name' => 'Old router', 'session' => 'old', 'type' => 'real', 'host' => '10.0.0.1', 'port' => 8728, 'ssl' => false, 'user' => 'u', 'pass' => Crypto::encrypt('pw')]];
        $b = Store::backend();   // no auto migration yet
        // write the pre-multi-tenant layout straight into the backend (no namespace)
        $b->write('users', $legacyUsers);
        $b->write('routers', $legacyRouters);
        $b->write('settings', ['hotspot_name' => 'Old WiFi', 'currency' => 'USD']);
        $b->write('apikeys', [['id' => 'k1', 'name' => 'n', 'scope' => 'read', 'hash' => hash('sha256', 'legacykey'), 'prefix' => 'kl_', 'created' => 1, 'last' => 0]]);
        $b->write('shop', ['enabled' => true]);
        $b->write('login_attempts', ['ip:1.2.3.4' => ['n' => 1, 't' => time()]]);
        $b->append('audit.log', ['ts' => 5, 'user' => 'owner', 'action' => 'old.action']);
        $b->append('ledger', ['id' => 'l1', 'type' => 'topup']);
        @mkdir($d . '/orders', 0775, true);
        file_put_contents($d . '/orders/KL250101-ABCDEF.json', json_encode(['id' => 'KL250101-ABCDEF', 'token' => 't', 'created' => 1, 'status' => 'paid']));
        @mkdir($d . '/backups/abc12345', 0775, true);
        file_put_contents($d . '/backups/abc12345/x.rsc', '# export');
        file_put_contents($d . '/demo-demo.json', json_encode(['t' => ['/ip/hotspot/user' => [['name' => 'legacyuser']]]]));
        eq(false, TenantMigration::done());
        $st = TenantMigration::status();
        ok($st['legacy_collections'] && $st['users_without_workspace'] === 3 && $st['legacy_dirs'] === ['orders', 'backups'] && $st['legacy_demo_files'] === 1, json_encode($st));

        // first normal use triggers the migration
        putenv('NEXTMON_TENANT_AUTO=');
        Store::reset();
        putenv('NEXTMON_DATA=' . $d);
        putenv('NEXTMON_STORAGE=' . $be);
        Store::backend();
        ok(TenantMigration::done(), 'marker written');
        $bk = glob($d . '/backup-tenant-*');
        eq(1, count($bk), 'one backup dir');
        ok(is_dir($bk[0] . '/orders') && is_file($bk[0] . '/demo-demo.json'), 'backup holds orders + demo state');
        ok($be === 'sqlite' ? is_file($bk[0] . '/nextmon.db') : is_file($bk[0] . '/routers.json'), 'backup holds the data');

        Workspace::set('main');
        eq($legacyRouters, Store::read('routers'), 'routers moved');
        eq('Old WiFi', Store::setting('hotspot_name'));
        eq('USD', Store::setting('currency'));
        eq('old.action', Store::tailLog('audit.log', 1)[0]['action']);
        eq(1, Store::count('ledger'));
        eq(['enabled' => true], Store::read('shop'));
        ok(is_file($d . '/ws/main/orders/KL250101-ABCDEF.json') && !is_dir($d . '/orders'), 'orders dir moved');
        ok(is_file($d . '/ws/main/backups/abc12345/x.rsc') && !is_dir($d . '/backups'), 'backups dir moved');
        ok(is_file($d . '/ws/main/demo/demo.json') && !is_file($d . '/demo-demo.json'), 'demo state moved');
        eq('KL250101-ABCDEF', Orders::get('KL250101-ABCDEF')['id'], 'legacy order id still valid');
        // global stuff stays global; users got a workspace; oldest admin is platform + owner
        ok(isset(Store::read('login_attempts')['ip:1.2.3.4']), 'login_attempts stayed global');
        $users = array_column(Auth::allUsers(), null, 'username');
        eq('platform', $users['owner']['role']);
        eq('admin', $users['second']['role']);
        eq('operator', $users['op']['role']);
        foreach ($users as $u) {
            eq('main', $u['workspace']);
        }
        $main = Workspace::get('main');
        eq('main', $main['id']);
        eq('u1', $main['owner']);
        eq('active', $main['status']);
        eq(0, Workspace::limits('main')['routers'], 'main is unlimited');
        eq('main', Workspace::wsByKeyHash(hash('sha256', 'legacykey')), 'api key index rebuilt');
        eq('main', Workspace::bySession('old')['ws'], 'session index rebuilt');
        ok(!in_array('routers', Store::allNames(), true), 'no un-namespaced per-workspace docs are left');
        // idempotent: a second run (marker removed) changes nothing and finds nothing to move
        unlink($d . '/tenant.migrated');
        Store::reset();
        putenv('NEXTMON_DATA=' . $d);
        putenv('NEXTMON_STORAGE=' . $be);
        $r = TenantMigration::run();
        eq(0, $r['docs'] + $r['logs'] + $r['users'], 'nothing left to move');
        eq($legacyRouters, Store::read('routers'));
        eq(1, Store::count('ledger'), 'logs not duplicated');
        eq(1, count(array_filter(Auth::allUsers(), fn($u) => $u['role'] === 'platform')), 'still exactly one platform admin');
    });

    test("[$be] tenant migration: a fresh install has nothing to migrate and just writes the marker", function () use ($be, $skip) {
        if ($skip) {
            return;
        }
        $d = fresh_store($be);
        Store::backend();
        ok(TenantMigration::done());
        eq([], Workspace::all());
        ok(!glob($d . '/backup-tenant-*'), 'no backup for an empty install');
        // first admin: platform + owner of main, demo router seeded in main only
        ok(Auth::createFirstAdmin('first', 'First-Pass-9x!'));
        ok(!Auth::createFirstAdmin('second', 'First-Pass-9x!'));
        $u = Auth::find('first');
        eq(['platform', 'main'], [$u['role'], $u['workspace']]);
        eq($u['id'], Workspace::get('main')['owner']);
        eq('demo', Store::read('routers')[0]['id'] ?? null);
    });
}

// ---- static guard: no raw data-file IO outside the storage layer -------------------------------------------------

test('tenant: only the storage layer touches the data directory (Store::dir / Store::path / Workspace::dir allow-list)', function () {
    $root = dirname(__DIR__, 2) . '/src';
    $allow = [
        'Store.php' => 'the storage facade', 'JsonStore.php' => 'backend', 'SqliteStore.php' => 'backend', 'Workspace.php' => 'per-workspace dirs',
        'TenantMigration.php' => 'one-time data move', 'Crypto.php' => 'platform key file (global by design)',
        'Cache.php' => 'derived cache files, keys carry the workspace', 'RouterOS.php' => 'breaker / pooled-socket markers keyed by device + credentials',
        'I18n.php' => 'compiled language files (no tenant data)', 'App.php' => 'sessions dir + compiled route table (no tenant data)',
        'Scheduler.php' => 'global cron.lock', 'Orders.php' => 'Workspace::dir(orders)', 'Monitor.php' => 'Workspace::dir(backups)', 'Sales.php' => 'Workspace::dir(cache)',
        'ImportController.php' => 'Workspace::dir(cache)',
    ];
    $bad = [];
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));
    foreach ($it as $f) {
        if ($f->getExtension() !== 'php' || str_contains(str_replace('\\', '/', $f->getPathname()), '/views/')) {
            continue;
        }
        $src = (string)file_get_contents($f->getPathname());
        if (preg_match('/Store::(dir|path)\s*\(|NEXTMON_DATA/', $src) && !isset($allow[$f->getFilename()])) {
            $bad[] = $f->getFilename();
        }
    }
    eq([], $bad, 'files using the data directory directly');
    // and the per-workspace ones really go through Workspace::dir
    foreach (['Orders.php', 'Monitor.php', 'Sales.php', 'Controllers/ImportController.php'] as $f) {
        $src = (string)file_get_contents($root . '/' . $f);
        ok(!preg_match('/Store::dir\s*\(/', $src), "$f must use Workspace::dir()");
    }
});
