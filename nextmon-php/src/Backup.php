<?php
/**
 * Workspace app-data backup / restore (format: docs/BACKUP-FORMAT.md; the Next.js edition reads and writes the same file).
 *
 * Export: routers (passwords blank, or still AES-encrypted on request), settings (+ voucher templates), shop config, resellers, wallets,
 * wallet ledger, reseller batches and shop orders of the ACTIVE workspace. File = JSON { format, version, edition, checksum, payload }
 * where payload is the data as a JSON *string* and checksum its SHA-256, so both editions verify the very same bytes.
 *
 * Restore: parse() validates everything and returns normalised data (nothing is written); apply() takes a safety backup of the
 * current data, replaces the selected collections and rolls back to that snapshot when anything fails. The workspace is always the
 * active one: the file carries no workspace id and every id inside it that could name a tenant is dropped or rewritten. Global
 * collections (users, sessions, workspaces, shares, api keys and their index, cron tokens) are never read from the file.
 */
final class Backup
{
    public const FORMAT = 'nextmon-backup';
    public const VERSION = 1;
    public const MAX_BYTES = 8388608;      // 8 MB per file (the Next.js edition's request pipeline buffers 10 MB)
    public const MAX_ROWS = 50000;         // per log collection (same as the store retention)
    public const MAX_ORDERS = 20000;
    public const MAX_ROUTERS = 200;
    private const MAX_DEPTH = 12;
    private const MAX_STR = 200000;
    private const PENDING_TTL = 900;
    private const KEEP_SAFETY = 10;

    /** id => kind. `orders` live in files (PHP) / documents (Next) but travel as one list. */
    public const COLLECTIONS = [
        'routers' => 'doc', 'settings' => 'doc', 'shop' => 'doc', 'resellers' => 'doc', 'wallets' => 'doc',
        'wallet_ledger' => 'log', 'reseller_batches' => 'log', 'orders' => 'orders',
    ];
    /** Keys that could name a tenant: dropped wherever they appear. */
    private const DROP_KEYS = ['workspace', 'workspace_id', 'ws', 'owner_ws', 'owner_workspace', '__ws'];
    private const REJECT_KEYS = ['__proto__', 'constructor', 'prototype'];
    private const SECRET_RE = '/^v1:[A-Za-z0-9+\/]{38,}={0,2}$/D';

    // ---- export -----------------------------------------------------------------------------------------

    /** The data of the active workspace. Only collections that exist are included. Logs are oldest first. */
    public static function snapshot(bool $stripSecrets): array
    {
        $d = ['docs' => [], 'logs' => [], 'orders' => []];
        foreach (self::COLLECTIONS as $c => $kind) {
            if ($kind === 'doc' && Store::has($c)) {
                $d['docs'][$c] = Store::read($c, []);
            } elseif ($kind === 'log' && Store::count($c) > 0) {
                $d['logs'][$c] = array_reverse(Store::rows($c, self::MAX_ROWS, 0));
            }
        }
        $o = array_reverse(Orders::all());   // all() is newest first
        if ($o) {
            $d['orders'] = $o;
        }
        return $stripSecrets ? self::strip($d) : $d;
    }

    private static function strip($v)
    {
        if (is_array($v)) {
            return array_map([self::class, 'strip'], $v);
        }
        return is_string($v) && preg_match(self::SECRET_RE, $v) ? '' : $v;
    }

    private static function json($v, int $flags = 0): string
    {
        $s = json_encode($v, $flags | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PRESERVE_ZERO_FRACTION);
        if ($s === false) {
            throw new BackupError(t('Could not encode the backup.'));
        }
        return $s;
    }

    /** The downloadable file. */
    public static function export(bool $secrets = false): string
    {
        return self::wrap(self::snapshot(!$secrets), $secrets);
    }

    /** Keep the file below the upload limit: drop the oldest log rows (the ledgers are retention-pruned anyway). Returns true when rows were dropped. */
    private static function fit(array &$data): bool
    {
        $cut = false;
        while (strlen(self::json($data)) > self::MAX_BYTES - 262144) {
            $best = null;
            foreach ($data['logs'] as $c => $rows) {
                if (count($rows) > 1 && ($best === null || count($rows) > count($data['logs'][$best]))) {
                    $best = $c;
                }
            }
            if ($best === null) {
                throw new BackupError(t('The data is too large for one backup file (max :n MB).', [':n' => self::MAX_BYTES / 1048576]));
            }
            $data['logs'][$best] = array_slice($data['logs'][$best], max(1, intdiv(count($data['logs'][$best]), 10)));
            $cut = true;
        }
        return $cut;
    }

    public static function wrap(array $data, bool $secrets): string
    {
        $truncated = self::fit($data);
        $payload = self::json($data);
        $counts = [];
        foreach ($data['docs'] as $c => $v) {
            $counts[$c] = is_array($v) ? count($v) : 1;
        }
        foreach ($data['logs'] as $c => $rows) {
            $counts[$c] = count($rows);
        }
        if ($data['orders']) {
            $counts['orders'] = count($data['orders']);
        }
        return self::json([
            'format' => self::FORMAT,
            'version' => self::VERSION,
            'edition' => 'php',
            'created' => gmdate('c'),
            'includes_secrets' => $secrets,
            'truncated' => $truncated,
            'counts' => $counts,
            'checksum' => ['algo' => 'sha256', 'value' => hash('sha256', $payload)],
            'payload' => $payload,
        ], JSON_PRETTY_PRINT);
    }

    // ---- validation -------------------------------------------------------------------------------------

    private static function bad(string $msg): BackupError
    {
        return new BackupError($msg);
    }

    /**
     * Validate an uploaded file. Nothing is written. Returns ['meta' => [...], 'data' => normalised, 'warnings' => string[], 'ignored' => string[]].
     * @throws BackupError
     */
    public static function parse(string $raw): array
    {
        if (strlen($raw) > self::MAX_BYTES) {
            throw self::bad(t('File is too large (max :n MB).', [':n' => self::MAX_BYTES / 1048576]));
        }
        if ($raw === '' || strpos($raw, "\0") !== false) {
            throw self::bad(t('This is not a NextMON backup file.'));
        }
        if (strncmp($raw, "\xEF\xBB\xBF", 3) === 0) {
            $raw = substr($raw, 3);
        }
        $f = json_decode($raw, true, 8);
        if (!is_array($f) || array_is_list($f) || ($f['format'] ?? null) !== self::FORMAT) {
            throw self::bad(t('This is not a NextMON backup file.'));
        }
        $ver = $f['version'] ?? null;
        if (!is_int($ver) || $ver < 1) {
            throw self::bad(t('This is not a NextMON backup file.'));
        }
        if ($ver > self::VERSION) {
            throw self::bad(t('This backup was made by a newer version (format :v). Update NextMON first.', [':v' => $ver]));
        }
        $edition = (string)($f['edition'] ?? '');
        if (!in_array($edition, ['php', 'next'], true)) {
            throw self::bad(t('This is not a NextMON backup file.'));
        }
        $cs = $f['checksum'] ?? null;
        $payload = $f['payload'] ?? null;
        if (!is_array($cs) || ($cs['algo'] ?? '') !== 'sha256' || !is_string($cs['value'] ?? null) || !preg_match('/^[a-f0-9]{64}$/D', $cs['value']) || !is_string($payload)) {
            throw self::bad(t('This is not a NextMON backup file.'));
        }
        if (!hash_equals($cs['value'], hash('sha256', $payload))) {
            throw self::bad(t('The checksum does not match: the file is damaged or was edited.'));
        }
        $p = json_decode($payload, true, self::MAX_DEPTH + 4);
        if (!is_array($p) || ($p && array_is_list($p))) {
            throw self::bad(t('The backup content is not valid.'));
        }
        $st = ['dropped' => 0, 'secrets' => 0, 'secrets_bad' => 0, 'plain_pass' => 0];
        $out = ['docs' => [], 'logs' => [], 'orders' => []];
        $ignored = [];
        foreach (['docs', 'logs'] as $sec) {
            $part = $p[$sec] ?? [];
            if (!is_array($part) || ($part && array_is_list($part))) {
                throw self::bad(t('The backup content is not valid.'));
            }
            foreach ($part as $name => $val) {
                $name = (string)$name;
                $kind = self::COLLECTIONS[$name] ?? null;
                if ($kind === null || $kind !== ($sec === 'docs' ? 'doc' : 'log')) {
                    $ignored[] = mb_substr(preg_replace('/[^A-Za-z0-9_.\-]/', '?', $name), 0, 40);   // users, sessions, workspaces, api keys... never imported
                    continue;
                }
                $out[$sec][$name] = $sec === 'docs' ? self::doc($name, $val, $st) : self::rows($name, $val, $st);
            }
        }
        foreach (array_keys($p) as $k) {
            if (!in_array($k, ['docs', 'logs', 'orders'], true)) {
                $ignored[] = mb_substr(preg_replace('/[^A-Za-z0-9_.\-]/', '?', (string)$k), 0, 40);
            }
        }
        if (isset($p['orders'])) {
            $out['orders'] = self::orders($p['orders'], $st);
        }
        if (!$out['docs'] && !$out['logs'] && !$out['orders']) {
            throw self::bad(t('The backup does not contain any data NextMON can restore.'));
        }
        $w = [];
        if ($st['dropped']) {
            $w[] = t(':n workspace references in the file were ignored.', [':n' => $st['dropped']]);
        }
        if ($st['secrets_bad']) {
            $w[] = t(':n secrets could not be decrypted with this installation\'s key and were left empty.', [':n' => $st['secrets_bad']]);
        }
        if (!empty($f['truncated'])) {
            $w[] = t('The file is incomplete: the oldest log rows were left out to keep it small.');
        }
        if ($st['plain_pass']) {
            $w[] = t(':n plain-text router passwords were ignored.', [':n' => $st['plain_pass']]);
        }
        return [
            'meta' => ['edition' => $edition, 'version' => $ver, 'created' => mb_substr((string)($f['created'] ?? ''), 0, 40), 'secrets' => !empty($f['includes_secrets'])],
            'data' => $out, 'warnings' => $w, 'ignored' => array_values(array_unique($ignored)),
        ];
    }

    /** Recursively validate / normalise JSON data: depth, sizes, tenant keys, secrets. */
    private static function clean($v, int $depth, array &$st)
    {
        if ($depth > self::MAX_DEPTH) {
            throw self::bad(t('The backup content is not valid.'));
        }
        if (is_array($v)) {
            $list = array_is_list($v);
            $o = [];
            foreach ($v as $k => $x) {
                if (!$list) {
                    $k = (string)$k;
                    $lk = strtolower($k);
                    if (in_array($lk, self::REJECT_KEYS, true)) {
                        throw self::bad(t('The backup content is not valid.'));
                    }
                    if (in_array($lk, self::DROP_KEYS, true)) {
                        $st['dropped']++;
                        continue;
                    }
                    if ($k === '' || strlen($k) > 100 || preg_match('/[\x00-\x1F]/', $k)) {
                        throw self::bad(t('The backup content is not valid.'));
                    }
                    $o[$k] = self::clean($x, $depth + 1, $st);
                } else {
                    $o[] = self::clean($x, $depth + 1, $st);
                }
            }
            return $o;
        }
        if (is_string($v)) {
            if (strlen($v) > self::MAX_STR || strpos($v, "\0") !== false) {
                throw self::bad(t('The backup content is not valid.'));
            }
            if (preg_match(self::SECRET_RE, $v)) {
                if (Crypto::decrypt($v) === '') {
                    $st['secrets_bad']++;
                    return '';
                }
                $st['secrets']++;
            }
            return $v;
        }
        if (is_bool($v) || is_int($v) || is_float($v) || $v === null) {
            return $v;
        }
        throw self::bad(t('The backup content is not valid.'));
    }

    private static function map($v, string $c): array
    {
        if (!is_array($v) || ($v && array_is_list($v))) {
            throw self::bad(t('Invalid data in ":c".', [':c' => $c]));
        }
        return $v;
    }

    private static function doc(string $c, $v, array &$st): array
    {
        switch ($c) {
            case 'routers':
                return self::routers($v, $st);
            case 'settings':
                return self::settings(self::clean(self::map($v, $c), 0, $st), $st);
            case 'wallets':
                $o = [];
                foreach (self::map($v, $c) as $k => $n) {
                    $k = (string)$k;
                    if (!preg_match('/^[A-Za-z0-9_.@\-]{1,64}$/D', $k) || !(is_int($n) || (is_float($n) && $n == floor($n))) || abs($n) > 1e12) {
                        throw self::bad(t('Invalid data in ":c".', [':c' => $c]));
                    }
                    $o[$k] = (int)$n;
                }
                return $o;
            case 'resellers':
                $o = [];
                foreach (self::map($v, $c) as $k => $cfg) {
                    $k = (string)$k;
                    if (!preg_match('/^[A-Za-z0-9_.@\-]{1,64}$/D', $k) || !is_array($cfg)) {
                        throw self::bad(t('Invalid data in ":c".', [':c' => $c]));
                    }
                    $o[$k] = self::clean($cfg, 1, $st);
                }
                return $o;
            default:   // shop
                return self::clean(self::map($v, $c), 0, $st);
        }
    }

    private static function routers($v, array &$st): array
    {
        if (!is_array($v) || ($v && !array_is_list($v)) || count($v) > self::MAX_ROUTERS) {
            throw self::bad(t('Invalid data in ":c".', [':c' => 'routers']));
        }
        $out = [];
        $seen = [];
        foreach ($v as $i => $r) {
            if (!is_array($r)) {
                throw self::bad(t('Router #:n is invalid.', [':n' => $i + 1]));
            }
            $id = (string)($r['id'] ?? '');
            if (!preg_match('/^[A-Za-z0-9_\-]{1,32}$/D', $id) || isset($seen[$id])) {
                throw self::bad(t('Router #:n is invalid.', [':n' => $i + 1]));
            }
            $seen[$id] = true;
            $type = ($r['type'] ?? '') === 'demo' ? 'demo' : 'real';
            $name = trim(mb_substr(preg_replace('/[\x00-\x1F]/', '', (string)($r['name'] ?? '')), 0, 40));
            $host = trim((string)($r['host'] ?? ''));
            if ($name === '' || !preg_match('/^[A-Za-z0-9.\-:]{0,253}$/D', $host) || ($type === 'real' && $host === '')) {
                throw self::bad(t('Router #:n is invalid.', [':n' => $i + 1]));
            }
            $port = (int)($r['port'] ?? 8728);
            $ssl = !empty($r['ssl']);
            if ($port < 1 || $port > 65535) {
                $port = $ssl ? 8729 : 8728;
            }
            $pass = (string)($r['pass'] ?? '');
            if ($pass !== '') {
                if (!preg_match(self::SECRET_RE, $pass)) {
                    $st['plain_pass']++;
                    $pass = '';
                } elseif (Crypto::decrypt($pass) === '') {
                    $st['secrets_bad']++;
                    $pass = '';
                } else {
                    $st['secrets']++;
                }
            }
            $session = strtolower(preg_replace('/[^A-Za-z0-9_\-]/', '', (string)($r['session'] ?? $name))) ?: 'router';
            $out[] = [
                'id' => $id, 'name' => $name, 'session' => substr($session, 0, 40), 'type' => $type, 'host' => $host, 'port' => $port,
                'ssl' => $ssl, 'verify_tls' => $ssl && !empty($r['verify_tls']),
                'user' => mb_substr(preg_replace('/[\x00-\x1F]/', '', (string)($r['user'] ?? '')), 0, 64),
                'pass' => $pass,
                'hotspot_name' => mb_substr(preg_replace('/[\x00-\x1F]/', '', (string)($r['hotspot_name'] ?? '')), 0, 60),
            ];
        }
        return $out;
    }

    private static function settings(array $s, array &$st): array
    {
        if (isset($s['lang']) && !in_array($s['lang'], ['id', 'en'], true)) {
            unset($s['lang']);
        }
        if (isset($s['timezone']) && (!is_string($s['timezone']) || !in_array($s['timezone'], DateTimeZone::listIdentifiers(), true))) {
            unset($s['timezone']);
        }
        if (isset($s['currency'])) {
            $s['currency'] = mb_substr((string)$s['currency'], 0, 6);
        }
        if (isset($s['max_qty'])) {
            $s['max_qty'] = max(1, min(2000, (int)$s['max_qty']));
        }
        if (array_key_exists('templates', $s)) {
            $t = $s['templates'];
            if (!is_array($t) || ($t && !array_is_list($t)) || count($t) > 100) {
                throw self::bad(t('Invalid data in ":c".', [':c' => 'templates']));
            }
            $list = [];
            foreach ($t as $x) {
                $id = is_array($x) ? (string)($x['id'] ?? '') : '';
                $name = is_array($x) ? mb_substr(trim((string)($x['name'] ?? '')), 0, 40) : '';
                if (!preg_match('/^[A-Za-z0-9_\-]{1,32}$/D', $id) || $name === '') {
                    throw self::bad(t('Invalid data in ":c".', [':c' => 'templates']));
                }
                // user HTML only ever re-enters through the allow-list sanitiser
                $list[] = ['id' => $id, 'name' => $name, 'html' => Sanitize::templateHtml(mb_substr((string)($x['html'] ?? ''), 0, 60000)),
                    'w' => max(20.0, min(300.0, (float)($x['w'] ?? 70))), 'h' => max(10.0, min(300.0, (float)($x['h'] ?? 40)))];
            }
            $s['templates'] = $list;
        }
        return $s;
    }

    private static function rows(string $c, $v, array &$st): array
    {
        if (!is_array($v) || ($v && !array_is_list($v)) || count($v) > self::MAX_ROWS) {
            throw self::bad(t('Invalid data in ":c".', [':c' => $c]));
        }
        $out = [];
        foreach ($v as $r) {
            if (!is_array($r) || ($r && array_is_list($r))) {
                throw self::bad(t('Invalid data in ":c".', [':c' => $c]));
            }
            $r = self::clean($r, 1, $st);
            if (strlen(self::json($r)) > 20000) {
                throw self::bad(t('Invalid data in ":c".', [':c' => $c]));
            }
            $out[] = $r;
        }
        return $out;
    }

    private static function orders($v, array &$st): array
    {
        if (!is_array($v) || ($v && !array_is_list($v)) || count($v) > self::MAX_ORDERS) {
            throw self::bad(t('Invalid data in ":c".', [':c' => 'orders']));
        }
        $out = [];
        $seen = [];
        foreach ($v as $o) {
            $id = is_array($o) ? (string)($o['id'] ?? '') : '';
            if (!preg_match('/^KL\d{6}-[A-F0-9]{6}(-[A-F0-9]{8})?$/D', $id) || isset($seen[substr($id, 0, 15)])) {
                throw self::bad(t('Invalid data in ":c".', [':c' => 'orders']));
            }
            $seen[substr($id, 0, 15)] = true;
            if (!in_array($o['status'] ?? '', Orders::STATES, true) || !is_string($o['token'] ?? null) || !preg_match('/^[A-Za-z0-9]{8,64}$/D', $o['token'])
                || !is_numeric($o['amount'] ?? null) || !is_array($o['package'] ?? null) || !is_int($o['created'] ?? null)) {
                throw self::bad(t('Invalid data in ":c".', [':c' => 'orders']));
            }
            $o['id'] = substr($id, 0, 15);   // the workspace part of an id is never trusted: apply re-binds it to the active workspace
            $out[] = self::clean($o, 1, $st);
        }
        return $out;
    }

    // ---- preview ----------------------------------------------------------------------------------------

    /** @return array<int,array{id:string,current:int,incoming:int}> one row per collection present in the file */
    public static function plan(array $data): array
    {
        $rows = [];
        foreach (self::COLLECTIONS as $c => $kind) {
            if ($kind === 'doc' && isset($data['docs'][$c])) {
                $cur = Store::has($c) ? self::size(Store::read($c, [])) : 0;
                $rows[] = ['id' => $c, 'current' => $cur, 'incoming' => self::size($data['docs'][$c])];
            } elseif ($kind === 'log' && isset($data['logs'][$c])) {
                $rows[] = ['id' => $c, 'current' => Store::count($c), 'incoming' => count($data['logs'][$c])];
            } elseif ($kind === 'orders' && $data['orders']) {
                $rows[] = ['id' => 'orders', 'current' => count(glob(Orders::dir() . '/KL*.json') ?: []), 'incoming' => count($data['orders'])]; // tenant-ok: per-workspace directory (Workspace::dir)
            }
        }
        return $rows;
    }

    private static function size($v): int
    {
        return is_array($v) ? count($v) : 1;
    }

    /** Warnings that depend on the active workspace (router limit). Throws when the file cannot be restored here. */
    public static function check(array $data, array $sel): void
    {
        if (in_array('routers', $sel, true) && isset($data['docs']['routers'])) {
            $lim = (int)(Workspace::limits()['routers'] ?? 0);
            if ($lim > 0 && count($data['docs']['routers']) > $lim) {
                throw self::bad(t('Router limit reached for this account (:n).', [':n' => $lim]));
            }
        }
    }

    // ---- apply ------------------------------------------------------------------------------------------

    /** Collections of $data that can be selected. */
    public static function available(array $data): array
    {
        return array_column(self::plan($data), 'id');
    }

    /**
     * Replace the selected collections of the active workspace. All or nothing: a snapshot of the current data is written to
     * data/ws/<id>/backups/pre-restore-*.json first and put back if anything throws.
     * @return array{safety:string,applied:string[]}
     */
    public static function apply(array $data, array $sel): array
    {
        $sel = array_values(array_intersect(self::available($data), $sel));
        if (!$sel) {
            throw self::bad(t('Select at least one item to restore.'));
        }
        self::check($data, $sel);
        $dir = Workspace::dir('backups');
        $lock = @fopen($dir . '/.restore.lock', 'c'); // tenant-ok: per-workspace directory (Workspace::dir)
        if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
            throw self::bad(t('Another restore is running. Try again in a minute.'));
        }
        try {
            $snap = self::snapshot(false);
            $safety = self::writeSafety($snap, $dir);
            $oldRouters = (array)Store::read('routers', []);
            try {
                self::write($data, $sel, true);
            } catch (Throwable $e) {
                try {
                    self::write($snap, $sel, false);
                } catch (Throwable $e2) {
                    error_log('[nextmon] restore rollback failed: ' . $e2->getMessage());
                    throw new BackupError(t('Restore failed and the automatic rollback failed too. Your previous data is saved in :f', [':f' => $safety]));
                }
                error_log('[nextmon] restore failed, rolled back: ' . $e->getMessage());
                throw new BackupError(t('Restore failed: nothing was changed.'));
            }
            self::afterRouters($sel, $oldRouters);
            return ['safety' => $safety, 'applied' => $sel];
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }

    /** Write collections. $data may lack a collection (snapshot of an absent doc): then it is deleted. */
    private static function write(array $data, array $sel, bool $restore): void
    {
        foreach ($sel as $c) {
            $kind = self::COLLECTIONS[$c];
            if ($kind === 'doc') {
                if (!isset($data['docs'][$c])) {
                    Store::delete($c);
                    continue;
                }
                $v = $data['docs'][$c];
                if ($c === 'routers' && $restore) {
                    $cur = [];
                    foreach ((array)Store::read('routers', []) as $r) {
                        $cur[$r['id'] ?? ''] = (string)($r['pass'] ?? '');
                    }
                    foreach ($v as &$r) {   // blank password in the file = keep the stored one of the same router (same rule as the router form)
                        if ($r['pass'] === '' && ($cur[$r['id']] ?? '') !== '') {
                            $r['pass'] = $cur[$r['id']];
                        }
                    }
                    unset($r);
                }
                Store::write($c, $v);
            } elseif ($kind === 'log') {
                Store::prune($c, 0);
                foreach ($data['logs'][$c] ?? [] as $row) {
                    Store::append($c, $row);
                }
            } else {
                self::writeOrders($data['orders'] ?? []);
            }
            if ($restore && self::$afterWrite !== null) {
                (self::$afterWrite)($c);
            }
        }
    }

    /** Test hook: called after each collection of a restore was written (not during rollback). */
    public static ?\Closure $afterWrite = null;

    private static function writeOrders(array $orders): void
    {
        $dir = Orders::dir();
        $ws = Workspace::id();
        $suffix = $ws === 'main' ? '' : '-' . strtoupper(substr($ws, 2));
        $new = [];
        foreach ($orders as $o) {
            $id = substr((string)$o['id'], 0, 15) . $suffix;   // the id carries its workspace: always the active one
            $o['id'] = $id;
            $new[$id] = $o;
        }
        foreach (glob($dir . '/KL*.json') ?: [] as $f) { // tenant-ok: per-workspace directory (Workspace::dir)
            if (!@unlink($f)) { // tenant-ok: per-workspace directory (Workspace::dir)
                throw new RuntimeException('cannot remove ' . basename($f));
            }
        }
        foreach ($new as $id => $o) {
            $f = $dir . '/' . $id . '.json';
            $tmp = $f . '.' . bin2hex(random_bytes(4)) . '.tmp';
            if (file_put_contents($tmp, self::json($o, JSON_PRETTY_PRINT)) === false || !@rename($tmp, $f)) { // tenant-ok: per-workspace directory (Workspace::dir)
                @unlink($tmp); // tenant-ok: per-workspace directory (Workspace::dir)
                throw new RuntimeException('cannot write order');
            }
        }
    }

    /** Derived state after the router list changed: shares of removed routers, session index, caches. Never fails the restore. */
    private static function afterRouters(array $sel, array $old): void
    {
        if (!in_array('routers', $sel, true)) {
            return;
        }
        try {
            $now = array_column((array)Store::read('routers', []), 'id');
            foreach ($old as $r) {
                if (!in_array($r['id'] ?? '', $now, true)) {
                    Share::dropRouter((string)$r['id']);
                }
            }
            foreach (array_merge(array_column($old, 'id'), $now) as $id) {
                CachedDriver::flush((string)$id);
            }
            Workspace::reindexSessions();
            App::forgetDrivers();
        } catch (Throwable $e) {
            error_log('[nextmon] restore: post-processing failed: ' . $e->getMessage());
        }
    }

    // ---- safety backups ---------------------------------------------------------------------------------

    private static function writeSafety(array $snap, string $dir): string
    {
        $name = 'pre-restore-' . date('Ymd-His') . '-' . bin2hex(random_bytes(2)) . '.json';
        $f = $dir . '/' . $name;
        if (file_put_contents($f, self::wrap($snap, true), LOCK_EX) === false) { // tenant-ok: per-workspace directory (Workspace::dir)
            throw self::bad(t('Could not write the safety backup. Nothing was changed.'));
        }
        @chmod($f, 0600);
        $all = self::safetyFiles();
        foreach (array_slice($all, self::KEEP_SAFETY) as $old) {
            @unlink($dir . '/' . $old['name']); // tenant-ok: per-workspace directory (Workspace::dir)
        }
        return $name;
    }

    /** @return array<int,array{name:string,size:int,time:int}> newest first */
    public static function safetyFiles(): array
    {
        $out = [];
        foreach (glob(Workspace::dir('backups') . '/pre-restore-*.json') ?: [] as $f) { // tenant-ok: per-workspace directory (Workspace::dir)
            if (self::safetyName(basename($f))) {
                $out[] = ['name' => basename($f), 'size' => (int)filesize($f), 'time' => (int)filemtime($f)]; // tenant-ok: per-workspace directory (Workspace::dir)
            }
        }
        usort($out, fn($a, $b) => $b['time'] <=> $a['time'] ?: strcmp($b['name'], $a['name']));
        return $out;
    }

    public static function safetyName(string $n): bool
    {
        return (bool)preg_match('/^pre-restore-\d{8}-\d{6}-[a-f0-9]{4}\.json$/D', $n);
    }

    /** Path of a safety backup of the ACTIVE workspace, or null. The name is matched against a strict pattern: no traversal. */
    public static function safetyPath(string $name): ?string
    {
        if (!self::safetyName($name)) {
            return null;
        }
        $f = Workspace::dir('backups') . '/' . $name;
        return is_file($f) ? $f : null; // tenant-ok: per-workspace directory (Workspace::dir)
    }

    // ---- pending preview (between "check file" and "restore") --------------------------------------------

    public static function stash(array $parsed, string $fileName, string $uid): string
    {
        $dir = Workspace::dir('backups');
        $token = bin2hex(random_bytes(16));
        $meta = ['token' => $token, 'uid' => $uid, 'ts' => time(), 'file' => mb_substr(preg_replace('/[^\w. \-]/u', '_', $fileName), 0, 80),
            'meta' => $parsed['meta'], 'warnings' => $parsed['warnings'], 'ignored' => $parsed['ignored'], 'plan' => self::plan($parsed['data'])];
        file_put_contents($dir . '/pending.data.json', self::json($parsed['data']), LOCK_EX); // tenant-ok: per-workspace directory (Workspace::dir)
        file_put_contents($dir . '/pending.json', self::json($meta), LOCK_EX); // tenant-ok: per-workspace directory (Workspace::dir)
        @chmod($dir . '/pending.data.json', 0600);
        return $token;
    }

    /** The pending preview of the active workspace for this user, or null (expired / other user / none). */
    public static function pending(string $uid): ?array
    {
        $f = Workspace::dir('backups') . '/pending.json';
        $m = is_file($f) ? json_decode((string)file_get_contents($f), true) : null; // tenant-ok: per-workspace directory (Workspace::dir)
        if (!is_array($m) || ($m['uid'] ?? '') !== $uid || time() - (int)($m['ts'] ?? 0) > self::PENDING_TTL) {
            if (is_array($m) && time() - (int)($m['ts'] ?? 0) > self::PENDING_TTL) {
                self::discard();
            }
            return null;
        }
        return $m;
    }

    /** Data of the pending preview when $token matches. */
    public static function pendingData(string $uid, string $token): ?array
    {
        $m = self::pending($uid);
        if (!$m || $token === '' || !hash_equals((string)$m['token'], $token)) {
            return null;
        }
        $d = json_decode((string)@file_get_contents(Workspace::dir('backups') . '/pending.data.json'), true); // tenant-ok: per-workspace directory (Workspace::dir)
        return is_array($d) && isset($d['docs'], $d['logs'], $d['orders']) ? $d : null;
    }

    public static function discard(): void
    {
        $dir = Workspace::dir('backups');
        @unlink($dir . '/pending.json'); // tenant-ok: per-workspace directory (Workspace::dir)
        @unlink($dir . '/pending.data.json'); // tenant-ok: per-workspace directory (Workspace::dir)
    }
}
