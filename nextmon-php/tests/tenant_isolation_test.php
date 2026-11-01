<?php
/**
 * Adversarial multi-tenant isolation suite (spec: docs/MULTITENANT.md).
 *
 *   php tests/tenant_isolation_test.php [json|sqlite] [--keep] [--selfcheck] [--only=area,area] [-v]
 *
 * Boots `php -S` in demo mode on a free port with a throwaway NEXTMON_DATA (JSON storage by default so the file-level scan can
 * work), creates via tests/tenant_bootstrap.php (Workspace API): platform admin + workspaces A, B (owner + operator + reseller each),
 * C (gets suspended) and D (limits routers=1, staff=1). Seeds every workspace over HTTP as its owner (routers incl. the SAME router id and
 * session name in A and B, vouchers, POS sale, template, shop + order, reseller wallet, API key, notification settings, backup, audit)
 * with unique markers (ZZ-A-SECRET-<rand>) and then attacks both directions (A<-B, B<-A) as other owner / other operator / other
 * reseller / anonymous / other API key. A leak = a victim marker, API key, order token, voucher prefix or staff username in ANY
 * response body, header or redirect. Also verifies victim data is unchanged after each attack round.
 *
 * Areas report PASS / FAIL / PENDING; exit code 1 when any area FAILs (PENDING never fails the run, so it can be run before the core lands).
 * Missing routes (e.g. /platform/*, router share) => PENDING. Re-run after the core is merged: no edits needed.
 */
error_reporting(E_ALL);
ini_set('display_errors', '1');
$root = dirname(__DIR__);
require __DIR__ . '/tenant_lib.php';

$backend = in_array($argv[1] ?? '', ['json', 'sqlite'], true) ? $argv[1] : 'json';
$keep = in_array('--keep', $argv, true);
$verbose = in_array('-v', $argv, true);
$selfOnly = in_array('--selfcheck', $argv, true);
$only = [];
foreach ($argv as $a) {
    if (str_starts_with($a, '--only=')) {
        $only = array_filter(explode(',', substr($a, 7)));
    }
}
$want = fn(string $id) => !$only || in_array($id, $only, true);

/** Files that may touch the data dir directly (everything else must go through Store / Workspace). Extend with a justification. */
const STATIC_ALLOW = ['Store.php', 'JsonStore.php', 'SqliteStore.php', 'Workspace.php', 'Crypto.php'];
const ATTACK_SKIP = '#^(POST /logout|POST /login|POST /setup|GET /setup|GET /lang|POST /pay/callback|POST /notifications/test|POST /monitor/test|POST /monitor/simulate|POST /security/sessions/revoke-others|POST /settings/password|POST /tools/run|POST /wizard/run|POST /routers/test)$#';
const PUBLIC_PATHS = ['/shop', '/shop/order', '/pay/callback', '/login', '/setup', '/status', '/status.json', '/manifest.webmanifest', '/sw.js', '/offline', '/lang'];
const GLOBAL_FILE_RE = '#(^|/)(users|workspaces|shares|platform|session_index|apikey_index|login_attempts|rate_limits|sessions_meta|secret\.key|storage\.conf)([._/-]|$)#';
const PER_WS_ROOT_RE = '#^(routers|settings|shop|wallets|resellers|apikeys|scheduler|monitor[\w.-]*|orders|backups|audit\.log|notify\.log|alerts\.log|wizard\.log|demo-[\w.-]+|pos-[\w.-]+|sales[\w.-]*)(\.json|\.log|/|$)#';

$R = new Rep;
$R->area('static', 'Static: raw data IO');
$R->area('core', 'Core present');
$R->area('seed', 'Seed + positive ctl');
$R->area('cross_routes', 'Cross-tenant routes');
$R->area('idor', 'IDOR direct ids');
$R->area('json_api', '/json + /api/v1');
$R->area('hpp', 'Param pollution');
$R->area('public', 'Public pages');
$R->area('cache', 'Cache isolation');
$R->area('platform', 'Platform admin');
$R->area('privesc', 'Privilege escalation');
$R->area('limits', 'Workspace limits');
$R->area('suspend', 'Suspended workspace');
$R->area('cron', 'Cron isolation');
$R->area('share', 'Router sharing ro/rw');
$R->area('session', 'Session fixation');
$R->area('files', 'File namespace scan');
$R->area('cli', 'CLI tenant:*');
$R->area('harness', 'Harness self-check');

// ===================================================================================================================
// 1. Static scan (independent of the core)
// ===================================================================================================================
function ti_static_scan(string $root, Rep $R): void
{
    $fnRe = '/\b(fopen|file_put_contents|file_get_contents|file|glob|scandir|opendir|readfile|unlink|rename|copy|touch|mkdir|rmdir|tempnam|fwrite|is_file|is_dir|filemtime|filesize|rrmdir|array_map\s*\(\s*[\'"]unlink)\s*\(/';
    $srcRe = '/Store::(dir|path)\s*\(|NEXTMON_DATA|Workspace::dir\s*\(|dataDir/';
    $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root . '/src', FilesystemIterator::SKIP_DOTS));
    foreach ($files as $f) {
        if (!$f->isFile() || $f->getExtension() !== 'php' || str_contains(str_replace('\\', '/', $f->getPathname()), '/src/views/') || in_array($f->getFilename(), STATIC_ALLOW, true)) {
            continue;
        }
        $lines = file($f->getPathname(), FILE_IGNORE_NEW_LINES) ?: [];
        if (preg_grep('~//\s*tenant-ok-file~', $lines)) {
            continue;   // whole file declared global-only (e.g. compiled language cache) with a reason in the marker comment
        }
        $vars = [];
        foreach ($lines as $l) {   // variables holding a data-dir path
            if (preg_match('/(\$\w+)\s*(?:\.?=)\s*[^;]*(?:Store::(?:dir|path)\s*\(|NEXTMON_DATA|Workspace::dir\s*\()/', $l, $m)) {
                $vars[$m[1]] = true;
            }
        }
        foreach ($lines as $i => $l) {
            if (!preg_match($fnRe, $l) || str_contains($l, 'tenant-ok') || str_contains($lines[$i - 1] ?? '', 'tenant-ok') || str_contains($l, 'php://')) {
                continue;
            }
            $hit = preg_match($srcRe, $l) === 1;
            foreach (array_keys($vars) as $v) {
                $hit = $hit || preg_match('/' . preg_quote($v, '/') . '\b/', $l) === 1;
            }
            $R->ok('static', !$hit, 'direct file IO on the data dir outside Store/Workspace: ' . substr($f->getPathname(), strlen($root) + 1) . ':' . ($i + 1) . '  ' . trim(mb_substr($l, 0, 90)) . '   (route via Store/Workspace::dir, or mark the line/previous line "// tenant-ok: reason", or the file "// tenant-ok-file: reason" if it only touches global data)');
        }
    }
    $R->ok('static', true, 'scan ran');
}
if ($want('static')) {
    ti_static_scan($root, $R);
}

// ===================================================================================================================
// 2. Core detection
// ===================================================================================================================
$routes = require $root . '/src/routes.php';
foreach (glob($root . '/src/routes.d/*.php') ?: [] as $rf) {
    $routes = array_merge($routes, (array)require $rf);
}
ksort($routes);
$platformRoutes = array_filter($routes, fn($k) => (bool)preg_match('# /platform#', $k), ARRAY_FILTER_USE_KEY);
$shareRoutes = array_filter($routes, fn($k) => (bool)preg_match('#share#i', $k), ARRAY_FILTER_USE_KEY);
$coreFile = is_file($root . '/src/Workspace.php');

$serverAreas = ['core', 'seed', 'cross_routes', 'idor', 'json_api', 'hpp', 'public', 'cache', 'platform', 'privesc', 'limits', 'suspend', 'cron', 'share', 'session', 'files'];
$data = str_replace('\\', '/', sys_get_temp_dir()) . '/nextmon-tenant-' . bin2hex(random_bytes(3));
mkdir($data, 0775, true);
$proc = null;
$cleanup = function () use (&$proc, $data, &$keep) {
    if (is_resource($proc)) {
        @proc_terminate($proc);
        @proc_close($proc);
        $proc = null;
    }
    if (!$keep) {
        ti_rrmdir($data);
    } else {
        echo "\n(kept data dir: $data)\n";
    }
};
register_shutdown_function($cleanup);

function ti_start_server(string $root, string $data, string $backend, &$proc): string
{
    $port = ti_free_port();
    $env = array_merge(getenv(), ['NEXTMON_DEMO' => '1', 'NEXTMON_DEBUG' => '1', 'NEXTMON_DATA' => $data, 'NEXTMON_STORAGE' => $backend]);
    $cmd = [PHP_BINARY, '-d', 'display_errors=1', '-d', 'error_reporting=E_ALL', '-d', 'html_errors=1', '-S', "127.0.0.1:$port", '-t', $root . '/public'];
    $proc = proc_open($cmd, [0 => ['pipe', 'r'], 1 => ['file', $data . '/out.log', 'w'], 2 => ['file', $data . '/err.log', 'w']], $pipes, $root, $env);
    for ($i = 0; $i < 80; $i++) {
        $c = @fsockopen('127.0.0.1', $port, $en, $es, 0.2);
        if ($c) {
            fclose($c);
            return TC::$base = "http://127.0.0.1:$port";
        }
        usleep(100000);
    }
    throw new RuntimeException('server did not start');
}

// ===================================================================================================================
// Seeding + harvesting helpers
// ===================================================================================================================
/** Seed one workspace over HTTP as its owner. Returns the context (markers, ids, secrets). */
function ti_seed(TC $o, array $ctx, Rep $R, string $area): array
{
    $T = $ctx['T'];
    $M = $ctx['M'];
    $ok = fn(bool $c, string $l) => $R->ok($area, $c, "$T: $l");
    $rand = bin2hex(random_bytes(2));
    $ctx += ['prefix' => 'zz' . strtolower($T) . bin2hex(random_bytes(2)), 'sameId' => 'samerid01', 'sameSession' => 'sharedsess',
        'r2' => 'r' . strtolower($T) . $rand, 'r2session' => 's' . strtolower($T) . $rand];

    // routers: same id + same session name in every workspace on purpose (cache / demo-file collision test)
    $r = $o->post('/routers/save', ['id' => $ctx['sameId'], 'name' => "$M-router", 'type' => 'demo', 'session' => $ctx['sameSession'], 'hotspot_name' => "$M-hs", 'host' => '', 'user' => 'admin', 'pass' => "$M-routerpass"]);
    $ok(in_array($r['code'], [200, 302], true), 'router save (shared id) accepted: ' . $r['code']);
    $o->post('/routers/save', ['id' => $ctx['r2'], 'name' => "$M-r2", 'type' => 'demo', 'session' => $ctx['r2session'], 'hotspot_name' => "$M-hs2", 'host' => '', 'user' => 'admin', 'pass' => 'x']);
    $o->post('/routers/select', ['id' => $ctx['sameId']]);
    $ok(str_contains($o->get('/routers')['body'], "$M-router"), 'own router visible on /routers');

    $vp = $o->get('/vouchers');
    preg_match('/name="profile"[^>]*>\s*<option value="([^"]+)"/s', $vp['body'], $m);
    $profile = html_entity_decode($m[1] ?? '', ENT_QUOTES);
    $ok($profile !== '', 'a hotspot profile is available on /vouchers');
    $ctx['profile'] = $profile;


    // vouchers + sale
    $g = $o->post('/vouchers/generate', ['profile' => $profile, 'qty' => '3', 'prefix' => $ctx['prefix'], 'length' => '6', 'charset' => 'lowernum', 'mode' => 'vc', 'batch' => $M, 'limit_uptime' => '', 'limit_bytes' => '', 'server' => 'all']);
    $ok($g['code'] === 302, 'voucher generate redirects (' . $g['code'] . ')');
    $ctx['print'] = $g['loc'];
    if ($g['loc'] !== '') {
        $pv = $o->get(preg_replace('#^https?://[^/]+#', '', $g['loc']));
        $ok(stripos($pv['body'], $ctx['prefix']) !== false, 'print view shows own voucher prefix');
    }
    $pos = $o->post('/pos/sell', ['profile' => $profile]);
    $ok(str_contains($pos['body'], '"ok":true'), 'POS sale: ' . substr($pos['body'], 0, 80));

    // template, settings, notifications, API key, backup, monitor
    $o->post('/vouchers/templates/save', ['name' => "$M-tpl", 'html' => "<div class=\"v\">$M-tplhtml {{code}}</div>"]);
    $ok(str_contains($o->get('/vouchers/templates')['body'], "$M-tpl"), 'template saved');
    $o->post('/settings/save', ['lang' => 'en', 'timezone' => 'Asia/Jakarta', 'currency' => 'Rp', 'hotspot_name' => "$M-hotspot", 'login_url' => 'http://hotspot.local/login', 'max_qty' => '500']);
    $ok(str_contains($o->get('/settings')['body'], "$M-hotspot"), 'settings saved');
    $o->post('/notifications/save', ['enabled' => '1', 'token' => "$M-tgtoken", 'chat_id' => "$M-chat", 'events' => ['sale'], 'webhook_url' => '']);
    $ok(str_contains($o->get('/notifications')['body'], "$M-chat"), 'notification settings saved');
    $o->post('/settings/key', ['name' => "$M-key", 'scope' => 'write']);
    $sp = $o->get('/settings');
    preg_match('/kl_[0-9a-f]{40}/', $sp['body'], $m);
    $ctx['apikey'] = $m[0] ?? '';
    $ok($ctx['apikey'] !== '', 'API key created and shown once');
    preg_match('#/settings/key-delete"[^>]*>.*?name="id"\s+value="([^"]+)"#s', $sp['body'], $m);
    $ctx['keyId'] = $m[1] ?? '';
    $o->post('/backup/create', ['type' => 'rsc']);
    preg_match('/([A-Za-z0-9_.\-]+\.rsc)/', $o->get('/backup')['body'], $m);
    $ctx['backup'] = $m[1] ?? '';
    $ok($ctx['backup'] !== '', 'backup file listed');
    $o->post('/monitor/run');

    // shop + public order
    $o->post('/shop/settings/save', ['enabled' => '1', 'router' => $ctx['sameId'], 'title' => "$M shop", 'tagline' => "$M-tagline", 'gateway' => 'manual', 'env' => 'sandbox',
        'instructions' => "$M-instr", 'expiry_minutes' => '30', 'order_limit' => '5', 'pkg' => [['id' => '', 'profile' => $profile, 'price' => '5000', 'label' => "$M-pkg", 'active' => '1']]]);
    $anon = new TC('anon-order');
    $sh = $anon->get('/shop', ['w' => $ctx['slug']]);
    $ok(str_contains($sh['body'], "$M shop") || str_contains($sh['body'], "$M-pkg"), 'public shop (?w=slug) shows own shop');
    preg_match('/name="package"\s+value="([^"]+)"/', $sh['body'], $m);
    $ctx['pkgId'] = $m[1] ?? '';
    preg_match('/name="_csrf"\s+value="([^"]+)"/', $sh['body'], $mc);
    $anon->csrf = $mc[1] ?? '';
    if ($ctx['pkgId'] !== '') {
        $od = $anon->req('POST', '/shop/order?w=' . rawurlencode($ctx['slug']), ['w' => $ctx['slug'], 'name' => "$M-cust", 'phone' => '081234567890', 'email' => 'a@example.com', 'package' => $ctx['pkgId'], 'terms' => '1', 'website' => '']);
        $ok($od['code'] === 302, 'public order created (' . $od['code'] . ')');
        parse_str((string)parse_url($od['loc'], PHP_URL_QUERY), $q);
        $ctx['orderId'] = (string)($q['id'] ?? '');
        $ctx['orderToken'] = (string)($q['t'] ?? '');
    }
    $ok(($ctx['orderId'] ?? '') !== '', 'order id obtained');
    $ok(str_contains($o->get('/orders')['body'], "$M-cust"), 'order listed in /orders');

    // staff
    foreach (['op' => 'operator', 'rs' => 'reseller'] as $k => $role) {
        $ctx[$k] = $k . strtolower($T) . '_' . bin2hex(random_bytes(3));
        $o->post('/settings/user', ['id' => '', 'username' => $ctx[$k], 'role' => $role, 'password' => TI_PASSWORD]);
    }
    $tp = $o->get('/vouchers/templates');
    preg_match('/name="id"\s+value="([^"]+)"/', $tp['body'], $m);
    $ctx['tplId'] = $m[1] ?? '';
    return $ctx;
}

/** Put an attacker's own settings back after blank POSTs from the attack sweep (same ids, so objects stay addressable). */
function ti_restore(TC $o, array $c): void
{
    $M = $c['M'];
    $o->post('/routers/save', ['id' => $c['sameId'], 'name' => "$M-router", 'type' => 'demo', 'session' => $c['sameSession'], 'hotspot_name' => "$M-hs", 'host' => '', 'user' => 'admin', 'pass' => '']);
    $o->post('/routers/select', ['id' => $c['sameId']]);
    $o->post('/settings/save', ['lang' => 'en', 'timezone' => 'Asia/Jakarta', 'currency' => 'Rp', 'hotspot_name' => "$M-hotspot", 'login_url' => 'http://hotspot.local/login', 'max_qty' => '500']);
    $o->post('/notifications/save', ['enabled' => '1', 'token' => '', 'chat_id' => "$M-chat", 'events' => ['sale'], 'webhook_url' => '']);
    $o->post('/shop/settings/save', ['enabled' => '1', 'router' => $c['sameId'], 'title' => "$M shop", 'tagline' => "$M-tagline", 'gateway' => 'manual', 'env' => 'sandbox',
        'instructions' => "$M-instr", 'expiry_minutes' => '30', 'order_limit' => '5', 'pkg' => [['id' => $c['pkgId'], 'profile' => $c['profile'], 'price' => '5000', 'label' => "$M-pkg", 'active' => '1']]]);
}

/** Marker-bearing strings + wallet text from the victim owner's pages: changes when somebody mutates the victim's data. */
function ti_signature(TC $o, ?TC $rs, string $M): string
{
    $sig = [];
    foreach (['/routers', '/vouchers/templates', '/resellers', '/shop/settings', '/settings', '/orders', '/backup', '/notifications'] as $p) {
        $b = html_entity_decode($o->get($p)['body'], ENT_QUOTES);
        preg_match_all('/[^<>"\']*' . preg_quote(substr($M, 0, 8), '/') . '[A-Z\-]*[0-9a-f]{8}[^<>"\']*/i', $b, $mm);
        $sig[$p] = implode('|', array_unique($mm[0])) . '#' . substr_count($b, '<tr') . '#' . preg_match_all('/\bname="id"\s+value="/', $b);
    }
    if ($rs) {
        $w = $rs->get('/me/wallet')['body'];
        $w = preg_replace('/\d{4}-\d\d-\d\d[ T\d:]*|data-csrf="[^"]*"|name="_csrf"\s+value="[^"]*"|nonce="[^"]*"/', '', $w);
        $sig['wallet'] = md5((string)$w);
    }
    ksort($sig);
    return md5(json_encode($sig));
}

function ti_needles(array $c): array
{
    $n = ['marker' => $c['M'], 'prefix' => $c['prefix'] ?? '', 'apikey' => $c['apikey'] ?? '', 'order token' => $c['orderToken'] ?? '',
        'owner user' => $c['owner'] ?? '', 'operator user' => $c['op'] ?? '', 'reseller user' => $c['rs'] ?? ''];
    return array_filter($n, fn($v) => is_string($v) && strlen($v) >= 6);
}

// ---- generic attack runner -------------------------------------------------------------------------------------------
function ti_attack_routes(Rep $R, string $area, array $routes, TC $att, array $needles, array $params, string $label, bool $anon = false, bool $publicOk = false, array $getOnly = []): int
{
    $n = 0;
    foreach ($routes as $key => [$class, $fn, $cap]) {
        if (preg_match(ATTACK_SKIP, $key)) {
            continue;
        }
        [$method, $path] = explode(' ', $key, 2);
        $p = $params;
        if ($method !== 'GET') {
            $p = array_diff_key($p, array_flip($getOnly));   // ids that also exist in the attacker's own workspace must not make it mutate itself
        }
        $res = $att->req($method, $path, $p);
        $n++;
        $sent = array_filter($p, 'is_string');
        // $publicOk: the public pages are addressed by workspace ref (?w=) ON PURPOSE, so the named workspace's public shop/status may show
        $leak = ($publicOk && in_array($path, PUBLIC_PATHS, true)) ? [] : ti_leaks($res, $needles, $sent);
        $R->ok($area, !$leak, "LEAK [" . implode(',', $leak) . "] $label $key" . ($leak ? '  ' . ($GLOBALS['ti_last_leak'] ?? '') : ''));
        $R->ok($area, $res['code'] > 0 && ($res['code'] < 500 || $res['code'] === 502), "$label $key -> {$res['code']} (server error)");   // 502 = RouterOS error (no such item), not a crash
        $diag = ti_php_errors($res['body']);
        $R->ok($area, !$diag, "$label $key PHP diagnostic: " . ($diag[0] ?? ''));
        if ($anon && !in_array($path, PUBLIC_PATHS, true)) {
            $R->ok($area, in_array($res['code'], [302, 401, 403], true), "anonymous $key not protected (got {$res['code']})");
        }
    }
    return $n;
}

function ti_http_get_code(TC $c, string $path, array $p = []): int
{
    return $c->get($path, $p)['code'];
}

// ===================================================================================================================
// 3. Harness self-check (legacy single-tenant) when the core is absent, or on --selfcheck
// ===================================================================================================================
function ti_selfcheck(string $root, string $data, string $backend, Rep $R, &$proc): void
{
    $sd = $data . '/legacy';
    mkdir($sd, 0775, true);
    $b = ti_boot_cmd($root, $sd, $backend, 'legacy');
    if (!$R->ok('harness', !isset($b['error']), 'bootstrap legacy admin: ' . ($b['error'] ?? ''))) {
        return;
    }
    ti_start_server($root, $sd, $backend, $proc);
    $o = new TC('legacy');
    if (!$R->ok('harness', $o->login('legacy_admin'), 'legacy login')) {
        return;
    }
    $ctx = ti_seed($o, ['T' => 'L', 'M' => 'ZZ-L-SECRET-' . bin2hex(random_bytes(4)), 'slug' => 'main', 'owner' => 'legacy_admin'], $R, 'harness');
    $s1 = ti_signature($o, null, $ctx['M']);
    $s2 = ti_signature($o, null, $ctx['M']);
    $R->ok('harness', $s1 === $s2, 'integrity signature is stable across two reads (otherwise attack rounds would flake)');
    $R->ok('harness', ti_leaks(['headers' => '', 'loc' => '', 'body' => "x {$ctx['M']}-router y"], ['m' => $ctx['M']]) === ['m'], 'leak detector fires');
    $R->ok('harness', ti_leaks(['headers' => '', 'loc' => '', 'body' => "echo {$ctx['M']} here"], ['m' => $ctx['M']], [$ctx['M']]) === [], 'leak detector scrubs values the attacker sent');
    $R->ok('harness', ti_leaks(['headers' => '', 'loc' => '', 'body' => "echo {$ctx['M']}-router"], ['m' => $ctx['M']], [$ctx['M']]) === ['m'], 'scrub does not hide longer derived strings');
    $api = new TC('api');
    $r = $api->get('/api/v1/users', ['q' => $ctx['prefix']], ['X-API-Key: ' . $ctx['apikey']]);
    $R->ok('harness', str_contains($r['body'], '"ok":true'), 'API key positive control works: ' . substr($r['body'], 0, 60));
    $R->note('harness', 'ran against the legacy single-tenant app (core absent): seeding field names verified, ' . TC::$count . ' requests');
}

if (!$coreFile && !$selfOnly) {
    foreach ($serverAreas as $a) {
        $R->pend($a, 'core missing (src/Workspace.php not found)');
    }
    $R->areas['core']['fails'][] = 'src/Workspace.php does not exist yet';
    $R->areas['core']['checks'] = 1;
    if ($want('harness')) {
        try {
            ti_selfcheck($root, $data, $backend, $R, $proc);
        } catch (Throwable $e) {
            $R->ok('harness', false, 'exception ' . $e->getMessage());
        }
    }
    goto done;
}
if ($selfOnly) {
    foreach ($serverAreas as $a) {
        $R->pend($a, '--selfcheck only');
    }
    ti_selfcheck($root, $data, $backend, $R, $proc);
    goto done;
}
// leak-detector unit checks need no server, so they always run
$R->ok('harness', ti_leaks(['headers' => '', 'loc' => '', 'body' => 'x ZZ-A-SECRET-1234abcd-router y'], ['m' => 'ZZ-A-SECRET-1234abcd']) === ['m'], 'leak detector fires');
$R->ok('harness', ti_leaks(['headers' => '', 'loc' => '', 'body' => 'echo ZZ-A-SECRET-1234abcd here'], ['m' => 'ZZ-A-SECRET-1234abcd'], ['ZZ-A-SECRET-1234abcd']) === [], 'detector scrubs values the attacker sent');
$R->ok('harness', ti_leaks(['headers' => '', 'loc' => '', 'body' => 'echo ZZ-A-SECRET-1234abcd-router'], ['m' => 'ZZ-A-SECRET-1234abcd'], ['ZZ-A-SECRET-1234abcd']) === ['m'], 'scrub does not hide longer derived strings');

// ===================================================================================================================
// 4. Create workspaces
// ===================================================================================================================
$tag = fn() => bin2hex(random_bytes(4));
$W = [];
foreach (['A', 'B', 'C', 'D'] as $T) {
    $M = "ZZ-$T-SECRET-" . $tag();
    $W[$T] = ['T' => $T, 'M' => $M, 'slug' => 'ti-' . strtolower($T) . '-' . bin2hex(random_bytes(2)), 'owner' => 'own' . strtolower($T) . '_' . bin2hex(random_bytes(3))];
}
$specs = [];
foreach ($W as $T => $c) {
    $specs[] = ['tag' => $T, 'name' => $c['M'] . '-ws', 'slug' => $c['slug'], 'owner' => $c['owner'], 'limits' => $T === 'D' ? ['routers' => 1, 'staff' => 1] : []];
}
$platUser = 'plat_' . bin2hex(random_bytes(3));
$init = ti_boot_cmd($root, $data, $backend, 'init', ['workspaces' => $specs, 'platform' => $platUser]);
$created = array_column($init['workspaces'] ?? [], null, 'tag');
foreach ($W as $T => &$c) {
    $c['id'] = $created[$T]['id'] ?? '';
}
unset($c);
$R->ok('core', isset($init['core']) && $init['core'] === true, 'Workspace class + create(): ' . ($init['error'] ?? ''));
foreach ($init['errors'] ?? [] as $e) {
    $R->ok('core', false, $e);
}
foreach ($W as $T => $c) {
    $R->ok('core', $c['id'] !== '', "workspace $T created (id)");
}
$platformOk = (bool)($init['platform_ok'] ?? false);
$R->ok('core', $platformOk, 'role "platform" can be created through Auth::create');
if (!isset($init['core']) || !$init['core'] || !array_filter($W, fn($c) => $c['id'] !== '')) {
    foreach ($serverAreas as $a) {
        if ($a !== 'core') {
            $R->pend($a, 'workspaces could not be created');
        }
    }
    goto done;
}

ti_start_server($root, $data, $backend, $proc);
$jars = [];
$login = function (string $name, string $user) use (&$jars, $R): TC {
    $c = new TC($name);
    $R->ok('core', $c->login($user), "login $name ($user)");
    return $jars[$name] = $c;
};
$own = ['A' => $login('ownerA', $W['A']['owner']), 'B' => $login('ownerB', $W['B']['owner']), 'C' => $login('ownerC', $W['C']['owner']), 'D' => $login('ownerD', $W['D']['owner'])];

// ===================================================================================================================
// 5. Seed
// ===================================================================================================================
foreach (['A', 'B', 'C'] as $T) {
    try {
        $W[$T] = ti_seed($own[$T], $W[$T], $R, 'seed');
    } catch (Throwable $e) {
        $R->ok('seed', false, "seeding $T threw " . $e->getMessage());
    }
}
$users = ti_boot_cmd($root, $data, $backend, 'users')['users'] ?? [];
$uid = [];
foreach ($users as $u) {
    $uid[$u['username']] = $u;
}
foreach (['A', 'B'] as $T) {
    $W[$T]['opId'] = $uid[$W[$T]['op'] ?? '']['id'] ?? '';
    $W[$T]['rsId'] = $uid[$W[$T]['rs'] ?? '']['id'] ?? '';
    $W[$T]['ownerId'] = $uid[$W[$T]['owner']]['id'] ?? '';
    $R->ok('seed', $W[$T]['opId'] !== '' && $W[$T]['rsId'] !== '', "$T: staff accounts exist");
    $own[$T]->post('/resellers/save', ['id' => $W[$T]['rsId'], 'active' => '1', 'commission' => '0', 'adj' => '0', 'credit' => '0', 'allow_all' => '1']);
    $own[$T]->post('/resellers/fund', ['id' => $W[$T]['rsId'], 'amount' => '50000', 'kind' => 'topup', 'note' => $W[$T]['M'] . '-note']);
    $lg = $own[$T]->get('/resellers/ledger');
    $R->ok('seed', str_contains($lg['body'], $W[$T]['M'] . '-note'), "$T: reseller wallet top-up visible in ledger");
    preg_match('/name="entry"\s+value="([^"]+)"/', $lg['body'], $m);
    $W[$T]['entry'] = $m[1] ?? '';
    $jars["op$T"] = new TC("op$T");
    $R->ok('seed', $jars["op$T"]->login($W[$T]['op']), "login operator $T");
    $jars["rs$T"] = new TC("rs$T");
    $R->ok('seed', $jars["rs$T"]->login($W[$T]['rs']), "login reseller $T");
    $R->ok('seed', str_contains($own[$T]->get('/audit')['body'], 'login') || str_contains($own[$T]->get('/audit')['body'], 'settings.save'), "$T: audit page shows entries");
}
// each owner sees ONLY own markers (positive + negative baseline)
foreach (['A' => 'B', 'B' => 'A'] as $T => $O) {
    $r = $own[$T]->get('/json/users', ['router' => $W[$T]['sameId'], 'q' => $W[$T]['prefix']]);
    $R->ok('seed', preg_match('/"total":\s*[1-9]/', $r['body']) === 1, "$T: /json/users finds own voucher prefix");
    $R->ok('seed', !ti_leaks($r, ti_needles($W[$O])), "$T: /json/users does not contain $O markers");
}
$R->ok('seed', $W['A']['slug'] !== $W['B']['slug'] && $W['A']['id'] !== $W['B']['id'], 'distinct workspace ids/slugs');
$R->ok('seed', $W['A']['apikey'] !== '' && $W['A']['apikey'] !== $W['B']['apikey'], 'distinct API keys');
$sigBase = [];
foreach (['A', 'B'] as $T) {
    $sigBase[$T] = ti_signature($own[$T], $jars["rs$T"], $W[$T]['M']);
    $R->ok('seed', $sigBase[$T] === ti_signature($own[$T], $jars["rs$T"], $W[$T]['M']), "$T: integrity signature stable");
}

// ===================================================================================================================
// 6. Cross-tenant route sweep (every route, GET + POST with valid CSRF, victim ids as parameters)
// ===================================================================================================================
TC::$track = true;   // from here on every client remembers what it sent (own audit rows echo it)
if ($want('cross_routes')) {
    $apiB = ['A' => new TC('apiA'), 'B' => new TC('apiB')];
    foreach (['A' => 'B', 'B' => 'A'] as $V => $X) {          // V = victim, X = attacker
        $v = $W[$V];
        $x = $W[$X];
        $needles = ti_needles($v);
        $bundles = [
            'ids-1' => ['id' => $v['r2'], 'router' => $v['r2'], 'rid' => $v['r2'], 'tpl' => $v['tplId'], 'design' => $v['tplId'], 'session' => $v['r2session'], 'w' => $x['slug']],
            'ids-2' => ['id' => $v['orderId'] ?? '', 't' => 'x', 'comment' => $v['M'], 'batch' => $v['M'], 'tag' => $v['M'], 'name' => $v['backup'], 'file' => $v['backup'], 'entry' => $v['entry'] ?? '',
                'router' => $v['sameId'], 'q' => $v['prefix'], 'uid' => $v['rsId']],
            'pollution' => ['id' => $v['keyId'], 'uid' => $v['rsId'], 'user' => $v['opId'], 'workspace' => $v['id'], 'workspace_id' => $v['id'], 'ws' => $v['id'], 'w' => $v['id'], 'tenant' => $v['id'], 'mode' => 'rw', 'role' => 'admin'],
        ];
        $sigBase[$V] = ti_signature($own[$V], $jars["rs$V"], $v['M']);   // the victim may have been damaged by its own attacks in the previous direction
        $attackers = ['owner' => $own[$X], 'operator' => $jars["op$X"], 'reseller' => $jars["rs$X"]];
        $total = 0;
        $plan = ['owner' => ['ids-1', 'ids-2', 'pollution'], 'operator' => ['ids-2'], 'reseller' => ['pollution']];
        foreach ($attackers as $who => $tc) {
            foreach ($bundles as $bn => $params) {
                if (!in_array($bn, $plan[$who], true)) {
                    continue;
                }
                $label = "$who$X<-$V/$bn";
                $total += ti_attack_routes($R, 'cross_routes', $routes, $tc, $needles, $params, $label, false, $bn === 'pollution', ['router']);
                $sig = ti_signature($own[$V], $jars["rs$V"], $v['M']);
                $R->ok('cross_routes', $sig === $sigBase[$V], "victim $V data CHANGED after attack round $label");
                $sigBase[$V] = $sig;
            }
        }
        $anon = new TC('anon');
        foreach (['ids-1', 'pollution'] as $bn) {
            $total += ti_attack_routes($R, 'cross_routes', $routes, $anon, $needles, $bundles[$bn], "anon<-$V/$bn", true, $bn === 'pollution', ['router']);
        }
        // credentials of victim accounts intact after being targeted by id
        foreach (['owner' => $v['owner'], 'op' => $v['op'], 'rs' => $v['rs']] as $k => $un) {
            $chk = new TC('chk');
            $R->ok('cross_routes', $chk->login($un), "victim $V $k can still log in with the original password after attacks");
        }
        $R->note('cross_routes', "$X attacking $V: $total requests");
        ti_restore($own[$X], $x);   // attackers mutate their OWN workspace with blank POSTs (settings/shop/notifications): put it back
        $sigBase[$X] = ti_signature($own[$X], $jars["rs$X"], $x['M']);
    }
}

// ===================================================================================================================
// 7. IDOR: strict denial of direct object reads
// ===================================================================================================================
if ($want('idor')) {
    foreach (['A' => 'B', 'B' => 'A'] as $V => $X) {
        $v = $W[$V];
        $nd = ti_needles($v);
        foreach (['owner' => $own[$X], 'operator' => $jars["op$X"]] as $who => $tc) {
            $cases = [
                'GET /orders/view' => ['/orders/view', ['id' => $v['orderId']]],
                'GET /orders/export' => ['/orders/export', ['id' => $v['orderId'], 'q' => $v['M']]],
                'GET /backup/download(name)' => ['/backup/download', ['type' => 'file', 'name' => $v['backup']]],
                'GET /vouchers/print(comment)' => ['/vouchers/print', ['comment' => $v['M']]],
                'GET /resellers/ledger(uid)' => ['/resellers/ledger', ['uid' => $v['rsId'], 'export' => 'csv']],
                'GET /reports/export' => ['/reports/export', ['router' => $v['r2'], 'q' => $v['M']]],
            ];
            foreach ($cases as $lbl => [$path, $p]) {
                $res = $tc->get($path, $p);
                $R->ok('idor', !ti_leaks($res, $nd, array_filter($p, 'is_string')), "$who$X read $V's object via $lbl leaked " . implode(',', ti_leaks($res, $nd, array_filter($p, 'is_string'))));
            }
            $res = $tc->get('/orders/view', ['id' => $v['orderId']]);
            $R->ok('idor', in_array($res['code'], [302, 403, 404], true) || ($res['code'] === 200 && !ti_leaks($res, $nd, [$v['orderId']])), "$who$X /orders/view of $V order -> {$res['code']}");
            $res = $tc->get('/backup/download', ['type' => 'file', 'name' => $v['backup']]);
            $R->ok('idor', !str_contains($res['headers'], $v['backup']) || $v['backup'] === ($W[$X]['backup'] ?? '#'), "$who$X backup download of $V file name echoed in headers");
        }
        // anonymous public shop order status needs the token: wrong token must not reveal
        $anon = new TC('anon');
        $res = $anon->get('/shop/order', ['id' => $v['orderId'], 't' => $W[$V === 'A' ? 'B' : 'A']['orderToken']]);
        $R->ok('idor', !ti_leaks($res, $nd), "shop order $V with the other tenant's token revealed data");
        $res = $anon->get('/shop/order', ['id' => $v['orderId'], 't' => 'x', 'w' => $W[$X]['slug'], 'json' => '1']);
        $R->ok('idor', !ti_leaks($res, $nd) && $res['code'] !== 200, "shop order $V with wrong token + other slug -> {$res['code']}");
    }
}

// ===================================================================================================================
// 8. /json/* and /api/v1/*
// ===================================================================================================================
if ($want('json_api')) {
    $api = (string)file_get_contents($root . '/src/Controllers/ApiController.php');
    preg_match_all("/case '([a-z_\\-]+)':/", $api, $mm);
    $names = array_values(array_unique($mm[1]));
    $R->ok('json_api', count($names) >= 5, 'discovered ' . count($names) . ' API resources: ' . implode(',', $names));
    foreach (['A' => 'B', 'B' => 'A'] as $V => $X) {
        $v = $W[$V];
        $nd = ti_needles($v);
        $anon = new TC('anon');
        $xk = new TC('key' . $X);
        $xh = ['X-API-Key: ' . $W[$X]['apikey']];
        $xb = ['Authorization: Bearer ' . $W[$X]['apikey']];
        foreach ($names as $n) {
            $R->ok('json_api', $anon->get("/json/$n")['code'] === 401, "anon /json/$n -> 401");
            if ($n === $names[0] && $V === 'A') {   // the failed-key throttle (30/10min/IP) must not be exhausted by the suite itself
                $R->ok('json_api', $anon->get("/api/v1/$n")['code'] === 401, "anon /api/v1/$n -> 401");
            }
            foreach (['GET', 'POST'] as $m) {
                foreach (['owner' => $own[$X], 'reseller' => $jars["rs$X"]] as $who => $tc) {
                    $res = $tc->req($m, "/json/$n", ['router' => $v['r2'], 'q' => $v['prefix'], 'user' => $v['prefix']]);
                    // session API ignores ?router= (uses the session's router) => 200 with the caller's own router is fine; 5xx / foreign data is not
                    $R->ok('json_api', in_array($res['code'], [200, 400, 403, 404, 502], true), "$who$X $m /json/$n?router=<$V router> unexpected code {$res['code']}");
                    $R->ok('json_api', !ti_leaks($res, $nd, [$v['prefix'], $v['r2']]), "$who$X $m /json/$n?router=<$V router> leaked");
                    $res = $tc->req($m, "/json/$n", ['router' => $v['sameId'], 'q' => $v['prefix'], 'comment' => $v['M']]);
                    $R->ok('json_api', !ti_leaks($res, $nd, [$v['prefix'], $v['M']]), "$who$X $m /json/$n?router=<shared id> returned $V data");
                }
                $res = $xk->req($m, "/api/v1/$n?router=" . rawurlencode($v['r2']), ['q' => $v['prefix']], $xh);
                $R->ok('json_api', in_array($res['code'], [403, 404, 405, 400], true) && !ti_leaks($res, $nd, [$v['prefix'], $v['r2']]), "key$X $m /api/v1/$n?router=<$V router> got {$res['code']} / leaked");
                $res = $xk->req($m, "/api/v1/$n?router=" . rawurlencode($v['sameId']), ['q' => $v['prefix'], 'w' => $v['slug'], 'workspace' => $v['id']], $xb);
                $R->ok('json_api', !ti_leaks($res, $nd, [$v['prefix'], $v['slug'], $v['id']]), "key$X $m /api/v1/$n shared router id + ?w=$V leaked");
                $res = $xk->req($m, "/api/v1/$n", ['q' => $v['prefix']], array_merge($xh, ['X-Workspace: ' . $v['id'], 'X-Tenant: ' . $v['slug']]));
                $R->ok('json_api', !ti_leaks($res, $nd, [$v['prefix']]), "key$X $m /api/v1/$n with X-Workspace header leaked");
            }
        }
        // positive: the victim's own key still reaches its data; a made-up key and a truncated key do not
        $res = $xk->get('/api/v1/users', ['q' => $v['prefix'], 'router' => $v['sameId']], ['X-API-Key: ' . $v['apikey']]);
        $R->ok('json_api', preg_match('/"total":\s*[1-9]/', $res['body']) === 1, "$V key sees $V data (control)");
        foreach ($V === 'A' ? ['kl_' . bin2hex(random_bytes(20)), substr($v['apikey'], 0, 30), $v['apikey'] . 'x', strtoupper($v['apikey'])] : [] as $bad) {
            $res = $xk->get('/api/v1/users', [], ['X-API-Key: ' . $bad]);
            $R->ok('json_api', $res['code'] === 401, 'bad/mangled key -> 401 (got ' . $res['code'] . ')');
        }
    }
    // revocation: deleting a key kills it immediately (global key index must follow)
    $o = $own['A'];
    $o->post('/settings/key', ['name' => 'tmp-' . $W['A']['M'], 'scope' => 'read']);
    $sp = $o->get('/settings')['body'];
    preg_match('/kl_[0-9a-f]{40}/', $sp, $m1);
    preg_match_all('#/settings/key-delete"[^>]*>.*?name="id"\s+value="([^"]+)"#s', $sp, $m2);
    $tmpKey = $m1[0] ?? '';
    $c = new TC('c');
    $R->ok('json_api', $tmpKey !== '' && $c->get('/api/v1/users', [], ['X-API-Key: ' . $tmpKey])['code'] === 200, 'new key works');
    foreach ($m2[1] as $kid) {
        if ($kid !== $W['A']['keyId']) {
            $o->post('/settings/key-delete', ['id' => $kid]);
        }
    }
    $R->ok('json_api', $tmpKey !== '' && $c->get('/api/v1/users', [], ['X-API-Key: ' . $tmpKey])['code'] === 401, 'revoked key -> 401');
    $R->ok('json_api', $c->get('/api/v1/users', [], ['X-API-Key: ' . $W['A']['apikey']])['code'] === 200, 'A original key still valid after revoking another');
}

// ===================================================================================================================
// 9. HTTP parameter / header / cookie pollution
// ===================================================================================================================
if ($want('hpp')) {
    $pages = ['/routers', '/settings', '/vouchers/templates', '/orders', '/audit', '/reports', '/resellers', '/shop/settings', '/backup', '/notifications', '/json/users', '/json/dashboard', '/'];
    foreach (['A' => 'B', 'B' => 'A'] as $V => $X) {
        $v = $W[$V];
        $nd = ti_needles($v);
        $mine = $W[$X]['M'] . '-router';
        $pollutants = [];
        foreach (['workspace', 'w', 'ws', 'workspace_id', 'ws_id', 'tenant', 'wid'] as $k) {
            $pollutants[] = [[$k => $v['id']], []];
            $pollutants[] = [[$k => $v['slug']], []];
        }
        $pollutants[] = [[], ['X-Workspace: ' . $v['id']]];
        $pollutants[] = [[], ['X-Workspace-Id: ' . $v['id'], 'X-Tenant: ' . $v['slug'], 'X-WS: ' . $v['id']]];
        $pollutants[] = [[], ['Cookie: nextmon_sid=' . ($own[$X]->sid()) . '; workspace=' . $v['id'] . '; ws=' . $v['id'] . '; w=' . $v['slug']]];
        $pollutants[] = [['workspace' => $v['id'], 'w' => $v['id'], 'ws' => $v['id'], 'router' => $v['r2']], ['X-Workspace: ' . $v['id']]];
        foreach ($pollutants as $pi => [$params, $hdrs]) {
            $tc = $own[$X];
            foreach ($pages as $p) {
                if ($hdrs && str_starts_with($hdrs[0], 'Cookie:')) {   // replace the jar cookie header instead of adding a second one
                    $saved = $tc->jar;
                    $tc->jar = [];
                    $res = $tc->get($p, $params, $hdrs);
                    $tc->jar = $saved;
                } else {
                    $res = $tc->get($p, $params, $hdrs);
                }
                $R->ok('hpp', !ti_leaks($res, $nd, array_filter($params, 'is_string')), "owner$X GET $p pollution#$pi " . json_encode($params) . implode(' ', $hdrs) . ' leaked ' . implode(',', ti_leaks($res, $nd, $params)));
            }
            $res = $tc->get('/routers', $params, $hdrs);
            $R->ok('hpp', !$hdrs || !str_starts_with($hdrs[0], 'Cookie:') ? str_contains($res['body'], $mine) : true, "owner$X lost own workspace view with pollution#$pi " . json_encode($params));
        }
        // POST pollution must write to the session workspace, never the named one
        $newName = $W[$X]['M'] . '-hpp';
        $own[$X]->post('/settings/save', ['workspace' => $v['id'], 'w' => $v['slug'], 'ws' => $v['id'], 'lang' => 'en', 'timezone' => 'Asia/Jakarta', 'currency' => 'Rp', 'hotspot_name' => $newName, 'login_url' => 'http://hotspot.local/login', 'max_qty' => '500'], ['X-Workspace: ' . $v['id']]);
        $R->ok('hpp', str_contains($own[$X]->get('/settings')['body'], $newName), "$X POST /settings/save with workspace=$V wrote to $X (own)");
        $R->ok('hpp', !str_contains($own[$V]->get('/settings')['body'], $newName) && str_contains($own[$V]->get('/settings')['body'], $v['M'] . '-hotspot'), "$X POST /settings/save with workspace=$V CHANGED $V settings");
        $own[$X]->post('/settings/save', ['lang' => 'en', 'timezone' => 'Asia/Jakarta', 'currency' => 'Rp', 'hotspot_name' => $W[$X]['M'] . '-hotspot', 'login_url' => 'http://hotspot.local/login', 'max_qty' => '500']);
        $sigBase[$V] = ti_signature($own[$V], $jars["rs$V"], $v['M']);
    }
}

// ===================================================================================================================
// 10. Public pages
// ===================================================================================================================
if ($want('public')) {
    $anon = new TC('anon');
    foreach (['A' => 'B', 'B' => 'A'] as $V => $X) {
        $v = $W[$V];
        $x = $W[$X];
        $ndX = ti_needles($x);
        $res = $anon->get('/shop', ['w' => $v['slug']]);
        $R->ok('public', $res['code'] === 200 && str_contains($res['body'], $v['M']), "/shop?w=$V-slug shows $V shop (got {$res['code']})");
        $R->ok('public', !ti_leaks($res, $ndX), "/shop?w=$V-slug leaks $X data [" . implode(',', ti_leaks($res, $ndX)) . '] ' . ($GLOBALS['ti_last_leak'] ?? ''));
        // both shops enabled; with the other slug nothing of V may be visible
        $res = $anon->get('/shop', ['w' => $x['slug'], 'router' => $v['sameId'], 'package' => $v['pkgId']]);
        $R->ok('public', !ti_leaks($res, ti_needles($v), [$v['pkgId']]), "/shop?w=$X-slug + $V ids leaks $V data" . ($GLOBALS['ti_last_leak'] ?? ''));
        foreach (['/shop', '/status.json', '/status', '/manifest.webmanifest', '/sw.js', '/offline'] as $p) {
            foreach ([[], ['w' => 'no-such-ws'], ['w' => $x['slug'], 'session' => $v['r2session']], ['w' => $x['slug'], 'session' => $v['sameSession'], 'user' => $v['prefix'] . 'aaa']] as $q) {
                if ($p === '/shop' && ($q['w'] ?? '') === $x['slug']) {
                    continue;
                }
                $res = $anon->get($p, $q);
                $nd = ti_needles($v);
                if ($p === '/shop' && !$q) {
                    $nd += ti_needles($x);   // no slug at all: neither tenant's shop may appear
                }
                $R->ok('public', !ti_leaks($res, $nd, array_filter($q, 'is_string')), "anon GET $p " . json_encode($q) . " leaked " . implode(',', ti_leaks($res, $nd, $q)));
                $R->ok('public', $res['code'] < 500, "anon GET $p " . json_encode($q) . ' -> ' . $res['code']);
            }
        }
        // an order for V's package submitted against X's slug must not create anything in X or V
        $before = [substr_count($own[$V]->get('/orders')['body'], '/orders/view?id='), substr_count($own[$X]->get('/orders')['body'], '/orders/view?id=')];
        $evil = new TC('evil-orderer');   // own session: a rejected order re-renders the form prefilled from the session
        $sh = $evil->get('/shop', ['w' => $x['slug']]);
        preg_match('/name="_csrf"\s+value="([^"]+)"/', $sh['body'], $mc);
        $evil->csrf = $mc[1] ?? '';
        $res = $evil->req('POST', '/shop/order?w=' . $x['slug'], ['w' => $x['slug'], 'name' => $v['M'] . '-evil', 'phone' => '081200000000', 'package' => $v['pkgId'], 'terms' => '1', 'website' => '']);
        $after = [substr_count($own[$V]->get('/orders')['body'], '/orders/view?id='), substr_count($own[$X]->get('/orders')['body'], '/orders/view?id=')];
        $R->ok('public', $after[0] === $before[0], "order with $V package id via $X slug created an order in $V");
        $R->ok('public', $after[1] === $before[1] || !str_contains($own[$X]->get('/orders')['body'], $v['pkgId']), "order with $V package id via $X slug was accepted into $X");
        // payment callback with a foreign order id + workspace hint must neither leak nor crash
        $res = $anon->req('POST', '/pay/callback?w=' . $x['slug'], ['order_id' => $v['orderId'], 'id' => $v['orderId'], 'status' => 'paid', 'w' => $x['slug']], [], null);
        $R->ok('public', !ti_leaks($res, ti_needles($v), [$v['orderId']]) && $res['code'] < 500, "/pay/callback foreign order id -> {$res['code']}");
    }
}

// ===================================================================================================================
// 11. Cache isolation (same router id/session in both workspaces)
// ===================================================================================================================
if ($want('cache')) {
    $reads = ['/json/dashboard', '/json/users', '/json/active', '/json/sales', '/json/profiles', '/json/hosts', '/json/health'];
    $seq = [['A', 'B'], ['B', 'A'], ['A', 'B'], ['B', 'B'], ['A', 'A'], ['B', 'A']];
    foreach ($seq as $round => $order) {
        foreach ($order as $T) {
            $O = $T === 'A' ? 'B' : 'A';
            foreach ($reads as $p) {
                $res = $own[$T]->get($p, ['router' => $W[$T]['sameId'], 'period' => 'all', 'limit' => '1000']);
                $R->ok('cache', !ti_leaks($res, ti_needles($W[$O])), "round$round owner$T GET $p (same router id) leaked $O data: " . implode(',', ti_leaks($res, ti_needles($W[$O]))));
            }
            $res = $own[$T]->get('/json/users', ['router' => $W[$T]['sameId'], 'q' => $W[$T]['prefix']]);
            $R->ok('cache', preg_match('/"total":\s*[1-9]/', $res['body']) === 1, "round$round owner$T still sees own vouchers (cache poisoned by $O?)");
            foreach (['/', '/vouchers', '/reports', '/hotspot/users'] as $p) {
                $res = $own[$T]->get($p);
                $R->ok('cache', !ti_leaks($res, ti_needles($W[$O])), "round$round owner$T GET $p leaked $O data");
            }
        }
    }
    // cache files must live in a namespace (JSON backend): no root-level router cache shared by tenants
    if ($backend === 'json') {
        $cd = $data . '/cache';
        $R->ok('cache', true, 'cache dir inspected');
        if (is_dir($cd)) {
            $bad = [];
            foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($cd, FilesystemIterator::SKIP_DOTS)) as $f) {
                if ($f->isFile()) {
                    $body = (string)@file_get_contents($f->getPathname());
                    $hasA = stripos($body, $W['A']['M']) !== false || stripos($body, $W['A']['prefix']) !== false;
                    $hasB = stripos($body, $W['B']['M']) !== false || stripos($body, $W['B']['prefix']) !== false;
                    $rel = substr(str_replace('\\', '/', $f->getPathname()), strlen($data) + 1);
                    if ($hasA && $hasB) {   // hashed cache names carry the workspace in the key; a single file must never serve both tenants
                        $bad[] = $rel;
                    }
                }
            }
            $R->ok('cache', !$bad, 'cache files mixing tenants: ' . implode(', ', array_slice($bad, 0, 5)));
        }
    }
}

// ===================================================================================================================
// 12. Platform admin
// ===================================================================================================================
$plat = new TC('platform');
if ($want('platform')) {
    if (!$platformRoutes) {
        $R->pend('platform', 'no /platform/* routes yet (src/routes.php + routes.d)');
    } elseif (!$platformOk) {
        $R->ok('platform', false, 'platform user could not be created');
    } else {
        $R->ok('platform', $plat->login($platUser), 'platform admin can log in');
        $acc = $plat->get('/platform/accounts');
        $R->ok('platform', $acc['code'] === 200, '/platform/accounts -> 200 for platform (got ' . $acc['code'] . ')');
        foreach ($W as $T => $c) {
            $R->ok('platform', str_contains($acc['body'], $c['slug']) || str_contains($acc['body'], $c['M']), "platform sees workspace $T in the account list");
        }
        // everyone else is denied on EVERY /platform route, GET and POST
        $who = ['anon' => new TC('anon'), 'ownerA' => $own['A'], 'operatorA' => $jars['opA'], 'resellerA' => $jars['rsA'], 'ownerB' => $own['B']];
        $before = ti_boot_cmd($root, $data, $backend, 'list')['workspaces'] ?? [];
        foreach ($platformRoutes as $key => $_) {
            [$m, $p] = explode(' ', $key, 2);
            foreach ($who as $wn => $tc) {
                $res = $tc->req($m, $p, ['workspace' => $W['A']['id'], 'w' => $W['A']['id'], 'id' => $W['A']['id'], 'slug' => $W['A']['slug'], 'name' => 'evil-' . $W['A']['M'], 'owner' => 'evilowner', 'password' => TI_PASSWORD, 'status' => 'suspended', 'action' => 'delete']);
                $R->ok('platform', $wn === 'anon' ? in_array($res['code'], [302, 401, 403, 404], true) : in_array($res['code'], [403, 404], true), "$wn $key must be denied (got {$res['code']})");
                $R->ok('platform', !ti_leaks($res, $wn === 'ownerB' ? ti_needles($W['A']) : (str_ends_with($wn, 'A') ? ti_needles($W['B']) : ti_needles($W['A']) + ti_needles($W['B'])), ['evil-' . $W['A']['M'], $W['A']['M']]), "$wn $key leaked tenant data");
            }
        }
        $after = ti_boot_cmd($root, $data, $backend, 'list')['workspaces'] ?? [];
        $R->ok('platform', $before == $after, 'denied platform POSTs did not alter the workspace table');
        // switch + banner + audit
        $sw = array_keys(array_filter($platformRoutes, fn($k) => str_contains($k, 'switch'), ARRAY_FILTER_USE_KEY))[0] ?? null;
        if (!$sw) {
            $R->note('platform', 'no */switch route found: skipped impersonation checks');
        } else {
            [$m, $p] = explode(' ', $sw, 2);
            $params = fn(string $T) => ['workspace' => $W[$T]['id'], 'workspace_id' => $W[$T]['id'], 'w' => $W[$T]['id'], 'ws' => $W[$T]['id'], 'id' => $W[$T]['id'], 'slug' => $W[$T]['slug']];
            $sid0 = $plat->sid();
            $r = $plat->req($m, $p, $params('A'));
            $R->ok('platform', in_array($r['code'], [200, 302], true), "platform switch to A -> {$r['code']}");
            $plat->refreshCsrf();
            $home = $plat->get('/');
            $R->ok('platform', str_contains($home['body'], $W['A']['M']) || str_contains($home['body'], $W['A']['slug']), 'banner names workspace A after switching (marker/slug in layout)');
            $R->ok('platform', str_contains($plat->get('/routers')['body'], $W['A']['M'] . '-router'), 'platform sees A routers after switching');
            $R->ok('platform', !ti_leaks($plat->get('/routers'), ti_needles($W['B'])), 'after switching to A, B data is not visible');
            $au = $own['A']->get('/audit')['body'];
            $R->ok('platform', str_contains($au, $platUser), 'switch recorded in A audit log (actor ' . $platUser . ')');
            $R->note('platform', 'session id ' . ($sid0 !== $plat->sid() ? 'rotated' : 'kept') . ' on switch');
            $plat->req($m, $p, $params('B'));
            $plat->refreshCsrf();
            $R->ok('platform', str_contains($plat->get('/routers')['body'], $W['B']['M'] . '-router') && !ti_leaks($plat->get('/routers'), ti_needles($W['A'])), 'switching to B shows B only');
            $R->ok('platform', str_contains($own['B']->get('/audit')['body'], $platUser), 'switch recorded in B audit log');
            // non-platform users cannot switch (checked above for access; here: view stays on own workspace)
            foreach ($who as $wn => $tc) {
                if ($wn === 'anon') {
                    continue;
                }
                $tc->req($m, $p, $params($wn === 'ownerB' ? 'A' : 'B'));
                $res = $tc->get('/routers');
                $R->ok('platform', !ti_leaks($res, ti_needles($W[$wn === 'ownerB' ? 'A' : 'B'])), "$wn tried to switch: still confined");
            }
        }
        // platform user is global: the login of a normal owner is unaffected
        $R->ok('platform', (new TC('x'))->login($W['A']['owner']), 'owner A still logs in');
    }
}

// ===================================================================================================================
// 13. Privilege escalation
// ===================================================================================================================
if ($want('privesc')) {
    $A = $W['A'];
    $B = $W['B'];
    $opA = $jars['opA'];
    $rsA = $jars['rsA'];
    $R->ok('privesc', $opA->post('/settings/user', ['id' => $A['opId'], 'username' => $A['op'], 'role' => 'admin'])['code'] === 403, 'operator cannot promote self to admin (403)');
    $R->ok('privesc', $opA->post('/settings/key', ['name' => 'x'])['code'] === 403, 'operator cannot create API keys');
    $R->ok('privesc', $rsA->post('/settings/user', ['id' => '', 'username' => 'zz' . bin2hex(random_bytes(3)), 'role' => 'admin', 'password' => TI_PASSWORD])['code'] === 403, 'reseller cannot create users');
    foreach ($platformRoutes as $key => $_) {
        [$m, $p] = explode(' ', $key, 2);
        $R->ok('privesc', in_array($opA->req($m, $p)['code'], [403, 404], true), "operator denied $key");
    }
    // owner tries to mint platform / owner accounts
    foreach (['platform', 'admin'] as $role) {
        $evil = 'evil' . $role[0] . bin2hex(random_bytes(3));
        $own['A']->post('/settings/user', ['id' => '', 'username' => $evil, 'role' => $role, 'password' => TI_PASSWORD, 'workspace' => $B['id']]);
        $us = ti_boot_cmd($root, $data, $backend, 'users')['users'] ?? [];
        $made = array_values(array_filter($us, fn($u) => $u['username'] === $evil));
        if ($role === 'platform') {
            $R->ok('privesc', !$made || $made[0]['role'] !== 'platform', 'owner created a platform user (role=' . ($made[0]['role'] ?? '-') . ')');
            $nplat = count(array_filter($us, fn($u) => $u['role'] === 'platform'));
            $R->ok('privesc', $nplat <= 1, "exactly the bootstrap platform admin has role platform (found $nplat)");
        } else {
            $R->ok('privesc', !$made || ($made[0]['role'] !== 'admin'), 'owner created a second owner (admin) in workspace A (spec: staff only)');
            $R->ok('privesc', !$made || ($made[0]['workspace'] ?? '') !== $B['id'], 'created user landed in B via workspace param');
        }
        if ($made) {
            $e = new TC('evil');
            if ($e->login($evil)) {
                foreach ($platformRoutes as $key => $_) {
                    [$m, $p] = explode(' ', $key, 2);
                    $R->ok('privesc', in_array($e->req($m, $p)['code'], [403, 404], true), "minted $role user denied $key");
                }
                $R->ok('privesc', $e->post('/settings/key', ['name' => 'e'])['code'] === 403 || $role === 'admin', "minted $role user cannot admin");
            }
        }
    }
    // cross-tenant account takeover by user id
    $takeover = 'Hijack-' . bin2hex(random_bytes(4)) . 'Zq9!';
    foreach (['owner' => 'ownerId', 'op' => 'opId', 'rs' => 'rsId'] as $k => $idk) {
        $own['A']->post('/settings/user', ['id' => $B[$idk], 'username' => $B[$k], 'role' => 'viewer', 'password' => $takeover]);
        $own['A']->post('/settings/user-delete', ['id' => $B[$idk]]);
        $t = new TC('t');
        $R->ok('privesc', !$t->login($B[$k], $takeover), "owner A reset B's $k password through user id");
        $t2 = new TC('t2');
        $R->ok('privesc', $t2->login($B[$k]), "B's $k still exists with the original password");
    }
    $us = ti_boot_cmd($root, $data, $backend, 'users')['users'] ?? [];
    $byName = array_column($us, null, 'username');
    $R->ok('privesc', ($byName[$B['op']]['role'] ?? '') === 'operator' && ($byName[$B['rs']]['role'] ?? '') === 'reseller', 'B staff roles unchanged');
    // staff list pages must not show other tenants' users
    $R->ok('privesc', !ti_leaks($own['A']->get('/settings'), ti_needles($B)), 'A /settings does not list B users');
}

// ===================================================================================================================
// 14. Limits (workspace D: routers=1, staff=1)
// ===================================================================================================================
if ($want('limits')) {
    $d = $own['D'];
    $M = $W['D']['M'];
    $d->post('/routers/save', ['id' => 'rd1' . bin2hex(random_bytes(2)), 'name' => "$M-r1", 'type' => 'demo', 'host' => '', 'user' => 'admin']);
    $R->ok('limits', str_contains($d->get('/routers')['body'], "$M-r1"), 'D: first router (within limit) accepted');
    $r = $d->post('/routers/save', ['id' => 'rd2' . bin2hex(random_bytes(2)), 'name' => "$M-r2", 'type' => 'demo', 'host' => '', 'user' => 'admin']);
    $R->ok('limits', !str_contains($d->get('/routers')['body'], "$M-r2".'</'), 'D: second router refused (limit routers=1)');
    $d->post('/routers/save', ['id' => '', 'name' => "$M-r3", 'type' => 'demo', 'host' => '', 'user' => 'admin']);
    $R->ok('limits', !str_contains($d->get('/routers')['body'], "$M-r3"), 'D: third router (new id) refused');
    foreach (['s1', 's2'] as $s) {
        $d->post('/settings/user', ['id' => '', 'username' => "d$s" . bin2hex(random_bytes(2)), 'role' => 'operator', 'password' => TI_PASSWORD]);
    }
    $us = ti_boot_cmd($root, $data, $backend, 'users')['users'] ?? [];
    $inD = array_filter($us, fn($u) => ($u['workspace'] ?? '') === $W['D']['id'] && $u['username'] !== $W['D']['owner']);
    $R->ok('limits', count($inD) === 1, 'D: exactly 1 staff account within limit (found ' . count($inD) . ')');
    $R->ok('limits', ($own['A']->get('/routers')['code'] === 200), 'A unaffected by D limits');
    // A's own limits are independent: A has 2 routers from seeding
    $R->ok('limits', substr_count($own['A']->get('/routers')['body'], $W['A']['M'] . '-r') >= 1, 'A keeps its own routers');
}

// ===================================================================================================================
// 15. Suspend + cron
// ===================================================================================================================
if ($want('suspend') || $want('cron')) {
    $C = $W['C'];
    $nd = ti_needles($C);
    $cC = $own['C'];
    $R->ok('suspend', $cC->get('/routers')['code'] === 200 && str_contains($cC->get('/routers')['body'], $C['M']), 'C works before suspension');
    $cron = function (string $label) use ($root, $data, $backend, $R): array {
        $env = array_merge(getenv(), ['NEXTMON_DATA' => $data, 'NEXTMON_DEMO' => '1', 'NEXTMON_STORAGE' => $backend]);
        $p = proc_open([PHP_BINARY, $root . '/cron.php', '--force', '--quiet'], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pp, $root, $env);
        $out = stream_get_contents($pp[1]) . stream_get_contents($pp[2]);
        $code = proc_close($p);
        return [$code, $out];
    };
    $sus = ti_boot_cmd($root, $data, $backend, 'suspend', ['id' => $C['id']]);
    $R->ok('suspend', ($sus['ok'] ?? false) === true && ($sus['status'] ?? '') === 'suspended', 'workspace C suspended via Workspace API: ' . json_encode($sus));
    $fresh = new TC('freshC');
    $R->ok('suspend', !$fresh->login($C['owner']), 'suspended workspace: login blocked');
    foreach (['/', '/routers', '/vouchers', '/json/users', '/json/dashboard', '/settings', '/orders'] as $p) {
        $res = $cC->get($p);
        $R->ok('suspend', $res['code'] !== 200 || !str_contains($res['body'], $C['M']), "existing C session GET $p after suspend -> {$res['code']}");
        $R->ok('suspend', !ti_leaks($res, $nd), "existing C session GET $p leaked after suspend");
    }
    $R->ok('suspend', $cC->post('/settings/save', ['hotspot_name' => 'pwn-' . $C['M']])['code'] !== 200, 'write by suspended session refused');
    $anon = new TC('anon');
    $res = $anon->get('/shop', ['w' => $C['slug']]);
    $R->ok('suspend', !ti_leaks($res, $nd), 'public shop of suspended workspace hidden');
    foreach (['/status' => ['session' => $C['sameSession'], 'w' => $C['slug']], '/status.json' => ['session' => $C['r2session'], 'user' => 'x']] as $p => $q) {
        $res = $anon->get($p, $q);
        $R->ok('suspend', !ti_leaks($res, $nd, array_filter($q, 'is_string')), "public $p of suspended workspace leaked");
    }
    $res = $anon->get('/api/v1/users', [], ['X-API-Key: ' . $C['apikey']]);
    $R->ok('suspend', in_array($res['code'], [401, 403], true), 'API key of suspended workspace refused (got ' . $res['code'] . ')');
    $pc = $anon->get('/pay/callback', ['w' => $C['slug']]);
    $R->ok('suspend', in_array($pc['code'], [302, 403, 404, 410, 503], true), '/pay/callback for suspended workspace -> ' . $pc['code'] . ' ' . mb_substr(trim(preg_replace('/\s+/', ' ', strip_tags($pc['body']))), 0, 160));
    $R->ok('suspend', $own['A']->get('/')['code'] === 200 && $own['B']->get('/')['code'] === 200, 'other workspaces unaffected by the suspension');
    // cron: A and B get work, suspended C does not, nothing lands in global scope
    if ($want('cron')) {
        if ($backend !== 'json') {
            $R->pend('cron', 'file-level cron check needs the json backend');
        } else {
            $s0 = ti_snapshot($data);
            sleep(1);
            [$code, $out] = $cron('cron');
            $s1 = ti_snapshot($data);
            $changed = array_keys(array_filter($s1, fn($v, $k) => ($s0[$k] ?? null) !== $v, ARRAY_FILTER_USE_BOTH));
            $changed = array_values(array_filter($changed, fn($f) => !preg_match('#^(sessions/|out\.log|err\.log)#', $f)));
            $under = fn(string $id) => array_values(array_filter($changed, fn($f) => str_contains($f, $id)));
            $R->ok('cron', $code === 0 || $code === 3, "cron.php exit code $code: " . trim(mb_substr($out, 0, 200)));
            $R->ok('cron', count($under($W['A']['id'])) > 0, 'cron wrote data inside workspace A namespace');
            $R->ok('cron', count($under($W['B']['id'])) > 0, 'cron wrote data inside workspace B namespace');
            $R->ok('cron', count($under($C['id'])) === 0, 'cron touched SUSPENDED workspace C: ' . implode(', ', array_slice($under($C['id']), 0, 3)));
            $stray = array_values(array_filter($changed, fn($f) => preg_match(PER_WS_ROOT_RE, $f) && !preg_match(GLOBAL_FILE_RE, $f) && !str_contains($f, 'ws/') && !str_contains($f, $W['A']['id']) && !str_contains($f, $W['B']['id'])));
            $R->ok('cron', !$stray, 'cron wrote per-workspace collections at the data root: ' . implode(', ', array_slice($stray, 0, 4)));
            $R->ok('cron', !ti_leaks(['headers' => '', 'loc' => '', 'body' => $out], ti_needles($W['A']) + ti_needles($W['B'])), 'cron output contains tenant secrets');
            foreach (['A' => 'B', 'B' => 'A'] as $T => $O) {
                foreach (['/audit', '/notifications', '/monitor', '/settings'] as $p) {
                    $R->ok('cron', !ti_leaks($own[$T]->get($p), ti_needles($W[$O])), "after cron: $T $p shows $O data");
                }
            }
            $sigBase['A'] = ti_signature($own['A'], $jars['rsA'], $W['A']['M']);
            $sigBase['B'] = ti_signature($own['B'], $jars['rsB'], $W['B']['M']);
        }
    }
    $un = ti_boot_cmd($root, $data, $backend, 'unsuspend', ['id' => $C['id']]);
    $R->ok('suspend', ($un['ok'] ?? false) === true, 'unsuspend works: ' . json_encode($un));
    $R->ok('suspend', (new TC('u'))->login($C['owner']), 'after unsuspend the owner can log in again (block was due to suspension)');
    $R->ok('suspend', (new TC('u'))->get('/api/v1/users', [], ['X-API-Key: ' . $C['apikey']])['code'] === 200, 'after unsuspend the API key works again');
}

// ===================================================================================================================
// 16. Router sharing
// ===================================================================================================================
if ($want('share')) {
    $create = array_keys(array_filter($shareRoutes, fn($k) => str_starts_with($k, 'POST') && !preg_match('#revoke|delete|remove|unshare#i', $k), ARRAY_FILTER_USE_KEY))[0] ?? null;
    $revoke = array_keys(array_filter($shareRoutes, fn($k) => str_starts_with($k, 'POST') && preg_match('#revoke|delete|remove|unshare#i', $k), ARRAY_FILTER_USE_KEY))[0] ?? null;
    if (!$create) {
        $R->pend('share', 'no router-share routes yet (looked for /share* in routes + routes.d)');
    } else {
        $R->note('share', "using $create" . ($revoke ? " / $revoke" : '') . ' with best-effort params (router,id,to,target,workspace,slug,user,mode) - adjust SHARE_PARAMS in the test when the contract is final');
        // contract: POST /routers/share {router,to=slug,mode=ro|rw}; POST /routers/share/revoke {router,to}
        $shareParams = fn(string $mode, string $rid) => ['router' => $rid, 'to' => $W['B']['slug'], 'mode' => $mode];
        [, $cp] = explode(' ', $create, 2);
        // dedicated router whose name does NOT contain A's private marker (B legitimately sees a shared router's name)
        $rid = 'shr' . bin2hex(random_bytes(3));
        $nameA = 'shared-' . bin2hex(random_bytes(4));
        $own['A']->post('/routers/save', ['id' => $rid, 'name' => $nameA, 'type' => 'demo', 'session' => 's' . $rid, 'hotspot_name' => 'hs-' . $rid, 'host' => '', 'user' => 'admin', 'pass' => $W['A']['M'] . '-routerpass']);
        $R->ok('share', str_contains($own['A']->get('/routers')['body'], $nameA), 'A created the router to share');
        $R->ok('share', !str_contains($own['B']->get('/routers')['body'], $nameA), 'before sharing B does not see A router');
        // B must not be able to create a share on A's router
        $own['B']->post($cp, $shareParams('rw', $rid) + ['to' => $W['B']['slug']]);
        $R->ok('share', !str_contains($own['B']->get('/routers')['body'], $nameA), 'B cannot share A router to itself');
        $fire = function (TC $tc, string $mode) use ($cp, $shareParams, $rid) {
            return $tc->post($cp, $shareParams($mode, $rid));
        };
        foreach (['ro', 'rw'] as $mode) {
            $fire($own['A'], $mode);
            $rb = $own['B']->get('/routers')['body'];
            $R->ok('share', str_contains($rb, $nameA), "A shared router ($mode): visible to B");
            $R->ok('share', !ti_leaks($own['B']->get('/routers'), ['pass' => $W['A']['M'] . '-routerpass']), "($mode) router password never visible to receiver");
            $R->ok('share', !str_contains($own['B']->get('/settings')['body'], $W['A']['M']), "($mode) sharing a router does not expose other A settings");
            $R->ok('share', !ti_leaks($own['B']->get('/vouchers/templates'), ti_needles($W['A'])), "($mode) A templates stay private");
            $R->ok('share', !ti_leaks($own['B']->get('/orders'), ti_needles($W['A'])), "($mode) A orders stay private");
            $nm = 'shr' . bin2hex(random_bytes(3));
            $own['B']->post('/routers/select', ['id' => $rid]);
            $own['B']->post('/hotspot/users/save', ['router' => $rid, 'name' => $nm, 'password' => $nm, 'profile' => $W['A']['profile']]);
            $own['A']->post('/routers/select', ['id' => $rid]);   // session API reads the session's router, not ?router=
            $seen = $own['A']->get('/json/users', ['q' => $nm]);
            $own['A']->post('/routers/select', ['id' => $W['A']['sameId']]);
            $written = preg_match('/"total":\s*[1-9]/', $seen['body']) === 1;
            $R->ok('share', $mode === 'rw' ? $written : !$written, "($mode) B write to shared router " . ($mode === 'rw' ? 'should succeed' : 'must be refused'));
            $R->ok('share', in_array($own['B']->post('/routers/delete', ['id' => $rid])['code'], [302, 403, 404], true) && str_contains($own['A']->get('/routers')['body'], $nameA), "($mode) receiver cannot delete the shared router");
            $own['B']->post('/routers/save', ['id' => $rid, 'name' => 'hijack-' . $W['B']['M'], 'type' => 'demo']);
            $R->ok('share', !str_contains($own['A']->get('/routers')['body'], 'hijack-' . $W['B']['M']), "($mode) receiver cannot edit the shared router");
            $R->ok('share', in_array($fire($own['B'], $mode)['code'], [302, 403, 404], true) && !str_contains($own['A']->get('/routers')['body'], 'hijack'), "($mode) receiver cannot re-share");
        }
        if ($revoke) {
            $own['A']->post(explode(' ', $revoke, 2)[1], $shareParams('rw', $rid));
            $R->ok('share', !str_contains($own['B']->get('/routers')['body'], $nameA), 'revoke removes access');
            $jb = $own['B']->get('/json/users', ['router' => $rid]);
            $R->ok('share', !ti_leaks($jb, ti_needles($W['A'])) && $jb['code'] < 500, 'revoked router: /json shows no A data (' . $jb['code'] . ')');
            $own['B']->post('/routers/select', ['id' => $W['B']['sameId']]);
        } else {
            $R->note('share', 'no revoke route found: revoke not tested');
        }
    }
}

// ===================================================================================================================
// 17. Session fixation / replay
// ===================================================================================================================
if ($want('session')) {
    $f = new TC('fix');
    $f->get('/login');
    $s0 = $f->sid();
    $R->ok('session', $s0 !== '', 'anonymous visit gets a session cookie');
    $R->ok('session', $f->login($W['A']['owner']), 'login on pre-existing session');
    $R->ok('session', $f->sid() !== $s0, 'session id regenerated at login');
    $rep = new TC('replay');
    $rep->jar = ['nextmon_sid' => $s0];
    $R->ok('session', in_array($rep->get('/')['code'], [302, 401], true), 'pre-login session id does not grant access');
    $adopt = new TC('adopt');
    $adopt->jar = ['nextmon_sid' => 'attackerchosen' . bin2hex(random_bytes(12))];
    $adopt->login($W['B']['owner']);
    $R->ok('session', !str_contains($adopt->sid(), 'attackerchosen'), 'server does not adopt a client-chosen session id');
    // logout -> old cookie dead; same cookie jar then logs in as the other tenant and sees only that tenant
    $old = $f->sid();
    $f->post('/logout');
    $dead = new TC('dead');
    $dead->jar = ['nextmon_sid' => $old];
    $R->ok('session', in_array($dead->get('/')['code'], [302, 401], true), 'session id dead after logout');
    $jar = new TC('swap');
    $jar->login($W['A']['owner']);
    $jar->post('/logout');
    $R->ok('session', $jar->login($W['B']['owner']), 'same jar logs in as B after A logout');
    $res = $jar->get('/routers');
    $R->ok('session', str_contains($res['body'], $W['B']['M']) && !ti_leaks($res, ti_needles($W['A'])), 'workspace follows the new login, no A residue (B view)');
    $res = $jar->get('/json/users', ['router' => $W['B']['sameId'], 'q' => $W['A']['prefix']]);
    $R->ok('session', !ti_leaks($res, ti_needles($W['A'])), 'no A residue in JSON after account swap');
    // A's CSRF token is useless for B
    $b = new TC('b');
    $b->login($W['B']['owner']);
    $b->csrf = $own['A']->csrf;
    $R->ok('session', $b->post('/settings/save', ['hotspot_name' => 'csrf-swap'])['code'] === 419, "A's CSRF token rejected on B's session (419)");
    // platform switch: a pre-switch cookie must not be usable by a different client afterwards (informational when route absent)
    if ($platformRoutes && $platformOk) {
        $p2 = new TC('plat2');
        $p2->login($platUser);
        $before = $p2->sid();
        $sw = array_keys(array_filter($platformRoutes, fn($k) => str_contains($k, 'switch'), ARRAY_FILTER_USE_KEY))[0] ?? null;
        if ($sw) {
            [$m, $p] = explode(' ', $sw, 2);
            $p2->req($m, $p, ['workspace' => $W['A']['id'], 'w' => $W['A']['id'], 'id' => $W['A']['id'], 'ws' => $W['A']['id'], 'slug' => $W['A']['slug']]);
            $p2->post('/logout');
            $R->ok('session', in_array((new TC('replay2'))->get('/')['code'], [302, 401], true), 'anonymous after platform logout is not in A');
            $stale = new TC('stale');
            $stale->jar = ['nextmon_sid' => $before];
            $res = $stale->get('/routers');
            $R->ok('session', !ti_leaks($res, ti_needles($W['A'])), 'old platform cookie after logout leaks nothing');
            $p3 = new TC('plat3');
            $p3->login($platUser);
            $res = $p3->get('/routers');
            $R->ok('session', !ti_leaks($res, ti_needles($W['A'])), 'new platform login does not inherit the previous switch (A)');
        }
    }
}

// ===================================================================================================================
// 18. File-level namespace scan
// ===================================================================================================================
if ($want('files')) {
    $bk = count(glob($data . '/backup-tenant-*') ?: []);
    $R->ok('files', $bk <= 2, "legacy->tenant migration backup ran $bk times (must be idempotent: at most once, not per request/process)");
    if ($backend !== 'json') {
        $R->pend('files', 'file-level scan needs the json backend');
    } else {
        $rootStray = [];
        $leaks = [];
        $nsCount = ['A' => 0, 'B' => 0];
        $ids = array_column($W, 'id', 'T');
        $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($data, FilesystemIterator::SKIP_DOTS));
        foreach ($it as $f) {
            if (!$f->isFile()) {
                continue;
            }
            $rel = ltrim(str_replace('\\', '/', substr($f->getPathname(), strlen($data))), '/');
            if (preg_match('#^(sessions/|out\.log$|err\.log$|backup-tenant-)#', $rel)) {
                continue;
            }
            $inWs = [];
            foreach ($ids as $T => $id) {
                if ($id !== '' && str_contains($rel, $id)) {
                    $inWs[] = $T;
                }
            }
            foreach (['A', 'B'] as $T) {
                if (in_array($T, $inWs, true)) {
                    $nsCount[$T]++;
                }
            }
            if (!$inWs && preg_match(PER_WS_ROOT_RE, $rel) && !preg_match(GLOBAL_FILE_RE, $rel)) {
                $rootStray[] = $rel;
            }
            if ($f->getSize() > 8_000_000) {
                continue;
            }
            $body = (string)file_get_contents($f->getPathname());
            $isLog = (bool)preg_match('#(^|/)(audit|notify|alerts|wizard)\.log$#', $rel);   // logs echo what their own tenant's users typed, incl. attack strings
            $isCache = str_starts_with($rel, 'cache/');   // hashed names: namespacing is by key, so check a file never mixes tenants
            $seenIn = [];
            foreach ($W as $T => $c) {
                if (!in_array($T, ['A', 'B', 'C', 'D'], true) || $isLog) {
                    continue;
                }
                foreach ([$c['M'], $c['prefix'] ?? ''] as $needle) {
                    if ($needle === '' || stripos($body, $needle) === false) {
                        continue;
                    }
                    if (preg_match(GLOBAL_FILE_RE, $rel) && $needle === $c['M']) {
                        continue;   // workspace name carries the marker in the global workspaces table, by design
                    }
                    $seenIn[$T] = true;
                    if (!$isCache && (!in_array($T, $inWs, true) || count($inWs) > 1)) {
                        $leaks[$rel . " holds $T data"] = true;
                    }
                }
            }
            if ($isCache && count($seenIn) > 1) {
                $leaks[$rel . ' mixes data of ' . implode('+', array_keys($seenIn))] = true;
            }
        }
        $R->ok('files', $nsCount['A'] > 0 && $nsCount['B'] > 0, 'per-workspace artifacts live under the workspace id (A:' . $nsCount['A'] . ' B:' . $nsCount['B'] . ' files)');
        $R->ok('files', !$rootStray, 'per-workspace collections stored at the data root (no namespace): ' . implode(', ', array_slice($rootStray, 0, 8)));
        $R->ok('files', !$leaks, 'tenant data in a file outside its namespace: ' . implode('; ', array_slice(array_keys($leaks), 0, 6)));
        // artifact kinds expected per workspace (orders, backups/cache dirs or docs)
        $all = implode("\n", array_keys(ti_snapshot($data)));
        foreach (['orders', 'audit', 'routers', 'settings'] as $kind) {
            $R->ok('files', (bool)preg_match('#' . preg_quote($W['A']['id'], '#') . '[^\n]*' . $kind . '|' . $kind . '[^\n]*' . preg_quote($W['A']['id'], '#') . '#', $all), "A: '$kind' artifact is namespaced under A's id");
        }
        // the CLI (if any) must agree
    }
}

// ===================================================================================================================
// 19. CLI tenant:* (optional)
// ===================================================================================================================
if ($want('cli')) {
    $cliSrc = (string)file_get_contents($root . '/bin/nextmon.php');
    if (!str_contains($cliSrc, 'tenant:')) {
        $R->pend('cli', 'bin/nextmon.php has no tenant:* commands yet');
    } else {
        $env = array_merge(getenv(), ['NEXTMON_DATA' => $data, 'NEXTMON_DEMO' => '1', 'NEXTMON_STORAGE' => $backend]);
        foreach (['tenant:list'] as $cmd) {
            $p = proc_open([PHP_BINARY, $root . '/bin/nextmon.php', $cmd], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pp, $root, $env);
            $out = stream_get_contents($pp[1]) . stream_get_contents($pp[2]);
            $code = proc_close($p);
            $R->ok('cli', $code === 0, "$cmd exit $code");
            foreach (['A', 'B', 'C', 'D'] as $T) {
                $R->ok('cli', str_contains($out, $W[$T]['slug']), "$cmd lists workspace $T");
            }
            $R->ok('cli', !str_contains($out, TI_PASSWORD) && !preg_match('/\$2y\$|\$argon/', $out), "$cmd prints no secrets/hashes");
        }
    }
}

done:
$R->print();
$cleanup();
exit($R->hasFail() ? 1 : 0);
