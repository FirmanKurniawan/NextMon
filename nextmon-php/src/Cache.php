<?php
/**
 * Tiny TTL cache for derived / remote data (never for source-of-truth data: that is Store).
 * Backend: APCu when loaded and enabled for this SAPI, else files in data/cache (atomic tmp+rename, no locks needed).
 * Values are stored with serialize() (no objects), optionally encrypted at rest ($secret) for payloads that hold voucher
 * passwords. Expired files are swept opportunistically.
 *
 * MULTI-TENANT: every key is namespaced with the active workspace (or '-' when none), so two tenants can never share an entry. Router-scoped
 * keys ('rt:<owner workspace>:<router>', 'rd:...', see CachedDriver) already carry the workspace of the router's OWNER and are used as is,
 * which lets a workspace that a router is shared with see (and invalidate) the same entries.
 *
 * Generations give cheap invalidation of a whole group: entries remember Cache::gen($ns) at fetch start and are only valid
 * while it is unchanged; Cache::bump($ns) invalidates every entry of the group at once, across processes.
 */
final class Cache
{
    /** @var array<string,mixed> per-request memo of generation lookups (a bump in this request updates it) */
    private static array $genMemo = [];

    private static function useApcu(): bool
    {
        static $on = null;
        return $on ??= (function_exists('apcu_fetch') && function_exists('apcu_enabled') && apcu_enabled() && getenv('NEXTMON_CACHE') !== 'file');
    }

    public static function backend(): string
    {
        return self::useApcu() ? 'apcu' : 'file';
    }

    /** Cache files live in the cache dir of the workspace the key belongs to (data/ws/<id>/cache); workspace-less keys in data/cache. */
    private static function file(string $key): string
    {
        if (preg_match('/^(main|w_[a-f0-9]{8})\|/', $key, $m) || preg_match('/^(?:rd:|gen:)*rt:(main|w_[a-f0-9]{8}):/', $key, $m)) {
            $dir = Workspace::dirFor($m[1], 'cache');
        } else {
            $dir = Store::dir() . '/cache';   // tenant-ok: keys without a workspace carry no tenant data (login page, platform level)
        }
        return $dir . '/c-' . substr(hash('sha256', $key), 0, 32) . '.dat';
    }

    private static function akey(string $key): string
    {
        return 'nm:' . substr(hash('sha256', Store::dir()), 0, 8) . ':' . $key;
    }

    /** Namespace a key with the active workspace (router-scoped keys carry their owner already). */
    private static function k(string $key): string
    {
        if (strncmp($key, 'rt:', 3) === 0 || strncmp($key, 'rd:', 3) === 0 || strncmp($key, 'gen:rt:', 7) === 0) {
            return $key;
        }
        return (Workspace::idOrNull() ?? '-') . '|' . $key;
    }

    /** @return mixed|null null on miss / expired */
    public static function get(string $key)
    {
        $key = self::k($key);
        if (self::useApcu()) {
            $v = apcu_fetch(self::akey($key), $ok);
            return $ok ? $v : null;
        }
        $f = self::file($key);
        $raw = @file_get_contents($f);
        if ($raw === false || $raw === '') {
            return null;
        }
        $secret = $raw[0] === 'E';
        $body = substr($raw, 1);
        if ($secret) {
            try {
                $body = Crypto::decrypt($body);
            } catch (Throwable $e) {
                return null;
            }
        }
        $d = @unserialize($body, ['allowed_classes' => false]);
        if (!is_array($d) || $d[0] < time()) {
            return null;
        }
        return $d[1];
    }

    public static function set(string $key, $value, int $ttl, bool $secret = false): void
    {
        $key = self::k($key);
        if ($ttl <= 0) {
            return;
        }
        if (self::useApcu()) {
            apcu_store(self::akey($key), $value, $ttl);
            return;
        }
        $body = serialize([time() + $ttl, $value]);
        if ($secret) {
            try {
                $body = 'E' . Crypto::encrypt($body);
            } catch (Throwable $e) {
                return; // cannot protect it: do not store it
            }
        } else {
            $body = 'P' . $body;
        }
        $f = self::file($key);
        $tmp = $f . '.' . bin2hex(random_bytes(4)) . '.tmp';
        if (@file_put_contents($tmp, $body) === false) {
            return;
        }
        if (!@rename($tmp, $f)) { // Windows refuses to replace a file another process has open: not fatal, just no cache
            @unlink($tmp);
        }
        if (random_int(1, 300) === 1) {
            self::sweep();
        }
    }

    public static function delete(string $key): void
    {
        $key = self::k($key);
        if (self::useApcu()) {
            apcu_delete(self::akey($key));
            return;
        }
        @unlink(self::file($key));
    }

    /** Current generation token of a group ('0' when never bumped). */
    public static function gen(string $ns): string
    {
        $mk = self::k('gen:' . $ns);
        if (isset(self::$genMemo[$mk])) {
            return self::$genMemo[$mk];
        }
        $g = self::get('gen:' . $ns);
        return self::$genMemo[$mk] = is_string($g) ? $g : '0';
    }

    /** Invalidate every entry that was stored under the previous generation. */
    public static function bump(string $ns): void
    {
        $g = bin2hex(random_bytes(5));
        self::$genMemo[self::k('gen:' . $ns)] = $g;
        self::set('gen:' . $ns, $g, 86400 * 30);
    }

    /** Forget per-request memos (tests; long-running workers). */
    public static function reset(): void
    {
        self::$genMemo = [];
    }

    /** Remove expired / abandoned cache files (called ~1/300 writes, and by cron). Returns files removed. */
    public static function sweep(int $maxAge = 3600): int
    {
        $n = 0;
        // tenant-ok: sweeping expired derived files only (data/cache and every data/ws/<id>/cache); no content is read
        foreach (array_merge(glob(Store::dir() . '/cache/c-*.{dat,tmp}', GLOB_BRACE) ?: [], glob(Store::dir() . '/ws/*/cache/c-*.{dat,tmp}', GLOB_BRACE) ?: []) as $f) {
            $age = time() - (int)@filemtime($f);
            if ($age > $maxAge && $age > 0) {
                // long-lived entries (generations, breakers) are rewritten when needed; anything untouched for an hour is garbage
                if (@unlink($f)) {
                    $n++;
                }
            }
        }
        return $n;
    }
}
