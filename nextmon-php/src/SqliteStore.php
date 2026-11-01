<?php
/**
 * SQLite storage backend (PDO, WAL, prepared statements, versioned migrations).
 *
 *   docs(name PK, value JSON text, updated)           small documents (settings, users, routers, ...)
 *   logs(id AUTOINCREMENT, channel, ts, data JSON)    append-heavy collections (audit, notify, ledgers, sales)
 *   meta(k PK, v)                                     schema_version, json_imported, ...
 */
final class SqliteStore
{
    /** Keep at most this many rows per log channel (checked on ~1/200 appends). */
    public const LOG_KEEP = 50000;

    private ?PDO $pdo = null;
    private string $dir;
    private string $file;
    private int $depth = 0;
    /** @var array<string,PDOStatement> prepared statements, reused within the request */
    private array $stmts = [];

    /** Ordered schema migrations: version => list of SQL statements. Append new entries, never edit old ones. */
    public const MIGRATIONS = [
        1 => [
            'CREATE TABLE IF NOT EXISTS docs (name TEXT PRIMARY KEY, value TEXT NOT NULL, updated INTEGER NOT NULL)',
            'CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, channel TEXT NOT NULL, ts INTEGER NOT NULL, data TEXT NOT NULL)',
            'CREATE INDEX IF NOT EXISTS logs_channel_id ON logs (channel, id)',
        ],
        2 => [
            'CREATE INDEX IF NOT EXISTS logs_channel_ts ON logs (channel, ts)',
        ],
        // rows($channel, ..., ['key' => v]) filters on CAST(json_extract(data, '$.key') AS TEXT): expression indexes with the exact same
        // expression turn those from a scan of the whole channel into an index lookup (audit by action, ledger by ref / id)
        3 => [
            "CREATE INDEX IF NOT EXISTS logs_x_action ON logs (channel, CAST(json_extract(data, '$.action') AS TEXT), id)",
            "CREATE INDEX IF NOT EXISTS logs_x_ref ON logs (channel, CAST(json_extract(data, '$.ref') AS TEXT), id)",
            "CREATE INDEX IF NOT EXISTS logs_x_id ON logs (channel, CAST(json_extract(data, '$.id') AS TEXT))",
        ],
    ];

    public static function available(): bool
    {
        return extension_loaded('pdo_sqlite') && in_array('sqlite', PDO::getAvailableDrivers(), true);
    }

    public function __construct(string $dir, bool $autoImport = true)
    {
        $this->dir = rtrim($dir, '/');
        $this->file = $this->dir . '/nextmon.db';
        $this->open();
        $this->migrateSchema();
        if ($autoImport) {
            try {
                $this->importJson();
            } catch (Throwable $e) {
                // never lose data nor block the app: JSON files stay untouched, import retries next time
                error_log('[nextmon] JSON import failed: ' . $e->getMessage());
            }
        }
    }

    public function close(): void
    {
        $this->stmts = [];
        $this->pdo = null;
    }

    public function file(): string
    {
        return $this->file;
    }

    private function open(): void
    {
        $this->pdo = new PDO('sqlite:' . $this->file, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_TIMEOUT => 10,
        ]);
        $this->pdo->exec('PRAGMA busy_timeout = 10000');
        $this->pdo->exec('PRAGMA journal_mode = WAL');
        $this->pdo->exec('PRAGMA synchronous = NORMAL');   // WAL + NORMAL: durable across app crashes, one fsync less per commit
        $this->pdo->exec('PRAGMA foreign_keys = ON');
        $this->pdo->exec('PRAGMA cache_size = -8000');      // 8 MB page cache (default 2 MB)
        $this->pdo->exec('PRAGMA temp_store = MEMORY');
        $this->pdo->exec('PRAGMA wal_autocheckpoint = 2000');
    }

    // ---- schema versioning ---------------------------------------------------------------

    public function schemaVersion(): int
    {
        try {
            $r = $this->pdo->query("SELECT v FROM meta WHERE k='schema_version'")->fetchColumn();
            return $r === false ? 0 : (int)$r;
        } catch (PDOException $e) {
            return 0;
        }
    }

    private function migrateSchema(): void
    {
        $latest = max(array_keys(self::MIGRATIONS));
        if ($this->schemaVersion() >= $latest) {
            return;
        }
        $this->pdo->exec('BEGIN IMMEDIATE');
        try {
            $this->pdo->exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
            $cur = $this->schemaVersion();
            foreach (self::MIGRATIONS as $ver => $sqls) {
                if ($ver <= $cur) {
                    continue;
                }
                foreach ($sqls as $sql) {
                    $this->pdo->exec($sql);
                }
                $this->setMeta('schema_version', (string)$ver);
            }
            $this->pdo->exec('COMMIT');
        } catch (Throwable $e) {
            $this->pdo->exec('ROLLBACK');
            throw $e;
        }
    }

    public function getMeta(string $k): ?string
    {
        $st = $this->pdo->prepare('SELECT v FROM meta WHERE k=?');
        $st->execute([$k]);
        $v = $st->fetchColumn();
        return $v === false ? null : (string)$v;
    }

    private function setMeta(string $k, string $v): void
    {
        $this->pdo->prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v')->execute([$k, $v]);
    }

    // ---- documents ---------------------------------------------------------------------

    private static function enc($data): string
    {
        return json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PRESERVE_ZERO_FRACTION);
    }

    private function st(string $sql): PDOStatement
    {
        return $this->stmts[$sql] ??= $this->pdo->prepare($sql);
    }

    public function read(string $name, $default)
    {
        $st = $this->st('SELECT value FROM docs WHERE name=?');
        $st->execute([$name]);
        $v = $st->fetchColumn();
        $st->closeCursor();
        if ($v === false) {
            return $default;
        }
        $j = json_decode((string)$v, true);
        return $j === null ? $default : $j;
    }

    private function put(string $name, $data): void
    {
        $this->st('INSERT INTO docs (name, value, updated) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET value=excluded.value, updated=excluded.updated')
            ->execute([$name, self::enc($data), time()]);
    }

    public function write(string $name, $data): void
    {
        $this->put($name, $data);
    }

    /** Atomic read-modify-write: BEGIN IMMEDIATE takes the write lock, so concurrent updaters serialize (also across processes). */
    public function update(string $name, callable $fn, $default)
    {
        if ($this->depth > 0) { // nested call inside another update(): already in the transaction
            $new = $fn($this->read($name, $default));
            $this->put($name, $new);
            return $new;
        }
        $this->pdo->exec('BEGIN IMMEDIATE');
        $this->depth++;
        try {
            $new = $fn($this->read($name, $default));
            $this->put($name, $new);
            $this->pdo->exec('COMMIT');
            return $new;
        } catch (Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->exec('ROLLBACK');
            }
            throw $e;
        } finally {
            $this->depth--;
        }
    }

    public function has(string $name): bool
    {
        $st = $this->pdo->prepare('SELECT 1 FROM docs WHERE name=?');
        $st->execute([$name]);
        return $st->fetchColumn() !== false;
    }

    public function delete(string $name): void
    {
        $this->pdo->prepare('DELETE FROM docs WHERE name=?')->execute([$name]);
    }

    public function names(): array
    {
        return array_map('strval', $this->pdo->query('SELECT name FROM docs ORDER BY name')->fetchAll(PDO::FETCH_COLUMN));
    }

    // ---- logs ----------------------------------------------------------------------------

    public function append(string $channel, array $row): void
    {
        $this->st('INSERT INTO logs (channel, ts, data) VALUES (?, ?, ?)')
            ->execute([$channel, (int)($row['ts'] ?? time()), self::enc($row)]);
        if (random_int(1, 200) === 1) {
            $this->prune($channel, self::LOG_KEEP);
        }
    }

    public function tail(string $channel, int $n): array
    {
        return $this->rows($channel, $n, 0, []);
    }

    public function rows(string $channel, int $limit, int $offset, array $where): array
    {
        $sql = 'SELECT data FROM logs WHERE channel=?';
        $args = [$channel];
        foreach ($where as $k => $v) {
            if (!preg_match('/^[A-Za-z0-9_]+$/', (string)$k)) {
                continue;
            }
            $sql .= " AND CAST(json_extract(data, '$." . $k . "') AS TEXT) = ?";
            $args[] = is_bool($v) ? ($v ? '1' : '0') : (string)$v;
        }
        $sql .= ' ORDER BY id DESC LIMIT ' . max(0, $limit) . ' OFFSET ' . max(0, $offset);
        $st = $this->pdo->prepare($sql);
        $st->execute($args);
        $out = [];
        foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $d) {
            $j = json_decode((string)$d, true);
            if (is_array($j)) {
                $out[] = $j;
            }
        }
        return $out;
    }

    public function count(string $channel): int
    {
        $st = $this->pdo->prepare('SELECT COUNT(*) FROM logs WHERE channel=?');
        $st->execute([$channel]);
        return (int)$st->fetchColumn();
    }

    public function prune(string $channel, int $keep): int
    {
        $st = $this->pdo->prepare('DELETE FROM logs WHERE channel=? AND id <= (SELECT id FROM logs WHERE channel=? ORDER BY id DESC LIMIT 1 OFFSET ?)');
        $st->execute([$channel, $channel, max(0, $keep)]);
        return $st->rowCount();
    }

    // ---- multi-tenant support (Store namespacing, TenantMigration) -------------------------------------

    /** Remove every document and log row whose key starts with "ws/<id>/". */
    public function purge(string $prefix): void
    {
        if (!preg_match('#^ws/(main|w_[a-f0-9]{8})/$#', $prefix)) {
            throw new InvalidArgumentException('bad purge prefix');
        }
        $len = strlen($prefix);
        $this->pdo->prepare('DELETE FROM docs WHERE substr(name, 1, ?) = ?')->execute([$len, $prefix]);
        $this->pdo->prepare('DELETE FROM logs WHERE substr(channel, 1, ?) = ?')->execute([$len, $prefix]);
    }

    private function legacyDocNames(array $globals): array
    {
        $o = [];
        foreach ($this->pdo->query("SELECT name FROM docs WHERE name NOT LIKE 'ws/%'")->fetchAll(PDO::FETCH_COLUMN) as $n) {
            if (!in_array($n, $globals, true)) {
                $o[] = (string)$n;
            }
        }
        return $o;
    }

    private function legacyChannels(array $globals): array
    {
        $o = [];
        foreach ($this->pdo->query("SELECT DISTINCT channel FROM logs WHERE channel NOT LIKE 'ws/%'")->fetchAll(PDO::FETCH_COLUMN) as $n) {
            if (!in_array($n, $globals, true)) {
                $o[] = (string)$n;
            }
        }
        return $o;
    }

    public function hasLegacy(array $globals): bool
    {
        return $this->legacyDocNames($globals) !== [] || $this->legacyChannels($globals) !== [];
    }

    /** Copy the database file (after a WAL checkpoint) into $dest. Returns number of files copied. */
    public function backupAll(string $dest): int
    {
        $this->pdo->exec('PRAGMA wal_checkpoint(TRUNCATE)');
        if (!@copy($this->file, $dest . '/nextmon.db')) {
            throw new RuntimeException('Backup copy failed for ' . $this->file);
        }
        return 1;
    }

    /** Move legacy documents / log channels under "ws/<id>/" in one transaction. @return array [docs, logs] */
    public function migrateLegacy(array $globals, string $wsId): array
    {
        $pre = 'ws/' . $wsId . '/';
        $nd = $nl = 0;
        $this->pdo->exec('BEGIN IMMEDIATE');
        try {
            foreach ($this->legacyDocNames($globals) as $n) {
                if ($this->has($pre . $n)) {   // interrupted earlier run: the namespaced copy wins
                    $this->pdo->prepare('DELETE FROM docs WHERE name=?')->execute([$n]);
                } else {
                    $this->pdo->prepare('UPDATE docs SET name=? WHERE name=?')->execute([$pre . $n, $n]);
                    $nd++;
                }
            }
            foreach ($this->legacyChannels($globals) as $c) {
                $st = $this->pdo->prepare('UPDATE logs SET channel=? WHERE channel=?');
                $st->execute([$pre . $c, $c]);
                $nl += $st->rowCount();
            }
            $this->pdo->exec('COMMIT');
        } catch (Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->exec('ROLLBACK');
            }
            throw $e;
        }
        return ['docs' => $nd, 'logs' => $nl];
    }

    // ---- JSON -> SQLite one-time import --------------------------------------------------

    /** @return string[] document files in data/ eligible for import (name => path) */
    private function jsonDocs(): array
    {
        $o = [];
        foreach (glob($this->dir . '/*.json') ?: [] as $f) {
            $b = basename($f, '.json');
            if ($b === '' || $b[0] === '.' || strncmp($b, 'demo-', 5) === 0) {
                continue;
            }
            $o[$b] = $f;
        }
        return $o;
    }

    private function jsonLogs(): array
    {
        $o = [];
        foreach (glob($this->dir . '/*.log') ?: [] as $f) {
            $o[basename($f)] = $f;
        }
        return $o;
    }

    /**
     * Import data/*.json documents and data/*.log jsonl files. Safe to run repeatedly:
     * the done-flag is checked inside the write transaction, documents already in SQLite are never overwritten
     * (unless $force), and the originals are only copied (to data/backup-json-<stamp>/), never deleted.
     * @return array report: docs, logs, skipped, backup (dir or '')
     */
    public function importJson(bool $force = false): array
    {
        $rep = ['docs' => 0, 'logs' => 0, 'skipped' => 0, 'backup' => '', 'already' => false];
        if (!$force && $this->getMeta('json_imported') !== null) {
            $rep['already'] = true;
            return $rep;
        }
        $docs = $this->jsonDocs();
        $logs = $this->jsonLogs();
        if (!$docs && !$logs) {
            $this->setMeta('json_imported', (string)time());
            return $rep;
        }
        // 1) backup first
        $bk = $this->dir . '/backup-json-' . date('Ymd-His') . '-' . bin2hex(random_bytes(2));
        if (!@mkdir($bk, 0775, true) && !is_dir($bk)) {
            throw new RuntimeException('Cannot create backup dir ' . $bk);
        }
        foreach (array_merge(array_values($docs), array_values($logs), glob($this->dir . '/*.log.1') ?: []) as $f) {
            if (!@copy($f, $bk . '/' . basename($f))) {
                throw new RuntimeException('Backup copy failed for ' . $f);
            }
        }
        $rep['backup'] = $bk;

        // 2) import in one transaction; any failure rolls everything back and leaves the JSON files in charge
        $this->pdo->exec('BEGIN IMMEDIATE');
        try {
            if (!$force && $this->getMeta('json_imported') !== null) { // another process won the race
                $this->pdo->exec('COMMIT');
                $rep['already'] = true;
                return $rep;
            }
            foreach ($docs as $name => $f) {
                $j = json_decode((string)file_get_contents($f), true);
                if ($j === null) {
                    $rep['skipped']++;
                    continue;
                }
                if (!$force && $this->has($name)) {
                    $rep['skipped']++;
                    continue;
                }
                $this->put($name, $j);
                $rep['docs']++;
            }
            $ins = $this->pdo->prepare('INSERT INTO logs (channel, ts, data) VALUES (?, ?, ?)');
            foreach ($logs as $ch => $f) {
                if ($this->count($ch) > 0 && !$force) {
                    $rep['skipped']++;
                    continue;
                }
                if ($force) {
                    $this->pdo->prepare('DELETE FROM logs WHERE channel=?')->execute([$ch]);
                }
                foreach ([$f . '.1', $f] as $src) {
                    if (!is_file($src)) {
                        continue;
                    }
                    $h = fopen($src, 'rb');
                    while ($h && ($line = fgets($h)) !== false) {
                        $j = json_decode(trim($line), true);
                        if (is_array($j)) {
                            $ins->execute([$ch, (int)($j['ts'] ?? 0), self::enc($j)]);
                            $rep['logs']++;
                        }
                    }
                    if ($h) {
                        fclose($h);
                    }
                }
            }
            $this->setMeta('json_imported', (string)time());
            $this->pdo->exec('COMMIT');
        } catch (Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->exec('ROLLBACK');
            }
            throw $e;
        }
        return $rep;
    }

    // ---- maintenance ---------------------------------------------------------------------

    public function status(): array
    {
        $ch = [];
        foreach ($this->pdo->query('SELECT channel, COUNT(*) n FROM logs GROUP BY channel ORDER BY channel') as $r) {
            $ch[$r['channel']] = (int)$r['n'];
        }
        return [
            'backend' => 'sqlite',
            'file' => $this->file,
            'size' => is_file($this->file) ? filesize($this->file) : 0,
            'wal_size' => is_file($this->file . '-wal') ? filesize($this->file . '-wal') : 0,
            'schema_version' => $this->schemaVersion(),
            'schema_latest' => max(array_keys(self::MIGRATIONS)),
            'journal_mode' => (string)$this->pdo->query('PRAGMA journal_mode')->fetchColumn(),
            'json_imported' => $this->getMeta('json_imported'),
            'docs' => $this->names(),
            'logs' => $ch,
            'integrity' => (string)$this->pdo->query('PRAGMA integrity_check')->fetchColumn(),
        ];
    }

    public function vacuum(): array
    {
        $before = is_file($this->file) ? filesize($this->file) : 0;
        $this->pdo->exec('PRAGMA wal_checkpoint(TRUNCATE)');
        $this->pdo->exec('VACUUM');
        $this->pdo->exec('PRAGMA optimize');
        clearstatcache();
        return ['before' => $before, 'after' => is_file($this->file) ? filesize($this->file) : 0];
    }
}
