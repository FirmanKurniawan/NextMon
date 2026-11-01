<?php
/**
 * Hotspot users CSV import / export (Mikhmon-style columns).
 * Flow: upload -> validate + preview (nothing written) -> commit (optionally dry-run) -> result + error report.
 * Parsed rows wait in data/cache/import-<token>.json (deleted on commit/cancel, stale ones after 1 h).
 */
class ImportController
{
    public const MAX_BYTES = 2097152;   // 2 MB
    public const MAX_ROWS = 5000;
    private const SHOW = 300;           // preview rows rendered

    /** canonical key => [export header, aliases (normalised: lowercase letters/digits only)] */
    public const COLS = [
        'server' => ['Server', ['server', 'hotspotserver']],
        'name' => ['Name', ['name', 'user', 'username', 'login', 'voucher', 'code']],
        'password' => ['Password', ['password', 'pass', 'pwd']],
        'profile' => ['Profile', ['profile', 'package', 'paket']],
        'mac-address' => ['Mac Address', ['macaddress', 'mac']],
        'limit-uptime' => ['Time Limit', ['timelimit', 'limituptime', 'uptimelimit', 'limittime']],
        'limit-bytes-total' => ['Data Limit', ['datalimit', 'limitbytestotal', 'limitbytes', 'bytelimit', 'limitdata']],
        'comment' => ['Comment', ['comment', 'note', 'keterangan']],
        'disabled' => ['Disabled', ['disabled', 'disable']],
    ];
    private const STATS = ['uptime' => 'Uptime', 'bytes-in' => 'Bytes In', 'bytes-out' => 'Bytes Out'];

    // ---- helpers -------------------------------------------------------------------------------------------

    private static function norm(string $h): string
    {
        return preg_replace('/[^a-z0-9]/', '', strtolower($h));
    }

    private static function cacheFile(string $token, string $kind = 'rows'): string
    {
        return Workspace::dir('cache') . '/import-' . $token . '-' . $kind . '.json';
    }

    private static function validToken(string $t): bool
    {
        return (bool)preg_match('/^[a-f0-9]{16}$/', $t) && isset($_SESSION['import'][$t]);
    }

    private static function load(string $token, string $kind = 'rows'): ?array
    {
        if (!self::validToken($token)) {
            return null;
        }
        $f = self::cacheFile($token, $kind);
        $raw = is_file($f) ? (string)file_get_contents($f) : '';
        if ($kind === 'rows') {
            $raw = Crypto::decrypt($raw);   // rows hold plain passwords: encrypted at rest (AES-GCM) until commit/cancel/1 h
        }
        $j = $raw !== '' ? json_decode($raw, true) : null;
        return is_array($j) ? $j : null;
    }

    /** Remove every pending import file of this session (called on logout). */
    public static function purgeSession(): void
    {
        foreach (array_keys((array)($_SESSION['import'] ?? [])) as $t) {
            if (preg_match('/^[a-f0-9]{16}$/', (string)$t)) {
                foreach (['rows', 'result'] as $k) {
                    @unlink(self::cacheFile((string)$t, $k));
                }
            }
        }
        unset($_SESSION['import']);
    }

    private static function gc(): void
    {
        foreach (glob(Workspace::dir('cache') . '/import-*.json') ?: [] as $f) {   // tenant-ok: per-workspace cache dir
            if (filemtime($f) < time() - 1800) {
                @unlink($f);
            }
        }
    }

    private static function drop(string $token): void
    {
        @unlink(self::cacheFile($token));
        unset($_SESSION['import'][$token]);
    }

    /** Spreadsheet formula guard on export */
    private static function out(string $v): string
    {
        return $v !== '' && strpos("=+-@\t\r", $v[0]) !== false && !preg_match('/^[+-]?\d+([.,]\d+)?$/', $v) ? "'" . $v : $v;
    }

    private static function in(string $v): string
    {
        $v = trim($v);
        return (strlen($v) > 1 && $v[0] === "'" && strpos("=+-@", $v[1]) !== false) ? substr($v, 1) : $v;
    }

    private static function csvLine(array $cells, string $sep): string
    {
        $o = fopen('php://temp', 'r+');
        fputcsv($o, $cells, $sep, '"', '\\', "\r\n");
        rewind($o);
        return (string)stream_get_contents($o);
    }

    private static function send(string $name, string $body): void
    {
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $name . '"');
        header('Cache-Control: no-store');
        echo "\xEF\xBB\xBF" . $body;
        exit;
    }

    // ---- pages ---------------------------------------------------------------------------------------------

    public static function index(): void
    {
        $r = App::driver();
        $profiles = array_column($r->print('/ip/hotspot/user/profile', [], ['name']), 'name');
        App::render('import', [
            'title' => t('Import / export users'), 'page' => 'import', 'profiles' => $profiles, 'cols' => self::COLS,
            'maxMb' => self::MAX_BYTES / 1048576, 'maxRows' => self::MAX_ROWS,
            'phpMax' => ini_get('upload_max_filesize'),
        ]);
    }

    public static function template(): void
    {
        $head = array_map(fn($c) => $c[0], self::COLS);
        $body = self::csvLine($head, ',')
            . self::csvLine(['all', 'abc123', 'abc123', '1Jam', '', '', '', 'vc-100-' . date('m.d.y') . '-sample', 'no'], ',');
        self::send('nextmon-users-template.csv', $body);
    }

    public static function export(): void
    {
        $r = App::driver();
        $sep = App::get('sep') === 'semicolon' ? ';' : ',';
        $prof = App::get('profile');
        $q = strtolower(App::get('q'));
        $stats = App::get('stats') === '1';
        $head = array_map(fn($c) => $c[0], self::COLS);
        if ($stats) {
            $head = array_merge($head, array_values(self::STATS));
        }
        $props = array_merge(array_keys(self::COLS), $stats ? array_keys(self::STATS) : []);
        $body = self::csvLine($head, $sep);
        $n = 0;
        foreach ($r->print('/ip/hotspot/user', [], $props) as $u) {
            if (($u['name'] ?? '') === 'default-trial') {
                continue;
            }
            if ($prof !== '' && ($u['profile'] ?? '') !== $prof) {
                continue;
            }
            if ($q !== '' && strpos(strtolower(($u['name'] ?? '') . ' ' . ($u['comment'] ?? '')), $q) === false) {
                continue;
            }
            $row = [];
            foreach ($props as $k) {
                $v = (string)($u[$k] ?? '');
                if ($k === 'disabled') {
                    $v = in_array($v, ['true', 'yes'], true) ? 'yes' : 'no';
                } elseif ($k === 'mac-address' && $v === '00:00:00:00:00:00') {
                    $v = '';
                } elseif (in_array($k, ['limit-uptime', 'limit-bytes-total'], true) && in_array($v, ['0', '0s', '1s'], true)) {
                    $v = '';
                } elseif ($k === 'server' && $v === '') {
                    $v = 'all';
                }
                $row[] = self::out($v);
            }
            $body .= self::csvLine($row, $sep);
            $n++;
        }
        Audit::log('users.export', $n . ' users');
        self::send('hotspot-users-' . date('Ymd-His') . '.csv', $body);
    }

    // ---- preview ---------------------------------------------------------------------------------------------

    /** @return array [header => canonical key map | null, list<array{line:int,cells:string[]}>, error] */
    private static function parseCsv(string $path): array
    {
        $raw = (string)file_get_contents($path);
        if (strncmp($raw, "\xEF\xBB\xBF", 3) === 0) {
            $raw = substr($raw, 3);
        }
        if (!mb_check_encoding($raw, 'UTF-8')) {
            $raw = mb_convert_encoding($raw, 'UTF-8', 'Windows-1252');
        }
        $raw = str_replace("\0", '', $raw);
        $first = strtok($raw, "\n") ?: '';
        $sep = ',';
        $best = substr_count($first, ',');
        foreach ([';' => ';', "\t" => "\t"] as $c) {
            if (substr_count($first, $c) > $best) {
                $best = substr_count($first, $c);
                $sep = $c;
            }
        }
        $fh = fopen('php://temp', 'r+');
        fwrite($fh, $raw);
        rewind($fh);
        $rows = [];
        $line = 0;
        $map = null;
        while (($cells = fgetcsv($fh, 0, $sep, '"', '\\')) !== false) {
            $line++;
            if ($cells === [null] || count(array_filter($cells, fn($c) => trim((string)$c) !== '')) === 0) {
                continue;   // blank line
            }
            $cells = array_map(fn($c) => (string)$c, $cells);
            if ($map === null) {
                $map = [];
                foreach ($cells as $i => $h) {
                    $nh = self::norm($h);
                    foreach (self::COLS as $key => $def) {
                        if (in_array($nh, $def[1], true) && !in_array($key, $map, true)) {
                            $map[$i] = $key;
                            continue 2;
                        }
                    }
                    $map[$i] = '';   // unknown column, ignored
                }
                if (!in_array('name', $map, true)) {
                    return [null, [], t('No "Name" column found in the first row. Download the template to see the expected columns.')];
                }
                continue;
            }
            if (count($rows) >= self::MAX_ROWS) {
                return [$map, $rows, t('Too many rows: the limit is :n rows per file.', [':n' => self::MAX_ROWS])];
            }
            $rows[] = ['line' => $line, 'cells' => $cells];
        }
        fclose($fh);
        return [$map, $rows, $map === null ? t('The file is empty.') : ''];
    }

    private static function yes(string $v): ?bool
    {
        $v = strtolower(trim($v));
        if ($v === '') {
            return null;
        }
        return in_array($v, ['yes', 'true', '1', 'y', 'ya', 'disabled'], true) ? true : (in_array($v, ['no', 'false', '0', 'n', 'tidak', 'enabled'], true) ? false : null);
    }

    /** Validate one row. Returns [data, errors[]] */
    private static function check(array $cells, array $map, array $ctx): array
    {
        $d = [];
        foreach ($map as $i => $key) {
            if ($key !== '' && isset($cells[$i])) {
                $d[$key] = self::in($cells[$i]);
            }
        }
        $err = [];
        $name = $d['name'] ?? '';
        if ($name === '') {
            $err[] = t('Name is empty.');
        } elseif (!preg_match('/^[\w.\-@]{1,64}$/', $name)) {
            $err[] = t('Invalid username (letters, digits, . - _ @, max 64).');
        }
        if (isset($d['password']) && (strlen($d['password']) > 64 || preg_match('/[\x00-\x1F]/', $d['password']))) {
            $err[] = t('Password too long or has control characters.');
        }
        if (array_key_exists('profile', $d) && $d['profile'] === '') {
            $d['profile'] = 'default';
        }
        if (isset($d['profile']) && !isset($ctx['profiles'][$d['profile']])) {
            $err[] = t('Profile ":p" does not exist on this router.', [':p' => $d['profile']]);
        }
        if (isset($d['server']) && $d['server'] !== '' && $d['server'] !== 'all' && !in_array($d['server'], $ctx['servers'], true)) {
            $err[] = t('Hotspot server ":s" does not exist.', [':s' => $d['server']]);
        }
        if (isset($d['mac-address']) && $d['mac-address'] !== '') {
            if (!preg_match('/^([0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}$/', $d['mac-address'])) {
                $err[] = t('Invalid MAC address.');
            } else {
                $d['mac-address'] = strtoupper(str_replace('-', ':', $d['mac-address']));
            }
        }
        if (isset($d['limit-uptime']) && $d['limit-uptime'] !== '') {
            $d['limit-uptime'] = strtolower($d['limit-uptime']);
            if (!Scripts::validDuration($d['limit-uptime'])) {
                $err[] = t('Time limit format is invalid (example: 1h30m).');
            } else {
                $validity = $ctx['validity'][$d['profile'] ?? 'default'] ?? '';
                if ($validity !== '' && Scripts::seconds($d['limit-uptime']) > Scripts::seconds($validity)) {
                    $err[] = t('Time limit (:l) must not exceed validity (:v).', [':l' => $d['limit-uptime'], ':v' => $validity]);
                }
            }
        }
        if (isset($d['limit-bytes-total']) && $d['limit-bytes-total'] !== '' && !preg_match('/^\d+[kKmMgG]?$/', $d['limit-bytes-total'])) {
            $err[] = t('Data limit format is invalid (example: 500M or 2G).');
        }
        if (isset($d['comment'])) {
            $d['comment'] = trim(preg_replace('/[\r\n]+/', ' ', $d['comment']));
            if (mb_strlen($d['comment']) > 255) {
                $err[] = t('Comment is longer than 255 characters.');
            }
        }
        if (isset($d['disabled']) && $d['disabled'] !== '') {
            $b = self::yes($d['disabled']);
            if ($b === null) {
                $err[] = t('Disabled must be yes or no.');
            } else {
                $d['disabled'] = $b ? 'yes' : 'no';
            }
        }
        return [$d, $err];
    }

    private static function context(Driver $r): array
    {
        $profiles = [];
        $validity = [];
        foreach ($r->print('/ip/hotspot/user/profile', [], ['name', 'on-login']) as $p) {
            $profiles[$p['name']] = true;
            $m = Scripts::parseMeta((string)($p['on-login'] ?? ''));
            $validity[$p['name']] = $m['validity'] ?? '';
        }
        $existing = [];
        foreach ($r->print('/ip/hotspot/user', [], ['name']) as $u) {
            $existing[$u['name']] = $u['.id'];
        }
        return ['profiles' => $profiles, 'validity' => $validity, 'servers' => array_column($r->print('/ip/hotspot', [], ['name']), 'name'), 'existing' => $existing];
    }

    public static function preview(): void
    {
        $f = $_FILES['csv'] ?? null;
        if (!$f || !is_array($f) || ($f['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
            App::redirect('/import', t('Choose a CSV file first.'), 'err');
        }
        if ($f['error'] === UPLOAD_ERR_INI_SIZE || $f['error'] === UPLOAD_ERR_FORM_SIZE || $f['size'] > self::MAX_BYTES) {
            App::redirect('/import', t('File is too large (max :n MB).', [':n' => self::MAX_BYTES / 1048576]), 'err');
        }
        if ($f['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($f['tmp_name'])) {
            App::redirect('/import', t('Upload failed.'), 'err');
        }
        if (!preg_match('/\.(csv|txt)$/i', (string)$f['name'])) {
            App::redirect('/import', t('Only .csv files are accepted.'), 'err');
        }
        $mode = App::post('mode') === 'overwrite' ? 'overwrite' : 'skip';
        [$map, $raw, $fatal] = self::parseCsv($f['tmp_name']);
        if ($map === null || $fatal !== '') {
            App::redirect('/import', $fatal ?: t('The file is empty.'), 'err');
        }
        if (!$raw) {
            App::redirect('/import', t('The file has a header but no data rows.'), 'err');
        }
        $ctx = self::context(App::driver());
        $seen = [];
        $out = [];
        $c = ['new' => 0, 'update' => 0, 'skip' => 0, 'error' => 0];
        foreach ($raw as $r) {
            [$d, $err] = self::check($r['cells'], $map, $ctx);
            $name = $d['name'] ?? '';
            if (!$err && isset($seen[$name])) {
                $err[] = t('Duplicate of line :n in this file.', [':n' => $seen[$name]]);
            }
            if (!$err && $name !== '') {
                $seen[$name] = $r['line'];
            }
            $exists = $name !== '' && isset($ctx['existing'][$name]);
            $st = $err ? 'error' : ($exists ? ($mode === 'overwrite' ? 'update' : 'skip') : 'new');
            $c[$st]++;
            $out[] = ['line' => $r['line'], 'st' => $st, 'exists' => $exists, 'd' => $d, 'err' => $err];
        }
        self::gc();
        $token = bin2hex(random_bytes(8));
        file_put_contents(self::cacheFile($token), Crypto::encrypt((string)json_encode([
            'rows' => $out, 'mode' => $mode, 'counts' => $c, 'file' => mb_substr((string)$f['name'], 0, 120), 'router' => App::currentRouterId(),
            'cols' => array_values(array_filter($map)), 'fatal' => $fatal, 'ts' => time(),
        ])), LOCK_EX);
        @chmod(self::cacheFile($token), 0600);
        $_SESSION['import'][$token] = time();
        Audit::log('users.import.preview', $f['name'] . ': ' . json_encode($c));
        App::redirect('/import/preview?t=' . $token);
    }

    public static function previewPage(): void
    {
        $token = App::get('t');
        $j = self::load($token);
        if (!$j) {
            App::redirect('/import', t('Import session expired. Upload the file again.'), 'err');
        }
        $only = App::get('show') === 'errors';
        $rows = $only ? array_values(array_filter($j['rows'], fn($r) => $r['st'] === 'error')) : $j['rows'];
        App::render('import_preview', [
            'title' => t('Import preview'), 'page' => 'import', 'token' => $token, 'j' => $j, 'rows' => array_slice($rows, 0, self::SHOW), 'shown' => min(count($rows), self::SHOW),
            'totalRows' => count($rows), 'only' => $only,
        ]);
    }

    public static function cancel(): void
    {
        $t = App::post('t');
        if (self::validToken($t)) {
            self::drop($t);
        }
        App::redirect('/import');
    }

    // ---- commit ----------------------------------------------------------------------------------------------

    public static function commit(): void
    {
        $token = App::post('t');
        $j = self::load($token);
        if (!$j) {
            App::redirect('/import', t('Import session expired. Upload the file again.'), 'err');
        }
        if (($j['router'] ?? '') !== App::currentRouterId()) {
            App::redirect('/import/preview?t=' . $token, t('The selected router changed since the preview. Upload the file again.'), 'err');
        }
        $mode = App::post('mode') === 'overwrite' ? 'overwrite' : 'skip';
        $dry = App::post('dry') === '1';
        @set_time_limit(300);
        $r = App::driver();
        $existing = [];
        foreach ($r->print('/ip/hotspot/user', [], ['name']) as $u) {
            $existing[$u['name']] = $u['.id'];
        }
        // daily voucher limit: the whole file is refused when the new users would not fit (a dry run only checks, a real run reserves)
        $new = [];
        foreach ($j['rows'] as $row) {
            $nm = (string)($row['d']['name'] ?? '');
            if ($row['st'] !== 'error' && $nm !== '' && !isset($existing[$nm])) {
                $new[$nm] = true;
            }
        }
        $quota = null;
        try {
            if ($dry) {
                Quota::check(count($new));
            } else {
                $quota = Quota::reserve(count($new));
            }
        } catch (QuotaException $qe) {
            App::redirect('/import/preview?t=' . $token, $qe->getMessage(), 'err');
        }
        $res = ['added' => 0, 'updated' => 0, 'skipped' => 0, 'errors' => 0, 'dry' => $dry, 'mode' => $mode, 'file' => $j['file'], 'ts' => time(), 'rowErrors' => []];
        // Router writes are queued and sent pipelined (100 rows per round-trip) instead of one round-trip per row.
        // Per-row error reporting is unchanged; a name that appears twice in the file flushes the queue first so the
        // second row sees the id of the first (same result as the old row-by-row loop).
        $sets = [];
        $adds = [];
        $pend = [];
        $errs = [];   // [row index, entry]: sorted back into file order at the end
        $flush = function () use (&$sets, &$adds, &$pend, &$existing, &$res, &$errs, $r) {
            if ($sets) {
                try {
                    $out = Pipe::trySets($r, '/ip/hotspot/user', array_map(fn($x) => [$x['id'], $x['attrs']], $sets));
                } catch (RouterOSException $e) { // transport failure: every queued row reports it, like the old per-row catch did
                    $out = array_fill(0, count($sets), ['err' => $e->getMessage()]);
                }
                foreach ($sets as $i => $x) {
                    if ($out[$i]['err'] !== null) {
                        $res['errors']++;
                        $errs[] = [$x['idx'], ['line' => $x['line'], 'name' => $x['name'], 'error' => $out[$i]['err']]];
                    } else {
                        $res['updated']++;
                    }
                }
                $sets = [];
            }
            if ($adds) {
                try {
                    $out = Pipe::tryAdds($r, '/ip/hotspot/user', array_map(fn($x) => $x['attrs'], $adds));
                } catch (RouterOSException $e) {
                    $out = array_fill(0, count($adds), ['id' => '', 'err' => $e->getMessage()]);
                }
                foreach ($adds as $i => $x) {
                    if ($out[$i]['err'] !== null) {
                        $res['errors']++;
                        $errs[] = [$x['idx'], ['line' => $x['line'], 'name' => $x['name'], 'error' => $out[$i]['err']]];
                    } else {
                        $existing[$x['name']] = $out[$i]['id'];
                        $res['added']++;
                    }
                }
                $adds = [];
            }
            $pend = [];
        };
        try {
            foreach ($j['rows'] as $idx => $row) {
                $d = $row['d'];
                $name = $d['name'] ?? '';
                if ($row['st'] === 'error') {
                    $res['errors']++;
                    $errs[] = [$idx, ['line' => $row['line'], 'name' => $name, 'error' => implode('; ', $row['err'])]];
                    continue;
                }
                if (isset($pend[$name])) {
                    $flush();
                }
                $id = $existing[$name] ?? null;
                if ($id !== null && $mode === 'skip') {
                    $res['skipped']++;
                    continue;
                }
                if ($id !== null) {
                    $attrs = array_filter($d, fn($v, $k) => $k !== 'name' && $k !== 'server' && $v !== '', ARRAY_FILTER_USE_BOTH);
                    if (!$dry && $attrs) {
                        $sets[] = ['idx' => $idx, 'line' => $row['line'], 'name' => $name, 'id' => $id, 'attrs' => $attrs];
                        $pend[$name] = true;
                    } else {
                        $res['updated']++;
                    }
                } else {
                    $attrs = array_filter($d, fn($v) => $v !== '');
                    if (($attrs['server'] ?? '') === 'all') {
                        unset($attrs['server']);
                    }
                    if (($attrs['disabled'] ?? '') === 'no') {
                        unset($attrs['disabled']);
                    }
                    $attrs += ['profile' => 'default'];
                    if (!$dry) {
                        $adds[] = ['idx' => $idx, 'line' => $row['line'], 'name' => $name, 'attrs' => $attrs];
                        $pend[$name] = true;
                    } else {
                        $res['added']++;
                    }
                }
                if (count($sets) + count($adds) >= RouterOS::PIPE_CHUNK) {
                    $flush();
                }
            }
        } finally {
            $flush();   // also when the loop was cut short by an exception: whatever was queued still goes out
            Quota::release($quota, count($new) - $res['added']);   // rows that failed / were skipped / never ran give their units back
        }
        usort($errs, fn($x, $y) => $x[0] <=> $y[0]);
        foreach ($errs as $e) {
            $res['rowErrors'][] = $e[1];
        }
        file_put_contents(self::cacheFile($token, 'result'), json_encode($res), LOCK_EX);
        if (!$dry) {
            @unlink(self::cacheFile($token));   // passwords no longer need to sit in the cache (a dry run keeps them for the real run)
        }
        Audit::log($dry ? 'users.import.dry' : 'users.import', "{$j['file']}: +{$res['added']} ~{$res['updated']} skip {$res['skipped']} err {$res['errors']}");
        App::redirect('/import/result?t=' . $token);
    }

    public static function result(): void
    {
        $token = App::get('t');
        $j = self::load($token, 'result');
        if (!$j) {
            App::redirect('/import', t('Import session expired. Upload the file again.'), 'err');
        }
        App::render('import_result', ['title' => t('Import result'), 'page' => 'import', 'token' => $token, 'res' => $j]);
    }

    public static function errors(): void
    {
        $token = App::get('t');
        $head = [t('Line'), t('Name'), t('Error')];
        $body = '';
        if ($res = self::load($token, 'result')) {
            $list = $res['rowErrors'];
        } elseif ($j = self::load($token)) {
            $list = [];
            foreach ($j['rows'] as $r) {
                if ($r['st'] === 'error') {
                    $list[] = ['line' => $r['line'], 'name' => $r['d']['name'] ?? '', 'error' => implode('; ', $r['err'])];
                }
            }
        } else {
            App::redirect('/import', t('Import session expired. Upload the file again.'), 'err');
        }
        $body = self::csvLine($head, ',');
        foreach ($list as $e) {
            $body .= self::csvLine([$e['line'], self::out((string)$e['name']), $e['error']], ',');
        }
        self::send('import-errors-' . date('Ymd-His') . '.csv', $body);
    }
}
