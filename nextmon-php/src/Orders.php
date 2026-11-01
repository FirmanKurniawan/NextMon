<?php
/**
 * Shop orders: one JSON file per order in data/orders/, states pending|paid|expired|failed|refunded.
 * Every mutation runs under a per-order exclusive file lock. Fulfilment (voucher on the router) is idempotent:
 *  - the voucher code is chosen and persisted BEFORE the router is touched (voucher_pre),
 *  - a retry first looks the user up on the router and re-uses it, so a crash between "router add" and "order saved"
 *    can never produce a second voucher,
 *  - once order.voucher is set nothing ever provisions again, no matter how many callbacks arrive.
 */
final class Orders
{
    public const STATES = ['pending', 'paid', 'expired', 'failed', 'refunded'];

    public static function dir(): string
    {
        return Workspace::dir('orders');   // created on demand, one directory per workspace
    }

    /**
     * Order ids carry their workspace: `KL<yymmdd>-<6 hex>` for workspace `main` (and every pre-multi-tenant order), and
     * `KL<yymmdd>-<6 hex>-<8 hex>` (the hex part of the workspace id `w_xxxxxxxx`, upper case) for all others. A payment webhook
     * therefore finds its workspace from the order id alone.
     */
    public static function valid(string $id): bool
    {
        return (bool)preg_match('/^KL\d{6}-[A-F0-9]{6}(-[A-F0-9]{8})?$/', $id);
    }

    /** Workspace id encoded in (the first order id found in) $text, or null when there is none. Does not check that it exists. */
    public static function workspaceOf(string $text): ?string
    {
        if (!preg_match('/KL\d{6}-[A-F0-9]{6}(?:-([A-F0-9]{8}))?(?![A-Za-z0-9])/', $text, $m)) {
            return null;
        }
        return !empty($m[1]) ? 'w_' . strtolower($m[1]) : 'main';
    }

    public static function get(string $id): ?array
    {
        if (!self::valid($id)) {
            return null;
        }
        $f = self::dir() . '/' . $id . '.json';
        if (!is_file($f)) {
            return null;
        }
        $j = json_decode((string)file_get_contents($f), true);
        return is_array($j) ? $j : null;
    }

    /** @return array[] newest first */
    public static function all(): array
    {
        $out = [];
        foreach (glob(self::dir() . '/KL*.json') ?: [] as $f) {
            $j = json_decode((string)file_get_contents($f), true);
            if (is_array($j) && isset($j['id'])) {
                $out[] = $j;
            }
        }
        usort($out, fn($a, $b) => $b['created'] <=> $a['created']);
        return $out;
    }

    public static function put(array $o): void
    {
        $f = self::dir() . '/' . $o['id'] . '.json';
        $o['updated'] = time();
        $tmp = $f . '.' . bin2hex(random_bytes(4)) . '.tmp';
        file_put_contents($tmp, json_encode($o, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
        if (!@rename($tmp, $f)) {
            @copy($tmp, $f);
            @unlink($tmp);
        }
    }

    /** Run $fn under the order's exclusive lock. */
    public static function locked(string $id, callable $fn)
    {
        $h = fopen(self::dir() . '/.' . $id . '.lock', 'c');
        if ($h) {
            flock($h, LOCK_EX);
        }
        try {
            return $fn();
        } finally {
            if ($h) {
                flock($h, LOCK_UN);
                fclose($h);
            }
        }
    }

    public static function create(array $pkg, array $customer, string $gateway, int $expiryMin, string $routerId): array
    {
        for ($i = 0; $i < 5; $i++) {
            $ws = Workspace::id();
            $id = 'KL' . date('ymd') . '-' . strtoupper(bin2hex(random_bytes(3))) . ($ws === 'main' ? '' : '-' . strtoupper(substr($ws, 2)));
            $f = self::dir() . '/' . $id . '.json';
            if (is_file($f)) {
                continue;
            }
            $o = [
                'id' => $id,
                'token' => bin2hex(random_bytes(12)),
                'created' => time(),
                'updated' => time(),
                'expires' => time() + 60 * max(5, $expiryMin),
                'status' => 'pending',
                'package' => ['id' => $pkg['id'], 'profile' => $pkg['profile'], 'price' => (int)$pkg['price'], 'label' => $pkg['label'] !== '' ? $pkg['label'] : $pkg['profile']],
                'amount' => (int)$pkg['price'],
                'customer' => $customer,
                'gateway' => $gateway,
                'router' => $routerId,
                'ref' => '',
                'pay_url' => '',
                'pay_info' => '',
                'voucher' => null,
                'fulfil' => '',
                'notes' => [],
                'events' => [],
                'ip' => Audit::ip(),
            ];
            self::put($o);
            return $o;
        }
        throw new RuntimeException('Could not allocate an order id');
    }

    /** Locked read-modify-write of simple fields. $fn(array $o): array. */
    public static function update(string $id, callable $fn): ?array
    {
        return self::locked($id, function () use ($id, $fn) {
            $o = self::get($id);
            if (!$o) {
                return null;
            }
            $o = $fn($o);
            self::put($o);
            return $o;
        });
    }

    private static function event(array &$o, string $type, string $detail, string $fp = ''): void
    {
        $o['events'][] = ['ts' => time(), 'type' => $type, 'detail' => mb_substr($detail, 0, 200), 'fp' => $fp];
        $o['events'] = array_slice($o['events'], -40);
    }

    public static function note(array &$o, string $by, string $text): void
    {
        $o['notes'][] = ['ts' => time(), 'by' => $by, 'text' => mb_substr($text, 0, 500)];
    }

    /** pending orders past their deadline become expired (a late verified payment is still honoured). */
    public static function expireStale(): void
    {
        foreach (glob(self::dir() . '/KL*.json') ?: [] as $f) {
            $j = json_decode((string)file_get_contents($f), true);
            if (is_array($j) && ($j['status'] ?? '') === 'pending' && ($j['expires'] ?? PHP_INT_MAX) < time()) {
                self::update($j['id'], function ($o) {
                    if ($o['status'] === 'pending' && $o['expires'] < time()) {
                        $o['status'] = 'expired';
                        self::event($o, 'expired', 'deadline passed');
                    }
                    return $o;
                });
            }
        }
    }

    // ---- payment results ----------------------------------------------------------------

    /** Admin or system says: paid. $amount = verified amount from the gateway, null for a manual confirmation. */
    public static function markPaid(string $id, string $source, ?int $amount = null): array
    {
        $res = self::locked($id, function () use ($id, $source, $amount) {
            $o = self::get($id);
            if (!$o) {
                return [false, 'not found', null, false];
            }
            return self::paidLocked($o, $source, $amount);
        });
        self::announce($res);
        return [$res[0], $res[1], $res[2]];
    }

    /** Paid but the router was unreachable earlier: try again (throttled by the caller via retry_at). */
    public static function retryFulfil(string $id): ?array
    {
        $res = self::locked($id, function () use ($id) {
            $o = self::get($id);
            if (!$o || $o['status'] !== 'paid' || !empty($o['voucher'])) {
                return [true, 'nothing to do', $o, false];
            }
            $o['retry_at'] = time();
            $o = self::provision($o);
            return [true, 'retried', $o, !empty($o['voucher'])];
        });
        self::announce($res);
        return $res[2];
    }

    /**
     * Apply a verified gateway webhook. $fp = fingerprint of the raw body (replay protection).
     * @return array [bool ok, string message, ?array order]
     */
    public static function applyEvent(string $id, array $ev, string $fp, string $gateway): array
    {
        $res = self::locked($id, function () use ($id, $ev, $fp, $gateway) {
            $o = self::get($id);
            if (!$o) {
                return [false, 'not found', null, false];
            }
            if ($o['gateway'] !== $gateway) {
                return [false, 'gateway mismatch', $o, false];
            }
            foreach ($o['events'] as $e) {
                if ($fp !== '' && ($e['fp'] ?? '') === $fp) {
                    return [true, 'duplicate', $o, false];
                }
            }
            self::event($o, 'callback', $ev['status'] . ' amount=' . $ev['amount'] . ' ref=' . $ev['ref'], $fp);
            if ($ev['ref'] !== '' && ($o['ref'] === '' || $o['gateway'] === 'mock')) {
                $o['ref'] = $ev['ref'];
            }
            switch ($ev['status']) {
                case 'paid':
                    return self::paidLocked($o, 'gateway:' . $gateway, $ev['amount']);
                case 'failed':
                case 'expired':
                    if ($o['status'] === 'pending') {
                        $o['status'] = $ev['status'];
                    }
                    self::put($o);
                    return [true, $o['status'], $o, false];
                case 'refunded':
                    if ($o['status'] === 'paid') {
                        $res = self::refundLocked($o, 'gateway:' . $gateway, 'Refund reported by gateway', true);
                        return $res;
                    }
                    self::put($o);
                    return [true, 'ignored', $o, false];
                default:
                    self::put($o);
                    return [true, 'pending', $o, false];
            }
        });
        self::announce($res);
        return [$res[0], $res[1], $res[2]];
    }

    /** MUST run under the order lock. Returns [ok, msg, order, newlyFulfilled]. */
    private static function paidLocked(array $o, string $source, ?int $amount): array
    {
        if ($o['status'] === 'refunded') {
            self::event($o, 'ignored', 'paid event on refunded order');
            self::put($o);
            return [false, 'order is refunded', $o, false];
        }
        if ($amount !== null && $amount !== (int)$o['amount']) {
            $o['flag'] = 'amount_mismatch';
            self::event($o, 'amount_mismatch', 'got ' . $amount . ' expected ' . $o['amount']);
            self::put($o);
            return [false, 'amount mismatch', $o, false];
        }
        $was = $o['status'];
        unset($o['flag']);
        $o['status'] = 'paid';
        if (empty($o['paid_at'])) {
            $o['paid_at'] = time();
            $o['paid_by'] = $source;
            self::event($o, 'paid', $source . ($was !== 'pending' ? ' (late, was ' . $was . ')' : ''));
        }
        self::put($o); // persist "paid" before the router is touched
        $fresh = false;
        if (empty($o['voucher'])) {
            $o = self::provision($o);
            $fresh = !empty($o['voucher']);
        }
        return [true, empty($o['voucher']) ? 'paid, voucher pending' : 'ok', $o, $fresh];
    }

    /** MUST run under the order lock. Creates (or re-finds) the hotspot user, always saves. */
    private static function provision(array $o): array
    {
        try {
            $cfg = Shop::config();
            $rc = App::routerCfg($o['router']) ?: Shop::routerCfg($cfg);
            if (!$rc) {
                throw new RuntimeException('No router configured');
            }
            if (empty($o['voucher_pre'])) {
                $name = Voucher::code(6, 'lowernum');
                $o['voucher_pre'] = ['user' => $name, 'pass' => $name, 'comment' => 'vc-' . random_int(100, 999) . '-' . date('m.d.y') . '-SHOP-' . $o['id']];
                self::put($o);
            }
            $r = App::driverFor($rc);
            for ($i = 0; $i < 6; $i++) {
                $pre = $o['voucher_pre'];
                $ex = $r->print('/ip/hotspot/user', ['name' => $pre['user']]);
                if (!$ex) {
                    $r->add('/ip/hotspot/user', ['name' => $pre['user'], 'password' => $pre['pass'], 'profile' => $o['package']['profile'], 'comment' => $pre['comment']]);
                    CachedDriver::flush((string)$rc['id']);   // the admin UI reads this router through the short read cache
                    break;
                }
                if (strpos((string)($ex[0]['comment'] ?? ''), $o['id']) !== false) {
                    break; // our own user from an interrupted attempt
                }
                $n = Voucher::code(6, 'lowernum'); // somebody else's user: pick another code
                $o['voucher_pre'] = ['user' => $n, 'pass' => $n, 'comment' => $pre['comment']];
                self::put($o);
                if ($i === 5) {
                    throw new RuntimeException('Could not find a free voucher code');
                }
            }
            $pre = $o['voucher_pre'];
            $o['voucher'] = ['user' => $pre['user'], 'pass' => $pre['pass'], 'url' => Voucher::loginUrl($pre['user'], $pre['pass']), 'comment' => $pre['comment'], 'created' => time()];
            $o['fulfil'] = 'done';
            unset($o['fulfil_err']);
            self::event($o, 'fulfilled', $pre['user']);
        } catch (Throwable $e) {
            $o['fulfil'] = 'error';
            $o['fulfil_err'] = mb_substr($e->getMessage(), 0, 200);
            self::event($o, 'fulfil_error', $o['fulfil_err']);
        }
        self::put($o);
        return $o;
    }

    private static function announce(array $res): void
    {
        if (!empty($res[3]) && $res[2]) {
            $o = $res[2];
            Audit::log('shop.paid', $o['id'] . ' ' . $o['package']['label'] . ' ' . $o['amount']);
            Notify::event('sale', 'Shop sale ' . $o['id'] . ': ' . $o['package']['label'] . ' ' . money($o['amount']) . ' - ' . ($o['customer']['name'] ?? ''));
        }
    }

    public static function refund(string $id, string $by, string $note, bool $disable): array
    {
        $res = self::locked($id, function () use ($id, $by, $note, $disable) {
            $o = self::get($id);
            if (!$o) {
                return [false, 'not found', null, false];
            }
            if ($o['status'] !== 'paid') {
                return [false, 'only paid orders can be refunded', $o, false];
            }
            return self::refundLocked($o, $by, $note, $disable);
        });
        return [$res[0], $res[1], $res[2]];
    }

    private static function refundLocked(array $o, string $by, string $note, bool $disable): array
    {
        $o['status'] = 'refunded';
        $o['refunded_at'] = time();
        self::note($o, $by, 'REFUND: ' . $note);
        self::event($o, 'refunded', $by);
        $msg = 'refunded';
        if ($disable && !empty($o['voucher'])) {
            try {
                $rc = App::routerCfg($o['router']) ?: Shop::routerCfg(Shop::config());
                $r = App::driverFor($rc);
                $u = $r->print('/ip/hotspot/user', ['name' => $o['voucher']['user']]);
                if ($u) {
                    $r->set('/ip/hotspot/user', (string)$u[0]['.id'], ['disabled' => 'yes']);
                    CachedDriver::flush((string)$rc['id']);
                    $msg .= ', voucher disabled';
                    self::event($o, 'voucher_disabled', $o['voucher']['user']);
                }
            } catch (Throwable $e) {
                $msg .= ', could not disable voucher: ' . $e->getMessage();
                self::note($o, 'system', 'Could not disable voucher: ' . $e->getMessage());
            }
        }
        self::put($o);
        return [true, $msg, $o, false];
    }

    /** Fields safe to show the customer. The voucher is included only for paid orders. */
    public static function publicView(array $o): array
    {
        $out = [
            'id' => $o['id'], 'status' => $o['status'], 'label' => $o['package']['label'], 'amount' => (int)$o['amount'],
            'expires_in' => max(0, (int)$o['expires'] - time()), 'fulfil' => $o['fulfil'] ?? '',
            'ready' => $o['status'] === 'paid' && !empty($o['voucher']),
        ];
        if ($out['ready']) {
            $out['voucher'] = ['user' => $o['voucher']['user'], 'pass' => $o['voucher']['pass'], 'url' => $o['voucher']['url']];
        }
        return $out;
    }
}
