<?php
/** Voucher (hotspot user batch) generation. */
final class Voucher
{
    public const CHARSETS = [
        'num' => '0123456789',
        'lower' => 'abcdefghjkmnpqrstuvwxyz',
        'upper' => 'ABCDEFGHJKLMNPQRSTUVWXYZ',
        'lowernum' => 'abcdefghjkmnpqrstuvwxyz23456789',
        'uppernum' => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
        'mixed' => 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789',
        // strict: also drops look-alike pairs 5/s 2/z 8/b 9/q/g u/v (0 O 1 l I i o are already absent from every letter set)
        'safe' => 'acdefhjkmnprtuwxy34679',
        'safeupper' => 'ACDEFHJKMNPRTUWXY34679',
    ];

    /** Characters that are easily confused when read or typed by hand. */
    public const AMBIGUOUS = '0O1lIoi';

    public static function code(int $len, string $set): string
    {
        $chars = self::CHARSETS[$set] ?? self::CHARSETS['lowernum'];
        $max = strlen($chars) - 1;
        $o = '';
        for ($i = 0; $i < $len; $i++) {
            $o .= $chars[random_int(0, $max)];
        }
        return $o;
    }

    /**
     * Options: profile, qty, prefix, length, charset, mode (vc|up), batch, limit_uptime, limit_bytes, server
     * @return array ['comment' => string, 'items' => [[name, password], ...]]
     */
    public static function generate(Driver $r, array $o): array
    {
        $qty = max(1, min((int)Store::setting('max_qty', 500), (int)($o['qty'] ?? 1)));
        $len = max(3, min(16, (int)($o['length'] ?? 6)));
        $prefix = preg_replace('/[^A-Za-z0-9_.\-]/', '', (string)($o['prefix'] ?? ''));
        $set = (string)($o['charset'] ?? 'lowernum');
        $mode = ($o['mode'] ?? 'vc') === 'up' ? 'up' : 'vc';
        $batch = trim(preg_replace('/[^A-Za-z0-9_. \-]/', '', (string)($o['batch'] ?? '')));
        $batch = mb_substr($batch, 0, 24);
        $comment = $mode . '-' . random_int(100, 999) . '-' . date('m.d.y') . ($batch !== '' ? '-' . $batch : '');

        $tok = Quota::reserve($qty);   // daily voucher limit: refuses the whole batch (QuotaException) before anything is created
        try {
            return self::build($r, $o, $qty, $len, $prefix, $set, $mode, $comment, $tok);
        } catch (Throwable $e) {
            Quota::release($tok);   // generation failed: give the reserved units back
            throw $e;
        }
    }

    private static function build(Driver $r, array $o, int $qty, int $len, string $prefix, string $set, string $mode, string $comment, ?array $tok): array
    {
        $existing = array_flip(array_column($r->print('/ip/hotspot/user', [], ['name']), 'name'));
        $items = [];
        $rows = [];
        $guard = 0;
        while (count($items) < $qty && $guard++ < $qty * 20) {
            $name = $prefix . self::code($len, $set);
            if (isset($existing[$name])) {
                continue;
            }
            $existing[$name] = true;
            $pass = $mode === 'vc' ? $name : self::code($len, $set);
            $attrs = ['name' => $name, 'password' => $pass, 'profile' => (string)$o['profile'], 'comment' => $comment];
            if (!empty($o['limit_uptime'])) {
                $attrs['limit-uptime'] = (string)$o['limit_uptime'];
            }
            if (!empty($o['limit_bytes'])) {
                $attrs['limit-bytes-total'] = (string)$o['limit_bytes'];
            }
            if (!empty($o['server']) && $o['server'] !== 'all') {
                $attrs['server'] = (string)$o['server'];
            }
            $rows[] = $attrs;
            $items[] = [$name, $pass];
        }
        // pipelined: 100 vouchers per round-trip instead of one per voucher
        Pipe::adds($r, '/ip/hotspot/user', $rows);
        Quota::release($tok, $qty - count($items));   // fewer codes than asked (collision guard)
        return ['comment' => $comment, 'items' => $items];
    }

    /** Extract the batch tag ("vc-123-10.28.26-name") from a comment that may be prefixed with an expiry date. */
    public static function batchOf(string $comment): string
    {
        if (preg_match('/\b((?:vc|up)-\d{3}-\d\d\.\d\d\.\d\d(?:-[^\n]*)?)$/', $comment, $m)) {
            return $m[1];
        }
        return '';
    }

    /** Expiry date stored by the on-login script at the start of the comment ("oct/12/2026 10:00:00") */
    public static function expiryOf(string $comment): string
    {
        return preg_match('~^([a-z]{3}/\d\d/\d{4} \d\d:\d\d:\d\d)~i', $comment, $m) ? $m[1] : '';
    }

    public static function loginUrl(string $user, string $pass): string
    {
        $base = (string)Store::setting('login_url', 'http://hotspot.local/login');
        return $base . (strpos($base, '?') === false ? '?' : '&') . 'username=' . rawurlencode($user) . '&password=' . rawurlencode($pass);
    }
}
