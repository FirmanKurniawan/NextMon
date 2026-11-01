<?php
/**
 * Reseller wallets. Config per reseller user in doc "resellers"; balances in doc "wallets"; every movement is an
 * append-only row in collection "wallet_ledger" carrying the running balance ("bal") after that row.
 * Entry types: topup | sale | refund | commission | adjustment.  Amounts are signed integers (currency units).
 * Retention note: the ledger is a Store log collection (SQLite: newest 50,000 rows kept; JSON fallback: 2 MB rotation).
 * The authoritative current balance is the "wallets" doc, so pruning old rows never changes balances.
 */
final class Reseller
{
    public const TYPES = ['topup', 'sale', 'refund', 'commission', 'adjustment'];
    private const LEDGER = 'wallet_ledger';

    // ---- config ---------------------------------------------------------------------------------

    public static function defaults(): array
    {
        return ['active' => true, 'commission' => 0.0, 'adj' => 0.0, 'credit' => 0, 'allow_all' => true, 'profiles' => []];
    }

    public static function all(): array
    {
        return (array)Store::read('resellers', []);
    }

    public static function cfg(string $uid): ?array
    {
        $a = self::all();
        return isset($a[$uid]) ? array_replace(self::defaults(), $a[$uid]) : null;
    }

    public static function saveCfg(string $uid, array $in): void
    {
        $profiles = [];
        foreach ((array)($in['profiles'] ?? []) as $name => $adj) {
            $profiles[(string)$name] = ($adj === '' || $adj === null) ? null : max(-100.0, min(1000.0, (float)$adj));
        }
        $cfg = [
            'active' => !empty($in['active']),
            'commission' => max(0.0, min(100.0, (float)($in['commission'] ?? 0))),
            'adj' => max(-100.0, min(1000.0, (float)($in['adj'] ?? 0))),
            'credit' => max(0, (int)($in['credit'] ?? 0)),
            'allow_all' => !empty($in['allow_all']),
            'profiles' => $profiles,
        ];
        Store::update('resellers', function ($a) use ($uid, $cfg) {
            $cfg['ref'] = (string)($a[$uid]['ref'] ?? '');   // the referral code is managed by setRef() only
            $a[$uid] = $cfg;
            return $a;
        }, []);
    }

    // ---- shop referral: ?ref=<code> only ATTRIBUTES an order to a reseller (never workspace / price / product) ------------

    public const REF_RE = '/^[a-z0-9][a-z0-9-]{2,23}$/';

    /** Slug-safe form of a client-supplied code ('' when nothing usable is left). */
    public static function cleanRef(string $s): string
    {
        $s = trim(preg_replace('/[^a-z0-9-]+/', '-', strtolower(mb_substr($s, 0, 60))), '-');
        return preg_match(self::REF_RE, $s) ? $s : '';
    }

    /** Set (or clear with '') the referral code of a reseller. Unique per workspace. Returns '' on success, else an error message. */
    public static function setRef(string $uid, string $code): string
    {
        $code = trim(strtolower($code));
        if ($code !== '' && self::cleanRef($code) !== $code) {
            return t('Referral code: 3-24 characters, a-z, 0-9 and dash.');
        }
        $err = '';
        Store::update('resellers', function ($a) use ($uid, $code, &$err) {
            foreach ($a as $id => $c) {
                if ($code !== '' && $id !== $uid && ($c['ref'] ?? '') === $code) {
                    $err = t('This referral code is already used.');
                    return $a;
                }
            }
            $a[$uid] = array_replace(self::defaults(), (array)($a[$uid] ?? []), ['ref' => $code]);
            return $a;
        }, []);
        return $err;
    }

    /** Active reseller owning referral $code in the CURRENT workspace, or null (unknown / inactive / not a reseller user: ignored silently). */
    public static function byRef(string $code): ?array
    {
        $code = self::cleanRef($code);
        if ($code === '') {
            return null;
        }
        foreach (self::all() as $uid => $c) {
            if (($c['ref'] ?? '') !== $code) {
                continue;
            }
            $cfg = array_replace(self::defaults(), (array)$c);
            if (!$cfg['active']) {
                return null;
            }
            foreach (Auth::users() as $u) {
                if ($u['id'] === $uid && ($u['role'] ?? '') === 'reseller') {
                    return ['uid' => (string)$uid, 'user' => $u, 'cfg' => $cfg, 'code' => $code];
                }
            }
            return null;
        }
        return null;
    }

    /**
     * Credit the shop commission of order $orderId once (guarded by the ledger itself: type commission + ref = order id).
     * @return int amount credited (0 when none or already credited, see $already)
     */
    public static function creditOrder(string $uid, string $orderId, int $amount, string $pct, bool &$already = false): int
    {
        $already = false;
        if ($amount <= 0) {
            return 0;
        }
        [$ok] = self::post($uid, [['type' => 'commission', 'amount' => $amount, 'note' => 'Shop ' . $orderId . ' ' . $pct . '%', 'ref' => $orderId, 'meta' => ['via' => 'shop', 'order' => $orderId], 'once' => true]], false, 'system');
        $already = !$ok;
        return $ok ? $amount : 0;
    }

    /** Reverse a credited shop commission exactly once (ref "rev:<order id>"). Returns the amount reversed. */
    public static function reverseOrder(string $uid, string $orderId, int $amount): int
    {
        if ($amount <= 0) {
            return 0;
        }
        [$ok] = self::post($uid, [['type' => 'commission', 'amount' => -$amount, 'note' => 'Shop refund ' . $orderId, 'ref' => 'rev:' . $orderId, 'meta' => ['via' => 'shop', 'order' => $orderId, 'auto' => 1], 'once' => true]], false, 'system');
        return $ok ? $amount : 0;
    }

    public static function isReseller(?array $u): bool
    {
        return $u && ($u['role'] ?? '') === 'reseller';
    }

    public static function allowed(array $cfg, string $profile): bool
    {
        return !empty($cfg['allow_all']) || array_key_exists($profile, (array)$cfg['profiles']);
    }

    /** Percent adjustment that applies to $profile (per-profile override, else the reseller default). Negative = discount. */
    public static function adjFor(array $cfg, string $profile): float
    {
        $p = $cfg['profiles'][$profile] ?? null;
        return $p === null ? (float)$cfg['adj'] : (float)$p;
    }

    /** What the reseller pays for one voucher whose customer price is $base. */
    public static function unitCost(array $cfg, string $profile, float $base): int
    {
        return max(0, (int)round($base * (1 + self::adjFor($cfg, $profile) / 100)));
    }

    public static function commissionFor(array $cfg, float $base, int $qty): int
    {
        return (int)round($base * $qty * (float)$cfg['commission'] / 100);
    }

    /** Customer-facing price from a parsed on-login meta (same rule as the POS). */
    public static function basePrice(?array $meta): float
    {
        return $meta ? (float)($meta['sprice'] !== '' ? $meta['sprice'] : $meta['price']) : 0.0;
    }

    // ---- batch ownership: a reseller may only print / reprint vouchers that were created through their own sales -------

    private const BATCHES = 'reseller_batches';

    /** Remember that the current user (when a reseller) created the voucher batch tagged $comment. */
    public static function recordBatch(string $comment): void
    {
        $u = Auth::user();
        if (!self::isReseller($u) || $comment === '') {
            return;
        }
        Store::update(self::BATCHES, function ($m) use ($comment, $u) {
            $m[$comment] = $u['id'];
            return count($m) > 5000 ? array_slice($m, -4000, null, true) : $m;
        }, []);
    }

    /** Non-resellers see every batch; a reseller only the ones recorded for them. */
    public static function mayPrint(string $batchTag): bool
    {
        $u = Auth::user();
        if (!self::isReseller($u)) {
            return true;
        }
        $m = (array)Store::read(self::BATCHES, []);
        return $batchTag !== '' && ($m[$batchTag] ?? null) === $u['id'];
    }

    // ---- balances + ledger ----------------------------------------------------------------------

    public static function balance(string $uid): int
    {
        $w = (array)Store::read('wallets', []);
        return (int)($w[$uid] ?? 0);
    }

    public static function balances(): array
    {
        return array_map('intval', (array)Store::read('wallets', []));
    }

    /**
     * Apply ledger rows to one wallet atomically.
     * @param array $specs list of ['type','amount'(signed int),'note','ref','meta','once'(bool)]
     * @param bool  $enforce refuse when the resulting balance would fall below -credit limit
     * @return array [bool ok, string error, array entries]
     */
    public static function post(string $uid, array $specs, bool $enforce, string $by = ''): array
    {
        $cfg = self::cfg($uid);
        $limit = $cfg ? (int)$cfg['credit'] : 0;
        $err = '';
        $entries = [];
        Store::update('wallets', function ($w) use ($uid, $specs, $enforce, $limit, $by, &$err, &$entries) {
            $bal = (int)($w[$uid] ?? 0);
            $start = $bal;
            $rows = [];
            foreach ($specs as $s) {
                if (!in_array($s['type'], self::TYPES, true)) {
                    $err = 'bad type';
                    return $w;
                }
                if (!empty($s['once']) && !empty($s['ref']) && Store::rows(self::LEDGER, 1, 0, ['type' => $s['type'], 'ref' => $s['ref'], 'uid' => $uid])) {
                    $err = t('Already refunded.');
                    return $w;
                }
                $bal += (int)$s['amount'];
                $rows[] = [
                    'id' => dechex(time()) . '-' . bin2hex(random_bytes(3)), 'ts' => time(), 'uid' => $uid, 'type' => $s['type'],
                    'amount' => (int)$s['amount'], 'bal' => $bal, 'note' => mb_substr((string)($s['note'] ?? ''), 0, 200),
                    'ref' => (string)($s['ref'] ?? ''), 'meta' => $s['meta'] ?? new stdClass(), 'by' => $by,
                ];
            }
            if ($enforce && $bal < $start && $bal < -$limit) {
                $err = t('Insufficient balance. Needed :need, available :bal.', [':need' => money($start - $bal), ':bal' => money($start)]);
                return $w;
            }
            foreach ($rows as $row) {
                Store::append(self::LEDGER, $row);
            }
            $entries = $rows;
            $w[$uid] = $bal;
            return $w;
        }, []);
        return [$err === '', $err, $entries];
    }

    /** Admin top-up (positive) */
    public static function topup(string $uid, int $amount, string $note): array
    {
        $by = Auth::user()['username'] ?? '';
        return self::post($uid, [['type' => 'topup', 'amount' => $amount, 'note' => $note]], false, $by);
    }

    /** Admin adjustment, signed */
    public static function adjust(string $uid, int $amount, string $note): array
    {
        $by = Auth::user()['username'] ?? '';
        return self::post($uid, [['type' => 'adjustment', 'amount' => $amount, 'note' => $note]], $amount < 0, $by);
    }

    /**
     * Sale hook. Returns null when the current user is not a reseller (nothing to do),
     * ['error' => msg] when the sale must be blocked, or a ticket array when the wallet has been debited.
     */
    public static function charge(string $profile, float $base, int $qty = 1, array $meta = []): ?array
    {
        $u = Auth::user();
        if (!self::isReseller($u)) {
            return null;
        }
        $cfg = self::cfg($u['id']);
        if (!$cfg || !$cfg['active']) {
            return ['error' => t('Your reseller account is not active. Ask the administrator.')];
        }
        if (!self::allowed($cfg, $profile)) {
            return ['error' => t('You are not allowed to sell the profile :p.', [':p' => $profile])];
        }
        $qty = max(1, $qty);
        $unit = self::unitCost($cfg, $profile, $base);
        $cost = $unit * $qty;
        $comm = self::commissionFor($cfg, $base, $qty);
        $meta += ['profile' => $profile, 'qty' => $qty, 'base' => (int)$base, 'unit' => $unit];
        $sid = dechex(time()) . '-s' . bin2hex(random_bytes(3));
        $specs = [['type' => 'sale', 'amount' => -$cost, 'note' => $qty . ' x ' . $profile, 'ref' => $sid, 'meta' => $meta]];
        if ($comm > 0) {
            $specs[] = ['type' => 'commission', 'amount' => $comm, 'note' => $cfg['commission'] . '% ' . $profile, 'ref' => $sid, 'meta' => $meta];
        }
        [$ok, $err, $entries] = self::post($u['id'], $specs, true, $u['username']);
        if (!$ok) {
            return ['error' => $err];
        }
        return ['uid' => $u['id'], 'sale' => $entries[0]['id'], 'sid' => $sid, 'cost' => $cost, 'comm' => $comm, 'balance' => end($entries)['bal'], 'profile' => $profile, 'qty' => $qty];
    }

    /** Undo a charge() whose voucher could not be created. */
    public static function rollback(array $t, string $why = ''): void
    {
        $specs = [['type' => 'refund', 'amount' => $t['cost'], 'note' => 'rollback ' . $why, 'ref' => $t['sale'], 'meta' => ['profile' => $t['profile'], 'qty' => $t['qty'], 'auto' => 1]]];
        if ($t['comm'] > 0) {
            $specs[] = ['type' => 'commission', 'amount' => -$t['comm'], 'note' => 'reversal', 'ref' => $t['sale'], 'meta' => ['auto' => 1]];
        }
        self::post($t['uid'], $specs, false, 'system');
    }

    /** Admin refund of a sale row (also reverses its commission). */
    public static function refund(string $entryId, string $by): array
    {
        $e = Store::rows(self::LEDGER, 1, 0, ['id' => $entryId])[0] ?? null;
        if (!$e || $e['type'] !== 'sale') {
            return [false, t('Only sale rows can be refunded.'), []];
        }
        $specs = [['type' => 'refund', 'amount' => -(int)$e['amount'], 'note' => 'refund ' . $e['note'], 'ref' => $e['id'], 'meta' => (array)($e['meta'] ?? []), 'once' => true]];
        foreach (Store::rows(self::LEDGER, 5, 0, ['ref' => $e['ref'], 'type' => 'commission']) as $c) {
            if ($c['amount'] > 0 && $c['uid'] === $e['uid']) {
                $specs[] = ['type' => 'commission', 'amount' => -(int)$c['amount'], 'note' => 'reversal', 'ref' => $e['id'], 'meta' => ['auto' => 1]];
            }
        }
        return self::post($e['uid'], $specs, false, $by);
    }

    // ---- reading --------------------------------------------------------------------------------

    /**
     * Filter ledger rows (newest first).
     * @param array $f uid, type, from (Y-m-d), to (Y-m-d), q (text in note/profile/by)
     */
    public static function rows(array $f, int $max = 20000): array
    {
        $where = [];
        if (!empty($f['uid'])) {
            $where['uid'] = $f['uid'];
        }
        if (!empty($f['type']) && in_array($f['type'], self::TYPES, true)) {
            $where['type'] = $f['type'];
        }
        $from = !empty($f['from']) ? strtotime($f['from'] . ' 00:00:00') : 0;
        $to = !empty($f['to']) ? strtotime($f['to'] . ' 23:59:59') : PHP_INT_MAX;
        $q = strtolower(trim((string)($f['q'] ?? '')));
        $out = [];
        foreach (Store::rows(self::LEDGER, $max, 0, $where) as $r) {
            if ($r['ts'] < $from || $r['ts'] > $to) {
                continue;
            }
            if ($q !== '' && strpos(strtolower($r['note'] . ' ' . ($r['meta']['profile'] ?? '') . ' ' . $r['by'] . ' ' . $r['type']), $q) === false) {
                continue;
            }
            $out[] = $r;
        }
        return $out;
    }

    /** Sales/commission totals for a reseller */
    public static function summary(string $uid): array
    {
        $today = date('Y-m-d');
        $month = date('Y-m');
        $s = ['today_n' => 0, 'today_amt' => 0, 'month_n' => 0, 'month_amt' => 0, 'comm_month' => 0, 'comm_total' => 0, 'topup_total' => 0];
        $refunded = [];
        $rows = self::rows(['uid' => $uid], 5000);
        foreach ($rows as $r) {
            if ($r['type'] === 'refund' && $r['ref'] !== '') {
                $refunded[$r['ref']] = true;
            }
        }
        foreach ($rows as $r) {
            $d = date('Y-m-d', $r['ts']);
            if ($r['type'] === 'sale' && !isset($refunded[$r['id']])) {
                $n = (int)($r['meta']['qty'] ?? 1);
                if ($d === $today) {
                    $s['today_n'] += $n;
                    $s['today_amt'] += -$r['amount'];
                }
                if (strncmp($d, $month, 7) === 0) {
                    $s['month_n'] += $n;
                    $s['month_amt'] += -$r['amount'];
                }
            } elseif ($r['type'] === 'commission') {
                $s['comm_total'] += $r['amount'];
                if (strncmp($d, $month, 7) === 0) {
                    $s['comm_month'] += $r['amount'];
                }
            } elseif ($r['type'] === 'topup') {
                $s['topup_total'] += $r['amount'];
            }
        }
        return $s;
    }

    public static function csv(array $rows, array $names): string
    {
        $o = fopen('php://temp', 'r+');
        fputcsv($o, ['time', 'reseller', 'type', 'amount', 'balance', 'profile', 'qty', 'note', 'by', 'id', 'ref'], ',', '"', '\\');
        foreach ($rows as $r) {
            fputcsv($o, [date('Y-m-d H:i:s', $r['ts']), $names[$r['uid']] ?? $r['uid'], $r['type'], $r['amount'], $r['bal'], $r['meta']['profile'] ?? '', $r['meta']['qty'] ?? '', self::cell($r['note']), self::cell($r['by']), $r['id'], $r['ref']], ',', '"', '\\');
        }
        rewind($o);
        return "\xEF\xBB\xBF" . stream_get_contents($o);
    }

    /** Neutralise spreadsheet formula injection in text cells */
    public static function cell(string $v): string
    {
        return $v !== '' && strpos("=+-@\t\r", $v[0]) !== false && !is_numeric($v) ? "'" . $v : $v;
    }
}
