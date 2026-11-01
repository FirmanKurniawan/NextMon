<?php
/** Public voucher status page + JSON (CORS limited), PWA manifest/service worker, offline page. */
class StatusController
{
    /** The public page serves ONE workspace (App::run resolved it from the session index / ?w=); only its own routers are visible. */
    private static function routerBySession(string $s): ?array
    {
        if (Workspace::idOrNull() === null) {
            return null;
        }
        foreach (App::ownRouters() as $r) {
            if ($s !== '' && strcasecmp($r['session'] ?? $r['id'], $s) === 0) {
                return $r;
            }
        }
        return null;
    }

    /**
     * Anti-enumeration + router protection: 40 lookups / 10 min per client IP (real IP only: X-Forwarded-For is honoured
     * solely from trusted proxies, see Net) and a global ceiling so a botnet cannot hammer the router through this page.
     */
    private static function limited(): bool
    {
        $perIp = Net::hit('status', Audit::ip(), 40, 600);
        $all = Net::hit('status-all', '*', 1500, 600);
        return $perIp || $all;
    }

    private static function lookup(array $cfg, string $user): ?array
    {
        // public page, many visitors: pooled socket + circuit breaker (an offline router must not cost 5 s per visitor)
        $r = App::driverFor($cfg, ['persist' => true, 'breaker' => true]);
        // the voucher row and its active session are independent: one round-trip
        $got = Pipe::prints($r, ['u' => ['/ip/hotspot/user', ['name' => $user]], 'a' => ['/ip/hotspot/active', ['user' => $user]]]);
        $rows = $got['u'];
        if (!$rows && ($flat = preg_replace('/[\s\x{00A0}\x{2009}\x{202F}\-]+/u', '', $user)) !== null && $flat !== $user && $flat !== '') {
            // a code printed in groups ("3c7 ta6") typed with its gap: try the raw code
            $user = $flat;
            $got = Pipe::prints($r, ['u' => ['/ip/hotspot/user', ['name' => $user]], 'a' => ['/ip/hotspot/active', ['user' => $user]]]);
            $rows = $got['u'];
        }
        if (!$rows) {
            return null;
        }
        $u = $rows[0];
        $act = $got['a'];
        $exp = Voucher::expiryOf((string)($u['comment'] ?? ''));
        if ($exp === '') {
            $sch = $r->print('/system/scheduler', ['name' => $user], ['next-run']);
            $exp = $sch[0]['next-run'] ?? '';
        }
        $limit = (string)($u['limit-uptime'] ?? '');
        $status = 'new';
        if (($u['disabled'] ?? '') === 'true') {
            $status = 'disabled';
        } elseif ($limit === '1s') {
            $status = 'expired';
        } elseif ($act) {
            $status = 'online';
        } elseif (($u['uptime'] ?? '0s') !== '0s') {
            $status = 'used';
        }
        return [
            'user' => $user,
            'profile' => $u['profile'] ?? '',
            'status' => $status,
            'uptime' => $u['uptime'] ?? '0s',
            'limit_uptime' => $limit,
            'time_left' => $act[0]['session-time-left'] ?? '',
            'expires' => $exp,
            'bytes_in' => (int)($u['bytes-in'] ?? 0),
            'bytes_out' => (int)($u['bytes-out'] ?? 0),
        ];
    }

    public static function page(): void
    {
        $session = App::get('session');
        $user = App::get('user');
        $cfg = self::routerBySession($session);
        $res = null;
        $err = '';
        if ($user !== '') {
            if (!$cfg) {
                $err = t('Unknown session name.');
            } elseif (self::limited()) {
                $err = t('Too many requests. Please wait a few minutes.');
            } else {
                try {
                    $res = self::lookup($cfg, $user);
                    if (!$res) {
                        $err = t('Voucher not found.');
                    }
                } catch (Throwable $e) {
                    $err = t('Status service is temporarily unavailable.');
                }
            }
        }
        App::renderBare('status', ['session' => $session, 'user' => $user, 'res' => $res, 'err' => $err, 'cfg' => $cfg]);
    }

    public static function json(): void
    {
        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
        $allowed = [];
        foreach (Workspace::idOrNull() === null ? [] : App::ownRouters() as $r) {
            if (!empty($r['host'])) {
                $allowed[] = 'http://' . $r['host'];
                $allowed[] = 'https://' . $r['host'];
            }
        }
        foreach (Workspace::idOrNull() === null ? [] : explode(',', (string)Store::setting('status_cors', '')) as $o) {
            $o = rtrim(trim($o), '/');
            if ($o !== '') {
                $allowed[] = $o;
            }
        }
        header('Vary: Origin');
        header('X-Robots-Tag: noindex');
        if ($origin !== '' && in_array($origin, $allowed, true)) {
            header('Access-Control-Allow-Origin: ' . $origin);
        }
        $cfg = self::routerBySession(App::get('session'));
        $user = App::get('user');
        if (!$cfg || $user === '') {
            App::json(['ok' => false, 'error' => 'bad request'], 400);
        }
        if (self::limited()) {
            App::json(['ok' => false, 'error' => 'rate limited'], 429);
        }
        try {
            $res = self::lookup($cfg, $user);
        } catch (Throwable $e) {
            App::json(['ok' => false, 'error' => 'unavailable'], 503);
        }
        App::json($res ? ['ok' => true, 'data' => $res] : ['ok' => false, 'error' => 'not found'], $res ? 200 : 404);
    }

    public static function manifest(): void
    {
        header('Content-Type: application/manifest+json; charset=utf-8');
        header('Cache-Control: no-cache');
        $b = App::$base;
        $ic = fn(string $f, string $sz, string $purpose = 'any') => ['src' => $b . '/assets/icons/' . $f, 'sizes' => $sz, 'type' => 'image/png', 'purpose' => $purpose];
        $sc = fn(string $name, string $short, string $path) => ['name' => $name, 'short_name' => $short, 'url' => $b . $path, 'icons' => [['src' => $b . '/assets/icons/icon-192.png', 'sizes' => '192x192', 'type' => 'image/png']]];
        echo json_encode([
            'id' => $b . '/',
            'name' => 'NextMON Hotspot Manager',
            'short_name' => 'NextMON',
            'description' => t('MikroTik hotspot manager'),
            'lang' => I18n::lang(),
            'dir' => 'ltr',
            'start_url' => $b . '/',
            'scope' => $b . '/',
            'display' => 'standalone',
            'display_override' => ['window-controls-overlay', 'standalone', 'minimal-ui'],
            'orientation' => 'any',
            'background_color' => '#090f15',
            'theme_color' => '#0b7285',
            'categories' => ['utilities', 'business', 'productivity'],
            'icons' => [
                $ic('icon-192.png', '192x192'),
                $ic('icon-512.png', '512x512'),
                $ic('icon-maskable-512.png', '512x512', 'maskable'),
                ['src' => $b . '/assets/icons/icon.svg', 'sizes' => 'any', 'type' => 'image/svg+xml', 'purpose' => 'any'],
            ],
            'shortcuts' => [
                $sc(t('Vouchers'), t('Vouchers'), '/vouchers'),
                $sc(t('Quick sell (POS)'), 'POS', '/pos'),
                $sc(t('Active sessions'), t('Active'), '/hotspot/active'),
                $sc(t('Sales report'), t('Reports'), '/reports'),
            ],
        ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        exit;
    }

    public static function sw(): void
    {
        header('Content-Type: application/javascript; charset=utf-8');
        header('Service-Worker-Allowed: ' . (App::$base ?: '') . '/');
        header('Cache-Control: no-cache');
        echo 'const BASE=' . json_encode(App::$base) . ";\n";
        readfile(App::$root . '/public/assets/js/sw.js');
        exit;
    }

    public static function offline(): void
    {
        App::renderBare('offline', []);
    }
}
