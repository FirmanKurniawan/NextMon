<?php
/**
 * Role / capability matrix test.   php tests/roles_test.php [sqlite|json]
 *
 * Boots `php -S` in demo mode on a temp data dir, creates one account per role (admin, operator, reseller, viewer) and for EVERY route in
 * src/routes.php + src/routes.d/*.php asserts, per role:
 *   - allowed role  -> anything except 401/403 (and no 5xx / no PHP diagnostics)
 *   - denied role   -> exactly 403 (POST is sent WITH a valid CSRF token, so the capability check is what answers)
 *   - POST without a CSRF token -> 419 for every logged-in role (the CSRF gate runs before the capability gate)
 *   - signed out    -> protected routes redirect to /login (public routes stay reachable)
 * Then checks the navigation: every visible nav link is permitted for the role, nothing permitted is hidden, and the
 * "My wallet" item shows for resellers only. Exit code 1 on any failure.
 */
error_reporting(E_ALL);
ini_set('display_errors', '1');
$root = dirname(__DIR__);
$backend = $argv[1] ?? (extension_loaded('pdo_sqlite') ? 'sqlite' : 'json');

/** routes we never fire (they end the session, need a gateway signature, or are public by design) */
const SKIP_FIRE = '#^(POST /logout|POST /login|POST /setup|POST /pay/callback|GET /pay/callback)$#';
/** public paths mirrored from App::PUBLIC_PATHS (reachable signed out, no capability gate) */
const PUBLIC_PATHS = ['/shop', '/shop/order', '/pay/callback', '/login', '/setup', '/status', '/status.json', '/manifest.webmanifest', '/sw.js', '/offline', '/lang'];
const PASSWORD = 'Roles-Test-4821qz';

function free_port(): int
{
    $s = stream_socket_server('tcp://127.0.0.1:0', $en, $es);
    $n = stream_socket_get_name($s, false);
    fclose($s);
    return (int)substr($n, strrpos($n, ':') + 1);
}

function http(string $method, string $url, array &$jar, array $post = [], bool $form = true): array
{
    $headers = ['Accept: text/html'];
    if ($jar) {
        $headers[] = 'Cookie: ' . implode('; ', array_map(fn($k, $v) => "$k=$v", array_keys($jar), $jar));
    }
    $opts = ['method' => $method, 'ignore_errors' => true, 'follow_location' => 0, 'max_redirects' => 0, 'timeout' => 30];
    if ($method === 'POST') {
        $headers[] = 'Content-Type: application/x-www-form-urlencoded';
        $opts['content'] = http_build_query($post);
    }
    $opts['header'] = implode("\r\n", $headers);
    $body = @file_get_contents($url, false, stream_context_create(['http' => $opts]));
    $code = 0;
    $loc = '';
    foreach ($http_response_header ?? [] as $h) {
        if (preg_match('#^HTTP/\S+ (\d{3})#', $h, $m)) {
            $code = (int)$m[1];
        } elseif (stripos($h, 'Set-Cookie:') === 0 && preg_match('/^Set-Cookie:\s*([^=;\s]+)=([^;]*)/i', $h, $m)) {
            if ($m[2] === '' || $m[2] === 'deleted') {
                unset($jar[$m[1]]);
            } else {
                $jar[$m[1]] = $m[2];
            }
        } elseif (stripos($h, 'Location:') === 0) {
            $loc = trim(substr($h, 9));
        }
    }
    return ['code' => $code, 'body' => (string)$body, 'loc' => $loc];
}

function php_errors_in(string $s): array
{
    $out = [];
    if (preg_match('~on line <b>\d+</b>|on line \d+~', $s) && preg_match_all('~(?:<b>)?(Warning|Notice|Fatal error|Deprecated|Parse error|Uncaught \w+)(?:</b>)?:\s*([^\n<]{0,140})~', $s, $m, PREG_SET_ORDER)) {
        foreach ($m as $x) {
            $out[] = $x[1] . ': ' . trim($x[2]);
        }
    }
    return array_values(array_unique($out));
}

// ---- data dir + accounts (created in-process so we do not depend on the UI) ----------------------------------------
$data = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'nextmon-roles-' . bin2hex(random_bytes(3));
mkdir($data, 0775, true);
$data = str_replace('\\', '/', $data);
putenv('NEXTMON_DATA=' . $data);
putenv('NEXTMON_DEMO=1');
putenv('NEXTMON_STORAGE=' . $backend);
require $root . '/src/App.php';
App::init();
Workspace::set('main');   // multi-tenant: in-process Store use needs a workspace
$caps = (new ReflectionClassConstant('Auth', 'CAPS'))->getValue();
$roles = Auth::ROLES;
foreach ($roles as $r) {
    Auth::create("t_$r", PASSWORD, $r, "Test $r");
}
Store::reset();

// ---- routes ----------------------------------------------------------------------------------------------------------
$routes = require $root . '/src/routes.php';
foreach (glob($root . '/src/routes.d/*.php') ?: [] as $rf) {
    $routes = array_merge($routes, (array)require $rf);
}
ksort($routes);

// ---- server ------------------------------------------------------------------------------------------------------------
$port = free_port();
$env = array_merge(getenv(), ['NEXTMON_DEMO' => '1', 'NEXTMON_DEBUG' => '1', 'NEXTMON_DATA' => $data, 'NEXTMON_STORAGE' => $backend]);
$cmd = [PHP_BINARY, '-d', 'display_errors=1', '-d', 'error_reporting=E_ALL', '-d', 'html_errors=1', '-S', "127.0.0.1:$port", '-t', $root . '/public'];
$proc = proc_open($cmd, [0 => ['pipe', 'r'], 1 => ['file', $data . '/out.log', 'w'], 2 => ['file', $data . '/err.log', 'w']], $pipes, $root, $env);
$base = "http://127.0.0.1:$port";
for ($i = 0, $up = false; $i < 60 && !$up; $i++) {
    $c = @fsockopen('127.0.0.1', $port, $en, $es, 0.2);
    if ($c) {
        fclose($c);
        $up = true;
    } else {
        usleep(100000);
    }
}
if (!$up) {
    fwrite(STDERR, "server did not start\n");
    exit(2);
}

$fails = [];
$checks = 0;
$ok = function (bool $cond, string $label) use (&$fails, &$checks) {
    $checks++;
    if (!$cond) {
        $fails[] = $label;
    }
};

// ---- sessions ------------------------------------------------------------------------------------------------------------
$jars = [];
$csrf = [];
foreach ($roles as $r) {
    $jar = [];
    $page = http('GET', "$base/login", $jar);
    preg_match('/name="_csrf"\s+value="([^"]+)"/', $page['body'], $m);
    $login = http('POST', "$base/login", $jar, ['_csrf' => $m[1] ?? '', 'username' => "t_$r", 'password' => PASSWORD]);
    $ok($login['code'] === 302, "login as $r -> 302 (got {$login['code']})");
    $home = http('GET', "$base/", $jar);
    $ok($home['code'] === 200, "dashboard as $r -> 200 (got {$home['code']})");
    preg_match('/data-csrf="([^"]+)"/', $home['body'], $m);
    $csrf[$r] = $m[1] ?? '';
    $ok($csrf[$r] !== '', "csrf token present for $r");
    $jars[$r] = $jar;
}

// ---- matrix ---------------------------------------------------------------------------------------------------------------
$denyCount = $allowCount = 0;
foreach ($routes as $key => [$class, $fn, $cap]) {
    [$method, $path] = explode(' ', $key, 2);
    $public = in_array($path, PUBLIC_PATHS, true);
    // signed out
    $none = [];
    if (!preg_match(SKIP_FIRE, $key)) {
        $r0 = $method === 'POST' ? http('POST', "$base$path", $none, ['_csrf' => 'x']) : http('GET', "$base$path", $none);
        if ($public) {
            // /setup legitimately bounces to /login once an account exists
            $ok($path === '/setup' || !in_array($r0['code'], [403, 500], true) && !($r0['code'] === 302 && str_ends_with($r0['loc'], '/login')), "public $key signed out (got {$r0['code']} {$r0['loc']})");
        } else {
            // POST: the auth redirect happens before CSRF, so a signed-out POST must also bounce to /login (or /setup)
            $ok($r0['code'] === 302 && preg_match('#/(login|setup)$#', $r0['loc']) === 1, "protected $key signed out -> /login (got {$r0['code']} {$r0['loc']})");
        }
    }
    if ($public || preg_match(SKIP_FIRE, $key)) {
        continue;
    }
    foreach ($roles as $r) {
        $allowed = in_array($cap, $caps[$r] ?? [], true);
        $jar = $jars[$r];
        if ($method === 'POST') {
            $noTok = http('POST', "$base$path", $jar, []);
            $ok($noTok['code'] === 419, "POST $path as $r without CSRF -> 419 (got {$noTok['code']})");
            $res = http('POST', "$base$path", $jar, ['_csrf' => $csrf[$r]]);
        } else {
            $res = http('GET', "$base$path", $jar);
        }
        if ($allowed) {
            $allowCount++;
            $bad = in_array($res['code'], [401, 403], true) || $res['code'] >= 500 || $res['code'] === 0;
            $ok(!$bad, "ALLOW  $r $key (cap $cap) got {$res['code']}");
            foreach (php_errors_in($res['body']) as $e) {
                $ok(false, "PHP diagnostic on $r $key: $e");
            }
            if ($res['code'] === 302 && preg_match('#/login$#', $res['loc'])) {
                $ok(false, "ALLOW $r $key bounced to /login (session lost?)");
            }
        } else {
            $denyCount++;
            $ok($res['code'] === 403, "DENY   $r $key (cap $cap) expected 403 got {$res['code']}");
        }
    }
}

// ---- /json/* (session API used by the UI): auth, CSRF and write-only mutations -------------------------------------------------
$none = [];
foreach (['dashboard', 'active', 'users', 'sales', 'vouchers', 'kick'] as $res) {
    $r0 = http('GET', "$base/json/$res", $none);
    $ok($r0['code'] === 401, "/json/$res signed out -> 401 (got {$r0['code']})");
}
foreach ($roles as $r) {
    $jar = $jars[$r];
    $canWrite = in_array('write', $caps[$r], true);
    $read = http('GET', "$base/json/active", $jar);
    $ok($read['code'] === 200, "/json/active as $r -> 200 (got {$read['code']})");
    $noTok = http('POST', "$base/json/kick", $jar, ['user' => 'nobody']);
    $ok($noTok['code'] === 419, "POST /json/kick as $r without CSRF -> 419 (got {$noTok['code']})");
    foreach (['kick' => ['user' => 'nobody'], 'vouchers' => ['profile' => 'nonexistent-profile']] as $res => $in) {
        $x = http('POST', "$base/json/$res", $jar, $in + ['_csrf' => $csrf[$r]]);
        $j = json_decode($x['body'], true) ?: [];
        if ($canWrite) {
            $ok(!str_contains((string)($j['error'] ?? ''), 'forbidden') && !str_contains((string)($j['error'] ?? ''), 'write scope required'), "POST /json/$res as $r (write) must not be refused for capability (got " . ($j['error'] ?? 'ok') . ')');
        } else {
            $ok(($j['ok'] ?? null) === false && $x['code'] >= 400, "POST /json/$res as $r (no write) must be refused (got {$x['code']} " . json_encode($j) . ')');
            $ok(empty($j['data']), "POST /json/$res as $r returned no voucher data");
        }
    }
}

// ---- navigation ----------------------------------------------------------------------------------------------------------
$linksOf = function (string $html): array {
    $out = [];
    if (preg_match('#<aside class="sidebar.*?</aside>#s', $html, $m) && preg_match_all('#<a class="nav-link" href="([^"]+)" data-key="([^"]+)"#', $m[0], $mm, PREG_SET_ORDER)) {
        foreach ($mm as $x) {
            $out[$x[2]] = html_entity_decode($x[1]);
        }
    }
    return $out;
};
$nav = [];
foreach ($roles as $r) {
    $jar = $jars[$r];
    $nav[$r] = $linksOf(http('GET', "$base/", $jar)['body']);
}
$all = $nav['admin'];
$ok(count($all) >= 20, 'admin sees a full navigation (' . count($all) . ' items)');
$capOfPath = function (string $href) use ($routes, $base): ?string {
    $p = parse_url($href, PHP_URL_PATH) ?: '/';
    foreach (['', App::$base ?? ''] as $_) {
        if (isset($routes["GET $p"])) {
            return $routes["GET $p"][2];
        }
    }
    return null;
};
foreach ($roles as $r) {
    foreach ($nav[$r] as $key => $href) {
        $cap = $capOfPath($href);
        $ok($cap !== null, "nav item $key ($href) has no GET route");
        if ($cap !== null) {
            $ok(in_array($cap, $caps[$r], true), "nav item '$key' is shown to $r but needs cap '$cap'");
        }
        if ($r !== 'admin') {
            $jar = $jars[$r];
            $res = http('GET', $base . $href, $jar);
            $ok($res['code'] !== 403, "nav item '$key' as $r leads to 403");
        }
    }
    foreach ($all as $key => $href) {
        $cap = $capOfPath($href);
        if ($cap !== null && in_array($cap, $caps[$r], true)) {
            $ok(isset($nav[$r][$key]), "nav item '$key' ($cap) is permitted for $r but hidden");
        }
    }
    $ok(isset($nav[$r]['wallet']) === ($r === 'reseller'), "'My wallet' nav item visible only for reseller (role $r)");
}
$ok(!isset($nav['viewer']['vouchers']) && !isset($nav['viewer']['pos']), 'viewer sees neither Vouchers nor POS');
$ok(!isset($nav['reseller']['backup']) && !isset($nav['reseller']['audit']), 'reseller nav: no Backup or Audit');
$ok(isset($nav['operator']['backup']) && !isset($nav['operator']['audit']) && !isset($nav['operator']['notifications']), 'operator: Backup yes, Audit/Notifications no');

// ---- teardown ----------------------------------------------------------------------------------------------------------------
proc_terminate($proc);
proc_close($proc);
$err = @file_get_contents($data . '/err.log') ?: '';
$serverErrors = [];
foreach (explode("\n", $err) as $ln) {
    if (preg_match('/(PHP (Warning|Notice|Fatal error|Deprecated|Parse error)|Uncaught)/', $ln)) {
        $serverErrors[] = trim($ln);
    }
}
if ($serverErrors) {
    $fails[] = 'server stderr has PHP diagnostics: ' . implode(' | ', array_slice($serverErrors, 0, 3));
}
register_shutdown_function(function () use ($data) {
    Store::reset();
    $rm = function ($d) use (&$rm) {
        foreach (glob($d . '/{,.}*', GLOB_BRACE) ?: [] as $f) {
            if (in_array(basename($f), ['.', '..'], true)) {
                continue;
            }
            is_dir($f) ? $rm($f) : @unlink($f);
        }
        @rmdir($d);
    };
    $rm($data);
});

echo "backend: $backend | routes: " . count($routes) . " | allow checks: $allowCount | deny checks: $denyCount | total assertions: $checks\n";
if ($fails) {
    echo 'FAILURES (' . count($fails) . "):\n  - " . implode("\n  - ", $fails) . "\n";
    exit(1);
}
echo "roles_test: all ok\n";
