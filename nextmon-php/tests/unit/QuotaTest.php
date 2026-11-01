<?php
/** Per-workspace limits: vouchers_per_day (Quota) and log_rows (capped log collections). Both storage backends. */
function qt_demo(string $tag): Demo
{
    return new Demo(tmpdir('demo') . "/demo-$tag.json");
}

function qt_ws(string $name, string $owner, array $limits): string
{
    return Workspace::create(['name' => $name, 'owner' => $owner, 'password' => 'Tenant-Pass-9x!', 'limits' => $limits])['id'];
}

foreach (['json', 'sqlite'] as $be) {
    $skip = $be === 'sqlite' && !SqliteStore::available();
    $T = function (string $n, callable $f) use ($be, $skip) {
        test("[$be] quota: $n", function () use ($be, $skip, $f) {
            if ($skip) {
                return;
            }
            fresh_store($be);
            Workspace::set('main');
            $f();
        });
    };

    $T('limit hit refuses the whole batch with used/limit, exact boundary passes', function () {
        $a = qt_ws('Alpha', 'owner-alpha', ['vouchers_per_day' => 10, 'log_rows' => 0]);
        Workspace::run($a, function () {
            $r = qt_demo('a');
            $res = Voucher::generate($r, ['profile' => 'default', 'qty' => 10, 'batch' => 'x']);   // exactly the limit
            eq(10, count($res['items']));
            eq(10, Quota::used());
            $before = count($r->print('/ip/hotspot/user'));
            $e = throws(fn() => Voucher::generate($r, ['profile' => 'default', 'qty' => 1]), QuotaException::class);
            eq(10, $e->used);
            eq(10, $e->limit);
            ok(strpos($e->getMessage(), '10') !== false, 'message shows numbers');
            eq($before, count($r->print('/ip/hotspot/user')), 'nothing created');
            eq(10, Quota::used(), 'refused batch is not counted');
        });
    });

    $T('a batch that does not fit is refused as a whole (no partial)', function () {
        $a = qt_ws('Alpha', 'owner-alpha', ['vouchers_per_day' => 10, 'log_rows' => 0]);
        Workspace::run($a, function () {
            $r = qt_demo('a');
            Voucher::generate($r, ['profile' => 'default', 'qty' => 7]);
            $before = count($r->print('/ip/hotspot/user'));
            throws(fn() => Voucher::generate($r, ['profile' => 'default', 'qty' => 5]), QuotaException::class);
            eq($before, count($r->print('/ip/hotspot/user')));
            eq(7, Quota::used());
            Voucher::generate($r, ['profile' => 'default', 'qty' => 3]);   // the remainder still fits
            eq(10, Quota::used());
        });
    });

    $T('splitting requests cannot exceed the limit', function () {
        $a = qt_ws('Alpha', 'owner-alpha', ['vouchers_per_day' => 10, 'log_rows' => 0]);
        Workspace::run($a, function () {
            $r = qt_demo('a');
            $made = 0;
            for ($i = 0; $i < 30; $i++) {
                try {
                    $made += count(Voucher::generate($r, ['profile' => 'default', 'qty' => 1])['items']);
                } catch (QuotaException $e) {
                }
            }
            eq(10, $made);
            eq(10, Quota::used());
        });
    });

    $T('rollback when generation fails', function () {
        $a = qt_ws('Alpha', 'owner-alpha', ['vouchers_per_day' => 10, 'log_rows' => 0]);
        Workspace::run($a, function () {
            $bad = new class (tmpdir('demo') . '/demo-bad.json') extends Demo {
                public function add(string $path, array $attrs): string
                {
                    throw new RuntimeException('router down');
                }
            };
            throws(fn() => Voucher::generate($bad, ['profile' => 'default', 'qty' => 6]), RuntimeException::class);
            eq(0, Quota::used(), 'released after failure');
            Voucher::generate(qt_demo('a'), ['profile' => 'default', 'qty' => 10]);   // the full limit is still available
            eq(10, Quota::used());
        });
    });

    $T('guard() releases on throw and keeps the count on success', function () {
        $a = qt_ws('Alpha', 'owner-alpha', ['vouchers_per_day' => 5, 'log_rows' => 0]);
        Workspace::run($a, function () {
            eq('ok', Quota::guard(2, fn() => 'ok'));
            eq(2, Quota::used());
            throws(fn() => Quota::guard(2, function () {
                throw new RuntimeException('x');
            }), RuntimeException::class);
            eq(2, Quota::used());
            throws(fn() => Quota::guard(4, fn() => 'never'), QuotaException::class);
            eq(2, Quota::used());
        });
    });

    $T('tenant isolation: A usage does not affect B', function () {
        $a = qt_ws('Alpha', 'owner-alpha', ['vouchers_per_day' => 3, 'log_rows' => 0]);
        $b = qt_ws('Bravo', 'owner-bravo', ['vouchers_per_day' => 3, 'log_rows' => 0]);
        Workspace::run($a, function () {
            Voucher::generate(qt_demo('a'), ['profile' => 'default', 'qty' => 3]);
            throws(fn() => Voucher::generate(qt_demo('a'), ['profile' => 'default', 'qty' => 1]), QuotaException::class);
        });
        eq(0, Quota::used($b), 'B untouched');
        eq(3, Quota::used($a));
        Workspace::run($b, function () {
            eq(3, count(Voucher::generate(qt_demo('b'), ['profile' => 'default', 'qty' => 3])['items']));
        });
        eq(['used' => 3, 'limit' => 3], Quota::usage($b));
    });

    $T('unlimited when 0, and for main', function () {
        $a = qt_ws('Alpha', 'owner-alpha', ['vouchers_per_day' => 0, 'log_rows' => 0]);
        Workspace::run($a, function () {
            Voucher::generate(qt_demo('a'), ['profile' => 'default', 'qty' => 40]);
            Voucher::generate(qt_demo('a'), ['profile' => 'default', 'qty' => 40]);
            eq(0, Quota::used(), 'nothing is counted when unlimited');
            eq(0, Quota::usage()['limit']);
        });
        Workspace::run('main', function () {
            Voucher::generate(qt_demo('m'), ['profile' => 'default', 'qty' => 50]);
            eq(0, Quota::usage()['limit']);
        });
    });

    $T('day rolls over by the workspace timezone', function () {
        $a = qt_ws('Alpha', 'owner-alpha', ['vouchers_per_day' => 5, 'log_rows' => 0]);
        Workspace::run($a, function () {
            Store::saveSettings(['timezone' => 'Pacific/Kiritimati']);   // UTC+14
            eq((new DateTimeImmutable('now', new DateTimeZone('Pacific/Kiritimati')))->format('Y-m-d'), Quota::day());
            Quota::reserve(5);
            throws(fn() => Quota::reserve(1), QuotaException::class);
            Store::write('quota', ['day' => '2000-01-01', 'used' => 5]);   // yesterday's counter
            eq(0, Quota::used(), 'old day does not count');
            Quota::reserve(5);
            eq(5, Quota::used());
        });
    });

    $T('release never goes below zero and ignores a stale day', function () {
        $a = qt_ws('Alpha', 'owner-alpha', ['vouchers_per_day' => 5, 'log_rows' => 0]);
        Workspace::run($a, function () {
            $t = Quota::reserve(3);
            Quota::release($t);
            Quota::release($t);
            eq(0, Quota::used());
            $t = Quota::reserve(2);
            Store::write('quota', ['day' => '2000-01-01', 'used' => 9]);
            Quota::release($t);
            eq(9, (int)Store::read('quota')['used'], 'stale-day release leaves the other day alone');
        });
    });

    $T('log_rows caps audit/notify/alerts/wizard logs per workspace, platform_audit untouched', function () use ($be) {
        $a = qt_ws('Alpha', 'owner-alpha', ['vouchers_per_day' => 0, 'log_rows' => 20]);
        $b = qt_ws('Bravo', 'owner-bravo', ['vouchers_per_day' => 0, 'log_rows' => 0]);
        Workspace::run($a, function () use ($be) {
            foreach (Store::CAPPED_LOGS as $l) {
                for ($i = 1; $i <= 60; $i++) {
                    Store::appendLog($l, ['ts' => $i, 'n' => $i]);
                }
                $c = Store::count($l);
                // sqlite trims exactly; json trims in 10% steps (one rewrite per ~cap/10 appends)
                ok($c >= 20 && $c <= ($be === 'sqlite' ? 20 : 22), "$l kept $c rows");
                eq(60, Store::tailLog($l, 1)[0]['n'], 'newest row kept');
                $rows = Store::rows($l, 100);
                eq($c, count($rows));
                eq(60 - $c + 1, end($rows)['n'], 'oldest rows were the ones dropped');
            }
            for ($i = 0; $i < 30; $i++) {
                Store::appendLog('pos-x.log', ['ts' => $i]);   // not a capped collection (sales record)
            }
            eq(30, Store::count('pos-x.log'));
        });
        Workspace::run($b, function () {
            for ($i = 1; $i <= 60; $i++) {
                Store::appendLog('audit.log', ['ts' => $i]);
            }
            eq(60, Store::count('audit.log'), 'unlimited workspace keeps everything');
        });
        Workspace::run('main', function () {
            for ($i = 1; $i <= 60; $i++) {
                Store::appendLog('audit.log', ['ts' => $i]);
            }
            eq(60, Store::count('audit.log'), 'main is unlimited');
        });
        $pa = Store::global('platform_audit')->count();
        for ($i = 1; $i <= 60; $i++) {
            Store::global('platform_audit')->append(['ts' => $i]);
        }
        eq($pa + 60, Store::global('platform_audit')->count(), 'platform_audit is never trimmed');
    });

    $T('Quota::plan() and logUsage report used vs limit', function () {
        $a = qt_ws('Alpha', 'owner-alpha', ['vouchers_per_day' => 8, 'log_rows' => 30, 'routers' => 2, 'staff' => 4]);
        Workspace::run($a, function () {
            Voucher::generate(qt_demo('a'), ['profile' => 'default', 'qty' => 3]);
            Store::appendLog('audit.log', ['ts' => 1]);
            $p = Quota::plan();
            eq(['used' => 3, 'limit' => 8], $p['vouchers']);
            eq(30, $p['log_rows']['limit']);
            eq(1, $p['log_rows']['used']);
            eq(2, $p['routers']['limit']);
            eq(4, $p['staff']['limit']);
        });
    });
}

test('quota: parallel processes cannot overshoot the limit (race-safe counter)', function () {
    $d = fresh_store('json');
    Workspace::set('main');
    $a = qt_ws('Alpha', 'owner-alpha', ['vouchers_per_day' => 10, 'log_rows' => 0]);
    $root = dirname(__DIR__, 2);
    $script = tmpdir('qrace') . '/w.php';
    file_put_contents($script, '<?php require ' . var_export($root . '/tests/bootstrap.php', true) . ';'
        . 'putenv("NEXTMON_DATA=' . $d . '"); putenv("NEXTMON_STORAGE=json"); Store::reset(); Workspace::set(' . var_export($a, true) . ');'
        . '$ok=0; for($i=0;$i<8;$i++){ try{ Quota::reserve(1); $ok++; }catch(QuotaException $e){} } echo $ok;');
    $procs = [];
    $pipes = [];
    for ($i = 0; $i < 4; $i++) {
        $procs[$i] = proc_open([PHP_BINARY, $script], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes[$i]);
    }
    $granted = 0;
    foreach ($procs as $i => $p) {
        $granted += (int)stream_get_contents($pipes[$i][1]);
        proc_close($p);
    }
    eq(10, $granted, 'exactly the limit was granted across 4 racing processes');
    eq(10, Quota::used($a));
});
