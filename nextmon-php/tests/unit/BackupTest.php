<?php
/** Workspace app-data backup / restore (src/Backup.php): round trips, hostile files, tenant safety, atomic rollback, cross-edition fixture. */

function bk_ws(string $name): string
{
    return Workspace::create(['name' => $name, 'owner' => strtolower($name) . '-owner', 'password' => 'Tenant-Pass-9x!'])['id'];
}

/** Fill the active workspace with one of every collection. */
function bk_seed(string $tag): void
{
    Store::write('routers', [
        ['id' => 'a1b2c3d4', 'name' => "R-$tag", 'session' => "r$tag", 'type' => 'real', 'host' => '10.0.0.1', 'port' => 8728, 'ssl' => false, 'verify_tls' => false, 'user' => 'api', 'pass' => Crypto::encrypt("pw-$tag"), 'hotspot_name' => 'WiFi'],
        ['id' => 'demo', 'name' => 'Demo', 'session' => 'demo', 'type' => 'demo', 'host' => '', 'port' => 8728, 'ssl' => false, 'user' => '', 'pass' => '', 'hotspot_name' => ''],
    ]);
    Store::write('settings', ['hotspot_name' => "Net $tag", 'currency' => 'Rp', 'telegram' => ['enabled' => true, 'token' => Crypto::encrypt("tg-$tag"), 'chat_id' => '42'],
        'templates' => [['id' => 't1', 'name' => 'Card', 'html' => '<div class="v">{{user}}</div>', 'w' => 70.0, 'h' => 40.0]]]);
    Store::write('shop', ['enabled' => true, 'gw' => ['tripay' => ['merchant' => 'M1', 'private_key' => Crypto::encrypt("gw-$tag")]], 'mock_secret' => Crypto::encrypt("mock-$tag")]);
    Store::write('resellers', ['u-1' => ['commission' => 10, 'limit' => 5]]);
    Store::write('wallets', ['u-1' => 12500]);
    Store::append('wallet_ledger', ['id' => "L1$tag", 'ts' => 100, 'uid' => 'u-1', 'type' => 'topup', 'amount' => 20000, 'bal' => 20000, 'note' => '', 'ref' => '', 'meta' => [], 'by' => 'owner']);
    Store::append('wallet_ledger', ['id' => "L2$tag", 'ts' => 200, 'uid' => 'u-1', 'type' => 'sale', 'amount' => -7500, 'bal' => 12500, 'note' => '', 'ref' => '', 'meta' => [], 'by' => 'u-1']);
    Store::append('reseller_batches', ['id' => "B1$tag", 'ts' => 150, 'uid' => 'u-1', 'qty' => 5]);
    $ws = Workspace::id();
    $id = 'KL250101-ABCDEF' . ($ws === 'main' ? '' : '-' . strtoupper(substr($ws, 2)));
    Orders::put(['id' => $id, 'token' => 'tok' . bin2hex(random_bytes(8)), 'created' => 1700000000, 'updated' => 1700000100, 'expires' => 1700003600, 'status' => 'paid',
        'package' => ['id' => 'p1', 'profile' => '1h', 'price' => 5000, 'label' => '1 hour'], 'amount' => 5000, 'customer' => ['name' => "Cust $tag"], 'gateway' => 'mock', 'router' => 'a1b2c3d4',
        'ref' => '', 'pay_url' => '', 'pay_info' => '', 'voucher' => null, 'fulfil' => '', 'notes' => [], 'events' => [], 'ip' => '1.2.3.4']);
}

/** Craft a syntactically valid file around an arbitrary payload (correct checksum). */
function bk_file(array $payload, array $over = []): string
{
    $p = json_encode($payload, JSON_UNESCAPED_SLASHES);
    return json_encode($over + ['format' => 'nextmon-backup', 'version' => 1, 'edition' => 'next', 'created' => '2026-01-01T00:00:00Z', 'includes_secrets' => false,
        'checksum' => ['algo' => 'sha256', 'value' => hash('sha256', $p)], 'payload' => $p]);
}

function bk_rejects(string $raw, string $why): void
{
    $threw = false;
    try {
        Backup::parse($raw);
    } catch (BackupError $e) {
        $threw = true;
    }
    ok($threw, "must reject: $why");
}

foreach (['json', 'sqlite'] as $be) {
    $skip = $be === 'sqlite' && !SqliteStore::available();
    $T = function (string $n, callable $f) use ($be, $skip) {
        test("[$be] backup: $n", function () use ($be, $skip, $f) {
            if ($skip) {
                return;
            }
            fresh_store($be);
            Workspace::set('main');
            $f();
        });
    };

    $T('round trip PHP -> PHP into another workspace; secrets stay out unless asked', function () {
        $a = bk_ws('Alpha');
        $b = bk_ws('Beta');
        Workspace::run($a, fn() => bk_seed('A'));
        Workspace::run($b, fn() => Store::write('routers', [['id' => 'ffffffff', 'name' => 'B-old', 'session' => 'b', 'type' => 'real', 'host' => '9.9.9.9', 'port' => 8728, 'ssl' => false, 'user' => '', 'pass' => '', 'hotspot_name' => '']]));
        $plain = Workspace::run($a, fn() => Backup::export(false));
        ok(strpos($plain, 'v1:') === false, 'no ciphertext in a secret-free export');
        ok(strpos($plain, 'pw-A') === false && strpos($plain, $a) === false, 'no plaintext secret, no workspace id');
        $f = json_decode($plain, true);
        eq('nextmon-backup', $f['format']);
        eq(1, $f['version']);
        eq('php', $f['edition']);
        eq(hash('sha256', $f['payload']), $f['checksum']['value']);
        $parsed = Backup::parse($plain);
        eq([], $parsed['warnings']);
        eq(['routers', 'settings', 'shop', 'resellers', 'wallets', 'wallet_ledger', 'reseller_batches', 'orders'], Backup::available($parsed['data']));
        $r = Workspace::run($b, fn() => Backup::apply($parsed['data'], Backup::available($parsed['data'])));
        ok(Backup::safetyName($r['safety']), 'safety backup name');
        Workspace::run($b, function () use ($b) {
            $routers = Store::read('routers', []);
            eq(['a1b2c3d4', 'demo'], array_column($routers, 'id'), 'replaced, B-old gone');
            eq('', $routers[0]['pass'], 'password not exported');
            eq('Net A', Store::settings()['hotspot_name']);
            eq('', Store::read('settings', [])['telegram']['token'], 'telegram token blank');
            eq('<div class="v">{{user}}</div>', Store::read('settings', [])['templates'][0]['html']);
            eq(['u-1' => 12500], Store::read('wallets', []));
            eq(['L2A', 'L1A'], array_column(Store::rows('wallet_ledger', 10), 'id'), 'ledger order kept (newest first)');
            $o = Orders::all();
            eq(1, count($o));
            eq('KL250101-ABCDEF-' . strtoupper(substr($b, 2)), $o[0]['id'], 'order id re-bound to the target workspace');
            ok(Orders::get($o[0]['id']) !== null);
            ok(count(Backup::safetyFiles()) === 1);
        });
        Workspace::run($a, function () {
            eq('pw-A', Crypto::decrypt(Store::read('routers', [])[0]['pass']), 'source untouched');
            eq('KL250101-ABCDEF', substr(Orders::all()[0]['id'], 0, 15));
        });
        // with secrets, same installation key: ciphertext survives and decrypts
        $withSecrets = Workspace::run($a, fn() => Backup::export(true));
        $p2 = Backup::parse($withSecrets);
        eq([], $p2['warnings']);
        Workspace::run($b, fn() => Backup::apply($p2['data'], ['routers', 'settings', 'shop']));
        Workspace::run($b, function () {
            eq('pw-A', Crypto::decrypt(Store::read('routers', [])[0]['pass']));
            eq('tg-A', Crypto::decrypt(Store::read('settings', [])['telegram']['token']));
            eq('mock-A', Crypto::decrypt(Store::read('shop', [])['mock_secret']));
        });
    });

    $T('PHP -> PHP into the same workspace (main) and partial selection', function () {
        bk_seed('M');
        $raw = Backup::export(true);
        Store::write('wallets', ['u-1' => 1]);
        Store::write('settings', ['hotspot_name' => 'changed']);
        $p = Backup::parse($raw);
        Backup::apply($p['data'], ['wallets']);
        eq(['u-1' => 12500], Store::read('wallets', []));
        eq('changed', Store::settings()['hotspot_name'], 'unselected collection untouched');
        eq('KL250101-ABCDEF', Orders::all()[0]['id'], 'main keeps suffix-less ids');
        throws(fn() => Backup::apply($p['data'], []), BackupError::class);
        throws(fn() => Backup::apply($p['data'], ['users', '../x']), BackupError::class);
    });

    $T('blank router password in the file keeps the stored one of the same router', function () {
        bk_seed('K');
        $raw = Backup::export(false);
        Backup::apply(Backup::parse($raw)['data'], ['routers']);
        eq('pw-K', Crypto::decrypt(Store::read('routers', [])[0]['pass']));
    });

    $T('hostile files are rejected', function () {
        bk_seed('H');
        $good = Backup::export(false);
        $f = json_decode($good, true);
        bk_rejects('', 'empty');
        bk_rejects('not json', 'garbage');
        bk_rejects("\0\0\0", 'binary');
        bk_rejects('[]', 'list');
        bk_rejects(str_repeat('A', Backup::MAX_BYTES + 1), 'huge');
        bk_rejects(json_encode(['format' => 'other'] + $f), 'wrong format');
        bk_rejects(json_encode(['version' => 2] + $f), 'newer version');
        bk_rejects(json_encode(['version' => '1'] + $f), 'version type');
        bk_rejects(json_encode(['edition' => 'evil'] + $f), 'edition');
        $bad = $f;
        $bad['checksum']['value'] = str_repeat('0', 64);
        bk_rejects(json_encode($bad), 'wrong checksum');
        $bad = $f;
        $bad['payload'] = str_replace('Net H', 'Net X', $bad['payload']);
        bk_rejects(json_encode($bad), 'edited payload');
        $bad = $f;
        $bad['checksum']['algo'] = 'md5';
        bk_rejects(json_encode($bad), 'algo');
        bk_rejects(bk_file(['docs' => []]), 'nothing restorable');
        bk_rejects(bk_file(['docs' => ['routers' => 'x']]), 'router type');
        bk_rejects(bk_file(['docs' => ['routers' => [['id' => '../../etc', 'name' => 'x', 'host' => '1.1.1.1']]]]), 'traversal router id');
        bk_rejects(bk_file(['docs' => ['routers' => [['id' => 'abcd1234', 'name' => 'x', 'host' => 'a b;rm']]]]), 'bad host');
        bk_rejects(bk_file(['docs' => ['routers' => [['id' => 'abcd1234', 'name' => 'x', 'host' => '1.1.1.1'], ['id' => 'abcd1234', 'name' => 'y', 'host' => '1.1.1.2']]]]), 'duplicate id');
        bk_rejects(bk_file(['docs' => ['settings' => json_decode('{"__proto__":{"admin":true}}', true)]]), 'proto key');
        bk_rejects(bk_file(['docs' => ['wallets' => ['u-1' => 'lots']]]), 'wallet value');
        bk_rejects(bk_file(['docs' => ['wallets' => ['../x' => 5]]]), 'wallet key');
        bk_rejects(bk_file(['orders' => [['id' => '../../x', 'status' => 'paid', 'token' => 'abcdefgh1', 'amount' => 1, 'package' => [], 'created' => 1]]]), 'order id traversal');
        bk_rejects(bk_file(['orders' => [['id' => 'KL250101-ABCDEF', 'status' => 'hacked', 'token' => 'abcdefgh1', 'amount' => 1, 'package' => [], 'created' => 1]]]), 'order status');
        $deep = ['a' => 1];
        for ($i = 0; $i < 40; $i++) {
            $deep = ['x' => $deep];
        }
        bk_rejects(bk_file(['docs' => ['shop' => $deep]]), 'depth bomb');
        bk_rejects(bk_file(['docs' => ['shop' => ['k' => str_repeat('x', 300000)]]]), 'giant string');
        bk_rejects(bk_file(['logs' => ['wallet_ledger' => array_fill(0, Backup::MAX_ROWS + 1, ['a' => 1])]]), 'too many rows');
        bk_rejects(bk_file(['logs' => ['wallet_ledger' => ['not a row']]]), 'row type');
        // the good one still passes (control)
        Backup::parse($good);
    });

    $T('tenant keys, global collections, plaintext and foreign secrets never get in', function () {
        $a = bk_ws('Alpha');
        $b = bk_ws('Beta');
        Workspace::run($b, function () {
            Crypto::encrypt('warm up the key');
        });
        $foreign = 'v1:' . base64_encode(random_bytes(40));   // valid shape, not decryptable here
        $raw = bk_file([
            'docs' => [
                'users' => [['id' => 'u1', 'username' => 'evil', 'role' => 'platform']],
                'workspaces' => [['id' => 'w_deadbeef']], 'sessions_meta' => ['x' => 1], 'apikeys' => [['hash' => 'abc']], 'apikey_index' => ['abc' => 'w_x'],
                '../../etc/passwd' => ['x' => 1], 'monitor' => ['cron_token' => 'steal'],
                'settings' => ['hotspot_name' => 'X', 'workspace' => $a, 'ws' => $a, 'nested' => ['owner_ws' => $a, 'ok' => 1], 'telegram' => ['token' => $foreign, 'chat_id' => '1'],
                    'templates' => [['id' => 't1', 'name' => 'T', 'html' => '<script>alert(1)</script><div onclick="x()">hi</div>', 'w' => 9999, 'h' => 1]]],
                'routers' => [['id' => 'abcd1234', 'name' => 'R', 'host' => '1.1.1.1', 'pass' => 'plain-text', 'shared' => true, 'mode' => 'rw', 'owner_ws' => $a]],
            ],
            'logs' => ['audit.log' => [['action' => 'forged']], 'wallet_ledger' => [['id' => 'x', 'workspace' => $a, 'bal' => 1]]],
            'orders' => [['id' => 'KL250101-ABCDEF-' . strtoupper(substr($a, 2)), 'token' => 'abcdefgh12', 'amount' => 1, 'package' => [], 'created' => 5, 'status' => 'paid', 'workspace' => $a]],
        ]);
        $p = Backup::parse($raw);
        $data = $p['data'];
        ok(count($p['ignored']) >= 6, 'ignored collections reported');
        foreach (['users', 'workspaces', 'sessions_meta', 'apikeys', 'apikey_index', 'monitor'] as $g) {
            ok(!isset($data['docs'][$g]), "$g not imported");
        }
        ok(!isset($data['logs']['audit.log']));
        ok(stripos(json_encode($data), substr($a, 2)) === false, 'no foreign workspace id survives (except as the re-bound order suffix, added at apply time)' . json_encode($data));
        eq('', $data['docs']['routers'][0]['pass'], 'plain password dropped');
        ok(!isset($data['docs']['routers'][0]['shared']));
        eq('', $data['docs']['settings']['telegram']['token'], 'undecryptable secret blanked');
        $tpl = $data['docs']['settings']['templates'][0];
        ok(strpos($tpl['html'], '<script') === false && strpos($tpl['html'], 'onclick') === false, 'template sanitised: ' . $tpl['html']);
        eq(300.0, $tpl['w']);
        ok($p['warnings'] !== [], 'warnings shown');
        // restore into B: A is not touched, order id is B's
        Workspace::run($a, fn() => Store::write('routers', [['id' => 'aaaaaaaa', 'name' => 'A-keep', 'session' => 'a', 'type' => 'real', 'host' => '2.2.2.2', 'port' => 8728, 'ssl' => false, 'user' => '', 'pass' => '', 'hotspot_name' => '']]));
        Workspace::run($b, fn() => Backup::apply($data, Backup::available($data)));
        Workspace::run($a, function () {
            eq(['aaaaaaaa'], array_column(Store::read('routers', []), 'id'), 'other tenant untouched');
            eq([], Orders::all());
            eq(0, Store::count('wallet_ledger'));
        });
        Workspace::run($b, function () use ($b) {
            eq('KL250101-ABCDEF-' . strtoupper(substr($b, 2)), Orders::all()[0]['id']);
            eq(1, Store::count('wallet_ledger'));
            eq(0, Store::count('audit.log'), 'audit log never imported');
        });
        ok(!in_array('evil', array_column(Auth::allUsers(), 'username'), true), 'no user created');
    });

    $T('router limit of the workspace is enforced', function () {
        $w = Workspace::create(['name' => 'Tiny', 'owner' => 'tiny-owner', 'password' => 'Tenant-Pass-9x!', 'limits' => ['routers' => 1]])['id'];
        $p = Backup::parse(bk_file(['docs' => ['routers' => [['id' => 'aaaaaaaa', 'name' => 'a', 'host' => '1.1.1.1'], ['id' => 'bbbbbbbb', 'name' => 'b', 'host' => '1.1.1.2']]]]));
        throws(fn() => Workspace::run($w, fn() => Backup::apply($p['data'], ['routers'])), BackupError::class);
        eq([], Workspace::run($w, fn() => Store::read('routers', [])));
    });

    $T('a failing restore rolls everything back and keeps the safety backup', function () {
        bk_seed('R');
        Backup::$afterWrite = function (string $c) {
            if ($c === 'wallet_ledger') {
                throw new RuntimeException('boom after the ledger was replaced');   // routers, settings, wallets and the ledger are already new
            }
        };
        $before = [Store::read('routers', []), Store::read('settings', []), Store::read('wallets', []), Store::count('wallet_ledger')];
        $p = Backup::parse(bk_file([
            'docs' => ['routers' => [['id' => 'cccccccc', 'name' => 'NEW', 'host' => '1.1.1.1']], 'settings' => ['hotspot_name' => 'NEW'], 'wallets' => ['u-9' => 1]],
            'logs' => ['wallet_ledger' => [['id' => 'new']]],
            'orders' => [['id' => 'KL250102-ABCDEF', 'token' => 'abcdefgh12', 'amount' => 1, 'package' => [], 'created' => 5, 'status' => 'paid']],
        ]));
        $e = throws(fn() => Backup::apply($p['data'], Backup::available($p['data'])), BackupError::class);
        ok(strpos($e->getMessage(), 'nothing was changed') !== false, $e->getMessage());
        eq($before, [Store::read('routers', []), Store::read('settings', []), Store::read('wallets', []), Store::count('wallet_ledger')], 'data identical after rollback');
        ok(count(Backup::safetyFiles()) === 1, 'safety backup kept');
        Backup::$afterWrite = null;
        eq(1, count(Orders::all()), 'orders intact');
        // the safety file is itself a valid backup
        $s = Backup::safetyFiles()[0]['name'];
        Backup::parse((string)file_get_contents(Backup::safetyPath($s)));
    });

    $T('safety file names cannot be used for traversal', function () {
        foreach (['../secret.key', '..\\x', 'pre-restore-20250101-010101-abcd.json/../../x', 'x.json', 'pre-restore-1.json', "pre-restore-20250101-010101-abcd.json\0"] as $n) {
            ok(Backup::safetyPath($n) === null, $n);
        }
    });

    $T('pending preview is bound to user, token and workspace and expires', function () {
        $a = bk_ws('Alpha');
        $b = bk_ws('Beta');
        $p = Backup::parse(bk_file(['docs' => ['wallets' => ['u' => 1]]]));
        $tok = Workspace::run($a, fn() => Backup::stash($p, '../../evil name.json', 'user-1'));
        Workspace::run($a, function () use ($tok) {
            ok(Backup::pending('user-1') !== null);
            ok(strpos(Backup::pending('user-1')['file'], '/') === false, 'file name sanitised');
            ok(Backup::pending('user-2') === null, 'other user');
            ok(Backup::pendingData('user-1', 'wrong') === null, 'wrong token');
            ok(Backup::pendingData('user-1', $tok) !== null);
        });
        Workspace::run($b, fn() => ok(Backup::pending('user-1') === null && Backup::pendingData('user-1', $tok) === null, 'other workspace'));
        Workspace::run($a, function () {
            $f = Workspace::dir('backups') . '/pending.json';
            $m = json_decode(file_get_contents($f), true);
            $m['ts'] = time() - 4000;
            file_put_contents($f, json_encode($m));
            ok(Backup::pending('user-1') === null, 'expired');
            ok(!is_file($f), 'expired preview removed');
        });
    });
}

test('cross-edition: a file written by the Next.js edition restores here', function () {
    fresh_store();
    Workspace::set('main');
    $raw = (string)file_get_contents(__DIR__ . '/../fixtures/backup-from-next.json');
    $f = json_decode($raw, true);
    eq('next', $f['edition']);
    $p = Backup::parse($raw);
    eq([], $p['warnings']);
    $r = Backup::apply($p['data'], Backup::available($p['data']));
    ok($r['applied'] !== []);
    eq('Next Fixture', Store::settings()['hotspot_name']);
    eq(['11111111'], array_column(Store::read('routers', []), 'id'));
    eq('', Store::read('routers', [])[0]['pass']);
    eq(['u-1' => 12500], Store::read('wallets', []));
    eq(2, Store::count('wallet_ledger'));
    eq('KL250101-ABCDEF', Orders::all()[0]['id'], 'next order re-bound to the suffix-less main id');
});

test('an oversized export drops the oldest log rows to stay under the upload limit and says so', function () {
    fresh_store();
    Workspace::set('main');
    $rows = [];
    for ($i = 0; $i < 30000; $i++) {
        $rows[] = ['id' => 'L' . $i, 'ts' => $i, 'note' => str_repeat('x', 400)];
    }
    $raw = Backup::wrap(['docs' => ['wallets' => ['u' => 1]], 'logs' => ['wallet_ledger' => $rows], 'orders' => []], false);
    ok(strlen($raw) < Backup::MAX_BYTES, 'fits: ' . strlen($raw));
    $p = Backup::parse($raw);
    ok(count($p['data']['logs']['wallet_ledger']) < 30000 && count($p['data']['logs']['wallet_ledger']) > 1000, 'oldest rows dropped');
    eq('L29999', end($p['data']['logs']['wallet_ledger'])['id'], 'newest row kept');
    ok($p['warnings'] !== [], 'warns about the truncation');
});

// NEXTMON_WRITE_FIXTURE=1 php tests/run.php Backup  -> rewrites tests/fixtures/backup-from-php.json (restored by the Next.js tests)
if (getenv('NEXTMON_WRITE_FIXTURE') === '1') {
    test('writes tests/fixtures/backup-from-php.json', function () {
        fresh_store();
        Workspace::set('main');
        Store::write('routers', [
            ['id' => '22222222', 'name' => 'PHP Router', 'session' => 'php', 'type' => 'real', 'host' => '10.2.2.2', 'port' => 8728, 'ssl' => false, 'verify_tls' => false, 'user' => 'api', 'pass' => '', 'hotspot_name' => 'PHP WiFi'],
            ['id' => 'demo', 'name' => 'Demo', 'session' => 'demo', 'type' => 'demo', 'host' => '', 'port' => 8728, 'ssl' => false, 'user' => '', 'pass' => '', 'hotspot_name' => ''],
        ]);
        Store::write('settings', ['hotspot_name' => 'PHP Fixture', 'currency' => 'Rp', 'templates' => [['id' => 't1', 'name' => 'Card', 'html' => '<div>{{user}}</div>', 'w' => 70.0, 'h' => 40.0]]]);
        Store::write('shop', ['enabled' => true]);
        Store::write('resellers', ['u-1' => ['commission' => 10]]);
        Store::write('wallets', ['u-1' => 12500]);
        Store::append('wallet_ledger', ['id' => 'PL1', 'ts' => 100, 'uid' => 'u-1', 'type' => 'topup', 'amount' => 20000, 'bal' => 20000]);
        Store::append('wallet_ledger', ['id' => 'PL2', 'ts' => 200, 'uid' => 'u-1', 'type' => 'sale', 'amount' => -7500, 'bal' => 12500]);
        Orders::put(['id' => 'KL250101-ABCDEF', 'token' => 'phptoken1234567', 'created' => 1700000000, 'updated' => 1700000100, 'expires' => 1700003600, 'status' => 'paid',
            'package' => ['id' => 'p1', 'profile' => '1h', 'price' => 5000, 'label' => '1 hour'], 'amount' => 5000, 'customer' => ['name' => 'PHP Customer'], 'gateway' => 'mock', 'router' => '22222222',
            'ref' => '', 'pay_url' => '', 'pay_info' => '', 'voucher' => null, 'fulfil' => '', 'notes' => [], 'events' => [], 'ip' => '1.2.3.4']);
        file_put_contents(__DIR__ . '/../fixtures/backup-from-php.json', Backup::export(false));
    });
}
