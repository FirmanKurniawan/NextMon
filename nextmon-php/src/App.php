<?php
/**
 * NextMON front controller support: bootstrap, routing, rendering, router (device) resolution.
 * Plain PHP 8.1, no framework. NOTE: written without the ability to execute PHP - untested.
 */
final class App
{
    public static string $root;
    public static string $base = '';
    private static array $drivers = [];
    /** True while a platform admin works inside a workspace that is not their own (layout shows a banner, Audit marks via=platform). */
    public static bool $impersonating = false;
    /** GET pages that only read the session: the lock is released before the (slow) router calls. Anything that unsets/sets session keys stays out. */
    private const SESSION_RO_PAGES = ['/', '/hotspot/users', '/hotspot/profiles', '/hotspot/active', '/hotspot/hosts', '/hotspot/bindings', '/reports', '/queues', '/firewall', '/pos', '/vouchers'];
    private static bool $sessClosed = false;
    /** @var callable[] work to run after the response has been delivered */
    private static array $after = [];
    private const PUBLIC_PATHS = ['/shop', '/shop/order', '/pay/callback', '/login', '/setup', '/status', '/status.json', '/manifest.webmanifest', '/sw.js', '/offline', '/lang'];

    public static function run(): void
    {
        self::boot();
        $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
        $path = self::path();
        $isJson = strncmp($path, '/json/', 6) === 0 || strncmp($path, '/api/', 5) === 0;
        try {
            if ($isJson) {
                ApiController::handle($path, $method);
                return;
            }
            $routes = self::routes();
            $key = $method . ' ' . $path;
            if (!isset($routes[$key])) {
                http_response_code(404);
                self::render('error', ['title' => '404', 'code' => 404, 'message' => t('Page not found.'), 'page' => '']);
                return;
            }
            [$class, $fn, $cap] = $routes[$key];
            $public = in_array($path, self::PUBLIC_PATHS, true);
            if ($public && in_array($path, ['/shop', '/shop/order', '/pay/callback', '/status', '/status.json'], true)) {
                // public pages of ONE workspace: the tenant comes from ?w= / the order id / the status session index, never from a login
                $raw = $path === '/pay/callback' && $method === 'POST' ? (string)file_get_contents('php://input', false, null, 0, 1048576) : null;
                Workspace::clear();
                self::$impersonating = false;
                [$pws, $why] = Workspace::resolvePublic($path, $raw);
                if ($pws !== null) {
                    Workspace::set($pws);
                    self::applyLocale();
                } elseif ($why !== null) {
                    $code = $why === 'suspended' ? 503 : 404;
                    if ($path === '/pay/callback' || $path === '/status.json') {
                        self::json(['ok' => false, 'error' => $why === 'suspended' ? 'unavailable' : 'not found'], $code);
                    }
                    http_response_code($code);
                    self::render('error', ['title' => $code === 503 ? t('Service unavailable') : '404', 'code' => $code, 'message' => $code === 503 ? t('This workspace is suspended.') : t('Page not found.'), 'page' => '']);
                    return;
                }
            }
            if (!$public) {
                if (!Auth::hasUsers()) {
                    self::redirect('/setup');
                }
                if (!Auth::check()) {
                    self::redirect('/login');
                }
            }
            // [shop module] payment webhooks cannot carry a CSRF token; /pay/callback authenticates by gateway signature instead
            if ($method === 'POST' && $path !== '/pay/callback' && (!self::sameSite() || !Auth::verifyCsrf())) {
                http_response_code(419);
                self::render('error', ['title' => t('Session expired'), 'code' => 419, 'message' => t('Security token invalid or expired. Reload the page and try again.'), 'page' => '']);
                return;
            }
            if (!$public && !Auth::can($cap)) {
                http_response_code(403);
                self::render('error', ['title' => t('Forbidden'), 'code' => 403, 'message' => t('Your role cannot access this page.'), 'page' => '']);
                return;
            }
            if ($method === 'GET' && !$public && in_array($path, self::SESSION_RO_PAGES, true)) {
                self::closeSession();   // slow router I/O below must not hold the session lock (parallel XHR would queue behind it)
            }
            $class::$fn();
        } catch (QuotaException $e) {
            // daily voucher limit (Quota): nothing was created; callers that charged something roll back before this point
            if ($isJson) {
                self::json(['ok' => false, 'error' => $e->getMessage(), 'used' => $e->used, 'limit' => $e->limit], 429);
            }
            self::back(strncmp($path, '/hotspot', 8) === 0 ? '/hotspot/users' : '/vouchers', $e->getMessage(), 'err');
        } catch (RouterOSException $e) {
            self::routerError($e);
        } catch (Throwable $e) {
            error_log('[nextmon] ' . $e);
            http_response_code(500);
            if ($isJson) {
                self::json(['ok' => false, 'error' => 'Server error'], 500);
            }
            self::render('error', ['title' => t('Server error'), 'code' => 500, 'message' => getenv('NEXTMON_DEBUG') ? $e->getMessage() : t('Something went wrong. Check the PHP error log.'), 'page' => '']);
        }
    }

    // ---- bootstrap -----------------------------------------------------------------

    /** Autoloader + helpers only (no session, no headers): used by CLI tools and tests. Idempotent. */
    public static function init(): void
    {
        if (isset(self::$root)) {
            return;
        }
        self::$root = dirname(__DIR__);
        spl_autoload_register(function ($c) {
            foreach (['/src/', '/src/Controllers/'] as $d) {
                $f = self::$root . $d . $c . '.php';
                if (is_file($f)) {
                    require_once $f;
                    return;
                }
            }
        });
        require_once self::$root . '/src/Driver.php';
        require_once self::$root . '/src/helpers.php';
    }

    public static function boot(): void
    {
        self::init();
        Store::requestCache(true);

        error_reporting(E_ALL);
        ini_set('display_errors', getenv('NEXTMON_DEBUG') ? '1' : '0');
        ini_set('html_errors', '0');
        ini_set('log_errors', '1');

        $sn = $_SERVER['SCRIPT_NAME'] ?? '/index.php';
        self::$base = (substr($sn, -10) === '/index.php') ? rtrim(str_replace('\\', '/', dirname($sn)), '/') : '';

        session_name('nextmon_sid');
        session_save_path(Store::dir() . '/sessions');
        session_set_cookie_params([
            'lifetime' => 0, 'path' => self::$base ?: '/', 'httponly' => true, 'samesite' => 'Lax', 'secure' => self::isHttps(),
        ]);
        ini_set('session.use_strict_mode', '1');   // never adopt a session id the client invented (fixation)
        ini_set('session.use_only_cookies', '1');
        ini_set('session.use_trans_sid', '0');
        if (PHP_VERSION_ID < 80400) { // these ini keys are deprecated in 8.4, whose defaults are already fine
            ini_set('session.sid_length', '48');
            ini_set('session.sid_bits_per_character', '5');
        }
        // idle timeout proper is enforced by Security; this only bounds how long abandoned (anonymous) session files live.
        // GC must be on explicitly: Debian/Ubuntu php.ini disables it and expects a cron that ignores our custom save path.
        ini_set('session.gc_maxlifetime', '604800');
        ini_set('session.gc_probability', '1');
        ini_set('session.gc_divisor', '50');
        if (self::needsSession()) {
            session_start();
        } else {
            $_SESSION = []; // stateless endpoints (API key, public status JSON, static helpers): no session file per request
        }

        // the workspace of this request = the workspace of the logged-in user (server-side session only)
        if (!empty($_SESSION['uid'])) {
            Auth::user();
        }
        if (Workspace::idOrNull() === 'main') {
            self::seedDemoRouter();   // single-tenant installs: the first run still starts with the demo router
        }
        self::applyLocale();

        self::securityHeaders();
        self::maybeGzip();
    }

    /** Timezone + language from the active workspace (platform defaults when none is active yet). */
    public static function applyLocale(): void
    {
        date_default_timezone_set((string)Store::setting('timezone', 'Asia/Jakarta') ?: 'UTC');
        $lang = $_SESSION['lang'] ?? ($_COOKIE['klang'] ?? Store::setting('lang', 'id'));
        I18n::init((string)$lang);
    }

    /** True when this request needs the session store. Cookie-less API-key / public JSON calls do not (no file per request). */
    private static function needsSession(): bool
    {
        if (!empty($_COOKIE['nextmon_sid'])) {
            return true;
        }
        $p = self::path();
        return !(strncmp($p, '/api/', 5) === 0 || in_array($p, ['/status.json', '/manifest.webmanifest', '/sw.js', '/offline'], true));
    }

    private static function securityHeaders(): void
    {
        header_remove('X-Powered-By');
        header('X-Content-Type-Options: nosniff');
        header('X-Frame-Options: DENY');
        header('Referrer-Policy: same-origin');
        header('Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(self), interest-cohort=()');
        header('Cross-Origin-Opener-Policy: same-origin');
        header('Cross-Origin-Resource-Policy: same-origin');
        header('X-Permitted-Cross-Domain-Policies: none');
        header('Cache-Control: no-store');   // dynamic pages carry vouchers / balances: never cache them (static assets are served by the web server)
        header("Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; frame-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
        if (self::isHttps()) {
            header('Strict-Transport-Security: max-age=31536000');
        }
    }

    /**
     * Defence in depth next to the CSRF token: browsers tell us when a request is cross-site (Sec-Fetch-Site) or from a
     * foreign Origin. Missing headers (old browsers, curl) fall through to the token check.
     */
    public static function sameSite(): bool
    {
        $sfs = strtolower((string)($_SERVER['HTTP_SEC_FETCH_SITE'] ?? ''));
        if ($sfs === 'cross-site') {
            return false;
        }
        $origin = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
        if ($origin !== '' && $origin !== 'null') {
            $oh = strtolower(trim((string)parse_url($origin, PHP_URL_HOST), '[]'));
            $hh = strtolower(preg_replace('/:\d+$/', '', trim(Net::host(), '[]')));
            if ($oh === '' || $oh !== $hh) {
                // a proxy may rewrite Host: accept the forwarded host from a trusted proxy
                $fh = Net::fromTrustedProxy() ? strtolower(preg_replace('/:\d+$/', '', (string)($_SERVER['HTTP_X_FORWARDED_HOST'] ?? ''))) : '';
                if ($fh === '' || $oh !== $fh) {
                    return false;
                }
            }
        }
        return true;
    }

    /**
     * Create the demo router of the ACTIVE workspace if it has no router document yet (first run of `main`; the "try demo mode" button
     * of a new account). Returns true when it was created.
     */
    public static function seedDemoRouter(): bool
    {
        if (Store::has('routers')) {
            return false;
        }
        Store::write('routers', [[
            'id' => 'demo', 'name' => 'Demo Router', 'session' => 'demo', 'type' => 'demo',
            'host' => '', 'port' => 8728, 'ssl' => false, 'user' => '', 'pass' => '', 'hotspot_name' => 'NextMON Demo WiFi',
        ]]);
        Workspace::reindexSessions();
        return true;
    }

    private static function isHttps(): bool
    {
        return Net::isHttps();
    }

    public static function path(): string
    {
        $uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
        $uri = rawurldecode($uri);
        if (self::$base !== '' && strncmp($uri, self::$base, strlen(self::$base)) === 0) {
            $uri = substr($uri, strlen(self::$base));
        }
        if ($uri === '' || $uri === '/index.php') {
            return '/';
        }
        return $uri === '/' ? '/' : rtrim($uri, '/');
    }

    public static function url(string $p = ''): string
    {
        return self::$base . ($p === '' ? '/' : $p);
    }

    public static function origin(): string
    {
        $fixed = trim((string)getenv('NEXTMON_BASE_URL'));
        if ($fixed !== '' && preg_match('#^https?://[A-Za-z0-9.\-:\[\]]+(/[A-Za-z0-9._~/\-]*)?$#', $fixed)) {
            return rtrim($fixed, '/');
        }
        return (self::isHttps() ? 'https' : 'http') . '://' . Net::host() . self::$base;
    }

    // ---- request helpers ---------------------------------------------------------------

    public static function get(string $k, string $d = ''): string
    {
        $v = $_GET[$k] ?? $d;
        return is_string($v) ? trim($v) : $d;
    }

    public static function post(string $k, string $d = ''): string
    {
        $v = $_POST[$k] ?? $d;
        return is_string($v) ? trim($v) : $d;
    }

    public static function postArr(string $k): array
    {
        $v = $_POST[$k] ?? [];
        return is_array($v) ? array_values(array_filter(array_map('strval', $v), 'strlen')) : [];
    }

    public static function body(): array
    {
        $raw = file_get_contents('php://input', false, null, 0, 1048576); // 1 MB is plenty for these JSON bodies
        $j = json_decode((string)$raw, true, 16);
        return is_array($j) ? $j : $_POST;
    }

    // ---- responses -----------------------------------------------------------------------

    public static function flash(string $msg, string $type = 'ok'): void
    {
        self::openSession();
        $_SESSION['flash'][] = [$type, $msg];
    }

    public static function takeFlash(): array
    {
        $f = $_SESSION['flash'] ?? [];
        if ($f) {
            self::openSession();
            unset($_SESSION['flash']);
        }
        return $f;
    }

    /** Release the session file lock; $_SESSION stays readable. Writes after this need openSession() first. */
    public static function closeSession(): void
    {
        if (!self::$sessClosed && session_status() === PHP_SESSION_ACTIVE) {
            session_write_close();
            self::$sessClosed = true;
        }
    }

    /** Re-acquire the session (no-op unless closeSession() ran). Reloads $_SESSION from the store. */
    public static function openSession(): void
    {
        if (self::$sessClosed && session_status() !== PHP_SESSION_ACTIVE && !headers_sent()) {
            @session_cache_limiter('');   // do not let the 2nd session_start() overwrite our Cache-Control: no-store
            session_start();
            self::$sessClosed = false;
        }
    }

    /** Run $fn after the response reached the client (fastcgi_finish_request, or Content-Length + flush on php -S / Apache). */
    public static function defer(callable $fn): void
    {
        self::$after[] = $fn;
    }

    public static function redirect(string $p, ?string $flash = null, string $type = 'ok'): void
    {
        if ($flash !== null) {
            self::flash($flash, $type);
        }
        header('Location: ' . str_replace(["\r", "\n", "\0"], '', self::url($p)));
        exit;
    }

    public static function back(string $fallback, ?string $flash = null, string $type = 'ok'): void
    {
        self::redirect(self::localPath(self::post('back', self::get('back')), $fallback), $flash, $type);
    }

    /**
     * Turn a user supplied "back" target into an app-local path (open-redirect guard).
     * Refused (=> $fallback): empty, not starting with "/", "//host", "/\host" (browsers read "\" as "/"), control characters.
     */
    public static function localPath(string $to, string $fallback): string
    {
        if ($to === '' || $to[0] !== '/' || strncmp($to, '//', 2) === 0 || preg_match('/[\x00-\x1F\x7F\\\\]/', $to)) {
            return $fallback;
        }
        if (self::$base !== '' && strncmp($to, self::$base, strlen(self::$base)) === 0) {
            return substr($to, strlen(self::$base)) ?: '/';
        }
        return $to;
    }

    public static function json($data, int $code = 200): void
    {
        http_response_code($code);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        $body = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
        if (self::$after) {
            while (ob_get_level() > 0) {
                @ob_end_clean();   // a compression handler would make Content-Length wrong; this payload is small
            }
            header('Content-Length: ' . strlen($body));
            header('Connection: close');
            echo $body;
            @flush();
            if (function_exists('fastcgi_finish_request')) {
                @fastcgi_finish_request();
            }
            @ignore_user_abort(true);
            $jobs = self::$after;
            self::$after = [];
            foreach ($jobs as $j) {
                try {
                    $j();
                } catch (Throwable $e) {
                    error_log('[nextmon] deferred job failed: ' . $e->getMessage());
                }
            }
            exit;
        }
        echo $body;
        exit;
    }

    /** Route table (routes.php + routes.d/*.php), compiled into data/cache and rebuilt when any source file changes. */
    private static function routes(): array
    {
        $files = array_merge([self::$root . '/src/routes.php'], glob(self::$root . '/src/routes.d/*.php') ?: []);
        $sig = '';
        foreach ($files as $f) {
            $sig .= $f . '@' . (int)@filemtime($f) . ';';
        }
        $sig = hash('sha1', $sig);
        $cache = Store::dir() . '/cache/routes.php';   // tenant-ok: compiled route table, identical for every tenant
        if (is_file($cache)) {   // tenant-ok: routes cache
            $c = @include $cache;
            if (is_array($c) && ($c['sig'] ?? '') === $sig) {
                return $c['routes'];
            }
        }
        $routes = require self::$root . '/src/routes.php';
        foreach (array_slice($files, 1) as $rf) {
            $routes = array_merge($routes, (array)require $rf);
        }
        $tmp = $cache . '.' . bin2hex(random_bytes(3)) . '.tmp';
        if (@file_put_contents($tmp, '<?php return ' . var_export(['sig' => $sig, 'routes' => $routes], true) . ';') !== false) {
            @rename($tmp, $cache) || @unlink($tmp);   // tenant-ok: routes cache
        }
        return $routes;
    }

    /** gzip dynamic output for remote clients (a loopback browser gains nothing). NEXTMON_GZIP=1 forces, =0 disables. */
    private static function maybeGzip(): void
    {
        $force = getenv('NEXTMON_GZIP');
        if ($force === '0' || PHP_SAPI === 'cli' || !extension_loaded('zlib') || ini_get('zlib.output_compression')) {
            return;
        }
        if (strpos((string)($_SERVER['HTTP_ACCEPT_ENCODING'] ?? ''), 'gzip') === false) {
            return;
        }
        if ($force !== '1' && in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true)) {
            return;
        }
        $p = self::path();
        if ($p === '/backup/download' || strncmp($p, '/reports/export', 15) === 0 || $p === '/sw.js') {
            return;   // downloads / already-small static-ish payloads
        }
        ob_start('ob_gzhandler');
    }

    public static function render(string $__view, array $vars = []): void
    {
        $vars['page'] = $vars['page'] ?? $__view;
        $vars['title'] = $vars['title'] ?? '';
        extract($vars, EXTR_SKIP);
        ob_start();
        include self::$root . '/src/views/' . $__view . '.php';
        $content = ob_get_clean();
        include self::$root . '/src/views/layout.php';
    }

    /** Render without the app shell (login, setup, status, print). */
    public static function renderBare(string $__view, array $vars = []): void
    {
        extract($vars, EXTR_SKIP);
        include self::$root . '/src/views/' . $__view . '.php';
    }

    public static function paginate(array $rows, int $per = 100): array
    {
        $pages = max(1, (int)ceil(count($rows) / $per));
        $pg = max(1, min($pages, (int)self::get('page', '1')));
        return [array_slice($rows, ($pg - 1) * $per, $per), $pg, $pages];
    }

    private static function routerError(RouterOSException $e): void
    {
        if ($e->getMessage() === 'No router configured' && !self::routers() && strncmp(self::path(), '/json/', 6) !== 0) {
            // empty account (first run): a welcome card instead of a "router unreachable" error, same as the Next.js edition
            self::render('error', ['title' => t('Welcome to NextMON'), 'code' => 0, 'page' => '', 'routerHelp' => true,
                'message' => Auth::can('admin') ? t('This account has no router yet. Connect your MikroTik through the RouterOS API, or explore NextMON with a simulated router first.') : t('This account has no router yet. Ask the account owner to add one.')]);
            return;
        }
        Audit::log('router.error', $e->getMessage());
        Notify::event('router', 'Router error (' . self::currentRouterId() . '): ' . $e->getMessage());
        if (strncmp(self::path(), '/json/', 6) === 0) {
            self::json(['ok' => false, 'error' => $e->getMessage()], 502);
        }
        http_response_code(502);
        self::render('error', ['title' => t('Router unreachable'), 'code' => 502, 'message' => $e->getMessage(), 'page' => '', 'routerHelp' => true]);
    }

    // ---- routers (devices) ------------------------------------------------------------------

    /** Routers owned by the ACTIVE workspace (credentials included; cron / monitor / settings use this). */
    public static function ownRouters(): array
    {
        if (Workspace::idOrNull() === null) {
            return [];   // login / setup / error pages: no tenant, no routers
        }
        return (array)Store::read('routers', []);
    }

    /**
     * Routers the active workspace can use: its own + routers shared with it (flagged shared=true, mode ro|rw, owner_ws, owner_name).
     * Shared entries NEVER carry host / user / password: the credentials stay in the owner's workspace and are resolved server-side
     * by driver() / driverFor().
     */
    public static function routers(): array
    {
        $out = self::ownRouters();
        if (Workspace::idOrNull() === null) {
            return $out;
        }
        $have = array_column($out, 'id');
        foreach (Share::incoming() as $sh) {
            if (in_array($sh['router'], $have, true)) {
                continue;   // an own router with the same id wins
            }
            $cfg = self::ownerRouter((string)$sh['owner'], (string)$sh['router']);
            if (!$cfg) {
                continue;
            }
            $out[] = [
                'id' => $cfg['id'], 'name' => $cfg['name'], 'session' => $cfg['session'] ?? $cfg['id'], 'type' => ($cfg['type'] ?? '') === 'demo' ? 'demo' : 'real',
                'host' => '', 'port' => 0, 'ssl' => false, 'user' => '', 'pass' => '', 'hotspot_name' => (string)($cfg['hotspot_name'] ?? ''),
                'shared' => true, 'mode' => $sh['mode'] === 'rw' ? 'rw' : 'ro', 'owner_ws' => $sh['owner'],
                'owner_name' => (string)(Workspace::get((string)$sh['owner'])['name'] ?? ''),
            ];
            $have[] = $cfg['id'];
        }
        return $out;
    }

    private static function ownerRouter(string $ws, string $rid): ?array
    {
        $list = Workspace::run($ws, fn() => (array)Store::read('routers', []));
        foreach ($list as $r) {
            if ($r['id'] === $rid) {
                return $r;
            }
        }
        return null;
    }

    public static function isShared(string $id): bool
    {
        foreach (self::routers() as $r) {
            if ($r['id'] === $id) {
                return !empty($r['shared']);
            }
        }
        return false;
    }

    /** Workspace that owns router $id (the active one unless the router is shared with it). */
    public static function routerOwner(string $id): string
    {
        foreach (self::routers() as $r) {
            if ($r['id'] === $id && !empty($r['shared'])) {
                return (string)$r['owner_ws'];
            }
        }
        return Workspace::idOrNull() ?? '-';
    }

    /** Router config for the UI. For shared routers this is the credential-free view; use driver()/driverFor() to talk to the device. */
    public static function routerCfg(?string $id = null): ?array
    {
        $id = $id ?: self::currentRouterId();
        foreach (self::routers() as $r) {
            if ($r['id'] === $id) {
                return $r;
            }
        }
        return null;
    }

    public static function currentRouterId(): string
    {
        $list = self::routers();
        $want = $_SESSION['router'] ?? '';
        foreach ($list as $r) {
            if ($r['id'] === $want) {
                return $want;
            }
        }
        return $list[0]['id'] ?? '';
    }

    /**
     * Resolve the real config (with credentials) behind a UI router entry, and whether writes are forbidden.
     * @return array [full cfg, owner workspace id, read-only bool]
     */
    private static function resolveCfg(array $cfg): array
    {
        if (empty($cfg['shared'])) {
            return [$cfg, Workspace::idOrNull() ?? '', false];   // (no workspace: only the synthetic configs of connection tests get here)
        }
        $sh = Share::for((string)$cfg['id']);
        if (!$sh || $sh['owner'] !== ($cfg['owner_ws'] ?? '')) {
            throw new RouterOSException('This router is no longer shared with you.');
        }
        $full = self::ownerRouter((string)$sh['owner'], (string)$cfg['id']);
        if (!$full) {
            throw new RouterOSException('This router is no longer shared with you.');
        }
        return [$full, (string)$sh['owner'], $sh['mode'] !== 'rw'];
    }
    public static function demoForced(): bool
    {
        return in_array(strtolower((string)getenv('NEXTMON_DEMO')), ['1', 'true', 'yes', 'on'], true);
    }

    /**
     * Build a driver for one router config.
     * $opt: lazy (connect on first command), persist (reuse the logged-in socket across requests), breaker (fail fast after a
     * recent failure). Default = classic eager connect, no pooling: Monitor / connection tests / one-off lookups.
     * A router shared with this workspace is resolved to the owner's credentials here, and wrapped read-only when the share is `ro`.
     */
    public static function driverFor(array $cfg, array $opt = []): Driver
    {
        [$full, $owner, $ro] = self::resolveCfg($cfg);
        $d = self::buildDriver($full, $opt, $owner);
        return $ro ? new ReadOnlyDriver($d) : $d;
    }

    private static function buildDriver(array $cfg, array $opt, string $ownerWs): Driver
    {
        if (self::demoForced() || ($cfg['type'] ?? '') === 'demo') {
            return new Demo(Workspace::dirFor($ownerWs, 'demo') . '/' . preg_replace('/\W/', '', $cfg['id']) . '.json');
        }
        $r = new RouterOS((string)$cfg['host'], (int)($cfg['port'] ?: 8728), !empty($cfg['ssl']), 5, !empty($cfg['verify_tls']));
        $r->setConnectTimeout(self::tuning('router_connect_timeout', 'NEXTMON_ROUTER_CONNECT_TIMEOUT', 4));
        if (!empty($opt['persist'])) {
            $r->enablePersistence(self::tuning('router_keepalive', 'NEXTMON_ROUTER_KEEPALIVE', 60));
        }
        if (!empty($opt['breaker'])) {
            $r->enableBreaker(self::tuning('router_fail_ttl', 'NEXTMON_ROUTER_FAIL_TTL', 15));
        }
        $pass = Crypto::decrypt((string)($cfg['pass'] ?? ''));
        if (!empty($opt['lazy'])) {
            $r->setCredentials((string)$cfg['user'], $pass);
        } else {
            $r->connect((string)$cfg['user'], $pass);
        }
        return $r;
    }
    /** Integer tuning knob: env var wins, then Settings, then default. 0 is a valid value (disables the feature). */
    public static function tuning(string $setting, string $env, int $default): int
    {
        $e = getenv($env);
        if ($e !== false && $e !== '' && is_numeric($e)) {
            return (int)$e;
        }
        $v = Store::setting($setting, null);
        return is_numeric($v) ? (int)$v : $default;
    }

    /** Per-request router driver: lazy connect, pooled socket, circuit breaker and (remote routers) the short read cache. */
    public static function driver(?string $id = null): Driver
    {
        $cfg = self::routerCfg($id);
        if (!$cfg) {
            throw new RouterOSException('No router configured');
        }
        $mk = Workspace::id() . '/' . $cfg['id'];   // one driver per workspace + router: cron / tests switch workspaces inside one process
        if (isset(self::$drivers[$mk])) {
            return self::$drivers[$mk];
        }
        [$full, $owner, $ro] = self::resolveCfg($cfg);
        $d = self::buildDriver($full, ['lazy' => true, 'persist' => true, 'breaker' => true], $owner);
        if (!$d->isDemo() && self::tuning('router_cache', 'NEXTMON_RCACHE', 1) !== 0) {
            $d = new CachedDriver($d, (string)$cfg['id'], $owner);
        }
        if ($ro) {
            $d = new ReadOnlyDriver($d);
        }
        return self::$drivers[$mk] = $d;
    }
    /** Drop the per-request driver cache (tests, or after the router config changed). */
    public static function forgetDrivers(): void
    {
        self::$drivers = [];
    }
    public static function isDemo(): bool
    {
        $cfg = self::routerCfg();
        return self::demoForced() || ($cfg['type'] ?? '') === 'demo';
    }

    public static function setTimeout(Driver $d, int $s): void
    {
        if ($d instanceof RouterOS || $d instanceof CachedDriver || $d instanceof ReadOnlyDriver) {
            $d->setTimeout($s);
        }
    }
}
