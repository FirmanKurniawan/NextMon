<?php
/** Every storage test runs against both backends. */
foreach (['json', 'sqlite'] as $be) {
    $skip = $be === 'sqlite' && !SqliteStore::available();
    $T = function (string $n, callable $f) use ($be, $skip) {
        test("[$be] $n", function () use ($be, $skip, $f) {
            if ($skip) {
                return;
            }
            $d = fresh_store($be);
            eq($be, Store::backendName(), 'backend');
            $f($d);
        });
    };

    $T('read default, write, read back, unicode', function () {
        eq(['x' => 1], Store::read('nope', ['x' => 1]));
        ok(!Store::has('doc'));
        Store::write('doc', ['a' => 'héllo 日本', 'n' => [1, 2, 3], 'f' => 1.5, 'b' => true]);
        ok(Store::has('doc'));
        eq(['a' => 'héllo 日本', 'n' => [1, 2, 3], 'f' => 1.5, 'b' => true], Store::read('doc'));
        Store::write('doc', ['replaced' => 1]);
        eq(['replaced' => 1], Store::read('doc'));
    });
    $T('update is read-modify-write and returns new value', function () {
        $r = Store::update('cnt', fn($c) => ['n' => ($c['n'] ?? 0) + 1], []);
        eq(['n' => 1], $r);
        Store::update('cnt', fn($c) => ['n' => $c['n'] + 1], []);
        eq(2, Store::read('cnt')['n']);
    });
    $T('update that throws leaves data unchanged', function () {
        Store::write('t', ['v' => 1]);
        throws(function () {
            Store::update('t', function ($c) {
                throw new RuntimeException('boom');
            });
        }, RuntimeException::class);
        eq(['v' => 1], Store::read('t'));
        Store::update('t', fn($c) => ['v' => 2]); // still usable afterwards (no stuck transaction/lock)
        eq(['v' => 2], Store::read('t'));
    });
    $T('nested update on another document works', function () {
        Store::update('outer', function ($o) {
            Store::update('inner', fn($i) => ['k' => 1], []);
            return ['ok' => true];
        }, []);
        eq(['k' => 1], Store::read('inner'));
        eq(['ok' => true], Store::read('outer'));
    });
    $T('names with odd characters are sanitized consistently', function () {
        Store::write('we/ird name', [1]);
        eq([1], Store::read('we/ird name'));
        eq([1], Store::read('we_ird_name'));
    });
    $T('delete and names()', function () {
        Store::write('a', [1]);
        Store::write('b', [2]);
        ok(in_array('a', Store::names()) && in_array('b', Store::names()));
        Store::delete('a');
        ok(!Store::has('a'));
        eq('x', Store::read('a', 'x'));
    });
    $T('settings: defaults merged, saveSettings patches and refreshes cache', function () {
        eq('Rp', Store::setting('currency'));
        eq(['enabled' => false, 'token' => '', 'chat_id' => '', 'events' => ['sale', 'voucher', 'router', 'login']], Store::settings()['telegram']);
        Store::saveSettings(['currency' => 'USD', 'telegram' => ['enabled' => true, 'events' => ['sale']]]);
        eq('USD', Store::setting('currency'), 'cache refreshed after save');
        eq(['sale'], Store::setting('telegram')['events'], 'no resurrected events');
        eq(true, Store::setting('telegram')['enabled']);
        eq('NextMON WiFi', Store::setting('hotspot_name'), 'defaults kept');
        eq('zz', Store::setting('missing', 'zz'));
    });
    $T('appendLog/tailLog: newest first, limit, unicode', function () {
        for ($i = 1; $i <= 50; $i++) {
            Store::appendLog('audit.log', ['ts' => $i, 'action' => 'a' . $i, 'detail' => 'ü' . $i]);
        }
        $t = Store::tailLog('audit.log', 5);
        eq(5, count($t));
        eq(50, $t[0]['ts']);
        eq(46, $t[4]['ts']);
        eq('ü50', $t[0]['detail']);
        eq([], Store::tailLog('empty.log', 10));
        eq(50, Store::count('audit.log'));
    });
    $T('rows(): paging + filter, prune keeps newest', function () {
        for ($i = 1; $i <= 30; $i++) {
            Store::append('ledger', ['ts' => $i, 'kind' => $i % 3 === 0 ? 'sale' : 'topup', 'amt' => $i]);
        }
        eq(10, count(Store::rows('ledger', 10)));
        eq(30, Store::rows('ledger', 10)[0]['amt']);
        eq(20, Store::rows('ledger', 10, 10)[0]['amt']);
        $s = Store::rows('ledger', 100, 0, ['kind' => 'sale']);
        eq(10, count($s));
        eq(30, $s[0]['amt']);
        eq(0, count(Store::rows('ledger', 5, 0, ['kind' => 'none'])));
        eq(20, Store::prune('ledger', 10));
        eq(10, Store::count('ledger'));
        eq(30, Store::rows('ledger', 1)[0]['amt']);
        eq(21, Store::rows('ledger', 100)[9]['amt']);
    });
    $T('concurrent updates from several processes lose nothing', function ($d) use ($be) {
        $worker = tmpdir('w') . '/worker.php';
        file_put_contents($worker, '<?php require ' . var_export(dirname(__DIR__) . '/bootstrap.php', true)
            . '; putenv("NEXTMON_DATA=' . $d . '"); putenv("NEXTMON_STORAGE=' . $be . '"); Store::reset();'
            . 'for ($i = 0; $i < 25; $i++) { Store::update("counter", fn($c) => ["n" => ($c["n"] ?? 0) + 1], []); Store::appendLog("w.log", ["ts" => $i, "p" => getmypid()]); }');
        $procs = [];
        for ($i = 0; $i < 4; $i++) {
            $procs[] = [proc_open([PHP_BINARY, $worker], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes), $pipes];
        }
        $err = '';
        foreach ($procs as [$p, $pipes]) {
            $err .= stream_get_contents($pipes[1]) . stream_get_contents($pipes[2]);
            proc_close($p);
        }
        Store::reset();
        putenv('NEXTMON_DATA=' . $d);
        eq(100, Store::read('counter')['n'], 'counter (worker output: ' . trim($err) . ')');
        eq(100, Store::count('w.log'), 'log rows');
    });
}

test('default backend is sqlite when pdo_sqlite is loaded', function () {
    fresh_store('');
    eq(SqliteStore::available() ? 'sqlite' : 'json', Store::backendName());
});
test('storage.conf can force json', function () {
    $d = fresh_store('');
    file_put_contents($d . '/storage.conf', "json\n");
    Store::reset();
    putenv('NEXTMON_DATA=' . $d);
    eq('json', Store::backendName());
});

if (SqliteStore::available()) {
    test('sqlite: WAL mode, schema version recorded, status() works', function () {
        $d = fresh_store('sqlite');
        Store::write('x', [1]);
        $s = Store::backend()->status();
        eq('wal', strtolower($s['journal_mode']));
        eq($s['schema_latest'], $s['schema_version']);
        eq('ok', $s['integrity']);
        ok(is_file($d . '/nextmon.db'));
    });
    test('sqlite: migration imports JSON docs + logs once, backs up, leaves originals', function () {
        $d = tmpdir('mig');
        putenv('NEXTMON_DATA=' . $d);
        putenv('NEXTMON_STORAGE=sqlite');
        Store::reset();
        file_put_contents("$d/users.json", json_encode([['username' => 'adm', 'role' => 'admin']]));
        file_put_contents("$d/settings.json", json_encode(['currency' => 'EUR']));
        file_put_contents("$d/demo-demo.json", json_encode(['t' => 1])); // demo state is not a store doc
        file_put_contents("$d/broken.json", '{not json');
        file_put_contents("$d/audit.log", json_encode(['ts' => 1, 'action' => 'one']) . "\n" . json_encode(['ts' => 2, 'action' => 'two']) . "\nGARBAGE\n");
        file_put_contents("$d/audit.log.1", json_encode(['ts' => 0, 'action' => 'zero']) . "\n");
        eq('sqlite', Store::backendName());
        eq('adm', Store::read('users')[0]['username']);
        eq('EUR', Store::setting('currency'));
        ok(!Store::has('demo-demo'), 'demo file skipped');
        ok(!Store::has('broken'), 'broken skipped');
        eq(['two', 'one', 'zero'], array_column(Store::tailLog('audit.log', 10), 'action'));
        $bk = glob("$d/backup-json-*");
        eq(1, count($bk), 'one backup dir');
        ok(is_file($bk[0] . '/users.json') && is_file($bk[0] . '/audit.log.1'), 'backup contents');
        ok(is_file("$d/users.json"), 'original kept');
        // idempotent: change JSON, reopen -> not re-imported, no second backup
        file_put_contents("$d/users.json", json_encode([]));
        Store::reset();
        putenv('NEXTMON_DATA=' . $d);
        putenv('NEXTMON_STORAGE=sqlite');
        eq('adm', Store::read('users')[0]['username']);
        eq(3, Store::count('audit.log'));
        eq(1, count(glob("$d/backup-json-*")));
    });
    test('sqlite: failed import (unwritable backup) imports nothing and does not set the done flag', function () {
        $d = tmpdir('migfail');
        file_put_contents("$d/users.json", json_encode([['username' => 'adm']]));
        mkdir("$d/bad.log"); // glob picks it up as a "log"; copy() of a directory fails -> backup step throws
        $s = new SqliteStore($d, false);
        throws(fn() => $s->importJson(), RuntimeException::class);
        eq(false, $s->has('users'), 'nothing imported');
        eq(null, $s->getMeta('json_imported'), 'flag not set');
        // the app still works (falls back to retrying later); originals untouched
        ok(is_file("$d/users.json"));
    });
    test('sqlite: schema re-open is idempotent', function () {
        $d = fresh_store('sqlite');
        Store::write('a', [1]);
        Store::reset();
        putenv('NEXTMON_DATA=' . $d);
        putenv('NEXTMON_STORAGE=sqlite');
        eq([1], Store::read('a'));
        eq(max(array_keys(SqliteStore::MIGRATIONS)), Store::backend()->schemaVersion());
    });
    test('sqlite: corrupt db file falls back to JSON backend without crashing', function () {
        $d = tmpdir('corrupt');
        putenv('NEXTMON_DATA=' . $d);
        putenv('NEXTMON_STORAGE=sqlite');
        Store::reset();
        file_put_contents("$d/nextmon.db", str_repeat('garbage', 500));
        $prev = ini_set('error_log', $d . '/php-errors.log');
        $name = Store::backendName();
        ini_set('error_log', (string)$prev);
        eq('json', $name);
        Store::write('z', [1]);
        eq([1], Store::read('z'));
    });
    test('sqlite: many appended rows stay queryable', function () {
        fresh_store('sqlite');
        for ($i = 0; $i < 2000; $i++) {
            Store::appendLog('big.log', ['ts' => $i, 'n' => $i]);
        }
        eq(2000, Store::count('big.log'));
        eq(1999, Store::tailLog('big.log', 1)[0]['n']);
    });
}
