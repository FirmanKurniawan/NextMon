<?php
/** Reseller/agent wallets: admin pages (/resellers, /resellers/ledger), reseller dashboard (/me/wallet), voucher-sale guard. */
class ResellerController
{
    /** @return array [name => base price] of router profiles that have a price (best effort: empty when the router is unreachable) */
    private static function profilePrices(): array
    {
        $out = [];
        try {
            foreach (App::driver()->print('/ip/hotspot/user/profile', [], ['name', 'on-login']) as $p) {
                if ($p['name'] === 'default') {
                    continue;
                }
                $out[$p['name']] = Reseller::basePrice(Scripts::parseMeta((string)($p['on-login'] ?? '')));
            }
        } catch (Throwable $e) {
            // listed without profiles
        }
        return $out;
    }

    private static function resellerUsers(): array
    {
        return array_values(array_filter(Auth::users(), fn($u) => $u['role'] === 'reseller'));
    }

    private static function userById(string $id): ?array
    {
        foreach (Auth::users() as $u) {
            if ($u['id'] === $id) {
                return $u;
            }
        }
        return null;
    }

    private static function names(): array
    {
        $n = [];
        foreach (Auth::users() as $u) {
            $n[$u['id']] = $u['username'];
        }
        return $n;
    }

    // ---- admin -------------------------------------------------------------------------------------

    public static function index(): void
    {
        $users = self::resellerUsers();
        $bal = Reseller::balances();
        $list = [];
        $total = 0;
        foreach ($users as $u) {
            $cfg = Reseller::cfg($u['id']);
            $b = (int)($bal[$u['id']] ?? 0);
            $total += $b;
            $list[] = ['u' => $u, 'cfg' => $cfg, 'bal' => $b];
        }
        App::render('resellers', ['title' => t('Resellers'), 'page' => 'resellers', 'list' => $list, 'total' => $total, 'prices' => self::profilePrices()]);
    }

    public static function save(): void
    {
        $id = App::post('id');
        $u = self::userById($id);
        if (!$u || $u['role'] !== 'reseller') {
            App::redirect('/resellers', t('User not found.'), 'err');
        }
        $profiles = [];
        $prices = self::profilePrices();
        $chk = $_POST['prof'] ?? [];
        $adj = $_POST['padj'] ?? [];
        foreach ((array)$chk as $name => $on) {
            if (isset($prices[$name])) {
                $profiles[$name] = is_array($adj) ? trim((string)($adj[$name] ?? '')) : '';
            }
        }
        Reseller::saveCfg($id, [
            'active' => App::post('active') === '1', 'commission' => App::post('commission', '0'), 'adj' => App::post('adj', '0'),
            'credit' => App::post('credit', '0'), 'allow_all' => App::post('allow_all') === '1', 'profiles' => $profiles,
        ]);
        Audit::log('reseller.save', $u['username']);
        App::redirect('/resellers', t('Reseller saved.'));
    }

    public static function saveRef(): void
    {
        $id = App::post('id');
        $u = self::userById($id);
        if (!$u || $u['role'] !== 'reseller') {
            App::redirect('/resellers', t('User not found.'), 'err');
        }
        $err = Reseller::setRef($id, App::post('ref'));
        Audit::log('reseller.ref', $u['username'] . ($err === '' ? '' : ' failed'));
        App::redirect('/resellers', $err === '' ? t('Referral code saved.') : $err, $err === '' ? 'ok' : 'err');
    }

    public static function fund(): void
    {
        $id = App::post('id');
        $u = self::userById($id);
        if (!$u || $u['role'] !== 'reseller') {
            App::redirect('/resellers', t('User not found.'), 'err');
        }
        $amount = (int)preg_replace('/[^\d\-]/', '', App::post('amount'));
        $kind = App::post('kind') === 'adjustment' ? 'adjustment' : 'topup';
        $note = mb_substr(App::post('note'), 0, 200);
        if ($amount === 0 || ($kind === 'topup' && $amount < 0)) {
            App::redirect('/resellers', t('Enter a valid amount.'), 'err');
        }
        if ($kind === 'adjustment' && $note === '') {
            App::redirect('/resellers', t('A note is required for adjustments.'), 'err');
        }
        [$ok, $err, $entries] = $kind === 'topup' ? Reseller::topup($id, $amount, $note) : Reseller::adjust($id, $amount, $note);
        if (!$ok) {
            App::redirect('/resellers', $err, 'err');
        }
        Audit::log('reseller.' . $kind, $u['username'] . ' ' . $amount);
        App::redirect('/resellers', t(':u balance is now :b.', [':u' => $u['username'], ':b' => money(end($entries)['bal'])]));
    }

    public static function refund(): void
    {
        [$ok, $err] = Reseller::refund(App::post('entry'), Auth::user()['username']);
        Audit::log('reseller.refund', App::post('entry') . ($ok ? '' : ' failed'));
        App::back('/resellers/ledger', $ok ? t('Sale refunded.') : $err, $ok ? 'ok' : 'err');
    }

    private static function filters(?string $forceUid = null): array
    {
        $f = [
            'uid' => $forceUid ?? App::get('uid'), 'type' => App::get('type'), 'q' => App::get('q'),
            'from' => preg_match('/^\d{4}-\d\d-\d\d$/', App::get('from')) ? App::get('from') : '',
            'to' => preg_match('/^\d{4}-\d\d-\d\d$/', App::get('to')) ? App::get('to') : '',
        ];
        return $f;
    }

    private static function csvOut(array $rows, string $name): void
    {
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $name . '-' . date('Ymd-His') . '.csv"');
        header('Cache-Control: no-store');
        echo Reseller::csv($rows, self::names());
        exit;
    }

    public static function ledger(): void
    {
        $f = self::filters();
        $rows = Reseller::rows($f);
        if (App::get('export') === 'csv') {
            Audit::log('reseller.ledger.export', count($rows) . ' rows');
            self::csvOut($rows, 'wallet-ledger');
        }
        $sumIn = $sumOut = 0;
        foreach ($rows as $r) {
            $r['amount'] > 0 ? $sumIn += $r['amount'] : $sumOut += $r['amount'];
        }
        [$page, $pg, $pages] = App::paginate($rows, 50);
        $refunded = [];
        foreach ($rows as $r) {
            if ($r['type'] === 'refund') {
                $refunded[$r['ref']] = true;
            }
        }
        App::render('reseller_ledger', [
            'title' => t('Reseller ledger'), 'page' => 'resellers', 'rows' => $page, 'pg' => $pg, 'pages' => $pages, 'total' => count($rows), 'f' => $f,
            'names' => self::names(), 'resellers' => self::resellerUsers(), 'in' => $sumIn, 'out' => $sumOut, 'refunded' => $refunded,
        ]);
    }

    // ---- reseller's own dashboard ----------------------------------------------------------------------

    public static function wallet(): void
    {
        $me = Auth::user();
        if (!Reseller::isReseller($me)) {
            App::render('wallet', ['title' => t('My wallet'), 'page' => 'wallet', 'isRs' => false]);
            return;
        }
        $f = self::filters($me['id']);
        $rows = Reseller::rows($f);
        if (App::get('export') === 'csv') {
            Audit::log('wallet.export', count($rows) . ' rows');
            self::csvOut($rows, 'my-wallet');
        }
        [$page, $pg, $pages] = App::paginate($rows, 30);
        $cfg = Reseller::cfg($me['id']);
        $prices = $cfg ? self::profilePrices() : [];
        $list = [];
        foreach ($prices as $name => $base) {
            if ($cfg && Reseller::allowed($cfg, $name)) {
                $list[] = ['name' => $name, 'base' => $base, 'cost' => Reseller::unitCost($cfg, $name, $base), 'comm' => Reseller::commissionFor($cfg, $base, 1)];
            }
        }
        App::render('wallet', [
            'title' => t('My wallet'), 'page' => 'wallet', 'isRs' => true, 'cfg' => $cfg, 'bal' => Reseller::balance($me['id']),
            'shopLink' => ($cfg['ref'] ?? '') !== '' ? '/shop' . Shop::wQuery() . (Shop::wQuery() === '' ? '?' : '&') . 'ref=' . $cfg['ref'] : '',
            'sum' => Reseller::summary($me['id']), 'rows' => $page, 'pg' => $pg, 'pages' => $pages, 'total' => count($rows), 'f' => $f, 'plist' => $list,
        ]);
    }

    // ---- /vouchers/generate wrapper (routes.d/reseller.php overrides the route; VoucherController is untouched) ----------

    public static function voucherGenerate(): void
    {
        $me = Auth::user();
        if (!Reseller::isReseller($me)) {
            VoucherController::generate();
            return;
        }
        $r = App::driver();
        $profile = App::post('profile');
        $limit = strtolower(App::post('limit_uptime'));
        $meta = null;
        if ($profile !== '') {
            foreach ($r->print('/ip/hotspot/user/profile', ['name' => $profile], ['name', 'on-login']) as $p) {
                $meta = Scripts::parseMeta((string)($p['on-login'] ?? '')) ?: [];
                $found = true;
            }
        }
        // let VoucherController produce its own validation messages without charging
        if (!isset($found) || HotspotController::checkTimeLimit($r, $profile, $limit) !== '') {
            VoucherController::generate();
            return;
        }
        $qty = max(1, min((int)Store::setting('max_qty', 500), (int)App::post('qty', '10')));
        $base = $meta ? Reseller::basePrice($meta) : 0.0;
        $t = Reseller::charge($profile, $base, $qty, ['via' => 'voucher', 'batch' => mb_substr(App::post('batch'), 0, 24)]);
        if ($t && isset($t['error'])) {
            Audit::log('reseller.blocked', $profile . ' x' . $qty . ': ' . $t['error']);
            App::redirect('/vouchers', $t['error'], 'err');
        }
        try {
            VoucherController::generate();   // ends with a redirect (exit) on success
        } catch (Throwable $e) {
            if ($t) {
                Reseller::rollback($t, 'voucher error');
            }
            throw $e;
        }
    }
}
