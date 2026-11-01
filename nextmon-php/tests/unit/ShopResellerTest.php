<?php
/** Shop reseller referral: attribution, commission credited once (replay + concurrent callbacks), refund reversal once, invalid ref, tenant isolation. */

function sr_setup(string $be = 'json'): array
{
    $d = fresh_store($be);
    putenv('NEXTMON_DEMO=1');
    Workspace::set('main');
    $_SESSION = [];
    Auth::forget();
    App::forgetDrivers();
    Cache::reset();
    Store::write('routers', [['id' => 'demo', 'name' => 'Demo', 'session' => 'demo', 'type' => 'demo', 'host' => '', 'port' => 8728, 'ssl' => false, 'user' => '', 'pass' => '', 'hotspot_name' => 'T']]);
    $u = Auth::create('agent1', 'Agent-Pass-9x!', 'reseller');
    Reseller::saveCfg($u['id'], ['active' => 1, 'commission' => 10, 'adj' => 0, 'credit' => 0, 'allow_all' => 1]);
    eq('', Reseller::setRef($u['id'], 'agent-one'));
    return [$d, $u];
}

function sr_order(?array $attr, int $price = 5000): array
{
    return Orders::create(['id' => 'pabcdef', 'profile' => '1Jam', 'price' => $price, 'label' => '1 Jam'], ['name' => 'Cust', 'phone' => '0811', 'email' => ''], 'manual', 30, 'demo', $attr);
}

function sr_comm(string $uid): array
{
    return array_values(array_filter(Reseller::rows(['uid' => $uid]), fn($r) => $r['type'] === 'commission'));
}

foreach (['json', 'sqlite'] as $be) {
    $T = function (string $n, callable $f) use ($be) {
        test("[$be] shop reseller: $n", function () use ($be, $f) {
            if ($be === 'sqlite' && !SqliteStore::available()) {
                return;
            }
            $f(...sr_setup($be));
        });
    };

    $T('ref code: slug-safe, unique, case-insensitive lookup, inactive ignored', function ($d, $u) {
        ok(Reseller::byRef('AGENT-ONE') !== null, 'case-insensitive');
        eq('', Reseller::cleanRef('x'), 'too short');
        eq('etc', Reseller::cleanRef('../../etc'), 'path chars neutralised to a slug'); eq('', Reseller::cleanRef('..'));
        $u2 = Auth::create('agent2', 'Agent-Pass-9x!', 'reseller');
        Reseller::saveCfg($u2['id'], ['active' => 1, 'commission' => 5]);
        ok(Reseller::setRef($u2['id'], 'agent-one') !== '', 'duplicate refused');
        ok(Reseller::setRef($u2['id'], 'Bad Code!') !== '', 'invalid refused');
        eq('', Reseller::setRef($u2['id'], 'agent-two'));
        Reseller::saveCfg($u['id'], ['active' => 1, 'commission' => 20]);
        eq('agent-one', Reseller::cfg($u['id'])['ref'], 'saveCfg keeps the code');
        Reseller::saveCfg($u['id'], ['active' => 0, 'commission' => 20]);
        eq(null, Reseller::byRef('agent-one'), 'inactive reseller ignored');
        eq(null, Reseller::byRef('nope'), 'unknown ignored');
        $adm = Auth::create('boss', 'Boss-Pass-9x!', 'admin');
        Store::update('resellers', function ($a) use ($adm) {
            $a[$adm['id']] = ['active' => true, 'ref' => 'boss-code'];
            return $a;
        }, []);
        eq(null, Reseller::byRef('boss-code'), 'a non-reseller user never matches');
    });

    $T('attribution + commission credited once on paid and fulfilled', function ($d, $u) {
        $o = sr_order(Reseller::byRef('agent-one'));
        eq($u['id'], $o['attr']['uid']);
        eq(0, Reseller::balance($u['id']), 'nothing before payment');
        Orders::markPaid($o['id'], 'test', 5000);
        $f = Orders::get($o['id']);
        ok(!empty($f['voucher']), 'fulfilled');
        eq(500, Reseller::balance($u['id']), '10% of 5000');
        eq(500, $f['attr']['comm']);
        for ($i = 0; $i < 5; $i++) {
            Orders::markPaid($o['id'], 'test', 5000);
            Orders::retryFulfil($o['id']);
            Orders::applyEvent($o['id'], ['status' => 'paid', 'amount' => 5000, 'ref' => 'r' . $i, 'order_id' => $o['id']], 'fp' . $i, 'manual');
        }
        eq(500, Reseller::balance($u['id']), 'replay never double credits');
        $rows = sr_comm($u['id']);
        eq(1, count($rows));
        eq($o['id'], $rows[0]['ref'], 'ledger labelled with the order id');
        ok(strpos($rows[0]['note'], $o['id']) !== false);
        eq($o['id'], $rows[0]['meta']['order']);
    });

    $T('amount mismatch and unpaid orders earn nothing; no ref = no commission', function ($d, $u) {
        $o = sr_order(Reseller::byRef('agent-one'));
        [$ok] = Orders::markPaid($o['id'], 'test', 1);
        ok(!$ok);
        eq(0, Reseller::balance($u['id']));
        $n = sr_order(null);
        ok(!isset($n['attr']));
        Orders::markPaid($n['id'], 'test', 5000);
        eq(0, Reseller::balance($u['id']));
    });

    $T('refund reverses the commission exactly once', function ($d, $u) {
        $o = sr_order(Reseller::byRef('agent-one'));
        Orders::markPaid($o['id'], 'test', 5000);
        eq(500, Reseller::balance($u['id']));
        [$ok] = Orders::refund($o['id'], 'admin', 'money returned', false);
        ok($ok);
        eq(0, Reseller::balance($u['id']));
        Orders::refund($o['id'], 'admin', 'again', false);
        Orders::applyEvent($o['id'], ['status' => 'refunded', 'amount' => 5000, 'ref' => '', 'order_id' => $o['id']], 'fpR', 'manual');
        eq(0, Reseller::balance($u['id']), 'no second reversal');
        eq(-500, array_sum(array_column(array_filter(sr_comm($u['id']), fn($r) => $r['amount'] < 0), 'amount')));
        Orders::markPaid($o['id'], 'test', 5000);
        eq(0, Reseller::balance($u['id']), 'paid after refund is refused, no re-credit');
        $f = Orders::get($o['id']);
        ok(!empty($f['attr']['reversed_at']));
    });

    $T('the ledger guard alone prevents a double credit even if the order flag is lost', function ($d, $u) {
        $o = sr_order(Reseller::byRef('agent-one'));
        Orders::markPaid($o['id'], 'test', 5000);
        Orders::update($o['id'], function ($x) {
            unset($x['attr']['credited_at']);
            return $x;
        });
        Orders::retryFulfil($o['id']);
        Orders::markPaid($o['id'], 'test', 5000);
        eq(500, Reseller::balance($u['id']));
        eq(1, count(sr_comm($u['id'])));
    });

    $T('commission follows the order total only; ref never changes price/product', function ($d, $u) {
        $o = sr_order(Reseller::byRef('agent-one'), 12345);
        eq(12345, $o['amount']);
        Orders::markPaid($o['id'], 'test', 12345);
        eq((int)round(12345 * 0.10), Reseller::balance($u['id']));
    });

    $T('concurrent paid callbacks credit once; concurrent refunds reverse once', function ($d, $u) use ($be) {
        $o = sr_order(Reseller::byRef('agent-one'));
        $worker = tmpdir('w') . '/worker.php';
        file_put_contents($worker, '<?php require ' . var_export(dirname(__DIR__) . '/bootstrap.php', true)
            . '; putenv("NEXTMON_DATA=' . $d . '"); putenv("NEXTMON_STORAGE=' . $be . '"); putenv("NEXTMON_DEMO=1"); Store::reset(); Workspace::set("main");'
            . 'while (!is_file(' . var_export($d . '/go', true) . ')) usleep(1000);'
            . 'if ($argv[1] === "paid") { Orders::markPaid($argv[2], "w", 5000); Orders::applyEvent($argv[2], ["status"=>"paid","amount"=>5000,"ref"=>"x","order_id"=>$argv[2]], "fp".$argv[3], "manual"); }'
            . 'else { Orders::refund($argv[2], "w", "race", false); }');
        $run = function (string $mode, int $n) use ($worker, $o, $d) {
            @unlink($d . '/go');
            $procs = [];
            for ($i = 0; $i < $n; $i++) {
                $procs[] = [proc_open([PHP_BINARY, $worker, $mode, $o['id'], (string)$i], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes), $pipes];
            }
            usleep(300000);
            touch($d . '/go');
            foreach ($procs as [$p, $pipes]) {
                stream_get_contents($pipes[1]);
                stream_get_contents($pipes[2]);
                proc_close($p);
            }
        };
        $run('paid', 8);
        Store::reset();
        Workspace::set('main');
        eq(500, Reseller::balance($u['id']), 'credited exactly once');
        eq(1, count(array_filter(sr_comm($u['id']), fn($r) => $r['amount'] > 0)));
        $run('refund', 8);
        Store::reset();
        Workspace::set('main');
        eq(0, Reseller::balance($u['id']), 'reversed exactly once');
        eq(2, count(sr_comm($u['id'])));
    });

    $T('tenant isolation: a ref of another workspace is ignored and credits nothing there', function ($d, $u) {
        $b = Workspace::create(['name' => 'Beta', 'owner' => 'bob', 'password' => 'Tenant-Pass-9x!'])['id'];
        Workspace::run($b, function () {
            Store::write('routers', [['id' => 'demo', 'name' => 'Demo', 'session' => 'demo', 'type' => 'demo', 'host' => '', 'port' => 8728, 'ssl' => false, 'user' => '', 'pass' => '', 'hotspot_name' => 'T']]);
            eq(null, Reseller::byRef('agent-one'), 'main reseller code does not resolve in Beta');
            $o = sr_order(Reseller::byRef('agent-one'));
            ok(!isset($o['attr']));
            Orders::markPaid($o['id'], 'test', 5000);
        });
        eq(0, Reseller::balance($u['id']), 'main wallet untouched');
        // same code may be reused by a reseller of another workspace (uniqueness is per workspace)
        Workspace::run($b, function () {
            $r = Auth::create('beta-agent', 'Agent-Pass-9x!', 'reseller');
            Reseller::saveCfg($r['id'], ['active' => 1, 'commission' => 50]);
            eq('', Reseller::setRef($r['id'], 'agent-one'));
            eq($r['id'], Reseller::byRef('agent-one')['uid']);
        });
        eq($u['id'], Reseller::byRef('agent-one')['uid'], 'main still resolves to its own reseller');
    });
}
