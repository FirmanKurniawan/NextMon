<?php
/**
 * Users, roles, sessions, CSRF and login rate limiting.
 * Roles -> capabilities:  platform (everything + 'platform') | admin (workspace owner: all but 'platform') | operator (no admin) |
 * reseller (view+sell) | viewer (view).
 * Every user belongs to ONE workspace (user['workspace']); a platform admin can switch into another workspace (impersonation).
 */
final class Auth
{
    /** Roles an owner can hand out inside a workspace (no 'platform'). */
    public const ROLES = ['admin', 'operator', 'reseller', 'viewer'];
    /** Every role that exists. 'platform' = platform admin, who is also the owner of their own workspace. */
    public const ALL_ROLES = ['platform', 'admin', 'operator', 'reseller', 'viewer'];
    private const CAPS = [
        'platform' => ['view', 'sell', 'write', 'admin', 'platform'],
        'admin' => ['view', 'sell', 'write', 'admin'],
        'operator' => ['view', 'sell', 'write'],
        'reseller' => ['view', 'sell'],
        'viewer' => ['view'],
    ];
    private const MAX_FAILS = 5;
    private const LOCK_SECONDS = 600;

    private static ?array $cur = null;

    /** EVERY user of every workspace (login lookup, platform pages). Use users() for anything a workspace admin may see. */
    public static function allUsers(): array
    {
        return (array)Store::global('users')->read([]);
    }

    /** Users of the ACTIVE workspace (all users when no workspace is active: setup / login only). */
    public static function users(): array
    {
        $all = self::allUsers();
        $ws = Workspace::idOrNull();
        if ($ws === null) {
            return $all;
        }
        return array_values(array_filter($all, fn($u) => (string)($u['workspace'] ?? 'main') === $ws));
    }

    /** One user of the ACTIVE workspace by id (null for anybody else's). */
    public static function inWorkspace(string $id): ?array
    {
        foreach (self::users() as $u) {
            if ($u['id'] === $id) {
                return $u;
            }
        }
        return null;
    }

    public static function hasUsers(): bool
    {
        return count(self::allUsers()) > 0;
    }

    /** Case-insensitive lookup across the whole platform (usernames are unique platform-wide). */
    public static function find(string $username): ?array
    {
        foreach (self::allUsers() as $u) {
            if (strcasecmp($u['username'], $username) === 0) {
                return $u;
            }
        }
        return null;
    }

    /** bcrypt, cost >= 12 on every PHP version (PHP < 8.4 defaults to 10). */
    public static function hash(string $password): string
    {
        return password_hash($password, PASSWORD_DEFAULT, ['cost' => 12]);
    }

    /**
     * Create the very first account atomically: false when somebody else got there first. It is the PLATFORM admin and the owner of
     * workspace `main` (created here, with the demo router, so a fresh install behaves like before).
     */
    public static function createFirstAdmin(string $username, string $password): bool
    {
        $made = false;
        $uid = bin2hex(random_bytes(6));
        Store::global('users')->update(function ($list) use ($username, $password, &$made, $uid) {
            if ($list) {
                return $list;
            }
            $made = true;
            return [[
                'id' => $uid, 'username' => $username, 'name' => $username,
                'hash' => self::hash($password), 'role' => 'platform', 'workspace' => 'main', 'created' => time(),
            ]];
        }, []);
        if ($made) {
            Workspace::ensureMain($uid, (string)Store::defaults()['hotspot_name']);
            Workspace::run('main', fn() => App::seedDemoRouter());
        }
        return $made;
    }

    /**
     * Add a user to $workspace (default: the active one). Unknown roles become viewer. This is the LOW-LEVEL call (tests, platform
     * tooling, migration): it accepts 'platform'; UI code that lets an owner pick a role must first check it against Auth::ROLES.
     * Returns the stored row.
     */
    public static function create(string $username, string $password, string $role, string $name = '', ?string $workspace = null): array
    {
        $workspace ??= Workspace::id();
        if (!Workspace::valid($workspace)) {
            throw new InvalidArgumentException('Invalid workspace id');
        }
        $role = in_array($role, self::ALL_ROLES, true) ? $role : 'viewer';
        $row = [
            'id' => bin2hex(random_bytes(6)),
            'username' => $username,
            'name' => $name ?: $username,
            'hash' => self::hash($password),
            'role' => $role,
            'workspace' => $workspace,
            'created' => time(),
        ];
        Store::global('users')->update(function ($list) use ($row) {
            $list[] = $row;
            return $list;
        }, []);
        return $row;
    }

    public static function user(): ?array
    {
        if (self::$cur !== null) {
            return self::$cur ?: null;
        }
        $id = $_SESSION['uid'] ?? null;
        self::$cur = [];
        if ($id) {
            foreach (self::allUsers() as $u) {
                if ($u['id'] === $id) {
                    self::bindWorkspace($u);
                    break;
                }
            }
        }
        // [SECURITY-HOOK] idle timeout + revoked sessions (src/Security.php)
        if (self::$cur && !Security::sessionValid(self::$cur)) {
            unset($_SESSION['uid']);
            self::$cur = [];
        }
        // [/SECURITY-HOOK]
        return self::$cur ?: null;
    }

    /**
     * Fix the active workspace for this request from the SERVER-SIDE session user (never from client input), unless the user is a
     * platform admin who switched ($_SESSION['ws_switch'], set only by PlatformController after CSRF + audit).
     * A suspended or deleted workspace locks its users out (platform admins are exempt from suspension so they can manage it).
     */
    private static function bindWorkspace(array $u): void
    {
        $home = (string)($u['workspace'] ?? 'main');
        $ws = $home;
        $isPlatform = ($u['role'] ?? '') === 'platform';
        $sw = $_SESSION['ws_switch'] ?? '';
        if ($isPlatform && is_string($sw) && $sw !== '' && Workspace::valid($sw) && Workspace::exists($sw)) {
            $ws = $sw;
        }
        $st = Workspace::valid($ws) ? Workspace::status($ws) : null;
        if ($st === null || ($st !== 'active' && !$isPlatform)) {
            unset($_SESSION['uid'], $_SESSION['ws_switch']);
            return;
        }
        Workspace::set($ws);
        App::$impersonating = $ws !== $home;
        self::$cur = $u;
    }

    /** Forget the per-request user (tests, after login/logout). */
    public static function forget(): void
    {
        self::$cur = null;
    }

    public static function check(): bool
    {
        return self::user() !== null;
    }

    public static function can(string $cap): bool
    {
        $u = self::user();
        return $u && in_array($cap, self::CAPS[$u['role']] ?? [], true);
    }

    // ---- CSRF --------------------------------------------------------------------

    public static function csrf(): string
    {
        if (empty($_SESSION['csrf'])) {
            App::openSession();
            $_SESSION['csrf'] = bin2hex(random_bytes(24));
        }
        return $_SESSION['csrf'];
    }

    public static function verifyCsrf(): bool
    {
        $tok = $_POST['_csrf'] ?? ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
        return is_string($tok) && $tok !== '' && hash_equals(self::csrf(), $tok);
    }

    // ---- login -------------------------------------------------------------------

    /** @return array [bool ok, string message] */
    public static function attempt(string $username, string $password, string $ip): array
    {
        $username = mb_substr(trim($username), 0, 64);
        $uname = strtolower($username);
        $keyU = 'u:' . $uname . '|' . $ip;
        $keyI = 'ip:' . $ip;
        $keyG = 'g:' . $uname;   // all sources together: stops a botnet that rotates IPs against one account
        $now = time();
        $att = (array)Store::read('login_attempts', []);
        foreach ([$keyU, $keyI, $keyG] as $k) {
            if (isset($att[$k]['until']) && $att[$k]['until'] > $now) {
                $min = (int)ceil(($att[$k]['until'] - $now) / 60);
                return [false, t('Too many attempts. Try again in :m min.', [':m' => $min])];
            }
        }
        $u = self::find($username);
        // constant-ish time: always verify against some hash
        $hash = $u['hash'] ?? '$2y$10$usesomesillystringfore7hnbRJHxXVLeakoG8K30oukPsA.ztMG';
        $ok = strlen($password) <= 1024 && password_verify($password, $hash) && $u !== null;

        Store::update('login_attempts', function ($a) use ($ok, $keyU, $keyI, $keyG, $now) {
            foreach ([$keyU => self::MAX_FAILS, $keyI => self::MAX_FAILS * 4, $keyG => self::MAX_FAILS * 6] as $k => $max) {
                if ($ok) {
                    if ($k !== $keyI) {
                        unset($a[$k]);
                    }
                    continue;
                }
                $e = $a[$k] ?? ['n' => 0, 't' => $now];
                if ($now - $e['t'] > self::LOCK_SECONDS) {
                    $e = ['n' => 0, 't' => $now];
                }
                $e['n']++;
                if ($e['n'] >= $max) {
                    $e['until'] = $now + self::LOCK_SECONDS;
                }
                $a[$k] = $e;
            }
            // prune old
            foreach ($a as $k => $e) {
                if ($now - ($e['t'] ?? 0) > 86400) {
                    unset($a[$k]);
                }
            }
            return $a;
        }, []);

        if (!$ok) {
            $shown = preg_replace('/[^\P{C}]/u', '', mb_substr($username, 0, 40));   // may be a mistyped password: keep it short, no control chars
            // the failure is recorded in the audit log of the account's workspace; an unknown name belongs to no tenant, so it goes to the
            // active workspace if there is one (tests / CLI), else to the platform log
            $ws = $u !== null ? (string)($u['workspace'] ?? 'main') : Workspace::idOrNull();
            if (is_string($ws) && Workspace::valid($ws)) {
                Workspace::run($ws, function () use ($shown, $ip) {
                    Audit::log('login.fail', $shown);
                    Notify::event('login', 'Failed login for "' . $shown . '" from ' . $ip);
                });
            } else {
                Store::global('platform_audit')->append(['ts' => time(), 'user' => '-', 'ip' => $ip, 'workspace' => '', 'action' => 'login.fail', 'detail' => $shown]);
            }
            return [false, t('Wrong username or password.')];
        }
        // right password, but the workspace was suspended / deleted: platform admins still get in, everybody else is told why
        $home = (string)($u['workspace'] ?? 'main');
        if (($u['role'] ?? '') !== 'platform' && Workspace::status($home) !== 'active') {
            Workspace::run($home, fn() => Audit::log('login.blocked', $u['username']));
            return [false, t('This account is suspended. Contact the platform administrator.')];
        }
        if (password_needs_rehash($u['hash'], PASSWORD_DEFAULT, ['cost' => 12])) {
            $nh = self::hash($password);
            Store::global('users')->update(function ($l) use ($u, $nh) {
                foreach ($l as $i => $x) {
                    if ($x['id'] === $u['id']) {
                        $l[$i]['hash'] = $nh;
                    }
                }
                return $l;
            }, []);
        }
        self::completeLogin($u);
        return [true, ''];
    }

    /** [SECURITY-HOOK] Final step of a successful login: new session id, CSRF, session registry, audit. */
    public static function completeLogin(array $u, string $note = ''): void
    {
        session_regenerate_id(true);
        $_SESSION['uid'] = $u['id'];
        unset($_SESSION['ws_switch'], $_SESSION['router']);
        $_SESSION['csrf'] = bin2hex(random_bytes(24));
        self::$cur = null;
        App::$impersonating = false;
        Workspace::set((string)($u['workspace'] ?? 'main'));
        Security::register($u);
        Audit::log('login', $u['username'] . $note);
    }

    public static function logout(): void
    {
        if (Workspace::idOrNull() !== null) {
            Audit::log('logout');
        }
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $p = session_get_cookie_params();
            setcookie(session_name(), '', time() - 3600, $p['path'], $p['domain'], $p['secure'], $p['httponly']);
        }
        session_destroy();
        self::$cur = null;
        App::$impersonating = false;
        Workspace::clear();
    }

    public static function roleLabel(string $r): string
    {
        return t(ucfirst($r));
    }
}
