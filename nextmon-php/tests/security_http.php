<?php
/**
 * Adversarial HTTP checks against a real `php -S` (demo mode, JSON storage so the data files can be inspected).
 *   php tests/security_http.php
 * Covers: headers, session fixation, CSRF (token + Sec-Fetch-Site), open redirect, template XSS, role/IDOR checks,
 * traversal in downloads, import cache at rest, API key auth/scope/rate limit, stateless endpoints, cron token throttle, CORS.
 * (X-Forwarded-For spoofing needs a non-loopback peer, so it is covered in unit tests: SecurityTest.)
 */
error_reporting(E_ALL);
ini_set('display_errors', '1');
$root = dirname(__DIR__);

function free_port(): int
{
    $s = stream_socket_server('tcp://127.0.0.1:0', $en, $es);
    $n = stream_socket_get_name($s, false);
    fclose($s);
    return (int)substr($n, strrpos($n, ':') + 1);
}

/** @return array{code:int, body:string, h:array<string,string[]>, loc:string} */
function req(string $method, string $url, array &$jar, array $post = [], array $headers = [], ?string $rawBody = null): array
{
    $hdr = $headers;
    if ($jar) {
        $hdr[] = 'Cookie: ' . implode('; ', array_map(fn($k, $v) => "$k=$v", array_keys($jar), $jar));
    }
    $opts = ['method' => $method, 'ignore_errors' => true, 'follow_location' => 0, 'max_redirects' => 0, 'timeout' => 60];
    if ($rawBody !== null) {
        $opts['content'] = $rawBody;
    } elseif ($method === 'POST') {
        $hdr[] = 'Content-Type: application/x-www-form-urlencoded';
        $opts['content'] = http_build_query($post);
    }
    $opts['header'] = implode("\r\n", $hdr);
    $body = @file_get_contents($url, false, stream_context_create(['http' => $opts]));
    $code = 0;
    $h = [];
    $loc = '';
    foreach ($http_response_header ?? [] as $line) {
        if (preg_match('#^HTTP/\S+ (\d{3})#', $line, $m)) {
            $code = (int)$m[1];
        } elseif (strpos($line, ':') !== false) {
            [$k, $v] = explode(':', $line, 2);
            $h[strtolower(trim($k))][] = trim($v);
            if (strtolower(trim($k)) === 'set-cookie' && preg_match('/^\s*([^=;\s]+)=([^;]*)/', $v, $m)) {
                if ($m[2] === '' || $m[2] === 'deleted') {
                    unset($jar[$m[1]]);
                } else {
                    $jar[$m[1]] = $m[2];
                }
            }
            if (strtolower(trim($k)) === 'location') {
                $loc = trim($v);
            }
        }
    }
    return ['code' => $code, 'body' => (string)$body, 'h' => $h, 'loc' => $loc];
}

function csrf(string $html): string
{
    return preg_match('/name="_csrf"\s+value="([^"]+)"/', $html, $m) ? $m[1] : '';
}

$data = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'nextmon-sec-' . bin2hex(random_bytes(3));
mkdir($data, 0775, true);
$port = free_port();
$env = array_merge(getenv(), ['NEXTMON_DEMO' => '1', 'NEXTMON_DATA' => $data, 'NEXTMON_STORAGE' => 'json', 'NEXTMON_DEBUG' => '']);
unset($env['NEXTMON_DEBUG'], $env['NEXTMON_TRUSTED_PROXIES'], $env['NEXTMON_SETUP_TOKEN']);
$proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", '-t', $root . '/public'], [0 => ['pipe', 'r'], 1 => ['file', $data . '/out.log', 'w'], 2 => ['file', $data . '/err.log', 'w']], $pipes, $root, $env);
$base = "http://127.0.0.1:$port";
for ($i = 0; $i < 60 && !@fsockopen('127.0.0.1', $port, $en, $es, 0.2); $i++) {
    usleep(100000);
}

$fail = 0;
$n = 0;
function check(string $label, bool $cond, string $info = ''): void
{
    global $fail, $n;
    $n++;
    printf("  %-4s %s%s\n", $cond ? 'ok' : 'FAIL', $label, $cond || $info === '' ? '' : '  -> ' . $info);
    if (!$cond) {
        $fail++;
    }
}

try {
    $jar = [];
    echo "headers + session\n";
    $r = req('GET', "$base/login", $jar);
    check('anonymous /login before setup redirects to /setup', $r['code'] === 302 && str_ends_with($r['loc'], '/setup'), $r['code'] . ' ' . $r['loc']);
    $r = req('GET', "$base/setup", $jar);
    $tok = csrf($r['body']);
    $h = $r['h'];
    check('CSP has script-src self, object-src none, frame-ancestors none', isset($h['content-security-policy']) && str_contains($h['content-security-policy'][0], "script-src 'self'") && str_contains($h['content-security-policy'][0], "object-src 'none'") && str_contains($h['content-security-policy'][0], "frame-ancestors 'none'"));
    check('no unsafe-inline for scripts', !preg_match("/script-src[^;]*unsafe-inline/", $h['content-security-policy'][0] ?? ''));
    check('X-Frame-Options DENY + nosniff + Referrer-Policy', ($h['x-frame-options'][0] ?? '') === 'DENY' && ($h['x-content-type-options'][0] ?? '') === 'nosniff' && isset($h['referrer-policy']));
    check('Permissions-Policy allows camera for self only', str_contains($h['permissions-policy'][0] ?? '', 'camera=(self)') && str_contains($h['permissions-policy'][0], 'microphone=()'));
    check('Cache-Control: no-store on dynamic pages', str_contains($h['cache-control'][0] ?? '', 'no-store'));
    check('no HSTS over plain http', !isset($h['strict-transport-security']));
    $r2 = req('GET', "$base/setup", $jar, [], ['X-Forwarded-Proto: https']);
    check('HSTS when HTTPS is signalled by a trusted (loopback) proxy', isset($r2['h']['strict-transport-security']));
    check('no X-Powered-By / path leakage headers', !isset($h['x-powered-by']));
    $cj = [];
    $cookieHdr = '';
    $rcookie = req('GET', "$base/setup", $cj);   // fresh visitor: gets a Set-Cookie
    foreach ($rcookie['h']['set-cookie'] ?? [] as $c) {
        if (str_starts_with($c, 'nextmon_sid=')) {
            $cookieHdr = $c;
        }
    }
    check('session cookie HttpOnly + SameSite', stripos($cookieHdr, 'HttpOnly') !== false && stripos($cookieHdr, 'SameSite=Lax') !== false, $cookieHdr);

    // session fixation: a made-up id must never be adopted
    $fix = ['nextmon_sid' => 'attackerchosenid0123456789abcdef'];
    $rf = req('GET', "$base/setup", $fix);
    check('strict mode: attacker-chosen session id is replaced', ($fix['nextmon_sid'] ?? '') !== 'attackerchosenid0123456789abcdef', json_encode($fix));

    echo "CSRF\n";
    $r = req('POST', "$base/setup", $jar, ['username' => 'admin', 'password' => 'Sup3rSecret!pw', 'password2' => 'Sup3rSecret!pw']);
    check('POST without token is rejected (419)', $r['code'] === 419, (string)$r['code']);
    $r = req('POST', "$base/setup", $jar, ['_csrf' => $tok, 'username' => 'admin', 'password' => 'Sup3rSecret!pw', 'password2' => 'Sup3rSecret!pw'], ['Sec-Fetch-Site: cross-site']);
    check('valid token but Sec-Fetch-Site: cross-site is rejected', $r['code'] === 419, (string)$r['code']);
    $r = req('POST', "$base/setup", $jar, ['_csrf' => $tok, 'username' => 'admin', 'password' => 'Sup3rSecret!pw', 'password2' => 'Sup3rSecret!pw'], ['Origin: https://evil.example']);
    check('valid token but foreign Origin is rejected', $r['code'] === 419, (string)$r['code']);
    $r = req('POST', "$base/setup", $jar, ['_csrf' => $tok, 'username' => 'admin', 'password' => 'Sup3rSecret!pw', 'password2' => 'Sup3rSecret!pw']);
    check('setup with token creates the admin and signs in', $r['code'] === 302, (string)$r['code']);
    $sidBefore = $jar['nextmon_sid'] ?? '';
    check('session id was regenerated at login (no fixation)', $sidBefore !== '' && $sidBefore !== ($fix['nextmon_sid'] ?? 'x'));
    $users = json_decode((string)file_get_contents($data . '/users.json'), true);
    check('password hash is bcrypt cost >= 12', (password_get_info($users[0]['hash'])['options']['cost'] ?? 0) >= 12);
    check('data files are not group/world accessible (POSIX)', DIRECTORY_SEPARATOR === '\\' || ((fileperms($data . '/users.json') & 0077) === 0));
    check('data dir has deny rules for Apache + IIS', is_file($data . '/.htaccess') && is_file($data . '/web.config'));

    $r = req('GET', '' . "$base/", $jar);
    $tok = csrf($r['body']);
    check('dashboard renders for the admin', $r['code'] === 200 && $tok !== '', (string)$r['code']);

    echo "open redirect + header injection\n";
    foreach (['//evil.example/x', '/\\evil.example', 'https://evil.example', "/ok\r\nSet-Cookie: pwn=1"] as $bad) {
        $r = req('POST', "$base/routers/select", $jar, ['_csrf' => $tok, 'router' => 'demo', 'back' => $bad]);
        check('back=' . json_encode($bad) . ' stays local', $r['code'] === 302 && !preg_match('#^(//|/\\\\|https?:)#', $r['loc']) && !isset($r['h']['set-cookie'][1]), $r['loc']);
    }
    $r = req('POST', "$base/routers/select", $jar, ['_csrf' => $tok, 'router' => 'demo', 'back' => '/hotspot/users?q=a']);
    check('a legitimate local back target is honoured', str_ends_with($r['loc'], '/hotspot/users?q=a'), $r['loc']);

    echo "XSS: voucher templates\n";
    $evil = '<div class="vc"><b>{{user}}</b><script>alert(1)</script><img src=x onerror=alert(2)><svg/onload=alert(3)><iframe srcdoc="<script>alert(4)</script>"></iframe><a href="javascript:alert(5)">x</a><style>@import url(//evil.example/x.css);.q{background:url(http://evil.example/p)}</style></div>';
    $r = req('POST', "$base/vouchers/templates/save", $jar, ['_csrf' => $tok, 'name' => 'xss', 'html' => $evil, 'w' => '70', 'h' => '40']);
    $s = json_decode((string)file_get_contents($data . '/ws/main/settings.json'), true);
    $stored = $s['templates'][0]['html'] ?? '(missing)';
    check('template saved', $r['code'] === 302 && $stored !== '(missing)', (string)$r['code']);
    check('stored template has no script/handler/iframe/js: url/remote css', !preg_match('/<script|onerror|onload|<iframe|javascript:|evil\.example|@import/i', $stored), $stored);
    check('placeholders survive', str_contains($stored, '{{user}}'));
    // simulate an older, unsanitised record that is already in the database
    $s['templates'][] = ['id' => 'old1', 'name' => 'legacy', 'html' => $evil, 'w' => 70, 'h' => 40];
    file_put_contents($data . '/ws/main/settings.json', json_encode($s));
    $r = req('GET', "$base/vouchers/templates", $jar);
    check('legacy dirty template is sanitised again when served', !preg_match('/<script>alert|onerror=alert|onload=alert|srcdoc=/i', preg_replace('/<script[^>]*src=[^>]*><\/script>/', '', $r['body'])), 'dirty markup reached the page');

    echo "roles / IDOR\n";
    $r = req('POST', "$base/settings/user", $jar, ['_csrf' => $tok, 'username' => 'rese', 'role' => 'reseller', 'password' => 'Zx9!qwerty-pass']);
    $r = req('POST', "$base/settings/user", $jar, ['_csrf' => $tok, 'username' => 'view', 'role' => 'viewer', 'password' => 'Zy8!asdfgh-pass']);
    // find a demo voucher + password as admin
    $r = req('GET', "$base/hotspot/users", $jar);
    $found = null;
    if (preg_match_all('#<b>([\w.@\-]+)</b></span> <span class="muted mono">/ ([^<]+)</span>#', $r['body'], $mm, PREG_SET_ORDER)) {
        $found = $mm[0];
    }
    check('admin sees voucher passwords in the user list', $found !== null);
    foreach (['rese' => 'Zx9!qwerty-pass', 'view' => 'Zy8!asdfgh-pass'] as $name => $pw) {
        $j2 = [];
        $r = req('GET', "$base/login", $j2);
        $t2 = csrf($r['body']);
        $r = req('POST', "$base/login", $j2, ['_csrf' => $t2, 'username' => $name, 'password' => $pw]);
        check("$name can sign in", $r['code'] === 302, (string)$r['code']);
        $r = req('GET', "$base/hotspot/users", $j2);
        check("$name does not see voucher passwords in the user list", $found && !str_contains($r['body'], '/ ' . $found[2] . '</span>') && !str_contains($r['body'], 'data-edit'), 'password leaked');
        $t2 = csrf(req('GET', "$base/", $j2)['body']);
        $r = req('POST', "$base/tools/run", $j2, ['_csrf' => $t2, 'tool' => 'ping', 'address' => '8.8.8.8']);
        check("$name cannot run ping from the router", $r['code'] === 403, $r['code'] . ' ' . substr($r['body'], 0, 80));
        $r = req('POST', "$base/tools/run", $j2, ['_csrf' => $t2, 'tool' => 'health']);
        check("$name may still read health", str_contains($r['body'], '"ok":true'));
        foreach (['/settings/user' => ['username' => 'x', 'role' => 'admin', 'password' => 'Adm1n!passw0rd'], '/routers/save' => ['name' => 'x', 'host' => '1.1.1.1'], '/backup/create' => [], '/resellers/fund' => ['id' => 'x', 'amount' => '1000']] as $path => $post) {
            $r = req('POST', "$base$path", $j2, ['_csrf' => $t2] + $post);
            check("$name is forbidden on POST $path", $r['code'] === 403, (string)$r['code']);
        }
        if ($name === 'rese' && $found) {
            $r = req('GET', "$base/vouchers/print?user=" . rawurlencode($found[1]), $j2);
            check('reseller cannot print a voucher they did not create (password not in page)', $r['code'] === 200 && !str_contains($r['body'], '"pass":"' . $found[2] . '"'), 'password leaked via print view');
            $r = req('GET', "$base/orders", $j2);
            check('reseller cannot open admin pages (orders)', $r['code'] === 403, (string)$r['code']);
            $r = req('GET', "$base/resellers/ledger", $j2);
            check('reseller cannot read the all-reseller ledger', $r['code'] === 403, (string)$r['code']);
            $r = req('GET', "$base/api/v1/status", $j2);
            check('session cookie alone does not authenticate /api/v1', $r['code'] === 401, (string)$r['code']);
        }
    }

    echo "downloads / traversal\n";
    foreach (['../../etc/passwd', '..\\..\\windows\\win.ini', 'user.dat', 'x.rsc/../../secret.key', ''] as $nm) {
        $r = req('GET', "$base/backup/download?type=file&name=" . rawurlencode($nm), $jar);
        check('backup download name ' . json_encode($nm) . ' refused', $r['code'] === 302, (string)$r['code']);
    }
    $r = req('GET', "$base/monitor/backup?router=demo&file=" . rawurlencode('../../users.json'), $jar);
    check('monitor backup traversal refused', $r['code'] === 302 && !str_contains($r['body'], 'password'), (string)$r['code']);
    foreach (['/data/users.json', '/data/secret.key', '/src/App.php', '/../src/App.php', '/%2e%2e/src/App.php', '/assets/../../src/App.php', '/tests/run.php', '/cron.php/x'] as $p) {
        $c = [];
        $r = req('GET', $base . $p, $c);
        check("GET $p does not leak code or data", !str_contains($r['body'], 'final class App') && !str_contains($r['body'], '"hash"') && $r['code'] !== 500, $r['code'] . '');
    }

    echo "import cache at rest\n";
    $boundary = '----kl' . bin2hex(random_bytes(6));
    $csv = "Name,Password,Profile\r\nsecretuser1,SuperSecretPw123,default\r\n";
    $body = "--$boundary\r\nContent-Disposition: form-data; name=\"_csrf\"\r\n\r\n$tok\r\n"
        . "--$boundary\r\nContent-Disposition: form-data; name=\"mode\"\r\n\r\nskip\r\n"
        . "--$boundary\r\nContent-Disposition: form-data; name=\"csv\"; filename=\"u.csv\"\r\nContent-Type: text/csv\r\n\r\n$csv\r\n--$boundary--\r\n";
    $r = req('POST', "$base/import/preview", $jar, [], ["Content-Type: multipart/form-data; boundary=$boundary"], $body);
    check('import preview accepted', $r['code'] === 302 && str_contains($r['loc'], '/import/preview?t='), $r['code'] . ' ' . $r['loc']);
    $files = glob($data . '/ws/main/cache/import-*-rows.json') ?: [];
    check('a pending-import cache file exists', count($files) === 1);
    $raw = $files ? (string)file_get_contents($files[0]) : '';
    check('cache file does not contain the plaintext password', $raw !== '' && !str_contains($raw, 'SuperSecretPw123'), substr($raw, 0, 80));
    $t = req('GET', "$base/", $jar);
    $r = req('POST', "$base/logout", $jar, ['_csrf' => csrf($t['body'])]);
    check('logout purges the pending import files', !glob($data . '/ws/main/cache/import-*-rows.json'));
    // sign back in for the remaining tests
    $r = req('GET', "$base/login", $jar);
    $r = req('POST', "$base/login", $jar, ['_csrf' => csrf($r['body']), 'username' => 'admin', 'password' => 'Sup3rSecret!pw']);
    $tok = csrf(req('GET', "$base/", $jar)['body']);

    echo "API keys\n";
    $r = req('POST', "$base/settings/key", $jar, ['_csrf' => $tok, 'name' => 'ro', 'scope' => 'read']);
    $pg = req('GET', "$base/settings", $jar);
    preg_match('/kl_[0-9a-f]{40}/', $pg['body'], $mk);
    $key = $mk[0] ?? '';
    check('key shown once after creation', $key !== '');
    $keys = json_decode((string)file_get_contents($data . '/ws/main/apikeys.json'), true);
    check('only the SHA-256 of the key is stored', $key !== '' && !str_contains(json_encode($keys), $key) && $keys[0]['hash'] === hash('sha256', $key));
    $nj = [];
    $c0 = count(glob($data . '/sessions/sess_*') ?: []);
    $r = req('GET', "$base/api/v1/status", $nj, [], ["X-API-Key: $key"]);
    check('API key authenticates (read)', $r['code'] === 200 && str_contains($r['body'], '"ok":true'), $r['code'] . ' ' . substr($r['body'], 0, 80));
    check('API response sets no cookie and creates no session file', !isset($r['h']['set-cookie']) && count(glob($data . '/sessions/sess_*') ?: []) === $c0);
    check('API sends no CORS headers', !isset($r['h']['access-control-allow-origin']));
    $r = req('POST', "$base/api/v1/vouchers", $nj, [], ["X-API-Key: $key", 'Content-Type: application/json'], '{"profile":"default","qty":1}');
    check('read-scope key cannot create vouchers', $r['code'] === 400 && str_contains($r['body'], 'read-only'), $r['code'] . ' ' . $r['body']);
    $r = req('GET', "$base/api/v1/status?key=" . $key, $nj);
    check('key in the query string is not accepted', $r['code'] === 401);
    $last = 0;
    for ($i = 0; $i < 32; $i++) {
        $r = req('GET', "$base/api/v1/status", $nj, [], ['X-API-Key: kl_' . bin2hex(random_bytes(20))]);
        $last = $r['code'];
        if ($last === 429) {
            break;
        }
    }
    check('wrong-key guessing is throttled (429)', $last === 429, "last=$last after " . ($i + 1));

    echo "public status endpoint\n";
    $c0 = count(glob($data . '/sessions/sess_*') ?: []);
    $r = req('GET', "$base/status.json?session=demo&user=nobody", $nj, [], ['Origin: https://evil.example']);
    check('foreign Origin gets no CORS grant', !isset($r['h']['access-control-allow-origin']), json_encode($r['h']['access-control-allow-origin'] ?? null));
    check('status.json is stateless (no cookie, no session file)', !isset($r['h']['set-cookie']) && count(glob($data . '/sessions/sess_*') ?: []) === $c0);
    $r = req('POST', "$base/settings/save", $jar, ['_csrf' => $tok, 'timezone' => 'Asia/Jakarta', 'currency' => 'Rp', 'lang' => 'id', 'max_qty' => '500', 'login_url' => 'javascript:alert(1)', 'status_cors' => "https://good.example, javascript:alert(1), http://x\"y"]);
    $s = json_decode((string)file_get_contents($data . '/ws/main/settings.json'), true);
    check('settings: javascript: login_url rejected', !str_starts_with($s['login_url'] ?? '', 'javascript'), (string)($s['login_url'] ?? ''));
    check('settings: only valid CORS origins kept', ($s['status_cors'] ?? '') === 'https://good.example', (string)($s['status_cors'] ?? ''));
    $r = req('GET', "$base/status.json?session=demo&user=nobody", $nj, [], ['Origin: https://good.example']);
    check('configured origin is echoed (not *) with Vary: Origin', ($r['h']['access-control-allow-origin'][0] ?? '') === 'https://good.example' && str_contains(implode(',', $r['h']['vary'] ?? []), 'Origin'));
    $codes = [];
    for ($i = 0; $i < 45; $i++) {
        $codes[] = req('GET', "$base/status.json?session=demo&user=guess$i", $nj)['code'];
    }
    check('voucher-status enumeration is rate limited (429 after 40)', in_array(429, $codes, true) && $codes[0] === 404, json_encode(array_count_values($codes)));

    echo "cron web trigger\n";
    $codes = [];
    for ($i = 0; $i < 12; $i++) {
        $codes[] = req('GET', "$base/cron.php?token=wrong$i", $nj)['code'];
    }
    check('bad cron token: 403 then throttled 429', $codes[0] === 403 && end($codes) === 429, json_encode($codes));
    $tokCron = json_decode((string)file_get_contents($data . '/ws/main/monitor.json'), true)['cron_token'] ?? '';
    if ($tokCron === '') {
        req('GET', "$base/monitor", $jar);
        $tokCron = json_decode((string)file_get_contents($data . '/ws/main/monitor.json'), true)['cron_token'] ?? '';
    }
    check('cron token exists', strlen($tokCron) === 32);

    echo "misc\n";
    $r = req('GET', "$base/does-not-exist", $nj);
    check('404 page leaks no filesystem path', $r['code'] === 404 && !preg_match('#[A-Za-z]:\\\\|/(var|home|tmp|usr)/#', $r['body']));
    $r = req('GET', "$base/lang?l=en&back=//evil.example", $jar);
    check('GET /lang redirect stays local', !preg_match('#^//|evil#', $r['loc']), $r['loc']);
} finally {
    proc_terminate($proc);
    proc_close($proc);
    $err = is_file($data . '/err.log') ? (string)file_get_contents($data . '/err.log') : '';
    $fatal = preg_match_all('/(Fatal error|Uncaught|Parse error)[^\n]*/', $err, $fm) ? $fm[0] : [];
    echo $fatal ? "SERVER ERRORS:\n  " . implode("\n  ", array_slice($fatal, 0, 5)) . "\n" : '';
    $fail += count($fatal);
    function rm_rf(string $d): void
    {
        foreach (glob($d . '/{,.}*', GLOB_BRACE) ?: [] as $f) {
            if (basename($f) === '.' || basename($f) === '..') {
                continue;
            }
            is_dir($f) ? rm_rf($f) : @unlink($f);
        }
        @rmdir($d);
    }
    rm_rf($data);
}
echo "\n$n checks, $fail failed\n";
exit($fail ? 1 : 0);
