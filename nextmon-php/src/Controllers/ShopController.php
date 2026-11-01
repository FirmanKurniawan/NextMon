<?php
/** Public self-service shop (/shop, /shop/order, /pay/callback) + admin settings (/shop/settings). */
class ShopController
{
    // ---- public: storefront -----------------------------------------------------------

    public static function page(): void
    {
        $c = Shop::config();
        $err = (string)($_SESSION['shop_err'] ?? '');
        $old = (array)($_SESSION['shop_old'] ?? []);
        unset($_SESSION['shop_err'], $_SESSION['shop_old']);
        header('Cache-Control: no-store');
        App::renderBare('shop', [
            'c' => $c, 'title' => Shop::title($c), 'packages' => $c['enabled'] ? Shop::activePackages($c) : [],
            'err' => $err, 'old' => $old,
            'ref' => (Reseller::byRef(App::get('ref')) ?? [])['code'] ?? '',   // only a valid active reseller code is echoed back into the form
        ]);
    }

    /** POST /shop/order : create the order and hand over to the payment step. */
    public static function create(): void
    {
        $c = Shop::config();
        $refIn = Reseller::cleanRef(App::post('ref'));
        $fail = function (string $msg, array $old = []) use ($refIn) {
            $_SESSION['shop_err'] = $msg;
            $_SESSION['shop_old'] = $old;
            App::redirect(Shop::homePath() . ($refIn !== '' ? (Shop::wQuery() === '' ? '?' : '&') . 'ref=' . $refIn : ''));
        };
        if (!$c['enabled']) {
            $fail(t('The shop is currently closed.'));
        }
        if (App::post('website') !== '') { // honeypot: humans never fill this
            App::redirect(Shop::homePath());
        }
        $name = mb_substr(trim(preg_replace('/\s+/', ' ', App::post('name'))), 0, 60);
        $phone = preg_replace('/[^0-9+]/', '', App::post('phone'));
        $email = mb_substr(App::post('email'), 0, 100);
        $old = ['name' => $name, 'phone' => $phone, 'email' => $email, 'package' => App::post('package')];
        if (Shop::hit('order', Audit::ip(), max(1, (int)$c['order_limit']), 600)) {
            $fail(t('Too many orders from your connection. Please wait a few minutes.'), $old);
        }
        $pending = 0;
        foreach (glob(Orders::dir() . '/KL*.json') ?: [] as $f) {
            if (strpos((string)file_get_contents($f), '"status": "pending"') !== false) {
                $pending++;
            }
        }
        if ($pending >= 300) {
            $fail(t('The shop is busy right now. Please try again shortly.'), $old);
        }
        $pkg = Shop::package($c, App::post('package'));
        if (!$pkg) {
            $fail(t('Please choose a package.'), $old);
        }
        if (mb_strlen($name) < 2) {
            $fail(t('Please enter your name.'), $old);
        }
        if (($c['require_phone'] && !preg_match('/^\+?\d{8,15}$/', $phone)) || ($phone !== '' && !preg_match('/^\+?\d{8,15}$/', $phone))) {
            $fail(t('Please enter a valid phone number.'), $old);
        }
        if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $fail(t('The email address looks invalid.'), $old);
        }
        if (trim($c['terms']) !== '' && App::post('terms') !== '1') {
            $fail(t('Please accept the terms to continue.'), $old);
        }
        $gw = Payments::get($c['gateway']);
        $router = Shop::routerCfg($c);
        if (!$gw || !$router || ($c['gateway'] === 'mock' && $c['env'] !== 'sandbox')) {
            $fail(t('The shop is not configured yet.'), $old);
        }

        // Referral: attribution only. Unknown / inactive code = ignored silently. Commission needs a PAID, verified order total.
        $attr = Reseller::byRef($refIn);
        $o = Orders::create($pkg, ['name' => $name, 'phone' => $phone, 'email' => $email], $c['gateway'], (int)$c['expiry_minutes'], $router['id'], $attr);
        try {
            $ctx = [
                'return_url' => Shop::orderUrl($o, true), 'callback_url' => Shop::callbackUrl($c['gateway']),
                'expiry_min' => (int)$c['expiry_minutes'], 'item_name' => Shop::title($c) . ' - ' . $o['package']['label'],
            ];
            $r = $gw->create($o, Shop::gwCfg($c, $c['gateway']), $ctx);
            $o = Orders::update($o['id'], function ($x) use ($r) {
                $x['ref'] = $r['ref'];
                $x['pay_url'] = $r['pay_url'];
                $x['pay_info'] = $r['info'];
                return $x;
            });
        } catch (Throwable $e) {
            error_log('[nextmon-shop] create failed ' . $o['id'] . ': ' . $e->getMessage());
            Orders::update($o['id'], function ($x) use ($e) {
                $x['status'] = 'failed';
                Orders::note($x, 'system', 'Gateway create failed: ' . $e->getMessage());
                return $x;
            });
            $fail(t('Could not start the payment. Please try again later.'), $old);
        }
        Audit::log('shop.order', $o['id'] . ' ' . $o['package']['label'] . ' ' . $o['amount'] . ' ' . $o['gateway']);
        App::redirect(substr(Shop::orderUrl($o, false, $o['pay_url'] !== '' ? '&go=1' : ''), strlen(App::$base)));
    }

    /** GET /shop/order?id=&t=[&json=1] : order status page / polling endpoint. */
    public static function status(): void
    {
        header('Cache-Control: no-store');
        $id = App::get('id');
        $o = Orders::get($id);
        $json = App::get('json') === '1';
        if (!$o || !hash_equals((string)$o['token'], App::get('t'))) {
            if ($json) {
                App::json(['ok' => false, 'error' => 'not found'], 404);
            }
            // neutral page: a wrong id / token must not reveal whose shop the id belongs to (no branding, no workspace data)
            Workspace::clear();
            http_response_code(404);
            App::renderBare('shop_order', ['c' => Shop::defaults(), 'title' => 'NextMON', 'o' => null, 'view' => null]);
            return;
        }
        if ($o['status'] === 'pending' && $o['expires'] < time()) {
            $o = Orders::update($id, function ($x) {
                if ($x['status'] === 'pending' && $x['expires'] < time()) {
                    $x['status'] = 'expired';
                }
                return $x;
            });
        }
        if ($o['status'] === 'paid' && empty($o['voucher']) && time() - (int)($o['retry_at'] ?? 0) > 15) {
            $o = Orders::retryFulfil($id) ?? $o;
        }
        $c = Shop::config();
        if ($json) {
            App::json(['ok' => true] + Orders::publicView($o));
        }
        App::renderBare('shop_order', ['c' => $c, 'title' => Shop::title($c), 'o' => $o, 'view' => Orders::publicView($o), 'go' => App::get('go') === '1', 'gw' => Payments::get($o['gateway'])]);
    }

    // ---- public: gateway callback + mock pay page -----------------------------------

    /** GET /pay/callback : mock pay page (?mock=ID&t=TOKEN), otherwise bounce to the shop. */
    public static function payPage(): void
    {
        $c = Shop::config();
        $o = Orders::get(App::get('mock'));
        if (!$o || $o['gateway'] !== 'mock' || $c['env'] !== 'sandbox' || !hash_equals((string)$o['token'], App::get('t'))) {
            App::redirect(Shop::homePath());
        }
        header('Cache-Control: no-store');
        $ts = time();
        $secret = Shop::mockSecret();
        $sig = fn(string $st) => PaymentMock::sign($o['id'], $st, (int)$o['amount'], $ts, $secret);
        App::renderBare('shop_mock', ['c' => $c, 'title' => Shop::title($c), 'o' => $o, 'ts' => $ts, 'sigPaid' => $sig('paid'), 'sigFail' => $sig('failed')]);
    }

    /** POST /pay/callback : payment webhook. Authenticity = gateway signature/token, never the session (CSRF-exempt). */
    public static function callback(): void
    {
        $c = Shop::config();
        $ip = Audit::ip();
        if (Shop::hit('callback', $ip, 200, 600)) {
            App::json(['ok' => false, 'error' => 'rate limited'], 429);
        }
        if (!Shop::ipAllowed($ip, (string)$c['callback_ips'])) {
            Audit::log('shop.callback.ip_denied', $ip);
            App::json(['ok' => false, 'error' => 'forbidden'], 403);
        }
        $raw = (string)file_get_contents('php://input');
        $headers = Payments::requestHeaders();
        $gw = null;
        $want = App::get('g');
        if ($want !== '') {
            $gw = Payments::get($want);
        } else {
            foreach (Payments::all() as $g) {
                if ($g->hasWebhook() && $g->id() !== 'mock' && $g->detect($headers, $raw)) {
                    $gw = $g;
                    break;
                }
            }
        }
        if (!$gw || !$gw->hasWebhook()) {
            App::json(['ok' => false, 'error' => 'unknown gateway'], 400);
        }
        try {
            $ev = $gw->parseCallback($headers, $raw, Shop::gwCfg($c, $gw->id()));
        } catch (PaymentException $e) {
            Audit::log('shop.callback.reject', $gw->id() . ': ' . $e->getMessage());
            App::json(['ok' => false, 'error' => 'invalid'], 403);
        }
        $o = Orders::get($ev['order_id']);
        if (!$o) {
            App::json(['ok' => false, 'error' => 'order not found'], 404);
        }
        [$ok, $msg, $after] = Orders::applyEvent($o['id'], $ev, hash('sha256', $gw->id() . '|' . $raw), $gw->id());
        if ($gw->id() === 'mock' && isset($_POST['mock_ui'])) {
            App::redirect(substr(Shop::orderUrl($o), strlen(App::$base)));
        }
        App::json(['ok' => $ok, 'message' => $msg]);
    }

    // ---- admin: /shop/settings ----------------------------------------------------------

    public static function settings(): void
    {
        $c = Shop::config();
        $profiles = [];
        try {
            $rc = Shop::routerCfg($c);
            if ($rc) {
                foreach (App::driverFor($rc)->print('/ip/hotspot/user/profile', [], ['name']) as $p) {
                    if ($p['name'] !== 'default') {
                        $profiles[] = $p['name'];
                    }
                }
            }
        } catch (Throwable $e) {
            // router offline: the field falls back to free text
        }
        App::render('shop_settings', ['title' => t('Shop settings'), 'page' => 'shop_settings', 'c' => $c, 'profiles' => $profiles, 'gateways' => Payments::all(), 'routers' => App::routers()]);
    }

    public static function settingsSave(): void
    {
        $cur = Shop::config();
        $pk = [];
        foreach ((array)($_POST['pkg'] ?? []) as $row) {
            if (!is_array($row)) {
                continue;
            }
            $profile = mb_substr(trim((string)($row['profile'] ?? '')), 0, 60);
            $price = (int)preg_replace('/\D/', '', (string)($row['price'] ?? ''));
            if ($profile === '' || $price <= 0 || count($pk) >= 12) {
                continue;
            }
            $id = preg_match('/^p[a-f0-9]{6}$/', (string)($row['id'] ?? '')) ? $row['id'] : 'p' . bin2hex(random_bytes(3));
            $pk[] = [
                'id' => $id, 'profile' => $profile, 'price' => min($price, 100000000),
                'label' => mb_substr(trim((string)($row['label'] ?? '')), 0, 40), 'badge' => mb_substr(trim((string)($row['badge'] ?? '')), 0, 16),
                'desc' => mb_substr(trim((string)($row['desc'] ?? '')), 0, 100), 'active' => !empty($row['active']),
            ];
        }
        $env = App::post('env') === 'production' ? 'production' : 'sandbox';
        $gateway = App::post('gateway');
        $msg = t('Shop settings saved.');
        $type = 'ok';
        if (!Payments::get($gateway)) {
            $gateway = 'manual';
        }
        if ($gateway === 'mock' && $env !== 'sandbox') {
            $gateway = 'manual';
            $msg = t('The demo gateway is only allowed in sandbox mode; gateway reset to manual transfer.');
            $type = 'warn';
        }
        $gw = $cur['gw'];
        foreach (Payments::all() as $id => $g) {
            foreach ($g->fields() as $f) {
                $v = trim((string)($_POST['gw'][$id][$f['key']] ?? ''));
                if (!empty($f['secret'])) {
                    if ($v !== '') {
                        $gw[$id][$f['key']] = Crypto::encrypt($v);
                    }
                } else {
                    $gw[$id][$f['key']] = mb_substr($v, 0, 80);
                }
            }
        }
        Shop::save([
            'enabled' => App::post('enabled') === '1',
            'router' => App::post('router'),
            'title' => mb_substr(App::post('title'), 0, 60),
            'tagline' => mb_substr(App::post('tagline'), 0, 160),
            'terms' => mb_substr(trim((string)($_POST['terms'] ?? '')), 0, 3000),
            'instructions' => mb_substr(trim((string)($_POST['instructions'] ?? '')), 0, 1000),
            'expiry_minutes' => max(5, min(1440, (int)App::post('expiry_minutes', '30'))),
            'gateway' => $gateway,
            'env' => $env,
            'require_phone' => App::post('require_phone') === '1',
            'order_limit' => max(1, min(50, (int)App::post('order_limit', '5'))),
            'callback_ips' => preg_replace('/[^0-9a-fA-F:.\/,;\s]/', '', (string)($_POST['callback_ips'] ?? '')),
            'packages' => $pk,
            'gw' => $gw,
        ]);
        Audit::log('shop.settings', 'gateway=' . $gateway . ' env=' . $env . ' packages=' . count($pk));
        App::redirect('/shop/settings', $msg, $type);
    }
}
