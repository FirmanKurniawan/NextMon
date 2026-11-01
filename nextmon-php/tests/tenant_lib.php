<?php
/**
 * Helpers for tests/tenant_isolation_test.php: HTTP client with cookie jar + CSRF, server boot, report table,
 * leak detection. Pure PHP, no dependencies.
 */

const TI_PASSWORD = 'Tenant-Iso-4821qzX!';

function ti_free_port(): int
{
    $s = stream_socket_server('tcp://127.0.0.1:0', $en, $es);
    $n = stream_socket_get_name($s, false);
    fclose($s);
    return (int)substr($n, strrpos($n, ':') + 1);
}

function ti_rrmdir(string $d): void
{
    if (!is_dir($d)) {
        return;
    }
    foreach (scandir($d) ?: [] as $f) {
        if ($f === '.' || $f === '..') {
            continue;
        }
        $p = $d . '/' . $f;
        is_dir($p) && !is_link($p) ? ti_rrmdir($p) : @unlink($p);
    }
    @rmdir($d);
}

/** Cookie-jar HTTP client for one identity. */
final class TC
{
    public array $jar = [];
    public string $csrf = '';
    public static string $base = '';
    public static int $count = 0;
    /** when true every string param (>= 6 chars) is remembered; log-like pages (audit) legitimately echo what THIS client sent */
    public static bool $track = false;
    /** @var array<string,true> strings any client sent since tracking started (shared: staff of one tenant see each other's audit rows) */
    public static array $sentAll = [];

    public function __construct(public string $name = 'anon')
    {
    }

    /** @return array{code:int, body:string, loc:string, headers:string} */
    public function req(string $method, string $path, array $params = [], array $headers = [], ?string $raw = null): array
    {
        $url = self::$base . $path;
        $hdr = array_merge(['Accept: text/html,application/json'], $headers);
        if ($this->jar) {
            $hdr[] = 'Cookie: ' . implode('; ', array_map(fn($k, $v) => "$k=$v", array_keys($this->jar), $this->jar));
        }
        $opts = ['method' => $method, 'ignore_errors' => true, 'follow_location' => 0, 'max_redirects' => 0, 'timeout' => 30];
        if ($method === 'GET' && $params) {
            $url .= (str_contains($url, '?') ? '&' : '?') . http_build_query($params);
        } elseif ($method !== 'GET') {
            if ($raw !== null) {
                $opts['content'] = $raw;
            } else {
                if ($this->csrf !== '' && !array_key_exists('_csrf', $params)) {
                    $params['_csrf'] = $this->csrf;
                }
                if (($params['_csrf'] ?? null) === false) {
                    unset($params['_csrf']);
                }
                $hdr[] = 'Content-Type: application/x-www-form-urlencoded';
                $opts['content'] = http_build_query($params);
            }
        }
        $opts['header'] = implode("\r\n", $hdr);
        self::$count++;
        if (self::$track) {
            foreach ($params as $pv) {
                if (is_string($pv) && strlen($pv) >= 6) {
                    self::$sentAll[$pv] = true;
                }
            }
        }
        $body = @file_get_contents($url, false, stream_context_create(['http' => $opts]));
        $code = 0;
        $loc = '';
        $all = '';
        foreach ($http_response_header ?? [] as $h) {
            $all .= $h . "\n";
            if (preg_match('#^HTTP/\S+ (\d{3})#', $h, $m)) {
                $code = (int)$m[1];
            } elseif (stripos($h, 'Set-Cookie:') === 0 && preg_match('/^Set-Cookie:\s*([^=;\s]+)=([^;]*)/i', $h, $m)) {
                if ($m[2] === '' || $m[2] === 'deleted') {
                    unset($this->jar[$m[1]]);
                } else {
                    $this->jar[$m[1]] = $m[2];
                }
            } elseif (stripos($h, 'Location:') === 0) {
                $loc = trim(substr($h, 9));
            }
        }
        return ['code' => $code, 'body' => (string)$body, 'loc' => $loc, 'headers' => $all, 'path' => $path, 'sent_all' => array_keys(self::$sentAll)];
    }

    public function get(string $path, array $params = [], array $headers = []): array
    {
        return $this->req('GET', $path, $params, $headers);
    }

    public function post(string $path, array $params = [], array $headers = []): array
    {
        return $this->req('POST', $path, $params, $headers);
    }

    public function sid(): string
    {
        return (string)($this->jar['nextmon_sid'] ?? '');
    }

    /** Pull the CSRF token out of a logged-in page. */
    public function refreshCsrf(): string
    {
        $r = $this->get('/');
        if (preg_match('/data-csrf="([^"]+)"/', $r['body'], $m)) {
            return $this->csrf = $m[1];
        }
        if (preg_match('/name="_csrf"\s+value="([^"]+)"/', $r['body'], $m)) {
            return $this->csrf = $m[1];
        }
        return $this->csrf = '';
    }

    /** @return bool true when the login redirected (302 not back to /login) */
    public function login(string $user, string $pw = TI_PASSWORD): bool
    {
        $page = $this->get('/login');
        preg_match('/name="_csrf"\s+value="([^"]+)"/', $page['body'], $m);
        $r = $this->req('POST', '/login', ['_csrf' => $m[1] ?? '', 'username' => $user, 'password' => $pw]);
        $ok = $r['code'] === 302 && !preg_match('#/login(\?|$)#', $r['loc']);
        if ($ok) {
            $this->refreshCsrf();
        }
        return $ok;
    }

    public function logout(): void
    {
        $this->post('/logout');
        $this->jar = [];
        $this->csrf = '';
    }
}

/** Collects checks per area and prints the PASS/FAIL/PENDING table. */
final class Rep
{
    /** @var array<string,array{title:string,checks:int,fails:string[],pending:string,notes:string[]}> */
    public array $areas = [];

    public function area(string $id, string $title): void
    {
        $this->areas[$id] ??= ['title' => $title, 'checks' => 0, 'fails' => [], 'pending' => '', 'notes' => []];
    }

    public function ok(string $id, bool $cond, string $label): bool
    {
        $a = &$this->areas[$id];
        $a['checks']++;
        if (!$cond) {
            $a['fails'][] = $label;
        }
        return $cond;
    }

    public function pend(string $id, string $why): void
    {
        $this->areas[$id]['pending'] = $why;
    }

    public function note(string $id, string $n): void
    {
        $this->areas[$id]['notes'][] = $n;
    }

    public function status(string $id): string
    {
        $a = $this->areas[$id];
        if ($a['fails']) {
            return 'FAIL';
        }
        if ($a['pending'] !== '' && $a['checks'] === 0) {
            return 'PENDING';
        }
        return $a['checks'] > 0 ? 'PASS' : 'PENDING';
    }

    public function hasFail(): bool
    {
        foreach (array_keys($this->areas) as $id) {
            if ($this->status($id) === 'FAIL') {
                return true;
            }
        }
        return false;
    }

    public function print(): void
    {
        echo "\n" . str_pad('AREA', 22) . str_pad('STATUS', 9) . str_pad('CHECKS', 8) . "DETAIL\n" . str_repeat('-', 100) . "\n";
        $cnt = ['PASS' => 0, 'FAIL' => 0, 'PENDING' => 0];
        foreach ($this->areas as $id => $a) {
            $st = $this->status($id);
            $cnt[$st]++;
            $detail = $a['fails'] ? count($a['fails']) . ' failed: ' . $a['fails'][0] : ($a['pending'] !== '' ? $a['pending'] : '');
            echo str_pad($a['title'], 22) . str_pad($st, 9) . str_pad((string)$a['checks'], 8) . mb_substr($detail, 0, 160) . "\n";
        }
        echo str_repeat('-', 100) . "\nPASS {$cnt['PASS']}  FAIL {$cnt['FAIL']}  PENDING {$cnt['PENDING']}   (HTTP requests: " . TC::$count . ")\n";
        foreach ($this->areas as $id => $a) {
            if ($a['fails']) {
                echo "\n[FAIL] {$a['title']}\n";
                foreach (array_slice($a['fails'], 0, 40) as $f) {
                    echo "  - $f\n";
                }
                if (count($a['fails']) > 40) {
                    echo '  ... +' . (count($a['fails']) - 40) . " more\n";
                }
            }
            foreach ($a['notes'] as $n) {
                echo "  note[{$a['title']}]: $n\n";
            }
        }
    }
}

/** pages that list logs: they legitimately echo strings the SAME client sent earlier (its own audit rows) */
const TI_LOG_PAGES = '#^/($|audit|notifications|monitor|settings/security|resellers/ledger|reports)#';

/**
 * Names of the leak needles found in a response (headers + body + Location). Values the attacker itself sent in THIS request
 * (and, on log pages, earlier in the session) are scrubbed first - but only as whole tokens, so a longer derived string
 * such as "<marker>-router" still counts as a leak.
 */
function ti_leaks(array $res, array $needles, array $sent = []): array
{
    $blob = $res['headers'] . "
" . $res['loc'] . "
" . $res['body'];
    for ($i = 0; $i < 2; $i++) {   // normalise html entities / percent-encoding so echoed query strings can be scrubbed
        $blob = rawurldecode(html_entity_decode($blob, ENT_QUOTES | ENT_HTML5));
    }
    if (preg_match(TI_LOG_PAGES, (string)($res['path'] ?? ''))) {
        $sent = array_merge($sent, $res['sent_all'] ?? []);
    }
    foreach ($sent as $v) {
        if (!is_string($v) || strlen($v) < 6) {
            continue;
        }
        $blob = preg_replace('/(?<![\w\-])' . preg_quote($v, '/') . '(?![\w\-])/i', '', $blob) ?? $blob;
    }
    $hit = [];
    foreach ($needles as $label => $n) {
        if ($n !== '' && ($pos = stripos($blob, $n)) !== false) {
            $hit[] = is_string($label) ? $label : $n;
            $GLOBALS['ti_last_leak'] = '...' . preg_replace('/\s+/', ' ', substr($blob, max(0, $pos - 70), 150)) . '...';
        }
    }
    return $hit;
}

function ti_php_errors(string $s): array
{
    $out = [];
    if (preg_match('~on line <b>\d+</b>|on line \d+~', $s) && preg_match_all('~(?:<b>)?(Warning|Notice|Fatal error|Deprecated|Parse error|Uncaught \w+)(?:</b>)?:\s*([^\n<]{0,120})~', $s, $m, PREG_SET_ORDER)) {
        foreach ($m as $x) {
            $out[] = $x[1] . ': ' . trim($x[2]);
        }
    }
    return array_values(array_unique($out));
}

/** Run the bootstrap child process (same NEXTMON_DATA as the server). Returns decoded JSON or ['error'=>..]. */
function ti_boot_cmd(string $root, string $data, string $backend, string $cmd, $arg = null): array
{
    $c = [PHP_BINARY, '-d', 'display_errors=0', $root . '/tests/tenant_bootstrap.php', $cmd, $arg === null ? '' : json_encode($arg)];
    $env = array_merge(getenv(), ['NEXTMON_DATA' => $data, 'NEXTMON_DEMO' => '1', 'NEXTMON_STORAGE' => $backend]);
    $p = proc_open($c, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, $root, $env);
    if (!is_resource($p)) {
        return ['error' => 'cannot spawn bootstrap'];
    }
    $out = stream_get_contents($pipes[1]);
    $err = stream_get_contents($pipes[2]);
    proc_close($p);
    if (preg_match('/@@JSON@@(.*)$/s', (string)$out, $m)) {
        $j = json_decode(trim($m[1]), true);
        if (is_array($j)) {
            return $j;
        }
    }
    return ['error' => 'bootstrap produced no JSON: ' . trim(mb_substr($out . ' ' . $err, 0, 300))];
}

/** Flat list "relative/path" => "mtime:size" for every file under $dir (used to see which namespaces a job touched). */
function ti_snapshot(string $dir): array
{
    $out = [];
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS));
    foreach ($it as $f) {
        if ($f->isFile()) {
            clearstatcache(true, $f->getPathname());
            $out[ltrim(str_replace('\\', '/', substr($f->getPathname(), strlen($dir))), '/')] = $f->getMTime() . ':' . $f->getSize();
        }
    }
    ksort($out);
    return $out;
}
