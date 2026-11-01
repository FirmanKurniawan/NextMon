<?php
function demo_driver(): Demo
{
    return new Demo(tmpdir('demo') . '/demo-t.json');
}

test('Voucher::code honours length and charset for every charset', function () {
    foreach (Voucher::CHARSETS as $name => $set) {
        for ($len = 3; $len <= 16; $len += 3) {
            $c = Voucher::code($len, $set === '' ? $name : $name);
            eq($len, strlen($c), "$name length");
            ok(strspn($c, $set) === strlen($c), "$name charset: $c");
        }
    }
    ok(strspn(Voucher::code(50, 'bogus'), Voucher::CHARSETS['lowernum']) === 50, 'unknown charset falls back');
});
test('charsets have no ambiguous characters (0/O, 1/l/I) except num', function () {
    foreach (['lower', 'upper', 'lowernum', 'uppernum', 'mixed'] as $n) {
        ok(!preg_match('/[0OIl1o]/', Voucher::CHARSETS[$n]), "$n contains ambiguous chars");
    }
});
test('code is not constant (random)', function () {
    $s = [];
    for ($i = 0; $i < 50; $i++) {
        $s[Voucher::code(8, Voucher::CHARSETS['mixed'])] = 1;
    }
    ok(count($s) > 45);
});
test('generate: qty, prefix, uniqueness, vc mode user==pass, comment format', function () {
    fresh_store();
    $r = demo_driver();
    $o = Voucher::generate($r, ['profile' => 'default', 'qty' => 120, 'prefix' => 'ab-', 'length' => 5, 'charset' => 'num', 'mode' => 'vc', 'batch' => 'Test 1']);
    eq(120, count($o['items']));
    $names = array_column($o['items'], 0);
    eq(120, count(array_unique($names)), 'unique');
    foreach ($o['items'] as [$n, $p]) {
        ok(preg_match('/^ab-\d{5}$/', $n) === 1, "name $n");
        eq($n, $p, 'vc mode password = user');
    }
    ok(preg_match('/^vc-\d{3}-\d\d\.\d\d\.\d\d-Test 1$/', $o['comment']) === 1, $o['comment']);
    eq('vc-' . substr($o['comment'], 3), Voucher::batchOf($o['comment']), 'batchOf roundtrip');
    $users = $r->print('/ip/hotspot/user', ['comment' => $o['comment']]);
    eq(120, count($users), 'users created in driver');
});
test('generate: up mode has separate password, avoids existing names, caps by max_qty', function () {
    fresh_store();
    Store::saveSettings(['max_qty' => 10]);
    $r = demo_driver();
    $o = Voucher::generate($r, ['profile' => 'default', 'qty' => 9999, 'length' => 4, 'charset' => 'lowernum', 'mode' => 'up']);
    eq(10, count($o['items']), 'max_qty');
    $diff = 0;
    foreach ($o['items'] as [$n, $p]) {
        if ($n !== $p) {
            $diff++;
        }
    }
    ok($diff >= 8, 'passwords differ from usernames');
    $o2 = Voucher::generate($r, ['profile' => 'default', 'qty' => 5, 'length' => 4, 'charset' => 'num', 'mode' => 'vc']);
    $all = array_merge(array_column($o['items'], 0), array_column($o2['items'], 0));
    eq(count($all), count(array_unique($all)), 'no collisions across batches');
});
test('generate: small keyspace stops instead of looping forever', function () {
    fresh_store();
    $r = demo_driver();
    $t = microtime(true);
    $o = Voucher::generate($r, ['profile' => 'default', 'qty' => 100, 'length' => 3, 'charset' => 'num', 'prefix' => '']);
    ok(count($o['items']) <= 100 && count($o['items']) > 0);
    ok(microtime(true) - $t < 5, 'finished quickly');
    eq(count($o['items']), count(array_unique(array_column($o['items'], 0))));
});
test('generate: prefix and batch are sanitized; length clamped', function () {
    fresh_store();
    $r = demo_driver();
    $o = Voucher::generate($r, ['profile' => 'default', 'qty' => 1, 'prefix' => 'a<b>"c', 'length' => 99, 'charset' => 'num', 'batch' => '<x>y;z']);
    ok(preg_match('/^abc\d{16}$/', $o['items'][0][0]) === 1, $o['items'][0][0]);
    ok(!preg_match('/[<>;"]/', $o['comment']), $o['comment']);
});
test('expiryOf / batchOf parse comments', function () {
    eq('oct/12/2026 10:00:00', Voucher::expiryOf('oct/12/2026 10:00:00 vc-123-10.28.26-x'));
    eq('', Voucher::expiryOf('vc-123-10.28.26'));
    eq('vc-123-10.28.26-x', Voucher::batchOf('oct/12/2026 10:00:00 vc-123-10.28.26-x'));
    eq('', Voucher::batchOf('random comment'));
});
test('loginUrl appends with ? or &, url-encodes', function () {
    fresh_store();
    Store::saveSettings(['login_url' => 'http://h/login']);
    eq('http://h/login?username=a%20b&password=p%26q', Voucher::loginUrl('a b', 'p&q'));
    Store::saveSettings(['login_url' => 'http://h/login?x=1']);
    eq('http://h/login?x=1&username=u&password=p', Voucher::loginUrl('u', 'p'));
});
test('strict safe charsets: no look-alike pairs (0 O 1 l I i o 5 s 2 z 8 b 9 q g v), still enough entropy', function () {
    foreach (['safe', 'safeupper'] as $n) {
        ok(!preg_match('/[0O1lIioSsZzBbQqGgVv258]/', Voucher::CHARSETS[$n]), "$n has a look-alike");
        ok(strlen(Voucher::CHARSETS[$n]) >= 20, "$n too small");
        $c = Voucher::code(12, $n);
        ok(strspn($c, Voucher::CHARSETS[$n]) === 12);
    }
    ok(!preg_match('/[A-Z]/', Voucher::CHARSETS['safe']) && !preg_match('/[a-z]/', Voucher::CHARSETS['safeupper']));
});
test('cleanOpts keeps the new voucher options and clamps junk', function () {
    $o = VoucherController::cleanOpts(['group' => false, 'ssid' => str_repeat('x', 80), 'wifipass' => ' pw ', 'tqr' => 'bogus', 'f' => ['wifi' => false]]);
    ok($o['group'] === false && strlen($o['ssid']) === 32 && $o['wifipass'] === 'pw' && $o['tqr'] === 'native' && $o['f']['wifi'] === false);
    $d = VoucherController::cleanOpts([]);
    ok($d['group'] === false && $d['ssid'] === '' && $d['tqr'] === 'native' && $d['f']['wifi'] === true);
    eq('raster', VoucherController::cleanOpts(['tqr' => 'raster'])['tqr']);
});
