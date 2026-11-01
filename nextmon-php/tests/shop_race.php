<?php
/**
 * Race test for idempotent fulfilment: N real OS processes call Orders::markPaid() on the same order at once
 * (Demo router, throw-away data dir). Exactly one hotspot user must exist afterwards.
 * Run: php tests/shop_race.php [processes=10]
 */
$root = dirname(__DIR__);
$mode = $argv[1] ?? 'parent';

spl_autoload_register(function ($c) use ($root) {
    foreach (['/src/', '/src/Controllers/'] as $d) {
        $f = $root . $d . $c . '.php';
        if (is_file($f)) {
            require_once $f;
            return;
        }
    }
});
App::$root = $root;
require_once $root . '/src/Driver.php';
require_once $root . '/src/helpers.php';
Workspace::set('main');   // multi-tenant: Orders live in the workspace's own directory
I18n::init('en');

if ($mode === 'child') {
    // wait for the start signal file so all children hit the lock together
    while (!is_file(getenv('NEXTMON_DATA') . '/go')) {
        usleep(1000);
    }
    $res = Orders::markPaid($argv[2], 'race-test', null);
    echo json_encode([$res[0], $res[1]]);
    exit(0);
}

$tmp = sys_get_temp_dir() . '/nextmon-race-' . bin2hex(random_bytes(4));
mkdir($tmp, 0775, true);
putenv('NEXTMON_DATA=' . $tmp);
putenv('NEXTMON_DEMO=1');
Store::reset();
Store::write('routers', [['id' => 'demo', 'name' => 'Demo', 'session' => 'demo', 'type' => 'demo', 'host' => '', 'port' => 8728, 'ssl' => false, 'user' => '', 'pass' => '', 'hotspot_name' => 'T']]);
$pkg = ['id' => 'pabcdef', 'profile' => '1Jam', 'price' => 2000, 'label' => '1 Jam'];
$o = Orders::create($pkg, ['name' => 'Race', 'phone' => '0811', 'email' => ''], 'manual', 30, 'demo');

$n = (int)($argv[1] ?? 10) ?: 10;
$procs = [];
for ($i = 0; $i < $n; $i++) {
    $p = proc_open([PHP_BINARY, __FILE__, 'child', $o['id']], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, ['NEXTMON_DATA' => $tmp, 'NEXTMON_DEMO' => '1'] + getenv());
    $procs[] = [$p, $pipes];
}
usleep(300000);
touch($tmp . '/go');
$out = [];
foreach ($procs as [$p, $pipes]) {
    $out[] = stream_get_contents($pipes[1]) . stream_get_contents($pipes[2]);
    proc_close($p);
}
Store::reset();
$final = Orders::get($o['id']);
$demo = json_decode((string)file_get_contents($tmp . '/ws/main/demo/demo.json'), true);
$users = array_filter($demo['t']['/ip/hotspot/user'] ?? [], fn($u) => strpos((string)($u['comment'] ?? ''), $o['id']) !== false);
$events = array_count_values(array_column($final['events'], 'type'));
echo "children: " . count($out) . ", first outputs: " . implode(' | ', array_slice($out, 0, 3)) . "\n";
echo "order status={$final['status']} fulfil={$final['fulfil']} events=" . json_encode($events) . "\n";
echo "hotspot users carrying this order: " . count($users) . "\n";
$ok = count($users) === 1 && ($events['fulfilled'] ?? 0) === 1 && $final['status'] === 'paid';
echo $ok ? "PASS\n" : "FAIL\n";
exit($ok ? 0 : 1);
