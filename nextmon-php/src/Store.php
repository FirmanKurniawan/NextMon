<?php
/**
 * NextMON storage facade. Public API (read/write/update/path/dir/settings/setting/saveSettings/appendLog/tailLog) is stable.
 *
 * Backends (src/JsonStore.php, src/SqliteStore.php):
 *   - sqlite (default when pdo_sqlite is loaded): data/nextmon.db, WAL mode, prepared statements, versioned migrations.
 *     Documents live in table `docs`; append-only collections (audit/notify log, ledgers, sales...) live in `logs`
 *     as one row per entry, so appending never rewrites anything.
 *   - json  (fallback): one data/<name>.json per document, jsonl files for logs.
 * Selection: env NEXTMON_STORAGE=sqlite|json, or a one-line file data/storage.conf, else auto.
 * On first SQLite use the existing JSON files are imported once (after a copy to data/backup-json-<stamp>/).
 *
 * MULTI-TENANT: every collection is per-workspace ("ws/<id>/<name>" in the backend) unless it is in GLOBAL_DOCS. The workspace comes from
 * Workspace::id() (set by Auth/App from the logged-in user, or by Workspace::run for cron / public pages). No active workspace =>
 * NoWorkspaceException. See docs/MULTITENANT.md.
 *
 * Generic extras for new code: has(), delete(), names(), append(), rows(), count(), prune(), backendName(), global().
 * Files that are not documents (secret.key, cache/, sessions/) are still plain files via path(); per-workspace directories
 * (orders, backups, cache, demo) come from Workspace::dir().
 */
final class Store
{
    private static ?string $dir = null;
    private static ?object $backend = null;
    private static ?array $settingsCache = null;
    /** @var array<string,mixed>|null per-request read memo (web only, see requestCache()); null = off */
    private static ?array $memo = null;
    private static bool $tenantChecked = false;

    public static function dir(): string
    {
        if (self::$dir === null) {
            $d = getenv('NEXTMON_DATA') ?: dirname(__DIR__) . '/data';
            if (!is_dir($d)) {
                @mkdir($d, 0770, true);
            }
            self::$dir = rtrim(str_replace('\\', '/', $d), '/');
            foreach (['cache', 'sessions'] as $sub) {
                if (!is_dir(self::$dir . '/' . $sub)) {
                    @mkdir(self::$dir . '/' . $sub, 0770, true);
                }
            }
            // belt and braces: the data dir should live outside the web root, but if it does not, deny it on Apache and IIS
            $ht = self::$dir . '/.htaccess';
            if (!is_file($ht)) {
                @file_put_contents($ht, "<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n  Order deny,allow\n  Deny from all\n</IfModule>\n");
            }
            $wc = self::$dir . '/web.config';
            if (!is_file($wc)) {
                @file_put_contents($wc, "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<configuration>\n  <system.webServer>\n    <security>\n      <authorization>\n        <remove users=\"*\" roles=\"\" verbs=\"\" />\n        <add accessType=\"Deny\" users=\"*\" />\n      </authorization>\n    </security>\n  </system.webServer>\n</configuration>\n");
            }
        }
        return self::$dir;
    }

    /** Forget cached dir/backend/settings (tests, CLI after changing NEXTMON_DATA / NEXTMON_STORAGE). The active workspace is kept. */
    public static function reset(): void
    {
        if (self::$backend instanceof SqliteStore) {
            self::$backend->close();
        }
        self::$dir = null;
        self::$backend = null;
        self::$settingsCache = null;
        self::$memo = null;
        self::$tenantChecked = false;
        Crypto::reset();
    }

    public static function sanitize(string $name): string
    {
        $n = preg_replace('/[^A-Za-z0-9_.\-]/', '_', $name);
        return ltrim($n, '.') === '' ? '_' : (($n[0] ?? '') === '.' ? '_' . substr($n, 1) : $n);   // never "." / ".." / hidden names
    }

    public static function path(string $name): string
    {
        return self::dir() . '/' . self::sanitize($name);
    }

    /** Which backend is wanted: 'sqlite' or 'json' (after availability check). */
    public static function configuredBackend(): string
    {
        $want = strtolower(trim((string)getenv('NEXTMON_STORAGE')));
        if ($want === '') {
            $f = self::dir() . '/storage.conf';
            $want = is_file($f) ? strtolower(trim((string)file_get_contents($f))) : 'auto';
        }
        if ($want === 'json') {
            return 'json';
        }
        return SqliteStore::available() ? 'sqlite' : 'json';
    }

    public static function backend(): object
    {
        if (self::$backend === null) {
            if (self::configuredBackend() === 'sqlite') {
                try {
                    self::$backend = new SqliteStore(self::dir());
                } catch (Throwable $e) {
                    error_log('[nextmon] SQLite storage unavailable, using JSON files: ' . $e->getMessage());
                }
            }
            self::$backend ??= new JsonStore(self::dir());
        }
        if (!self::$tenantChecked && getenv('NEXTMON_TENANT_AUTO') !== '0') {
            // once per process: pre-multi-tenant data (unprefixed collections) moves into workspace "main" (backup first, idempotent)
            self::$tenantChecked = true;
            try {
                TenantMigration::auto();
            } catch (Throwable $e) {
                error_log('[nextmon] tenant migration failed (data untouched, will retry): ' . $e->getMessage());
            }
        }
        return self::$backend;
    }

    public static function backendName(): string
    {
        return self::backend() instanceof SqliteStore ? 'sqlite' : 'json';
    }

    // ---- namespacing (multi-tenant) -------------------------------------------------------

    /**
     * Collections that are NOT per-workspace. Everything else is stored under "ws/<workspace id>/<name>" automatically
     * and needs an active workspace (Workspace::set / Workspace::run), otherwise NoWorkspaceException (fail closed).
     */
    public const GLOBAL_DOCS = [
        'users', 'login_attempts', 'rate_limits', 'sessions_meta', 'workspaces', 'shares', 'platform', 'apikey_index', 'session_index',
        'shop_rate', 'platform_audit',
    ];

    public static function isGlobal(string $name): bool
    {
        return in_array(self::sanitize($name), self::GLOBAL_DOCS, true);
    }

    /** Backend key of a collection for the active workspace. */
    private static function key(string $name): string
    {
        $n = self::sanitize($name);
        if (in_array($n, self::GLOBAL_DOCS, true)) {
            return $n;
        }
        $ws = Workspace::idOrNull();
        if ($ws === null) {
            throw new NoWorkspaceException("No active workspace: refusing to access '$n'");
        }
        return 'ws/' . $ws . '/' . $n;
    }

    /** Explicit handle on a global collection (users, workspaces, shares, platform, apikey_index, session_index, ...). */
    public static function global(string $name): StoreGlobal
    {
        $n = self::sanitize($name);
        if (!in_array($n, self::GLOBAL_DOCS, true)) {
            throw new InvalidArgumentException("'$n' is not a global collection");
        }
        return new StoreGlobal($n);
    }

    /** Delete every document / log of one workspace (Workspace::delete). */
    public static function purgeWorkspace(string $wsId): void
    {
        if (!preg_match(Workspace::ID_RE, $wsId)) {
            throw new InvalidArgumentException('bad workspace id');
        }
        self::backend()->purge('ws/' . $wsId . '/');
        self::$memo = self::$memo === null ? null : [];
        self::$settingsCache = null;
    }

    // ---- documents -------------------------------------------------------------------

    /**
     * Web requests only: remember each document after its first read (routers / users / settings are read several times per page).
     * Any write, update or delete THROUGH Store drops the entry; another process changing a document mid-request is not seen,
     * which is fine for a request that lasts milliseconds. CLI tools and tests never enable this. Keys are the namespaced backend
     * keys, so one workspace can never be served another's memo.
     */
    public static function requestCache(bool $on = true): void
    {
        self::$memo = $on ? [] : null;
    }

    public static function read(string $name, $default = [])
    {
        $n = self::key($name);
        if (self::$memo !== null) {
            if (array_key_exists($n, self::$memo)) {
                return self::$memo[$n] ?? $default;
            }
            $miss = new stdClass();
            $v = self::backend()->read($n, $miss);
            self::$memo[$n] = $v === $miss ? null : $v;
            return $v === $miss ? $default : $v;
        }
        return self::backend()->read($n, $default);
    }

    public static function write(string $name, $data): void
    {
        $n = self::key($name);
        unset(self::$memo[$n]);
        self::backend()->write($n, $data);
        if (self::sanitize($name) === 'settings') {
            self::$settingsCache = null;
        }
    }

    /** Read-modify-write under an exclusive lock. $fn receives the data and returns the new data. */
    public static function update(string $name, callable $fn, $default = [])
    {
        $n = self::key($name);
        unset(self::$memo[$n]);
        $r = self::backend()->update($n, $fn, $default);
        unset(self::$memo[$n]);
        if (self::sanitize($name) === 'settings') {
            self::$settingsCache = null;
        }
        return $r;
    }

    public static function has(string $name): bool
    {
        return self::backend()->has(self::key($name));
    }

    public static function delete(string $name): void
    {
        $n = self::key($name);
        unset(self::$memo[$n]);
        self::backend()->delete($n);
        if (self::sanitize($name) === 'settings') {
            self::$settingsCache = null;
        }
    }

    /** @return string[] document names of the active workspace (the global ones when no workspace is active) */
    public static function names(): array
    {
        $ws = Workspace::idOrNull();
        $pre = $ws === null ? '' : 'ws/' . $ws . '/';
        $o = [];
        foreach (self::backend()->names() as $n) {
            if ($pre !== '') {
                if (strncmp($n, $pre, strlen($pre)) === 0) {
                    $o[] = substr($n, strlen($pre));
                }
            } elseif (strncmp($n, 'ws/', 3) !== 0) {
                $o[] = $n;
            }
        }
        return $o;
    }

    /** @return string[] raw backend keys of every document of every workspace (CLI / maintenance only) */
    public static function allNames(): array
    {
        return self::backend()->names();
    }

    // ---- settings ----------------------------------------------------------------

    public static function defaults(): array
    {
        return [
            'lang' => 'id',
            'timezone' => 'Asia/Jakarta',
            'currency' => 'Rp',
            'hotspot_name' => 'NextMON WiFi',
            'login_url' => 'http://hotspot.local/login',
            'max_qty' => 500,
            'live_report' => true,
            'status_cors' => '',
            'telegram' => ['enabled' => false, 'token' => '', 'chat_id' => '', 'events' => ['sale', 'voucher', 'router', 'login']],
            'webhook_url' => '',
            'templates' => [],
        ];
    }

    /**
     * Settings of the active workspace. With NO active workspace (login page, setup, public error pages) this returns the defaults
     * overlaid with the platform-level "settings" (language / timezone only, never tenant data); it never throws.
     */
    public static function settings(): array
    {
        $ws = Workspace::idOrNull() ?? '';
        if (self::$settingsCache === null || (self::$settingsCache['__ws'] ?? null) !== $ws) {
            // shallow merges only: recursive merging would resurrect unchecked list items (telegram.events)
            $def = self::defaults();
            if ($ws === '') {
                $plat = (array)self::global('platform')->read([]);
                $stored = (array)($plat['settings'] ?? []);
            } else {
                $stored = (array)self::read('settings', []);
            }
            $c = array_replace($def, $stored);
            $c['telegram'] = array_replace($def['telegram'], (array)($stored['telegram'] ?? []));
            $c['__ws'] = $ws;
            self::$settingsCache = $c;
        }
        $c = self::$settingsCache;
        unset($c['__ws']);
        return $c;
    }

    public static function setting(string $k, $d = null)
    {
        $s = self::settings();
        return $s[$k] ?? $d;
    }

    public static function saveSettings(array $patch): void
    {
        self::update('settings', function ($cur) use ($patch) {
            return array_replace((array)$cur, $patch);
        }, []);
    }

    // ---- append-only collections ("logs": audit.log, notify.log, ledgers...) ---------------

    public static function appendLog(string $file, array $row): void
    {
        self::backend()->append(self::key($file), $row);
    }

    /** Newest first. */
    public static function tailLog(string $file, int $n = 200): array
    {
        return self::backend()->tail(self::key($file), $n);
    }

    /** Alias of appendLog for new code (collection name, e.g. 'ledger'). */
    public static function append(string $collection, array $row): void
    {
        self::appendLog($collection, $row);
    }

    /**
     * Paged read of an append-only collection, newest first.
     * @param array $where exact-match filters on top-level row keys (e.g. ['action' => 'login'])
     */
    public static function rows(string $collection, int $limit = 100, int $offset = 0, array $where = []): array
    {
        return self::backend()->rows(self::key($collection), $limit, $offset, $where);
    }

    public static function count(string $collection): int
    {
        return self::backend()->count(self::key($collection));
    }

    /** Keep only the newest $keep entries. Returns number removed. */
    public static function prune(string $collection, int $keep): int
    {
        return self::backend()->prune(self::key($collection), $keep);
    }
}
