<?php
/**
 * Router sharing over HTTP, with names that cannot be confused with the router's own name.
 *   php tests/tenant_share_http.php [json|sqlite]
 * A shares a router with B (ro, then rw, then revoke). Checks: B sees ONLY that router (name + mode), never A's settings / templates /
 * orders / shop / users / credentials; ro refuses every write, rw allows it (the write lands in A's router state); B cannot edit, delete or
 * re-share it; revoke cuts access (/json -> 404, router vanishes). Uses tests/tenant_lib.php + tests/tenant_bootstrap.php.
 */
error_reporting(E_ALL);
ini_set('display_errors', '1');
$root = dirname(__DIR__);
require __DIR__ . '/tenant_lib.php';
$backend = in_array($argv[1] ?? '', ['json', 'sqlite'], true) ? $argv[1] : 'json';

$data = str_replace('\\', '/', sys_get_temp_dir()) . '/nextmon-share-' . bin2hex(random_bytes(3));
mkdir($data, 0775, true);
$port = ti_free_port();
$env = array_merge(getenv(), ['NEXTMON_DEMO' => '1', 'NEXTMON_DEBUG' => '1', 'NEXTMON_DATA' => $data, 'NEXTMON_STORAGE' => $backend]);
$proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", '-t', $root . '/public'], [0 => ['pipe', 'r'], 1 => ['file', $data . '/out.log', 'w'], 2 => ['file', $data . '/err.log', 'w']], $pipes, $root, $env);
register_shutdown_function(function () use (&$proc, $data) {
    if (is_resource($proc)) {
        @proc_terminate($proc);
        @proc_close($proc);
    }
    ti_rrmdir($data);
});
for ($i = 0; $i < 80 && !@fsockopen('127.0.0.1', $port, $en, $es, 0.2); $i++) {
    usleep(100000);
}
TC::$base = "http://127.0.0.1:$port";

$fail = 0;
$n = 0;
function chk(bool $c, string $m): void
{
    global $fail, $n;
    $n++;
    if (!$c) {
        $fail++;
        echo "  FAIL $m\n";
    }
}

$init = ti_boot_cmd($root, $data, $backend, 'init', ['platform' => 'plat_share', 'workspaces' => [
    ['name' => 'Alpha Net', 'slug' => 'alpha-net', 'owner' => 'owner_alpha'],
    ['name' => 'Beta Net', 'slug' => 'beta-net', 'owner' => 'owner_beta'],
]]);
chk(($init['core'] ?? false) && !($init['errors'] ?? []), 'workspaces created: ' . json_encode($init));

$A = new TC('A');
$B = new TC('B');
chk($A->login('owner_alpha') && $B->login('owner_beta'), 'both owners log in');

// ---- A's private data, all with ALPHA-* markers that never appear in the shared router itself ----------------------------------
$S = 'ALPHA-' . bin2hex(random_bytes(4));
$A->post('/routers/save', ['id' => 'rshare01', 'name' => 'Shared-Router-One', 'type' => 'demo', 'session' => 'shr1', 'hotspot_name' => 'Hot-One', 'host' => '', 'user' => 'apiuser-' . $S, 'pass' => 'routerpass-' . $S]);
$A->post('/routers/save', ['id' => 'rprivate1', 'name' => 'Private-Router-' . $S, 'type' => 'demo', 'session' => 'prv1', 'hotspot_name' => 'x', 'host' => '', 'user' => 'u', 'pass' => 'p']);
$A->post('/settings/save', ['timezone' => 'Asia/Jakarta', 'currency' => 'Rp', 'lang' => 'id', 'max_qty' => '500', 'hotspot_name' => 'Hotspot-' . $S, 'login_url' => 'http://hotspot.local/login']);
$A->post('/vouchers/templates/save', ['name' => 'Tpl-' . $S, 'html' => '<div>{{user}} ' . $S . '</div>', 'w' => '70', 'h' => '40']);
$A->post('/settings/user', ['id' => '', 'username' => 'staff_' . strtolower($S), 'role' => 'operator', 'password' => TI_PASSWORD]);
$A->post('/routers/select', ['router' => 'rshare01']);
$private = [$S, 'routerpass-', 'apiuser-', 'staff_'];
$leak = function (array $res) use ($S): bool {
    return str_contains($res['body'] . $res['headers'] . $res['loc'], $S);
};

// platform pages: a normal owner gets 403; the error page is rendered inside the owner's OWN workspace (it lists the owner's own routers in the picker, nothing of anybody else)
$B->post('/settings/save', ['timezone' => 'Asia/Jakarta', 'currency' => 'Rp', 'lang' => 'id', 'max_qty' => '500', 'hotspot_name' => 'BETA-ONLY-77', 'login_url' => 'http://hotspot.local/login']);
$p403 = $A->get('/platform/accounts');
chk($p403['code'] === 403, 'owner A: /platform/accounts -> 403');
chk(!str_contains($p403['body'], 'BETA-ONLY-'), "the 403 page carries nothing of B");

echo "before sharing\n";
chk(!str_contains($B->get('/routers')['body'], 'Shared-Router-One'), 'B does not see the router before it is shared');
chk($B->post('/routers/share', ['router' => 'rshare01', 'to' => 'beta-net', 'mode' => 'rw'])['code'] !== 500, 'B posting a share of a router it does not own does not crash');
chk(!str_contains($B->get('/routers')['body'], 'Shared-Router-One'), 'B cannot self-share A router');
chk($B->get('/json/users', ['router' => 'rshare01'])['code'] === 404, 'B: /json?router=<A router id> -> 404 before sharing');

foreach (['ro', 'rw'] as $mode) {
    echo "shared $mode\n";
    $r = $A->post('/routers/share', ['router' => 'rshare01', 'to' => 'beta-net', 'mode' => $mode]);
    chk(in_array($r['code'], [302], true), "A share ($mode) -> {$r['code']}");
    $rb = $B->get('/routers');
    chk(str_contains($rb['body'], 'Shared-Router-One'), "($mode) B sees the shared router");
    chk(str_contains($rb['body'], $mode === 'rw' ? 'Read/write' : 'Read-only') || str_contains($rb['body'], $mode === 'rw' ? 'Baca/tulis' : 'Hanya baca'), "($mode) mode is shown to B");
    chk(!str_contains($rb['body'], 'Private-Router-'), "($mode) A's other router stays private");
    foreach (['/routers', '/settings', '/vouchers/templates', '/vouchers', '/orders', '/shop/settings', '/audit', '/reports', '/resellers', '/monitor', '/backup', '/hotspot/users', '/'] as $p) {
        $res = $B->get($p);
        chk(!$leak($res), "($mode) B GET $p leaks nothing of A");
        chk(!str_contains($res['body'], 'routerpass-') && !str_contains($res['body'], 'apiuser-'), "($mode) B GET $p shows no router credentials");
    }
    $B->post('/routers/select', ['router' => 'rshare01']);
    $nm = 'shr' . bin2hex(random_bytes(3));
    $B->post('/hotspot/users/save', ['name' => $nm, 'password' => $nm, 'profile' => 'default']);
    $seen = $A->get('/json/users', ['router' => 'rshare01', 'q' => $nm]);
    $written = preg_match('/"total":\s*[1-9]/', $seen['body']) === 1;
    chk($mode === 'rw' ? $written : !$written, "($mode) B write to the shared router " . ($mode === 'rw' ? 'lands on the owner router' : 'is refused'));
    chk($B->get('/json/users', ['router' => 'rshare01'])['code'] === 200, "($mode) B can read the shared router");
    $B->post('/routers/delete', ['id' => 'rshare01']);
    chk(str_contains($A->get('/routers')['body'], 'Shared-Router-One'), "($mode) B cannot delete A router");
    $B->post('/routers/save', ['id' => 'rshare01', 'name' => 'HIJACK', 'type' => 'demo']);
    chk(!str_contains($A->get('/routers')['body'], 'HIJACK') && !str_contains($B->get('/routers')['body'], 'HIJACK'), "($mode) B cannot edit A router");
    $B->post('/routers/share', ['router' => 'rshare01', 'to' => 'alpha-net', 'mode' => 'rw']);
    $B->post('/routers/share', ['router' => 'rshare01', 'to' => 'beta-net', 'mode' => 'rw']);
}

echo "revoke\n";
chk($A->post('/routers/share/revoke', ['router' => 'rshare01', 'to' => 'beta-net'])['code'] === 302, 'A revokes');
chk(!str_contains($B->get('/routers')['body'], 'Shared-Router-One'), 'router gone from B');
chk($B->get('/json/users', ['router' => 'rshare01'])['code'] === 404, 'revoked router: /json -> 404');
chk($B->get('/api/v1/users', ['router' => 'rshare01'])['code'] === 401, 'no API key -> 401');
$A->post('/routers/share', ['router' => 'rshare01', 'to' => 'beta-net', 'mode' => 'ro']);
chk(str_contains($B->get('/routers')['body'], 'Shared-Router-One'), 're-share works');
$B->post('/routers/share/revoke', ['router' => 'rshare01']);
chk(!str_contains($B->get('/routers')['body'], 'Shared-Router-One'), 'recipient can drop a share it received');

$err = is_file($data . '/err.log') ? (string)file_get_contents($data . '/err.log') : '';
chk(!preg_match('/PHP (Warning|Fatal|Notice|Deprecated)|Uncaught|NoWorkspaceException/', $err), 'server stderr clean: ' . substr(trim($err), 0, 300));
echo "\n$n checks, $fail failed\n";
exit($fail ? 1 : 0);
