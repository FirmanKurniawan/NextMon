<?php
/**
 * Security settings: password policy, idle session timeout, session registry (list / revoke), login history.
 * Settings live in settings.json under "security". Session registry: data/sessions_meta.json (session ids are only stored hashed).
 */
final class Security
{
    public const DEFAULTS = [
        'pw_min' => 8, 'pw_upper' => false, 'pw_digit' => false, 'pw_symbol' => false, 'pw_no_username' => true,
        'timeout_min' => 480, // idle timeout in minutes (default 8 h); 0 = off (browser-session cookie only)
    ];
    private const TOUCH_EVERY = 60;
    private const KEEP_DAYS = 30;

    public static function policy(): array
    {
        // platform-wide policy is the floor-setting; a workspace may only override what the platform left at its default
        $base = array_replace(self::DEFAULTS, (array)(Workspace::platform()['security'] ?? []));
        $p = array_replace($base, (array)Store::setting('security', []));
        $p['pw_min'] = max(8, min(64, (int)$p['pw_min']));
        $p['timeout_min'] = max(0, min(43200, (int)$p['timeout_min']));
        return $p;
    }

    public static function savePolicy(array $in): void
    {
        $cur = (array)Store::setting('security', []);
        Store::saveSettings(['security' => array_replace($cur, [
            'pw_min' => max(8, min(64, (int)($in['pw_min'] ?? 8))),
            'pw_upper' => !empty($in['pw_upper']), 'pw_digit' => !empty($in['pw_digit']),
            'pw_symbol' => !empty($in['pw_symbol']), 'pw_no_username' => !empty($in['pw_no_username']),
            'timeout_min' => max(0, min(43200, (int)($in['timeout_min'] ?? 0))),
        ])]);
    }

    /** Human readable problem with the password, or null if it satisfies the policy. */
    public static function passwordError(string $pw, string $username = ''): ?string
    {
        $p = self::policy();
        if (strpos($pw, "\0") !== false) {
            return t('Password contains an invalid character.');
        }
        if (strlen($pw) > 72) { // bcrypt silently ignores everything after 72 bytes: refuse instead of pretending
            return t('Password must be at most 72 bytes.');
        }
        if (mb_strlen($pw) < $p['pw_min']) {
            return t('Password must be at least :n characters.', [':n' => $p['pw_min']]);
        }
        if ($p['pw_upper'] && !(preg_match('/\p{Lu}/u', $pw) && preg_match('/\p{Ll}/u', $pw))) {
            return t('Password must contain both upper and lower case letters.');
        }
        if ($p['pw_digit'] && !preg_match('/\d/', $pw)) {
            return t('Password must contain a digit.');
        }
        if ($p['pw_symbol'] && !preg_match('/[^\p{L}\d]/u', $pw)) {
            return t('Password must contain a symbol.');
        }
        if ($p['pw_no_username'] && $username !== '' && stripos($pw, $username) !== false) {
            return t('Password must not contain the username.');
        }
        return null;
    }

    public static function policyText(): string
    {
        $p = self::policy();
        $parts = [t(':n+ characters', [':n' => $p['pw_min']])];
        if ($p['pw_upper']) {
            $parts[] = t('upper and lower case');
        }
        if ($p['pw_digit']) {
            $parts[] = t('a digit');
        }
        if ($p['pw_symbol']) {
            $parts[] = t('a symbol');
        }
        return implode(', ', $parts);
    }

    // ---- session registry ---------------------------------------------------------------------

    private static function sid(): string
    {
        return hash('sha256', session_id());
    }

    private static function ua(): string
    {
        return mb_substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 200);
    }

    /** Called after a successful login (session id already regenerated). */
    public static function register(array $u): void
    {
        $now = time();
        $_SESSION['kl_seen'] = $now;
        Store::update('sessions_meta', function ($m) use ($u, $now) {
            $m['s'][self::sid()] = ['uid' => $u['id'], 'ip' => Audit::ip(), 'ua' => self::ua(), 'created' => $now, 'last' => $now];
            return self::prune($m, $now);
        }, ['s' => [], 'revoked' => []]);
    }

    private static function prune(array $m, int $now): array
    {
        $cut = $now - self::KEEP_DAYS * 86400;
        foreach ((array)($m['s'] ?? []) as $k => $e) {
            if (($e['last'] ?? 0) < $cut) {
                unset($m['s'][$k]);
            }
        }
        foreach ((array)($m['revoked'] ?? []) as $k => $ts) {
            if ($ts < $cut) {
                unset($m['revoked'][$k]);
            }
        }
        return $m;
    }

    /** Idle timeout / revocation check for the logged-in user. Cheap: one small JSON read per request. */
    public static function sessionValid(array $u): bool
    {
        $now = time();
        $sid = self::sid();
        $meta = (array)Store::read('sessions_meta', []);
        if (isset($meta['revoked'][$sid])) {
            Audit::log('session.revoked', $u['username']);
            return false;
        }
        $p = self::policy();
        $last = (int)($_SESSION['kl_seen'] ?? 0);
        if ($p['timeout_min'] > 0 && $last > 0 && $now - $last > $p['timeout_min'] * 60) {
            Audit::log('session.timeout', $u['username']);
            return false;
        }
        if ($now - $last >= self::TOUCH_EVERY || !isset($meta['s'][$sid])) {
            $_SESSION['kl_seen'] = $now;
            Store::update('sessions_meta', function ($m) use ($u, $sid, $now) {
                $e = $m['s'][$sid] ?? ['uid' => $u['id'], 'created' => $now, 'ua' => self::ua()];
                $e['ip'] = Audit::ip();
                $e['last'] = $now;
                $m['s'][$sid] = $e;
                return $m;
            }, ['s' => [], 'revoked' => []]);
        }
        return true;
    }

    /** @return array [hash => entry] for one user (or everyone when $uid is null), newest first */
    public static function sessions(?string $uid = null): array
    {
        $m = (array)Store::read('sessions_meta', []);
        $out = [];
        foreach ((array)($m['s'] ?? []) as $h => $e) {
            if (isset($m['revoked'][$h]) || ($uid !== null && ($e['uid'] ?? '') !== $uid)) {
                continue;
            }
            $out[$h] = $e;
        }
        uasort($out, fn($a, $b) => ($b['last'] ?? 0) <=> ($a['last'] ?? 0));
        return $out;
    }

    public static function currentHash(): string
    {
        return self::sid();
    }

    public static function revoke(string $hash): bool
    {
        $found = false;
        Store::update('sessions_meta', function ($m) use ($hash, &$found) {
            if (isset($m['s'][$hash])) {
                $found = true;
                unset($m['s'][$hash]);
                $m['revoked'][$hash] = time();
            }
            return $m;
        }, ['s' => [], 'revoked' => []]);
        return $found;
    }

    /** Revoke every session of $uid except the current one. Returns how many. */
    public static function revokeOthers(string $uid): int
    {
        $n = 0;
        $me = self::sid();
        Store::update('sessions_meta', function ($m) use ($uid, $me, &$n) {
            foreach ((array)($m['s'] ?? []) as $h => $e) {
                if (($e['uid'] ?? '') === $uid && $h !== $me) {
                    unset($m['s'][$h]);
                    $m['revoked'][$h] = time();
                    $n++;
                }
            }
            return $m;
        }, ['s' => [], 'revoked' => []]);
        return $n;
    }

    /** Short "Chrome / Windows" style label for a user agent. */
    public static function uaLabel(string $ua): string
    {
        if ($ua === '') {
            return '-';
        }
        $b = 'Browser';
        foreach (['Edg' => 'Edge', 'OPR' => 'Opera', 'Firefox' => 'Firefox', 'Chrome' => 'Chrome', 'Safari' => 'Safari', 'curl' => 'curl'] as $k => $v) {
            if (stripos($ua, $k) !== false) {
                $b = $v;
                break;
            }
        }
        $os = '';
        foreach (['Windows' => 'Windows', 'Android' => 'Android', 'iPhone' => 'iOS', 'iPad' => 'iOS', 'Mac OS' => 'macOS', 'Linux' => 'Linux'] as $k => $v) {
            if (stripos($ua, $k) !== false) {
                $os = $v;
                break;
            }
        }
        return $b . ($os ? ' / ' . $os : '');
    }

    // ---- login history (from the audit log) -----------------------------------------------------

    public static function loginHistory(?string $username = null, int $n = 100): array
    {
        $out = [];
        foreach (Store::tailLog('audit.log', 5000) as $a) {
            $act = (string)($a['action'] ?? '');
            if (!preg_match('/^(login|logout|session\.|password\.)/', $act)) {
                continue;
            }
            if ($username !== null) {
                // failed logins carry the attempted name in detail; the rest carry the actor in user
                $who = strncmp($act, 'login.fail', 10) === 0 ? (string)$a['detail'] : (string)$a['user'];
                if (strcasecmp($who, $username) !== 0) {
                    continue;
                }
            }
            $out[] = $a;
            if (count($out) >= $n) {
                break;
            }
        }
        return $out;
    }
}
