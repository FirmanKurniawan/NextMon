<?php
class PosController
{
    private static function logName(): string
    {
        return 'pos-' . preg_replace('/\W/', '', App::currentRouterId()) . '.log';
    }

    public static function index(): void
    {
        $r = App::driver();
        $items = [];
        foreach ($r->print('/ip/hotspot/user/profile', [], ['name', 'on-login', 'rate-limit']) as $p) {
            $m = Scripts::parseMeta((string)($p['on-login'] ?? ''));
            if ($p['name'] === 'default') {
                continue;
            }
            $items[] = ['name' => $p['name'], 'price' => $m ? ($m['sprice'] !== '' ? $m['sprice'] : $m['price']) : '', 'validity' => $m['validity'] ?? '', 'rate' => $p['rate-limit'] ?? ''];
        }
        $today = array_values(array_filter(Store::tailLog(self::logName(), 200), fn($x) => date('Y-m-d', $x['ts']) === date('Y-m-d')));
        App::render('pos', ['title' => t('Quick sell (POS)'), 'page' => 'pos', 'items' => $items, 'today' => $today, 'total' => array_sum(array_column($today, 'price'))]);
    }

    /** JSON: create one voucher and log the sale locally. */
    public static function sell(): void
    {
        $r = App::driver();
        $profile = App::post('profile');
        $found = null;
        foreach ($r->print('/ip/hotspot/user/profile', ['name' => $profile], ['name', 'on-login']) as $p) {
            $found = $p;
        }
        if (!$found) {
            App::json(['ok' => false, 'error' => t('Profile not found.')], 404);
        }
        $m = Scripts::parseMeta((string)($found['on-login'] ?? ''));
        $price = $m ? (float)($m['sprice'] !== '' ? $m['sprice'] : $m['price']) : 0;
        // [RESELLER-HOOK] reseller users pay from their wallet before the voucher exists; blocked when balance is too low
        $rsv = Reseller::charge($profile, $price, 1, ['via' => 'pos']);
        if ($rsv && isset($rsv['error'])) {
            App::json(['ok' => false, 'error' => $rsv['error']], 402);
        }
        try {
            $res = Voucher::generate($r, ['profile' => $profile, 'qty' => 1, 'length' => 6, 'charset' => 'lowernum', 'mode' => 'vc', 'batch' => 'POS']);
        } catch (Throwable $ex) {
            if ($rsv) {
                Reseller::rollback($rsv, 'pos error');
            }
            if ($ex instanceof QuotaException) {   // daily voucher limit: nothing created, wallet refunded above
                App::json(['ok' => false, 'error' => $ex->getMessage(), 'used' => $ex->used, 'limit' => $ex->limit], 429);
            }
            throw $ex;
        }
        // [/RESELLER-HOOK]
        Reseller::recordBatch($res['comment']);
        [$user, $pass] = $res['items'][0];
        $by = Auth::user()['username'] ?? '-';
        Store::appendLog(self::logName(), ['ts' => time(), 'user' => $user, 'profile' => $profile, 'price' => $price, 'by' => $by]);
        Audit::log('pos.sell', "$user / $profile / $price");
        Notify::event('sale', "POS sale: $profile " . money($price) . " by $by");
        App::json([
            'ok' => true, 'user' => $user, 'pass' => $pass, 'profile' => $profile, 'price' => money($price), 'validity' => $m['validity'] ?? '',
            'url' => Voucher::loginUrl($user, $pass), 'hotspot' => App::routerCfg()['hotspot_name'] ?: Store::setting('hotspot_name'),
            'time' => date('d/m/Y H:i'), 'total' => money(array_sum(array_column(array_filter(Store::tailLog(self::logName(), 300), fn($x) => date('Y-m-d', $x['ts']) === date('Y-m-d')), 'price'))),
        ]);
    }
}
