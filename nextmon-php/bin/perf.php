<?php
/**
 * Page cost measurement against a (simulated slow) RouterOS API. Dev tool, not part of the app.
 *
 *   1. php tests/fixtures/fake_router_server.php --port=18728 --latency=120 --users=2000 --sales=3000 &
 *   2. NEXTMON_DATA=C:/tmp/nm-perf php bin/perf.php setup 18728            (throwaway admin + "real" router -> fake server)
 *   3. NEXTMON_DATA=C:/tmp/nm-perf php -S 127.0.0.6:8301 -t public &        (NO NEXTMON_DEMO)
 *   4. php bin/perf.php run http://127.0.0.6:8301 18728 [rounds=3]
 * Prints per page: server ms (wall clock of the HTTP request), router TCP connects, logins and API sentences (round-trips)
 * as counted by the fake router, for a cold request (first of its kind) and the median of the warm repeats.
 */
$cmd = $argv[1] ?? '';
const PW = 'Perf-test-pass-9x!';
if ($cmd === 'setup') {
    require dirname(__DIR__) . '/src/App.php';
    App::init();
    $port = (int)($argv[2] ?? 18728);
    if (!Auth::hasUsers()) {
        Auth::createFirstAdmin('perfadmin', PW);
    }
    Store::write('routers', [['id' => 'fake', 'name' => 'Fake', 'session' => 'fake', 'type' => 'real', 'host' => '127.0.0.1', 'port' => $port, 'ssl' => false,
        'user' => 'admin', 'pass' => Crypto::encrypt('secret'), 'hotspot_name' => 'Perf']]);
    echo "ok: user perfadmin, router fake -> 127.0.0.1:$port\n";
    exit;
}
if ($cmd !== 'run') {
    fwrite(STDERR, "usage: perf.php setup <port> | run <baseurl> <fakeport> [rounds]\n");
    exit(1);
}
$base = rtrim($argv[2] ?? 'http://127.0.0.6:8301', '/');
$fport = (int)($argv[3] ?? 18728);
$rounds = max(1, (int)($argv[4] ?? 3));

function stats(int $port): array
{
    $s = @stream_socket_client("tcp://127.0.0.1:$port", $e, $es, 3);
    if (!$s) {
        return [];
    }
    $send = function (array $w) use ($s) {
        $o = '';
        foreach ($w as $x) {
            $o .= chr(strlen($x)) . $x;
        }
        fwrite($s, $o . "\0");
    };
    $send(['/login', '=name=admin', '=password=secret']);
    $out = [];
    // read replies until the stats row arrives
    $send(['/__stats']);
    $buf = '';
    $t = microtime(true);
    while (microtime(true) - $t < 5 && !preg_match('/connections=(\d+)/', $buf)) {
        $buf .= (string)fread($s, 8192);
    }
    fclose($s);
    foreach (['connections', 'logins', 'sentences', 'rows'] as $k) {
        $out[$k] = preg_match("/$k=(\d+)/", $buf, $m) ? (int)$m[1] : 0;
    }
    return $out;
}

$jar = sys_get_temp_dir() . '/nm-perf-cookies-' . getmypid() . '.txt';
@unlink($jar);
function http(string $method, string $url, array $post = [], string $jar = '', array $hdr = []): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_COOKIEJAR => $jar, CURLOPT_COOKIEFILE => $jar, CURLOPT_TIMEOUT => 60,
        CURLOPT_HTTPHEADER => $hdr, CURLOPT_ENCODING => '']);
    if ($method === 'POST') {
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($post));
    }
    $t = microtime(true);
    $body = (string)curl_exec($ch);
    $ms = (microtime(true) - $t) * 1000;
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$code, $ms, $body];
}

[, , $form] = http('GET', "$base/login", [], $jar);
preg_match('/name="_csrf" value="([^"]+)"/', $form, $m);
[$code] = http('POST', "$base/login", ['_csrf' => $m[1] ?? '', 'username' => 'perfadmin', 'password' => PW], $jar);
echo "login HTTP $code\n";
[, , $dash] = http('GET', "$base/", [], $jar);
preg_match('/csrf[^>]*content="([^"]+)"|name="csrf-token" content="([^"]+)"/', $dash, $cm);

$pages = ['/', '/json/dashboard', '/json/dashboard', '/hotspot/users', '/hotspot/users?q=u0001', '/hotspot/profiles', '/hotspot/active', '/reports', '/vouchers', '/pos', '/queues', '/routers', '/settings'];
if (getenv('PERF_PAGES')) {
    $pages = explode(',', getenv('PERF_PAGES'));
}
printf("%-26s %8s %8s | %5s %5s %5s %7s\n", 'page (cold / warm median)', 'ms cold', 'ms warm', 'conn', 'login', 'sent', 'rows');
$tot = ['ms' => 0, 'c' => 0, 'l' => 0, 's' => 0];
foreach ($pages as $p) {
    $runs = [];
    for ($i = 0; $i < $rounds; $i++) {
        $a = stats($fport);
        [$code, $ms, $body] = http('GET', $base . $p, [], $jar);
        $b = stats($fport);
        // the stats probe itself costs 1 connection, 1 login and 2 sentences: subtract it
        $runs[] = ['ms' => $ms, 'c' => $b['connections'] - $a['connections'] - 1, 'l' => $b['logins'] - $a['logins'] - 1,
            's' => $b['sentences'] - $a["sentences"] - 2, 'r' => $b['rows'] - $a['rows'], 'code' => $code, 'bytes' => strlen($body)];
    }
    $w = array_slice($runs, 1) ?: $runs;
    usort($w, fn($x, $y) => $x['ms'] <=> $y['ms']);
    $med = $w[intdiv(count($w), 2)];
    printf("%-26s %8.0f %8.0f | %5d %5d %5d %7d  http=%d\n", $p, $runs[0]['ms'], $med['ms'], $runs[0]['c'], $runs[0]['l'], $runs[0]['s'], $runs[0]['r'], $runs[0]['code']);
    $tot['ms'] += $med['ms'];
    $tot['c'] += $runs[0]['c'];
    $tot['l'] += $runs[0]['l'];
    $tot['s'] += $runs[0]['s'];
}
printf("%-26s %8s %8.0f | %5d %5d %5d\n", 'TOTAL', '', $tot['ms'], $tot['c'], $tot['l'], $tot['s']);

// ---- write scenarios (PERF_WRITES=1): bulk voucher generate + batch delete
if (getenv('PERF_WRITES')) {
    $tok = preg_match('/data-csrf="([^"]+)"/', $dash, $tm) ? $tm[1] : '';
    $qty = (int)(getenv('PERF_QTY') ?: 100);
    $a = stats($fport);
    $ch = curl_init($base . '/vouchers/generate');
    $loc = '';
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_COOKIEJAR => $jar, CURLOPT_COOKIEFILE => $jar, CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => http_build_query(['_csrf' => $tok, 'qty' => $qty, 'profile' => 'default']),
        CURLOPT_HEADERFUNCTION => function ($c, $h) use (&$loc) {
            if (stripos($h, 'location:') === 0) {
                $loc = trim(substr($h, 9));
            }
            return strlen($h);
        }]);
    $t = microtime(true);
    curl_exec($ch);
    $ms = (microtime(true) - $t) * 1000;
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $b = stats($fport);
    printf("%-26s %8.0f %8s | %5d %5d %5d %7d  http=%d\n", "vouchers/generate qty=$qty", $ms, '', $b['connections'] - $a['connections'] - 1, $b['logins'] - $a['logins'] - 1, $b['sentences'] - $a['sentences'] - 2, $b['rows'] - $a['rows'], $code);
    if (preg_match('/comment=([^&]+)/', $loc, $cmm)) {
        $a = stats($fport);
        [$code, $ms] = http('POST', $base . '/vouchers/delete', ['_csrf' => $tok, 'tag' => rawurldecode($cmm[1])], $jar);
        $b = stats($fport);
        printf("%-26s %8.0f %8s | %5d %5d %5d %7d  http=%d\n", "vouchers/delete batch($qty)", $ms, '', $b['connections'] - $a['connections'] - 1, $b['logins'] - $a['logins'] - 1, $b['sentences'] - $a['sentences'] - 2, $b['rows'] - $a['rows'], $code);
    }
}
@unlink($jar);
