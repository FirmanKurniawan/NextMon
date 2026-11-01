<?php
/**
 * HTTP smoke test.   php tests/smoke.php [sqlite|json|both]   (default: both when pdo_sqlite is loaded)
 * Boots `php -S` on a free port in demo mode with display_errors=1 / E_ALL, creates the admin through /setup,
 * logs in with a cookie jar, GETs every GET route from routes.php + routes.d/*.php (skipping destructive ones)
 * and asserts HTTP 200/302 and no PHP warning/notice/fatal in the body or in the server's stderr.
 */
error_reporting(E_ALL);
ini_set('display_errors', '1');
$root = dirname(__DIR__);
$argBackend = $argv[1] ?? 'both';
$backends = $argBackend === 'both' ? (extension_loaded('pdo_sqlite') ? ['sqlite', 'json'] : ['json']) : [$argBackend];

/** GET routes we never hit (destructive or not a page). Everything else that is GET is requested. */
const SKIP = '#(delete|remove|kick|logout|reset|wipe|purge|clear|destroy)#i';
/** Routes that legitimately need parameters; [query string => acceptable codes] extras are hit in addition. */
const EXTRA = [
    '/reports' => ['?period=month&value=' . '', '?period=all', '?period=day'],
    '/reports/export' => ['?period=all', '?period=month'],
    '/vouchers/print' => ['?batch=nonexistent'],
    '/hotspot/users' => ['?q=a', '?profile=default', '?page=2'],
    '/backup/download' => ['?type=users', '?type=profiles', '?type=app', '?type=bogus'],
    '/audit' => ['?n=50'],
    '/lang' => ['?l=en', '?l=id'],
];

/** Extra acceptable codes for routes that need a token/param (bare GET legitimately answers 4xx). */
const ALLOW = ['/status.json' => [400], '/shop/order' => [404]];

function free_port(): int
{
    $s = stream_socket_server('tcp://127.0.0.1:0', $en, $es);
    $n = stream_socket_get_name($s, false);
    fclose($s);
    return (int)substr($n, strrpos($n, ':') + 1);
}

function http(string $method, string $url, array &$jar, array $post = []): array
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
    $t = microtime(true);
    $body = @file_get_contents($url, false, stream_context_create(['http' => $opts]));
    $ms = (int)((microtime(true) - $t) * 1000);
    $code = 0;
    $loc = '';
    foreach ($http_response_header ?? [] as $h) {
        if (preg_match('#^HTTP/\S+ (\d{3})#', $h, $m)) {
            $code = (int)$m[1];
        } elseif (stripos($h, 'Set-Cookie:') === 0) {
            if (preg_match('/^Set-Cookie:\s*([^=;\s]+)=([^;]*)/i', $h, $m)) {
                if ($m[2] === '' || $m[2] === 'deleted') {
                    unset($jar[$m[1]]);
                } else {
                    $jar[$m[1]] = $m[2];
                }
            }
        } elseif (stripos($h, 'Location:') === 0) {
            $loc = trim(substr($h, 9));
        }
    }
    return ['code' => $code, 'body' => (string)$body, 'loc' => $loc, 'ms' => $ms];
}

function php_errors_in(string $s): array
{
    $out = [];
    if (preg_match_all('~(?:<b>)?(Warning|Notice|Fatal error|Deprecated|Parse error|Uncaught \w+)(?:</b>)?:\s*([^\n<]{0,160})~', $s, $m, PREG_SET_ORDER)) {
        foreach ($m as $x) {
            // only count genuine PHP diagnostics (they always mention "on line N" nearby)
            if (preg_match('~on line <b>\d+</b>|on line \d+~', $s)) {
                $out[] = $x[1] . ': ' . trim($x[2]);
            }
        }
    }
    return array_values(array_unique($out));
}

function csrf_of(string $html): string
{
    return preg_match('/name="_csrf"\s+value="([^"]+)"/', $html, $m) ? $m[1] : '';
}

function run_backend(string $backend, string $root): array
{
    $data = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'nextmon-smoke-' . $backend . '-' . bin2hex(random_bytes(3));
    mkdir($data, 0775, true);
    $port = free_port();
    $errFile = $data . DIRECTORY_SEPARATOR . 'server-stderr.log';
    $env = array_merge(getenv(), ['NEXTMON_DEMO' => '1', 'NEXTMON_DEBUG' => '1', 'NEXTMON_DATA' => $data, 'NEXTMON_STORAGE' => $backend]);
    $cmd = [PHP_BINARY, '-d', 'display_errors=1', '-d', 'error_reporting=E_ALL', '-d', 'html_errors=1', '-S', "127.0.0.1:$port", '-t', $root . '/public'];
    $proc = proc_open($cmd, [0 => ['pipe', 'r'], 1 => ['file', $data . '/server-stdout.log', 'w'], 2 => ['file', $errFile, 'w']], $pipes, $root, $env);
    $base = "http://127.0.0.1:$port";
    $up = false;
    for ($i = 0; $i < 60; $i++) {
        $c = @fsockopen('127.0.0.1', $port, $en, $es, 0.2);
        if ($c) {
            fclose($c);
            $up = true;
            break;
        }
        usleep(100000);
    }
    $rows = [];
    $fail = 0;
    $add = function (string $label, int $code, int $ms, array $problems) use (&$rows, &$fail) {
        $rows[] = [$label, $code, $ms, $problems ? 'FAIL: ' . implode(' | ', $problems) : 'ok'];
        if ($problems) {
            $fail++;
        }
    };
    if (!$up) {
        $add('server boot', 0, 0, ['server did not start']);
        return [$rows, $fail, $data];
    }
    $jar = [];

    // --- before setup: everything redirects to /setup
    $r = http('GET', "$base/", $jar);
    $add('GET / (no users)', $r['code'], $r['ms'], $r['code'] === 302 && str_ends_with($r['loc'], '/setup') ? [] : ["expected 302 /setup, got {$r['code']} {$r['loc']}"]);
    $r = http('GET', "$base/setup", $jar);
    $p = [];
    if ($r['code'] !== 200) {
        $p[] = "code {$r['code']}";
    }
    $tok = csrf_of($r['body']);
    if ($tok === '') {
        $p[] = 'no csrf field';
    }
    $add('GET /setup', $r['code'], $r['ms'], array_merge($p, php_errors_in($r['body'])));

    // --- CSRF must be enforced
    $r = http('POST', "$base/setup", $jar, ['username' => 'admin', 'password' => 'Passw0rd!123', 'password2' => 'Passw0rd!123']);
    $add('POST /setup without CSRF -> 419', $r['code'], $r['ms'], $r['code'] === 419 ? [] : ["expected 419 got {$r['code']}"]);

    // --- create admin
    $r = http('POST', "$base/setup", $jar, ['_csrf' => $tok, 'username' => 'admin', 'password' => 'Passw0rd!123', 'password2' => 'Passw0rd!123']);
    $add('POST /setup (create admin)', $r['code'], $r['ms'], $r['code'] === 302 ? php_errors_in($r['body']) : ["expected 302 got {$r['code']}"]);

    // --- logout, wrong login, real login
    $r = http('GET', "$base/", $jar);
    $tok = csrf_of($r['body']);
    $r = http('POST', "$base/logout", $jar, ['_csrf' => $tok]);
    $add('POST /logout', $r['code'], $r['ms'], $r['code'] === 302 ? [] : ["code {$r['code']}"]);
    $r = http('GET', "$base/", $jar);
    $add('GET / (logged out) -> /login', $r['code'], $r['ms'], $r['code'] === 302 && str_ends_with($r['loc'], '/login') ? [] : ["expected 302 /login got {$r['code']} {$r['loc']}"]);
    $r = http('GET', "$base/login", $jar);
    $tok = csrf_of($r['body']);
    $add("GET /login", $r["code"], $r["ms"], array_merge($r["code"] === 200 && $tok !== "" ? [] : ["no 200/csrf"], php_errors_in($r["body"])));
    $r = http('POST', "$base/login", $jar, ['_csrf' => $tok, 'username' => 'admin', 'password' => 'wrong-password']);
    $add('POST /login wrong password -> 401', $r['code'], $r['ms'], $r['code'] === 401 ? php_errors_in($r['body']) : ["expected 401 got {$r['code']}"]);
    $r = http('GET', "$base/login", $jar);
    $tok = csrf_of($r['body']);
    $r = http('POST', "$base/login", $jar, ['_csrf' => $tok, 'username' => 'admin', 'password' => 'Passw0rd!123']);
    $add('POST /login (admin)', $r['code'], $r['ms'], $r['code'] === 302 ? [] : ["expected 302 got {$r['code']}"]);

    // --- enumerate GET routes
    $routes = require $root . '/src/routes.php';
    foreach (glob($root . '/src/routes.d/*.php') ?: [] as $rf) {
        $routes = array_merge($routes, (array)require $rf);
    }
    $paths = [];
    foreach ($routes as $key => $_) {
        if (strncmp($key, 'GET ', 4) === 0) {
            $paths[] = substr($key, 4);
        }
    }
    sort($paths);
    $skipped = [];
    foreach ($paths as $path) {
        if (preg_match(SKIP, $path)) {
            $skipped[] = $path;
            continue;
        }
        $targets = [$path];
        foreach (EXTRA[$path] ?? [] as $q) {
            $targets[] = $path . $q;
        }
        foreach ($targets as $t) {
            $r = http('GET', $base . $t, $jar);
            $p = [];
            if (!in_array($r["code"], array_merge([200, 302], ALLOW[$path] ?? []), true)) {
                $p[] = "HTTP {$r['code']}";
            }
            if ($r['code'] === 302 && preg_match('#/(login|setup)$#', $r['loc']) && !in_array($path, ["/lang", "/login", "/setup"], true)) {
                $p[] = 'redirected to ' . $r['loc'] . ' (session lost?)';
            }
            if ($r['code'] === 200 && trim($r['body']) === '') {
                $p[] = 'empty body';
            }
            $p = array_merge($p, php_errors_in($r['body']));
            $add('GET ' . $t, $r['code'], $r['ms'], $p);
        }
    }
    // --- public pages again while logged out
    $anon = [];
    foreach (['/login', '/status', '/status.json', '/manifest.webmanifest', '/sw.js', '/offline'] as $pp) {
        $r = http('GET', $base . $pp, $anon);
        $p = in_array($r["code"], array_merge([200, 302], ALLOW[$pp] ?? []), true) ? php_errors_in($r['body']) : ["HTTP {$r['code']}"];
        $add('GET ' . $pp . ' (anonymous)', $r['code'], $r['ms'], $p);
    }
    $r = http('GET', "$base/settings", $anon);
    $add('GET /settings (anonymous) -> /login', $r['code'], $r['ms'], $r['code'] === 302 && str_ends_with($r['loc'], '/login') ? [] : ["expected 302 /login got {$r['code']}"]);
    $r = http('GET', "$base/definitely-missing", $jar);
    $add("GET /definitely-missing -> 404", $r["code"], $r["ms"], array_merge($r["code"] === 404 ? [] : ["expected 404 got " . $r["code"]], php_errors_in($r["body"])));

    // --- server stderr
    proc_terminate($proc);
    proc_close($proc);
    usleep(200000);
    $err = is_file($errFile) ? (string)file_get_contents($errFile) : '';
    $bad = [];
    foreach (preg_split('/\R/', $err) as $l) {
        if (preg_match('/PHP (Warning|Notice|Fatal error|Deprecated|Parse error)|Uncaught|Stack trace|\[nextmon\]/', $l)) {
            $bad[] = trim($l);
        }
    }
    $add('server stderr clean', 0, 0, $bad ? array_slice($bad, 0, 5) : []);
    if ($skipped) {
        $rows[] = ['(skipped destructive GETs: ' . implode(', ', $skipped) . ')', '', '', ''];
    }
    return [$rows, $fail, $data];
}

$totalFail = 0;
foreach ($backends as $be) {
    echo "\n== smoke: backend=$be (demo mode) ==\n";
    [$rows, $fail, $data] = run_backend($be, $root);
    $w = max(array_map(fn($r) => strlen($r[0]), $rows));
    printf("%-{$w}s  %-4s %-6s %s\n", 'Request', 'Code', 'ms', 'Result');
    foreach ($rows as [$l, $c, $ms, $res]) {
        printf("%-{$w}s  %-4s %-6s %s\n", $l, $c, $ms, $res);
    }
    $n = count(array_filter($rows, fn($r) => $r[1] !== ''));
    echo "-> $n requests, $fail failed\n";
    $totalFail += $fail;
    rrmdir_smoke($data);
}
echo "\nSmoke: " . ($totalFail ? "$totalFail FAILED" : 'all ok') . "\n";
exit($totalFail ? 1 : 0);

function rrmdir_smoke(string $d): void
{
    if (!is_dir($d)) {
        return;
    }
    foreach (scandir($d) ?: [] as $f) {
        if ($f !== '.' && $f !== '..') {
            $p = $d . '/' . $f;
            is_dir($p) ? rrmdir_smoke($p) : @unlink($p);
        }
    }
    @rmdir($d);
}
