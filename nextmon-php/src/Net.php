<?php
/**
 * Network trust helpers: real client IP behind a reverse proxy (only when the proxy is trusted), HTTPS detection,
 * generic rate limiting, and SSRF guards for outbound requests to user-supplied URLs.
 *
 * Trusted proxies: env NEXTMON_TRUSTED_PROXIES="10.0.0.5,172.18.0.0/16" (default: loopback only). X-Forwarded-For and
 * X-Forwarded-Proto are IGNORED unless the TCP peer (REMOTE_ADDR) is one of them, so a client can never spoof its IP
 * to dodge the login/status/shop rate limits.
 */
final class Net
{
    /** @return string[] rules (IP or CIDR) */
    public static function trustedProxies(): array
    {
        $env = trim((string)getenv('NEXTMON_TRUSTED_PROXIES'));
        $list = $env === '' ? [] : (preg_split('/[\s,;]+/', $env, -1, PREG_SPLIT_NO_EMPTY) ?: []);
        return array_merge(['127.0.0.0/8', '::1'], $list);
    }

    public static function isTrusted(string $ip): bool
    {
        foreach (self::trustedProxies() as $rule) {
            if (Shop::ipMatch($ip, $rule)) {
                return true;
            }
        }
        return false;
    }

    public static function fromTrustedProxy(): bool
    {
        $ra = (string)($_SERVER['REMOTE_ADDR'] ?? '');
        return $ra !== '' && self::isTrusted($ra);
    }

    /** The client IP used for rate limits and audit rows. */
    public static function clientIp(): string
    {
        $ra = (string)($_SERVER['REMOTE_ADDR'] ?? 'cli');
        if (!self::fromTrustedProxy()) {
            return $ra;
        }
        $xff = (string)($_SERVER['HTTP_X_FORWARDED_FOR'] ?? '');
        if ($xff === '') {
            return $ra;
        }
        // walk from the right (closest hop) and skip our own proxies; the first foreign address is the client
        $parts = array_reverse(array_map('trim', explode(',', $xff)));
        foreach ($parts as $p) {
            if (filter_var($p, FILTER_VALIDATE_IP) === false) {
                return $ra; // garbage in the chain: do not guess
            }
            if (!self::isTrusted($p)) {
                return $p;
            }
        }
        return $ra;
    }

    public static function isHttps(): bool
    {
        if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') {
            return true;
        }
        return self::fromTrustedProxy() && strtolower((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
    }

    /** Host[:port] of this request, validated (Host header injection guard). NEXTMON_BASE_URL wins when set. */
    public static function host(): string
    {
        $h = (string)($_SERVER['HTTP_HOST'] ?? '');
        if ($h === '' || !preg_match('/^[A-Za-z0-9.\-]+(:\d{1,5})?$|^\[[0-9A-Fa-f:.]+\](:\d{1,5})?$/', $h)) {
            $h = (string)($_SERVER['SERVER_NAME'] ?? 'localhost');
            if (!preg_match('/^[A-Za-z0-9.\-]+$|^[0-9A-Fa-f:.]+$/', $h)) {
                $h = 'localhost';
            }
        }
        return $h;
    }

    // ---- rate limiting ------------------------------------------------------------------------

    /**
     * Fixed-window counter. Returns true when this call is OVER the limit (every call counts as one attempt).
     * Stored in doc "rate_limits"; expired and surplus entries are pruned so the file cannot grow without bound.
     */
    public static function hit(string $bucket, string $key, int $max, int $windowSec): bool
    {
        $over = false;
        Store::update('rate_limits', function ($a) use ($bucket, $key, $max, $windowSec, &$over) {
            $now = time();
            foreach ($a as $k => $e) {
                if ($now - ($e['t'] ?? 0) > ($e['w'] ?? 0)) {
                    unset($a[$k]);
                }
            }
            if (count($a) > 5000) {
                uasort($a, fn($x, $y) => ($x['t'] ?? 0) <=> ($y['t'] ?? 0));
                $a = array_slice($a, -2500, null, true);
            }
            $k = $bucket . '|' . mb_substr($key, 0, 80);
            $e = $a[$k] ?? ['n' => 0, 't' => $now, 'w' => $windowSec];
            $e['n']++;
            $over = $e['n'] > $max;
            $a[$k] = $e;
            return $a;
        }, []);
        return $over;
    }

    // ---- SSRF guard --------------------------------------------------------------------------------

    public static function allowPrivateTargets(): bool
    {
        return in_array(strtolower((string)getenv('NEXTMON_ALLOW_PRIVATE_WEBHOOK')), ['1', 'true', 'yes', 'on'], true);
    }

    /** True when $ip is a globally routable unicast address (not loopback / private / link-local / CGNAT / reserved / multicast). */
    public static function isPublicIp(string $ip): bool
    {
        if (filter_var($ip, FILTER_VALIDATE_IP) === false) {
            return false;
        }
        $bin = inet_pton($ip);
        if ($bin === false) {
            return false;
        }
        if (strlen($bin) === 16) {
            // IPv4-mapped / compatible / NAT64: judge the embedded IPv4 address
            if (substr($bin, 0, 12) === str_repeat("\0", 10) . "\xff\xff" || substr($bin, 0, 12) === str_repeat("\0", 12) || substr($bin, 0, 12) === "\x00\x64\xff\x9b" . str_repeat("\0", 8)) {
                return self::isPublicIp(inet_ntop(substr($bin, 12)) ?: '0.0.0.0');
            }
            $first = ord($bin[0]);
            $second = ord($bin[1]);
            if ($first === 0xFF || ($first & 0xFE) === 0xFC || ($first === 0xFE && ($second & 0xC0) === 0x80) || ($first === 0xFE && ($second & 0xC0) === 0xC0)) {
                return false; // multicast, unique-local, link-local, site-local
            }
            if ($first === 0x20 && $second === 0x01 && ord($bin[2]) === 0x0D && ord($bin[3]) === 0xB8) {
                return false; // documentation
            }
            return $bin !== str_repeat("\0", 15) . "\x01" && $bin !== str_repeat("\0", 16);
        }
        $o = array_map('ord', str_split($bin));
        if ($o[0] >= 224) {
            return false; // multicast + reserved + broadcast
        }
        if ($o[0] === 100 && $o[1] >= 64 && $o[1] <= 127) {
            return false; // CGNAT 100.64.0.0/10
        }
        if ($o[0] === 192 && $o[1] === 0 && $o[2] === 0) {
            return false; // 192.0.0.0/24 IETF protocol assignments
        }
        if ($o[0] === 198 && ($o[1] === 18 || $o[1] === 19)) {
            return false; // benchmarking
        }
        return filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) !== false;
    }

    /** @return string[] all A/AAAA addresses of $host (the literal itself when $host is an IP) */
    public static function resolve(string $host): array
    {
        $host = trim($host, '[]');
        if (filter_var($host, FILTER_VALIDATE_IP) !== false) {
            return [$host];
        }
        $ips = [];
        foreach ((array)@gethostbynamel($host) as $ip) {
            $ips[] = (string)$ip;
        }
        if (function_exists('dns_get_record')) {
            foreach ((array)@dns_get_record($host, DNS_AAAA) as $r) {
                if (!empty($r['ipv6'])) {
                    $ips[] = (string)$r['ipv6'];
                }
            }
        }
        return array_values(array_unique($ips));
    }

    /**
     * Validate a user-supplied http(s) URL for server-side requests.
     * @param array|null $pin out: ["host:port:ip", ...] suitable for CURLOPT_RESOLVE (defeats DNS rebinding)
     * @return string '' when OK, otherwise a short English reason
     */
    public static function checkOutboundUrl(string $url, ?array &$pin = null): string
    {
        $pin = [];
        if (strlen($url) > 500 || preg_match('/[\x00-\x20\x7f\\\\]/', $url)) {
            return 'invalid URL';
        }
        $p = parse_url($url);
        if (!$p || !isset($p['scheme'], $p['host']) || !in_array(strtolower($p['scheme']), ['http', 'https'], true)) {
            return 'only http(s) URLs are allowed';
        }
        if (isset($p['user']) || isset($p['pass'])) {
            return 'credentials in the URL are not allowed';
        }
        $port = (int)($p['port'] ?? (strtolower($p['scheme']) === 'https' ? 443 : 80));
        if ($port < 1 || $port > 65535) {
            return 'invalid port';
        }
        $ips = self::resolve((string)$p['host']);
        if (!$ips) {
            return 'host does not resolve';
        }
        foreach ($ips as $ip) {
            if (!self::isPublicIp($ip) && !self::allowPrivateTargets()) {
                return 'target address is not public (internal addresses are blocked; set NEXTMON_ALLOW_PRIVATE_WEBHOOK=1 to allow)';
            }
        }
        foreach ($ips as $ip) {
            $pin[] = trim((string)$p['host'], '[]') . ':' . $port . ':' . $ip;
        }
        return '';
    }
}
