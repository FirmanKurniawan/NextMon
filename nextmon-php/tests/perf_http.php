<?php
/**
 * End-to-end checks of the speed layer over real HTTP.   php tests/perf_http.php
 * Boots tests/fixtures/fake_router_server.php (a RouterOS API look-alike) and `php -S` in REAL (non-demo) mode against it, then asserts:
 *   - one TCP connection + one login for many page loads (pooled socket), lazy connect
 *   - read cache never serves stale data after a write (users add / bulk delete / voucher batch)
 *   - flash messages and CSRF still work although read-only pages release the session lock early
 *   - pipelined voucher generation, dashboard payload cache + stale-while-revalidate (deferred refresh)
 *   - gzip for remote clients, circuit breaker when the router goes away, clean server stderr
 */
error_reporting(E_ALL);
ini_set('display_errors', '1');
$root = dirname(__DIR__);
$fails = 0;
$checks = 0;
function check(string $name, bool $ok, string $detail = ''): void
{
    global $fails, $checks;
    $checks++;
    echo ($ok ? '  ok   ' : '  FAIL ') . $name . ($ok || $detail === '' ? '' : '  -> ' . $detail) . "\n";
    if (!$ok) {
        $fails++;
    }
}
function free_port(): int
{
    $s = stream_socket_server('tcp://127.0.0.1:0', $en, $es);
    $n = stream_socket_get_name($s, false);
    fclose($s);
    return (int)substr($n, strrpos($n, ':') + 1);
}
function rrm(string $d): void
{
    if (!is_dir($d)) {
        return;
    }
    foreach (scandir($d) ?: [] as $f) {
        if ($f !== '.' && $f !== '..') {
            is_dir("$d/$f") ? rrm("$d/$f") : @unlink("$d/$f");
        }
    }
    @rmdir($d);
}

$tmp = str_replace('\\', '/', sys_get_temp_dir()) . '/nm-perfhttp-' . getmypid();
@mkdir($tmp, 0775, true);
register_shutdown_function(function () use ($tmp) {
    rrm($tmp);
});

// ---- fake router -----------------------------------------------------------------------------------------------
$rs = proc_open([PHP_BINARY, "$root/tests/fixtures/fake_router_server.php", '--port=0', "--data=$tmp/router"], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $rp);
preg_match('/^READY (\d+)/', (string)fgets($rp[1]), $m);
$rport = (int)($m[1] ?? 0);
if (!$rport) {
    fwrite(STDERR, "fake router did not start\n");
    exit(1);
}

// ---- app data: admin + a "real" router pointing at the fake server -------------------------------------------------
putenv("NEXTMON_DATA=$tmp/app");
putenv('NEXTMON_DEMO=');
putenv('NEXTMON_STORAGE=sqlite');
require "$root/src/App.php";
App::init();
Store::reset();
Auth::createFirstAdmin('perfadmin', 'Perf-test-pass-9x!');
Workspace::set('main');   // multi-tenant: the router below belongs to workspace main
Store::write('routers', [['id' => 'fake', 'name' => 'Fake', 'session' => 'fake', 'type' => 'real', 'host' => '127.0.0.1', 'port' => $rport, 'ssl' => false,
    'user' => 'admin', 'pass' => Crypto::encrypt('secret'), 'hotspot_name' => 'T']]);
Store::reset();

function router_stats(int $port): array
{
    $r = new RouterOS('127.0.0.1', $port, false, 5);
    $r->connect('admin', 'secret');
    $row = $r->command('/__stats')[0] ?? [];
    $r->command('/__reset');
    $r->close();
    $row['connections']--;
    $row['logins']--;
    $row['sentences'] -= 2;
    return array_map('intval', $row);
}

function start_app(int $port, string $dataDir, array $env = []): array
{
    $e = array_merge(getenv(), ['NEXTMON_DATA' => $dataDir, 'NEXTMON_DEMO' => '', 'NEXTMON_STORAGE' => 'sqlite'], $env);
    // the access log goes to a FILE: an unread pipe would fill up and block php -S
    $log = sys_get_temp_dir() . "/nm-perfhttp-$port.log";
    @unlink($log);
    $p = proc_open([PHP_BINARY, '-d', 'display_errors=1', '-S', "127.0.0.1:$port", '-t', dirname(__DIR__) . '/public'], [1 => ['file', $log, 'a'], 2 => ['file', $log, 'a']], $pp, null, $e);
    $pp = [2 => $log];
    for ($i = 0; $i < 50; $i++) {
        if (@fsockopen('127.0.0.1', $port, $en, $es, 0.2)) {
            break;
        }
        usleep(100000);
    }
    return [$p, $pp];
}

$jar = sys_get_temp_dir() . '/nm-perfhttp-' . getmypid() . '.jar';
@unlink($jar);
function req(string $method, string $url, array $post = [], array $hdr = [], bool $gzip = false): array
{
    global $jar;
    $ch = curl_init($url);
    $headers = [];
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_COOKIEJAR => $jar, CURLOPT_COOKIEFILE => $jar, CURLOPT_TIMEOUT => 20,
        CURLOPT_HTTPHEADER => $hdr, CURLOPT_HEADERFUNCTION => function ($c, $h) use (&$headers) {
            if (strpos($h, ':') !== false) {
                [$k, $v] = explode(':', $h, 2);
                $headers[strtolower(trim($k))] = trim($v);
            }
            return strlen($h);
        }]);
    if ($gzip) {
        curl_setopt($ch, CURLOPT_ENCODING, '');
    }
    if ($method === 'POST') {
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($post));
    }
    $t = microtime(true);
    $body = (string)curl_exec($ch);
    $ms = (microtime(true) - $t) * 1000;
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    if ($code === 0) {
        echo '  (curl: ' . curl_error($ch) . ' for ' . $url . ")
";
    }
    curl_close($ch);
    return ['code' => $code, 'body' => $body, 'h' => $headers, 'ms' => $ms];
}

$port = free_port();
[$app, $ap] = start_app($port, "$tmp/app", ['NEXTMON_ROUTER_FAIL_TTL' => '30']);
$base = "http://127.0.0.1:$port";

echo "login + lazy connect\n";
$r = req('GET', "$base/login");
preg_match('/name="_csrf" value="([^"]+)"/', $r['body'], $m);
$r = req('POST', "$base/login", ['_csrf' => $m[1] ?? '', 'username' => 'perfadmin', 'password' => 'Perf-test-pass-9x!']);
check('login redirects', $r['code'] === 302, (string)$r['code']);
req('GET', "$base/lang?l=en");
$r = req('GET', "$base/");
check('dashboard page renders', $r['code'] === 200 && strpos($r['body'], 'data-page="dashboard"') !== false);
preg_match('/data-csrf="([^"]+)"/', $r['body'], $m);
$csrf = $m[1] ?? '';
check('page contains csrf token', $csrf !== '');
$st = router_stats($rport);
check('the dashboard HTML page itself never touches the router (lazy)', $st['connections'] === 0 && $st['sentences'] === 0, json_encode($st));

echo "pooled socket across requests\n";
foreach (['/hotspot/users', '/hotspot/profiles', '/hotspot/active', '/vouchers', '/json/dashboard', '/hotspot/users'] as $p) {
    $r = req('GET', $base . $p);
    check("GET $p -> 200", $r['code'] === 200, (string)$r['code']);
}
$st = router_stats($rport);
check('6 router pages = 1 TCP connection and 1 login', $st['connections'] === 1 && $st['logins'] === 1, json_encode($st));

echo "read cache: instant repeats, never stale after a write\n";
$r = req('GET', "$base/hotspot/users");
$st = router_stats($rport);
check('repeat of a cached page sends nothing to the router', $st['sentences'] === 0, json_encode($st));
$r = req('POST', "$base/hotspot/users/save", ['_csrf' => $csrf, 'name' => 'zz-perf-1', 'password' => 'pw1', 'profile' => 'default', 'comment' => 'perf']);
check('add user -> 302', $r['code'] === 302, (string)$r['code']);
$r = req('GET', "$base/hotspot/users?q=zz-perf");
check('new user visible immediately (cache invalidated by the write)', strpos($r['body'], 'zz-perf-1') !== false);
check('flash message survived the early session close', stripos($r['body'], 'User saved') !== false, 'flash missing');
$r = req('GET', "$base/hotspot/users?q=zz-perf");
check('flash is consumed exactly once', stripos($r['body'], 'User saved') === false);
check('no-store header kept on re-opened session pages', stripos($r['h']['cache-control'] ?? '', 'no-store') !== false, $r['h']['cache-control'] ?? '(none)');
preg_match('/name="ids\[\]" value="([^"]+)"/', req('GET', "$base/hotspot/users?q=zz-perf-1")['body'], $m);
check('found the new user row id', !empty($m[1]));
$r = req('POST', "$base/hotspot/users/action", ['_csrf' => $csrf, 'action' => 'delete', 'ids' => [$m[1] ?? 'x']]);
$r = req('GET', "$base/hotspot/users?q=zz-perf");
check('deleted user is gone immediately', strpos($r['body'], 'zz-perf-1') === false);

echo "bulk voucher generation is pipelined\n";
router_stats($rport);
$t = microtime(true);
$r = req('POST', "$base/vouchers/generate", ['_csrf' => $csrf, 'qty' => 40, 'profile' => 'default', 'prefix' => 'qzv', 'length' => 6]);
check('generate 40 vouchers -> 302', $r['code'] === 302, (string)$r['code']);
$st = router_stats($rport);
check('40 adds + 1 existing-names read, 0 extra connections', $st['connections'] === 0 && $st['sentences'] >= 41 && $st['sentences'] <= 44, json_encode($st));
$loc = req('GET', "$base/hotspot/users?q=qzv")['body'];
check('all 40 vouchers exist and are listed (page 1 shows up to 100)', substr_count($loc, 'name="ids[]"') === 40, (string)substr_count($loc, 'name="ids[]"'));
preg_match('/comment=([^&"\']+)/', $r['h']['location'] ?? '', $cm);
$r = req('POST', "$base/vouchers/delete", ['_csrf' => $csrf, 'tag' => rawurldecode($cm[1] ?? 'none')]);
$loc = req('GET', "$base/hotspot/users?q=qzv")['body'];
check('batch delete (pipelined removes) removed all 40', substr_count($loc, 'name="ids[]"') === 0, (string)substr_count($loc, 'name="ids[]"'));

echo "dashboard payload cache + stale-while-revalidate\n";
req('GET', "$base/json/dashboard");
router_stats($rport);
$a = req('GET', "$base/json/dashboard");
$b = req('GET', "$base/json/dashboard");
$st = router_stats($rport);
$ja = json_decode($a['body'], true);
check('dashboard JSON ok', ($ja['ok'] ?? false) === true && isset($ja['resource']['cpu'], $ja['income_today']), $a['code'] . ' ' . json_encode($a['h']) . ' ' . substr($a['body'], 0, 300));
check('two polls within the fresh window cost the router nothing', $st['sentences'] === 0, json_encode($st));
sleep(9);   // longer than every read-cache TTL: the deferred refresh has to ask the router
router_stats($rport);
$c = req('GET', "$base/json/dashboard");
check('stale payload is served at once with Content-Length (deferred refresh)', $c['code'] === 200 && isset($c['h']['content-length']) && json_decode($c['body'], true)['ok'] === true, json_encode($c['h']));
usleep(600000);
$st = router_stats($rport);
check('...and the refresh ran after the response (router was asked now)', $st['sentences'] >= 2, json_encode($st));
$write = req('POST', "$base/hotspot/users/save", ['_csrf' => $csrf, 'name' => 'zz-perf-2', 'password' => 'p', 'profile' => 'default']);
$d = json_decode(req('GET', "$base/json/dashboard")['body'], true);
check('a write invalidates the cached dashboard payload at once', ($d['users'] ?? 0) === ($ja['users'] ?? -1) + 1, ($d['users'] ?? '?') . ' vs ' . ($ja['users'] ?? '?'));

echo "no router, no hang: circuit breaker\n";
proc_terminate($rs);
proc_close($rs);
usleep(300000);
$t = microtime(true);
$r1 = req('GET', "$base/hotspot/active");
$t1 = microtime(true) - $t;
$t = microtime(true);
$r2 = req('GET', "$base/hotspot/active");
$t2 = microtime(true) - $t;
check('router down -> 502 page, not a hang', $r1['code'] === 502, (string)$r1['code']);
check('2nd request fails fast and says why', $r2['code'] === 502 && stripos($r2['body'], 'unreachable') !== false && $t2 < 1.0, sprintf('%d in %.2fs', $r2['code'], $t2));
check('non-router pages keep working', req('GET', "$base/settings")['code'] === 200);

echo "gzip for remote clients\n";
[$app2, $ap2] = start_app($port2 = free_port(), "$tmp/app", ['NEXTMON_GZIP' => '1']);
$raw = req('GET', "http://127.0.0.1:$port2/settings", [], ['Accept-Encoding: gzip']);
check('Content-Encoding: gzip when asked', ($raw['h']['content-encoding'] ?? '') === 'gzip', json_encode($raw['h']));
$plain = req('GET', "http://127.0.0.1:$port2/settings", [], ['Accept-Encoding: gzip'], true);
check('...and it decodes to the page', $plain['code'] === 200 && strpos($plain['body'], 'data-page="settings"') !== false);
$pn = req('GET', "$base/settings", [], ['Accept-Encoding: gzip']);
check('loopback client is not compressed by default', ($pn['h']['content-encoding'] ?? '') === '');

echo "server stderr\n";
$err = (string)@file_get_contents($ap[2]) . (string)@file_get_contents($ap2[2]);
$bad = [];
foreach (explode("\n", $err) as $l) {
    if (preg_match('/(Warning|Notice|Deprecated|Fatal error|Uncaught)/', $l)) {
        $bad[] = $l;
    }
}
check('no PHP warnings / notices in the server log', !$bad, implode(' | ', array_slice($bad, 0, 3)));
proc_terminate($app);
proc_terminate($app2);
@unlink($ap[2]);
@unlink($ap2[2]);
@unlink($jar);
echo "\n$checks checks, $fails failed\n";
exit($fails ? 1 : 0);
