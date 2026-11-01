<?php
/** JSON-file storage backend (fallback when pdo_sqlite is missing). One file per document, jsonl for logs. */
final class JsonStore
{
    private string $dir;

    public function __construct(string $dir)
    {
        $this->dir = $dir;
    }

    /** Keys are either "name" (global) or "ws/<workspace id>/name"; anything else is refused (no path traversal, no stray dirs). */
    private function safe(string $name): string
    {
        if (!preg_match('#^(ws/(main|w_[a-f0-9]{8})/)?[A-Za-z0-9_\-][A-Za-z0-9_.\-]*$#', $name)) {
            throw new InvalidArgumentException('bad storage key');
        }
        return $name;
    }

    private function f(string $name): string
    {
        return $this->dir . '/' . $this->safe($name) . '.json';
    }

    /** Create the parent directory of a namespaced file before writing. */
    private function ensureParent(string $path): void
    {
        $d = dirname($path);
        if (!is_dir($d)) {
            @mkdir($d, 0770, true);
        }
    }

    public function read(string $name, $default)
    {
        $f = $this->f($name);
        if (!is_file($f)) {
            return $default;
        }
        $j = json_decode((string)file_get_contents($f), true);
        return $j === null ? $default : $j;
    }

    public function write(string $name, $data): void
    {
        $f = $this->f($name);
        $this->ensureParent($f);
        $tmp = $f . '.' . bin2hex(random_bytes(4)) . '.tmp';
        file_put_contents($tmp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
        @chmod($tmp, 0600);   // users.json holds password hashes, routers.json encrypted secrets
        if (!@rename($tmp, $f)) {
            @copy($tmp, $f);
            @unlink($tmp);
        }
    }

    public function update(string $name, callable $fn, $default)
    {
        $this->ensureParent($this->f($name));
        $lock = fopen($this->dir . '/' . dirname($this->safe($name) . '.x') . '/.lock-' . basename($name), 'c');
        if ($lock) {
            flock($lock, LOCK_EX);
        }
        try {
            $new = $fn($this->read($name, $default));
            $this->write($name, $new);
            return $new;
        } finally {
            if ($lock) {
                flock($lock, LOCK_UN);
                fclose($lock);
            }
        }
    }

    public function has(string $name): bool
    {
        return is_file($this->f($name));
    }

    public function delete(string $name): void
    {
        @unlink($this->f($name));
    }

    /** @return string[] keys of every document: "name" for global ones, "ws/<id>/name" for workspace ones */
    public function names(): array
    {
        $o = [];
        foreach (glob($this->dir . '/*.json') ?: [] as $f) {
            $o[] = basename($f, '.json');
        }
        foreach (glob($this->dir . '/ws/*/*.json') ?: [] as $f) {
            $o[] = 'ws/' . basename(dirname($f)) . '/' . basename($f, '.json');
        }
        sort($o);
        return $o;
    }

    /** Remove every document and log under a "ws/<id>/" prefix (the whole directory, including orders / backups / cache). */
    public function purge(string $prefix): void
    {
        if (!preg_match('#^ws/(main|w_[a-f0-9]{8})/$#', $prefix)) {
            throw new InvalidArgumentException('bad purge prefix');
        }
        $this->rrmdir($this->dir . '/' . rtrim($prefix, '/'));
    }

    private function rrmdir(string $d): void
    {
        if (!is_dir($d)) {
            return;
        }
        foreach (scandir($d) ?: [] as $f) {
            if ($f === '.' || $f === '..') {
                continue;
            }
            $p = $d . '/' . $f;
            is_dir($p) && !is_link($p) ? $this->rrmdir($p) : @unlink($p);
        }
        @rmdir($d);
    }

    // ---- logs --------------------------------------------------------------------

    private function lf(string $file): string
    {
        return $this->dir . '/' . $this->safe($file);
    }

    public function append(string $file, array $row): void
    {
        $f = $this->lf($file);
        $this->ensureParent($f);
        if (is_file($f) && filesize($f) > 2 * 1024 * 1024) {
            @rename($f, $f . '.1');
        }
        @file_put_contents($f, json_encode($row, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n", FILE_APPEND | LOCK_EX);
    }

    private function all(string $file): array
    {
        $out = [];
        $base = $this->lf($file);
        foreach ([$base . '.1', $base] as $f) {
            if (!is_file($f)) {
                continue;
            }
            foreach (@file($f, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $l) {
                $j = json_decode($l, true);
                if (is_array($j)) {
                    $out[] = $j;
                }
            }
        }
        return $out;
    }

    public function tail(string $file, int $n): array
    {
        $f = $this->lf($file);
        if (!is_file($f)) {
            return [];
        }
        $lines = @file($f, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
        $out = [];
        foreach (array_reverse(array_slice($lines, -$n)) as $l) {
            $j = json_decode($l, true);
            if (is_array($j)) {
                $out[] = $j;
            }
        }
        return $out;
    }

    public function rows(string $file, int $limit, int $offset, array $where): array
    {
        $all = array_reverse($this->all($file));
        if ($where) {
            $all = array_values(array_filter($all, function ($r) use ($where) {
                foreach ($where as $k => $v) {
                    if (!array_key_exists($k, $r) || (string)$r[$k] !== (string)$v) {
                        return false;
                    }
                }
                return true;
            }));
        }
        return array_slice($all, $offset, $limit);
    }

    public function count(string $file): int
    {
        return count($this->all($file));
    }

    public function prune(string $file, int $keep): int
    {
        $all = $this->all($file);
        $drop = count($all) - max(0, $keep);
        if ($drop <= 0) {
            return 0;
        }
        $f = $this->lf($file);
        $lines = '';
        foreach (array_slice($all, $drop) as $r) {
            $lines .= json_encode($r, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n";
        }
        file_put_contents($f, $lines, LOCK_EX);
        @unlink($f . '.1');
        return $drop;
    }

    // ---- multi-tenant migration support (TenantMigration) --------------------------------------------

    /** Un-namespaced files that predate multi-tenancy: documents (name => path) and logs (name => path[]). */
    public function legacyFiles(array $globals): array
    {
        $docs = [];
        $logs = [];
        $skipExt = '#\.(json|tmp|db|db-wal|db-shm|key|conf|lock|php|ser|dat|bak|log\.tmp)$#i';
        foreach (scandir($this->dir) ?: [] as $b) {
            $p = $this->dir . '/' . $b;
            if ($b === '.' || $b === '..' || $b[0] === '.' || !is_file($p)) {
                continue;
            }
            if (substr($b, -5) === '.json') {
                $n = substr($b, 0, -5);
                if (in_array($n, $globals, true) || strncmp($n, 'demo-', 5) === 0 || strncmp($n, 'backup-', 7) === 0) {
                    continue;
                }
                $docs[$n] = $p;
                continue;
            }
            if (preg_match($skipExt, $b) || strncmp($b, 'secret.key', 10) === 0 || strncmp($b, 'tenant.', 7) === 0 || $b === 'web.config') {
                continue;
            }
            $base = preg_replace('/\.1$/', '', $b);
            if (in_array($base, $globals, true) || !preg_match('/^[A-Za-z0-9_][A-Za-z0-9_.\-]*$/', $base)) {
                continue;
            }
            // a log file is JSON lines: peek at the first line
            $h = @fopen($p, 'rb');
            $first = $h ? (string)fgets($h) : '';
            if ($h) {
                fclose($h);
            }
            if (is_array(json_decode(trim($first), true))) {
                $logs[$base][] = $p;
            }
        }
        return ['docs' => $docs, 'logs' => $logs];
    }

    /** Copy every top-level data file into $dest (pre-migration backup). Returns number of files. */
    public function backupAll(string $dest): int
    {
        $n = 0;
        foreach (scandir($this->dir) ?: [] as $b) {
            $p = $this->dir . '/' . $b;
            if (is_file($p) && $b[0] !== '.' && $b !== 'web.config' && substr($b, -4) !== '.tmp') {
                if (!@copy($p, $dest . '/' . $b)) {
                    throw new RuntimeException('Backup copy failed for ' . $p);
                }
                $n++;
            }
        }
        return $n;
    }

    /**
     * Move legacy documents / logs into "ws/<id>/". Never overwrites something already in the workspace (the legacy copy is dropped then:
     * it can only exist when an earlier run was interrupted after copying).
     * @return array [docs, logs]
     */
    public function migrateLegacy(array $globals, string $wsId): array
    {
        $leg = $this->legacyFiles($globals);
        $dst = $this->dir . '/ws/' . $wsId;
        if (!is_dir($dst) && !@mkdir($dst, 0770, true) && !is_dir($dst)) {
            throw new RuntimeException('Cannot create ' . $dst);
        }
        $nd = $nl = 0;
        foreach ($leg['docs'] as $n => $p) {
            $to = $dst . '/' . $n . '.json';
            if (is_file($to)) {
                @unlink($p);
            } elseif (@rename($p, $to)) {
                $nd++;
            } else {
                throw new RuntimeException('Cannot move ' . $p);
            }
        }
        foreach ($leg['logs'] as $n => $paths) {
            foreach ($paths as $p) {
                $to = $dst . '/' . basename($p);
                if (is_file($to)) {
                    @unlink($p);
                } elseif (@rename($p, $to)) {
                    $nl++;
                } else {
                    throw new RuntimeException('Cannot move ' . $p);
                }
            }
        }
        return ['docs' => $nd, 'logs' => $nl];
    }

    /** True when there is anything to migrate. */
    public function hasLegacy(array $globals): bool
    {
        $l = $this->legacyFiles($globals);
        return (bool)($l['docs'] || $l['logs']);
    }
}
