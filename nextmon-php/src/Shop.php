<?php
/** Public shop: configuration (data/shop.json), package lookup, rate limits, callback IP allow-list. */
final class Shop
{
    public static function defaults(): array
    {
        return [
            'enabled' => false,
            'router' => '',
            'title' => '',
            'tagline' => '',
            'terms' => '',
            'instructions' => '',
            'expiry_minutes' => 30,
            'gateway' => 'manual',
            'env' => 'sandbox',
            'require_phone' => true,
            'order_limit' => 5,
            'callback_ips' => '',
            'packages' => [],
            'gw' => [],
            'mock_secret' => '',
        ];
    }

    public static function config(): array
    {
        $c = array_replace(self::defaults(), (array)Store::read('shop', []));
        $c['packages'] = array_values((array)$c['packages']);
        $c['gw'] = (array)$c['gw'];
        return $c;
    }

    public static function save(array $patch): void
    {
        Store::update('shop', fn($cur) => array_replace((array)$cur, $patch), []);
    }

    public static function title(array $c): string
    {
        return $c['title'] !== '' ? $c['title'] : (string)Store::setting('hotspot_name', 'NextMON WiFi');
    }

    /** Active package by id, or null. Price/profile always come from here, never from the request. */
    public static function package(array $c, string $id): ?array
    {
        foreach ($c['packages'] as $p) {
            if (($p['id'] ?? '') === $id && !empty($p['active']) && (int)$p['price'] > 0 && ($p['profile'] ?? '') !== '') {
                return $p;
            }
        }
        return null;
    }

    public static function activePackages(array $c): array
    {
        return array_values(array_filter($c['packages'], fn($p) => !empty($p['active']) && (int)($p['price'] ?? 0) > 0 && ($p['profile'] ?? '') !== ''));
    }

    /** Decrypted credentials of one gateway + env (+ mock secret / manual instructions). */
    public static function gwCfg(array $c, string $id): array
    {
        $out = ['env' => $c['env'] === 'production' ? 'production' : 'sandbox'];
        $g = Payments::get($id);
        if ($g) {
            foreach ($g->fields() as $f) {
                $v = (string)($c['gw'][$id][$f['key']] ?? '');
                $out[$f['key']] = !empty($f['secret']) ? Crypto::decrypt($v) : $v;
            }
        }
        if ($id === 'mock') {
            $out['secret'] = self::mockSecret();
        }
        if ($id === 'manual') {
            $out['instructions'] = (string)$c['instructions'];
        }
        return $out;
    }

    public static function mockSecret(): string
    {
        $c = (array)Store::read('shop', []);
        $s = Crypto::decrypt((string)($c['mock_secret'] ?? ''));
        if ($s === '') {
            $s = bin2hex(random_bytes(24));
            self::save(['mock_secret' => Crypto::encrypt($s)]);
        }
        return $s;
    }

    public static function routerCfg(array $c): ?array
    {
        if ($c['router'] !== '') {
            $r = App::routerCfg($c['router']);
            if ($r) {
                return $r;
            }
        }
        $all = App::routers();
        return $all[0] ?? null;
    }

    /** `?w=<workspace slug>` for links into a non-main workspace's public pages ('' for main: its links stay as they always were). */
    public static function wQuery(string $sep = '?'): string
    {
        $ws = Workspace::idOrNull();
        return $ws === null || $ws === 'main' ? '' : $sep . 'w=' . rawurlencode(Workspace::slug());
    }

    /** App path of the storefront of the active workspace. */
    public static function homePath(): string
    {
        return '/shop' . self::wQuery();
    }

    /** The webhook URL carries the workspace slug (the order id inside the payload also carries the workspace, as a fallback). */
    public static function callbackUrl(string $gw = ''): string
    {
        $q = ($gw !== '' ? '?g=' . $gw : '') . self::wQuery($gw !== '' ? '&' : '?');
        return App::origin() . '/pay/callback' . $q;
    }

    public static function orderUrl(array $o, bool $abs = false, string $extra = ''): string
    {
        $p = '/shop/order?id=' . rawurlencode($o['id']) . '&t=' . rawurlencode($o['token']) . $extra;
        return $abs ? App::origin() . $p : url($p);
    }

    // ---- limits -------------------------------------------------------------------------

    /**
     * Sliding-window counter per key. Returns true when the call is OVER the limit.
     * Counts every call (so call it once per attempt).
     */
    public static function hit(string $bucket, string $key, int $max, int $windowSec): bool
    {
        $over = false;
        Store::update('shop_rate', function ($a) use ($bucket, $key, $max, $windowSec, &$over) {
            $now = time();
            foreach ($a as $k => $e) {
                if ($now - ($e['t'] ?? 0) > $e['w']) {
                    unset($a[$k]);
                }
            }
            $k = $bucket . '|' . $key;
            $e = $a[$k] ?? ['n' => 0, 't' => $now, 'w' => $windowSec];
            $e['n']++;
            $over = $e['n'] > $max;
            $a[$k] = $e;
            return $a;
        }, []);
        return $over;
    }

    /** Is $ip inside the allow-list (one IPv4, IPv4/CIDR or IPv6 per line / comma)? Empty list = allow all. */
    public static function ipAllowed(string $ip, string $list): bool
    {
        $items = preg_split('/[\s,;]+/', trim($list), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        if (!$items) {
            return true;
        }
        foreach ($items as $it) {
            if (self::ipMatch($ip, $it)) {
                return true;
            }
        }
        return false;
    }

    public static function ipMatch(string $ip, string $rule): bool
    {
        if (strpos($rule, '/') === false) {
            return strcasecmp($ip, $rule) === 0;
        }
        [$net, $bits] = explode('/', $rule, 2);
        $a = @inet_pton($ip);
        $b = @inet_pton($net);
        if ($a === false || $b === false || strlen($a) !== strlen($b)) {
            return false;
        }
        $bits = max(0, min(strlen($a) * 8, (int)$bits));
        $bytes = intdiv($bits, 8);
        if ($bytes && substr($a, 0, $bytes) !== substr($b, 0, $bytes)) {
            return false;
        }
        $rem = $bits % 8;
        if ($rem === 0) {
            return true;
        }
        $mask = (0xFF << (8 - $rem)) & 0xFF;
        return (ord($a[$bytes]) & $mask) === (ord($b[$bytes]) & $mask);
    }
}
