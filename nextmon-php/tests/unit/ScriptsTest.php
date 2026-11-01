<?php
test('mode none / unknown mode yields empty script', function () {
    eq('', Scripts::onLogin('none', '1000', '1d', '1000', false, false, 'p'));
    eq('', Scripts::onLogin('bogus', '1000', '1d', '1000', false, false, 'p'));
});
test('on-login: metadata line first and parseMeta roundtrips', function () {
    foreach (Scripts::MODES as $m) {
        if ($m === 'none') {
            continue;
        }
        $s = Scripts::onLogin($m, '5.000', '1d2h', '6000', true, false, 'Gold');
        ok(str_starts_with($s, ':put (",' . $m . ',5000,1d2h,6000,,Enable,Disable,");'), "$m meta line: " . strtok($s, "\n"));
        $p = Scripts::parseMeta($s);
        eq([$m, '5000', '1d2h', '6000', true, false], [$p['mode'], $p['price'], $p['validity'], $p['sprice'], $p['lock_user'], $p['lock_server']]);
    }
});
test('on-login: braces and double quotes are balanced', function () {
    foreach (['rem', 'ntf', 'remc', 'ntfc'] as $m) {
        foreach ([[true, true], [false, false]] as [$lu, $ls]) {
            $s = Scripts::onLogin($m, '1000', '30m', '', $lu, $ls, 'P 1');
            $body = $s;
            eq(substr_count($body, '{'), substr_count($body, '}'), "$m braces");
            $unescaped = preg_match_all('/(?<!\\\\)"/', $body);
            eq(0, $unescaped % 2, "$m quotes ($unescaped)");
            eq(substr_count($body, '['), substr_count($body, ']'), "$m brackets");
        }
    }
});
test('on-login: record modes add the sale script, non-record modes do not', function () {
    $c = Scripts::onLogin('remc', '1000', '1d', '1500', false, false, 'Gold');
    ok(str_contains($c, '/system script add name="$date-|-$time-|-$user-|-1500-|-$address-|-$mac-|-1d-|-Gold-|-$comment"'), 'sale record');
    ok(!str_contains(Scripts::onLogin('rem', '1000', '1d', '1500', false, false, 'Gold'), '/system script add'));
});
test('on-login: rem removes the user, ntf only blocks it', function () {
    $rem = Scripts::onLogin('rem', '1', '1d', '1', false, false, 'p');
    $ntf = Scripts::onLogin('ntf', '1', '1d', '1', false, false, 'p');
    ok(str_contains($rem, '/ip hotspot user remove'));
    ok(!str_contains($ntf, '/ip hotspot user remove') && str_contains($ntf, 'limit-uptime=1s'));
});
test('on-login: no validity => no scheduler; invalid validity dropped', function () {
    $s = Scripts::onLogin('rem', '1', '', '1', false, false, 'p');
    ok(!str_contains($s, '/system scheduler add'));
    $bad = Scripts::onLogin('rem', '1', '1d; /system reset-configuration', '1', false, false, 'p');
    ok(!str_contains($bad, 'reset-configuration'), 'injection via validity');
});
test('on-login: profile name and prices are sanitized (no script injection)', function () {
    $s = Scripts::onLogin('remc', '10"; /x', '1d', '5$(evil)', false, false, 'a"; :put pwn; "b');
    ok(!str_contains($s, 'pwn;'), 'profile injection: ' . $s);
    $p = Scripts::parseMeta($s);
    eq('10', $p['price']);
    eq('5', $p['sprice']);
});
test('Scripts::seconds / validDuration', function () {
    eq(93784, Scripts::seconds('1d2h3m4s'));
    eq(604800, Scripts::seconds('1w'));
    eq(0, Scripts::seconds(''));
    ok(Scripts::validDuration('') && Scripts::validDuration('1d') && Scripts::validDuration('1w2d3h4m5s'));
    ok(!Scripts::validDuration('1x') && !Scripts::validDuration('d') && !Scripts::validDuration('1d '));
});
test('Sales::parse reads Mikhmon records; ts/filter/daily', function () {
    $rows = Sales::parse([
        ['.id' => '*1', 'name' => 'oct/12/2026-|-10:00:00-|-u1-|-5000-|-10.0.0.2-|-AA:BB-|-1d-|-Gold-|-vc-001-10.12.26'],
        ['.id' => '*2', 'name' => 'oct/13/2026-|-11:30:00-|-u2-|-7000-|-10.0.0.3-|-CC:DD-|-3d-|-Silver-|-'],
        ['.id' => '*3', 'name' => 'garbage'],
    ]);
    eq(2, count($rows));
    eq('u2', $rows[0]['user'], 'newest first');
    eq(12000.0, Sales::sum($rows));
    eq(mktime(10, 0, 0, 10, 12, 2026), $rows[1]['ts']);
    eq(1, count(Sales::filter($rows, 'day', '2026-10-12')));
    eq(2, count(Sales::filter($rows, 'month', '2026-10')));
    eq(1, count(Sales::filter($rows, 'all', '', 'Gold')));
    eq(['2026-10-12' => 5000.0, '2026-10-13' => 7000.0], Sales::daily($rows));
    eq(['Silver' => 7000.0, 'Gold' => 5000.0], Sales::byProfile($rows));
    eq(mktime(1, 2, 3, 1, 5, 2026), Sales::ts('2026-01-05', '01:02:03'));
    eq(0, Sales::ts('nonsense', '00:00:00'));
});
test('Sales::recordName roundtrips through parse', function () {
    $ts = mktime(9, 8, 7, 3, 4, 2026);
    $name = Sales::recordName(['ts' => $ts, 'user' => 'uu', 'price' => 2500, 'profile' => 'P', 'validity' => '1d']);
    $r = Sales::parse([['name' => $name]]);
    eq(1, count($r));
    eq($ts, $r[0]['ts']);
    eq(2500.0, $r[0]['price']);
});
