<?php
/**
 * Multi-tenant core: the active workspace, workspace records, limits, per-workspace directories and the global lookup indexes.
 *
 * - The active workspace is process state (one PHP request = one process). Auth/App set it from the logged-in user's server-side
 *   session; cron, webhooks and public pages use Workspace::run(). It is NEVER taken from client input directly.
 * - Records live in the global doc `workspaces`; platform-wide settings in the global doc `platform`.
 * - Id: `w_` + 8 hex (random), or the literal `main` for the workspace that pre-multi-tenant data migrates into.
 * See docs/MULTITENANT.md.
 */
final class Workspace
{
    public const ID_RE = '/^(main|w_[a-f0-9]{8})$/';
    public const SLUG_RE = '/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/';
    private const RESERVED_SLUGS = ['platform', 'admin', 'api', 'www', 'login', 'logout', 'setup', 'shop', 'status', 'assets', 'cron', 'json', 'pay', 'lang'];
    /** Default per-workspace limits (0 = unlimited). Overridable by platform['limits'] and per workspace record['limits']. */
    public const LIMIT_DEFAULTS = ['routers' => 3, 'staff' => 5, 'vouchers_per_day' => 1000, 'log_rows' => 5000];

    private static ?string $id = null;

    // ---- active workspace ------------------------------------------------------------------------

    public static function idOrNull(): ?string
    {
        return self::$id;
    }

    /** Active workspace id; throws NoWorkspaceException when none (fail closed). */
    public static function id(): string
    {
        if (self::$id === null) {
            throw new NoWorkspaceException('No active workspace');
        }
        return self::$id;
    }

    public static function valid(string $id): bool
    {
        return (bool)preg_match(self::ID_RE, $id);
    }

    /** Make $id the active workspace (after login, platform switch, CLI). Does not check existence or status: callers do (isActive()). */
    public static function set(string $id): void
    {
        if (!self::valid($id)) {
            throw new InvalidArgumentException('Invalid workspace id');
        }
        self::$id = $id;
    }

    /** No active workspace any more (tests, logout). */
    public static function clear(): void
    {
        self::$id = null;
    }

    /** Run $fn inside another workspace and restore the previous one afterwards (cron, webhooks, public pages, shared routers). */
    public static function run(string $id, callable $fn)
    {
        if (!self::valid($id)) {
            throw new InvalidArgumentException('Invalid workspace id');
        }
        $prev = self::$id;
        self::$id = $id;
        try {
            return $fn();
        } finally {
            self::$id = $prev;
        }
    }

    // ---- records -----------------------------------------------------------------------------------

    /** @return array[] every workspace record */
    public static function all(): array
    {
        return array_values((array)Store::global('workspaces')->read([]));
    }

    public static function get(string $id): ?array
    {
        foreach (self::all() as $w) {
            if (($w['id'] ?? '') === $id) {
                return $w;
            }
        }
        return null;
    }

    public static function bySlug(string $slug): ?array
    {
        $slug = strtolower(trim($slug));
        foreach (self::all() as $w) {
            if ($slug !== '' && ($w['slug'] ?? '') === $slug) {
                return $w;
            }
        }
        return null;
    }

    /** Public pages accept either a slug or an id in `?w=`. */
    public static function resolveRef(string $ref): ?array
    {
        $ref = trim($ref);
        if ($ref === '') {
            return null;
        }
        return self::bySlug($ref) ?? (self::valid($ref) ? self::get($ref) : null);
    }

    /** 'active' | 'suspended' | null (unknown). `main` without a record counts as active (fresh installs / tests). */
    public static function status(string $id): ?string
    {
        $w = self::get($id);
        if ($w) {
            return ($w['status'] ?? 'active') === 'suspended' ? 'suspended' : 'active';
        }
        return $id === 'main' ? 'active' : null;
    }

    public static function exists(string $id): bool
    {
        return self::status($id) !== null;
    }

    public static function isActive(string $id): bool
    {
        return self::status($id) === 'active';
    }

    /** @return string[] ids of workspaces that may run cron / serve traffic */
    public static function activeIds(): array
    {
        $ids = [];
        foreach (self::all() as $w) {
            if (($w['status'] ?? 'active') === 'active' && self::valid((string)$w['id'])) {
                $ids[] = (string)$w['id'];
            }
        }
        return $ids;
    }

    /** Make sure the `main` record exists (migration / first admin). */
    public static function ensureMain(?string $ownerId = null, string $name = 'Main'): array
    {
        $rec = null;
        Store::global('workspaces')->update(function ($list) use (&$rec, $ownerId, $name) {
            $list = array_values((array)$list);
            foreach ($list as $i => $w) {
                if (($w['id'] ?? '') === 'main') {
                    if ($ownerId !== null && empty($w['owner'])) {
                        $list[$i]['owner'] = $ownerId;
                    }
                    $rec = $list[$i];
                    return $list;
                }
            }
            $rec = ['id' => 'main', 'slug' => 'main', 'name' => $name, 'status' => 'active', 'owner' => (string)$ownerId,
                'limits' => array_fill_keys(array_keys(self::LIMIT_DEFAULTS), 0), 'created' => time()];
            $list[] = $rec;
            return $list;
        }, []);
        return $rec;
    }

    public static function slugify(string $name): string
    {
        $s = strtolower(trim((string)preg_replace('/[^A-Za-z0-9]+/', '-', $name), '-'));
        $s = substr($s, 0, 32);
        return trim($s, '-');
    }

    /**
     * Create a workspace + its owner account (role admin). $data: name, slug (optional), owner (username), password, owner_name, limits[], status.
     * @return array the workspace record (with `owner` = user id)
     * @throws InvalidArgumentException with a human readable message on bad input
     */
    public static function create(array $data): array
    {
        $name = mb_substr(trim((string)($data['name'] ?? '')), 0, 60);
        if ($name === '') {
            throw new InvalidArgumentException('Name is required.');
        }
        $slug = strtolower(trim((string)($data['slug'] ?? ''))) ?: self::slugify($name);
        if (!preg_match(self::SLUG_RE, $slug) || in_array($slug, self::RESERVED_SLUGS, true)) {
            throw new InvalidArgumentException('Invalid slug (3-32 chars: a-z, 0-9, dash).');
        }
        $owner = trim((string)($data['owner'] ?? ''));
        $pw = (string)($data['password'] ?? '');
        if (!preg_match('/^[A-Za-z0-9_.\-]{3,32}$/', $owner)) {
            throw new InvalidArgumentException('Owner username: 3-32 letters, digits, dot, dash or underscore.');
        }
        if (Auth::find($owner)) {
            throw new InvalidArgumentException('Username already exists.');
        }
        $limits = self::cleanLimits((array)($data['limits'] ?? []));
        $status = ($data['status'] ?? 'active') === 'suspended' ? 'suspended' : 'active';
        $rec = null;
        $err = null;
        Store::global('workspaces')->update(function ($list) use (&$rec, &$err, $name, $slug, $limits, $status) {
            $list = array_values((array)$list);
            $ids = array_column($list, 'id');
            foreach ($list as $w) {
                if (($w['slug'] ?? '') === $slug) {
                    $err = 'Slug already in use.';
                    return $list;
                }
            }
            do {
                $id = 'w_' . bin2hex(random_bytes(4));
            } while (in_array($id, $ids, true));
            $rec = ['id' => $id, 'slug' => $slug, 'name' => $name, 'status' => $status, 'owner' => '', 'limits' => $limits, 'created' => time()];
            $list[] = $rec;
            return $list;
        }, []);
        if ($err !== null || $rec === null) {
            throw new InvalidArgumentException($err ?? 'Could not create workspace.');
        }
        $id = $rec['id'];
        try {
            $pe = self::run($id, fn() => Security::passwordError($pw, $owner));
            if ($pe !== null) {
                throw new InvalidArgumentException($pe);
            }
            $user = Auth::create($owner, $pw, 'admin', (string)($data['owner_name'] ?? '') ?: $owner, $id);
        } catch (Throwable $e) {
            Store::global('workspaces')->update(fn($l) => array_values(array_filter((array)$l, fn($w) => ($w['id'] ?? '') !== $id)), []);
            throw $e;
        }
        $rec['owner'] = $user['id'];
        Store::global('workspaces')->update(function ($list) use ($id, $user) {
            foreach ($list as $i => $w) {
                if (($w['id'] ?? '') === $id) {
                    $list[$i]['owner'] = $user['id'];
                }
            }
            return $list;
        }, []);
        self::run($id, function () use ($name) {
            Store::saveSettings(['hotspot_name' => $name]);
        });
        self::platformLog('workspace.create', $id . ' ' . $slug);
        return $rec;
    }

    /** Patch name / slug / status / limits of a workspace record. Returns the new record or null when unknown. */
    public static function update(string $id, array $patch): ?array
    {
        $out = null;
        $err = null;
        Store::global('workspaces')->update(function ($list) use ($id, $patch, &$out, &$err) {
            $list = array_values((array)$list);
            foreach ($list as $i => $w) {
                if (($w['id'] ?? '') !== $id) {
                    continue;
                }
                if (isset($patch['name']) && trim((string)$patch['name']) !== '') {
                    $w['name'] = mb_substr(trim((string)$patch['name']), 0, 60);
                }
                if (isset($patch['slug'])) {
                    $slug = strtolower(trim((string)$patch['slug']));
                    if ($slug !== $w['slug']) {
                        if (!preg_match(self::SLUG_RE, $slug) || in_array($slug, self::RESERVED_SLUGS, true)) {
                            $err = 'Invalid slug (3-32 chars: a-z, 0-9, dash).';
                            return $list;
                        }
                        foreach ($list as $o) {
                            if (($o['slug'] ?? '') === $slug) {
                                $err = 'Slug already in use.';
                                return $list;
                            }
                        }
                        $w['slug'] = $slug;
                    }
                }
                if (isset($patch['status'])) {
                    $w['status'] = $patch['status'] === 'suspended' ? 'suspended' : 'active';
                }
                if (isset($patch['limits'])) {
                    $w['limits'] = self::cleanLimits((array)$patch['limits']) + (array)($w['limits'] ?? []);
                }
                $list[$i] = $w;
                $out = $w;
            }
            return $list;
        }, []);
        if ($err !== null) {
            throw new InvalidArgumentException($err);
        }
        if ($out !== null) {
            self::platformLog('workspace.update', $id . ' ' . implode(',', array_keys($patch)));
        }
        return $out;
    }

    public static function setStatus(string $id, string $status): ?array
    {
        return self::update($id, ['status' => $status === 'suspended' ? 'suspended' : 'active']);
    }

    /**
     * Delete a workspace with everything in it: documents, logs, orders / backups directories, its users, shares in both directions,
     * index entries. Refused for `main` and for any workspace that holds a platform admin.
     */
    public static function delete(string $id): bool
    {
        if (!self::valid($id) || $id === 'main' || !self::get($id)) {
            return false;
        }
        foreach (Auth::allUsers() as $u) {
            if (($u['workspace'] ?? 'main') === $id && ($u['role'] ?? '') === 'platform') {
                return false;
            }
        }
        Store::global('users')->update(fn($l) => array_values(array_filter((array)$l, fn($u) => ($u['workspace'] ?? 'main') !== $id)), []);
        Store::global('shares')->update(fn($l) => array_values(array_filter((array)$l, fn($s) => ($s['owner'] ?? '') !== $id && ($s['to'] ?? '') !== $id)), []);
        Store::global('apikey_index')->update(fn($m) => array_filter((array)$m, fn($w) => $w !== $id), []);
        Store::global('session_index')->update(function ($m) use ($id) {
            foreach ((array)$m as $k => $list) {
                $list = array_values(array_filter((array)$list, fn($e) => ($e['ws'] ?? '') !== $id));
                if ($list) {
                    $m[$k] = $list;
                } else {
                    unset($m[$k]);
                }
            }
            return $m;
        }, []);
        Store::purgeWorkspace($id);
        self::rrmdir(Store::dir() . '/ws/' . $id);
        Store::global('workspaces')->update(fn($l) => array_values(array_filter((array)$l, fn($w) => ($w['id'] ?? '') !== $id)), []);
        self::platformLog('workspace.delete', $id);
        return true;
    }

    private static function rrmdir(string $d): void
    {
        if (!is_dir($d)) {
            return;
        }
        foreach (scandir($d) ?: [] as $f) {
            if ($f !== '.' && $f !== '..') {
                $p = $d . '/' . $f;
                is_dir($p) && !is_link($p) ? self::rrmdir($p) : @unlink($p);
            }
        }
        @rmdir($d);
    }

    // ---- platform settings + limits ------------------------------------------------------------------

    /** Platform-wide settings (global doc `platform`) with defaults: signup, limits, security (password policy), settings (lang/timezone for logged-out pages). */
    public static function platform(): array
    {
        $p = (array)Store::global('platform')->read([]);
        $p['limits'] = array_replace(self::LIMIT_DEFAULTS, self::cleanLimits((array)($p['limits'] ?? [])));
        $p += ['signup' => false, 'security' => [], 'settings' => []];
        return $p;
    }

    public static function savePlatform(array $patch): void
    {
        Store::global('platform')->update(fn($p) => array_replace((array)$p, $patch), []);
    }

    /** Token that lets cron.php run every workspace (per-workspace tokens still run only their own). */
    public static function platformCronToken(): string
    {
        $tok = '';
        Store::global('platform')->update(function ($p) use (&$tok) {
            $p = (array)$p;
            if (empty($p['cron_token'])) {
                $p['cron_token'] = bin2hex(random_bytes(16));
            }
            $tok = (string)$p['cron_token'];
            return $p;
        }, []);
        return $tok;
    }

    private static function cleanLimits(array $in): array
    {
        $o = [];
        foreach (self::LIMIT_DEFAULTS as $k => $_) {
            if (isset($in[$k]) && $in[$k] !== '' && is_numeric($in[$k])) {
                $o[$k] = max(0, min(1000000000, (int)$in[$k]));
            }
        }
        return $o;
    }

    /** Effective limits: defaults < platform defaults < workspace override. 0 = unlimited. `main` without a record is unlimited. */
    public static function limits(?string $id = null): array
    {
        $id ??= self::id();
        $w = self::get($id);
        if (!$w && $id === 'main') {
            return array_fill_keys(array_keys(self::LIMIT_DEFAULTS), 0);
        }
        return array_replace(self::platform()['limits'], self::cleanLimits((array)($w['limits'] ?? [])));
    }

    /** May the workspace hold one more of `$what` (routers, staff, ...) given it has $current? */
    public static function allows(string $what, int $current, ?string $id = null): bool
    {
        $max = (int)(self::limits($id)[$what] ?? 0);
        return $max === 0 || $current < $max;
    }

    // ---- directories ---------------------------------------------------------------------------------

    /** Per-workspace directory (orders, backups, cache, demo ...), created on demand: data/ws/<id>/<sub>. */
    public static function dir(string $sub = ''): string
    {
        return self::dirFor(self::id(), $sub);
    }

    public static function dirFor(string $id, string $sub = ''): string
    {
        if (!self::valid($id)) {
            throw new InvalidArgumentException('Invalid workspace id');
        }
        $d = Store::dir() . '/ws/' . $id;
        foreach (explode('/', $sub) as $seg) {
            if ($seg !== '') {
                $d .= '/' . Store::sanitize($seg);
            }
        }
        if (!is_dir($d)) {
            @mkdir($d, 0770, true);
        }
        return $d;
    }

    // ---- global indexes (key hash -> workspace, status session name -> workspace) -------------------------

    public static function indexKey(string $hash, ?string $ws = null): void
    {
        $ws ??= self::id();
        Store::global('apikey_index')->update(function ($m) use ($hash, $ws) {
            $m = (array)$m;
            $m[$hash] = $ws;
            return $m;
        }, []);
    }

    public static function unindexKey(string $hash): void
    {
        Store::global('apikey_index')->update(function ($m) use ($hash) {
            $m = (array)$m;
            unset($m[$hash]);
            return $m;
        }, []);
    }

    public static function wsByKeyHash(string $hash): ?string
    {
        $m = (array)Store::global('apikey_index')->read([]);
        $w = $m[$hash] ?? null;
        return is_string($w) && self::valid($w) ? $w : null;
    }

    /** Rebuild the key index entries of one workspace (default: active) from its apikeys doc. */
    public static function reindexKeys(?string $ws = null): void
    {
        $ws ??= self::id();
        $hashes = self::run($ws, fn() => array_column((array)Store::read('apikeys', []), 'hash'));
        Store::global('apikey_index')->update(function ($m) use ($ws, $hashes) {
            $m = array_filter((array)$m, fn($w) => $w !== $ws);
            foreach ($hashes as $h) {
                if (is_string($h) && $h !== '') {
                    $m[$h] = $ws;
                }
            }
            return $m;
        }, []);
    }

    /** Rebuild the public-status session index entries of one workspace (default: active) from its routers. */
    public static function reindexSessions(?string $ws = null): void
    {
        $ws ??= self::id();
        $routers = self::run($ws, fn() => (array)Store::read('routers', []));
        Store::global('session_index')->update(function ($m) use ($ws, $routers) {
            $m = (array)$m;
            foreach ($m as $k => $list) {
                $list = array_values(array_filter((array)$list, fn($e) => ($e['ws'] ?? '') !== $ws));
                if ($list) {
                    $m[$k] = $list;
                } else {
                    unset($m[$k]);
                }
            }
            foreach ($routers as $r) {
                $s = strtolower((string)($r['session'] ?? '') ?: (string)$r['id']);
                if ($s !== '') {
                    $m[$s][] = ['ws' => $ws, 'rid' => (string)$r['id']];
                }
            }
            return $m;
        }, []);
    }

    /**
     * Which workspace / router owns a public status session name? Unique across the platform, or disambiguated by workspace slug/id.
     * @return array|null ['ws' => id, 'rid' => router id]
     */
    public static function bySession(string $session, string $ref = ''): ?array
    {
        $m = (array)Store::global('session_index')->read([]);
        $cands = (array)($m[strtolower(trim($session))] ?? []);
        if ($ref !== '') {
            $w = self::bySlug($ref);   // public input: slug only
            if (!$w) {
                return null;
            }
            $cands = array_values(array_filter($cands, fn($e) => ($e['ws'] ?? '') === $w['id']));
        }
        $cands = array_values(array_filter($cands, fn($e) => self::isActive((string)($e['ws'] ?? ''))));
        return count($cands) === 1 ? $cands[0] : null;
    }

    // ---- public pages --------------------------------------------------------------------------------

    /**
     * Workspace for an unauthenticated public request. @return array [?workspace id, ?reason 'unknown'|'suspended']
     *  - the ONLY client-chosen selector is the workspace SLUG (`?w=slug`); ids / names / headers / cookies are never read
     *  - /shop (storefront) and POST /shop/order (new order): ?w=slug, else `main` (old single-tenant links keep working); an `id` parameter
     *    is ignored here, so a foreign order id can never switch the page to another tenant
     *  - GET /shop/order?id= : the order id carries its workspace; the controller then checks the order TOKEN and shows a neutral page
     *    (no branding of that workspace) when it does not match
     *  - /pay/callback: ?w=slug (set by us in the webhook URL), else the workspace encoded in the order id inside the payload / `mock` param;
     *    authenticity is the gateway signature, checked inside that workspace
     *  - /status, /status.json: ?session= through the session index, disambiguated by ?w=slug
     */
    public static function resolvePublic(string $path, ?string $rawBody = null): array
    {
        $ref = isset($_GET['w']) && is_string($_GET['w']) ? strtolower(trim($_GET['w'])) : '';
        $bySlug = $ref !== '' ? self::bySlug($ref) : null;
        $id = null;
        if ($path === '/status' || $path === '/status.json') {
            $s = isset($_GET['session']) && is_string($_GET['session']) ? $_GET['session'] : '';
            $hit = $s !== '' ? self::bySession($s, $ref) : null;
            if (!$hit) {
                return [null, null];   // the page itself reports "unknown session"
            }
            $id = $hit['ws'];
        } elseif ($path === '/shop' || ($path === '/shop/order' && ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST')) {
            $id = $ref !== '' ? ($bySlug['id'] ?? null) : 'main';
        } elseif ($path === '/shop/order') {
            $id = Orders::workspaceOf(isset($_GET['id']) && is_string($_GET['id']) ? $_GET['id'] : '');
            if ($id === null) {
                return [null, 'unknown'];
            }
        } elseif ($path === '/pay/callback') {
            $probe = (string)($_GET['mock'] ?? '') . ' ' . (string)$rawBody;
            $id = $bySlug['id'] ?? Orders::workspaceOf($probe) ?? ($ref === '' ? 'main' : null);
        } else {
            return [null, null];
        }
        if ($id === null || !self::exists($id)) {
            return [null, 'unknown'];
        }
        if (!self::isActive($id)) {
            return [null, 'suspended'];
        }
        return [$id, null];
    }

    /** Slug of the active workspace (its id when it has no record, e.g. a bare `main`). */
    public static function slug(): string
    {
        $id = self::id();
        return (string)(self::get($id)['slug'] ?? $id);
    }
    // ---- audit for platform-level actions ---------------------------------------------------------------

    public static function platformLog(string $action, string $detail = ''): void
    {
        $u = Auth::user();
        Store::global('platform_audit')->append([
            'ts' => time(), 'user' => $u['username'] ?? '-', 'ip' => Audit::ip(), 'workspace' => self::$id ?? '', 'action' => $action,
            'detail' => mb_substr($detail, 0, 500),
        ]);
    }
}
