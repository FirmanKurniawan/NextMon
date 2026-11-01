<?php
/**
 * Per-workspace daily voucher quota (limit `vouchers_per_day`, 0 = unlimited, `main` unlimited via Workspace::limits()).
 * Counter = doc `quota` of the workspace: {day: 'Y-m-d' in the workspace timezone, used: n}. reserve() checks and increments inside
 * one Store::update (exclusive lock), so parallel or split requests cannot slip past the limit; release() gives units back when
 * generation fails or creates fewer vouchers than reserved.
 */
final class Quota
{
    /** Today's date in the workspace timezone (setting `timezone`). */
    public static function day(): string
    {
        $tz = (string)Store::setting('timezone', 'UTC');
        try {
            $z = new DateTimeZone($tz !== '' ? $tz : 'UTC');
        } catch (Throwable $e) {
            $z = new DateTimeZone('UTC');
        }
        return (new DateTimeImmutable('now', $z))->format('Y-m-d');
    }

    /** Vouchers already created today in workspace $ws (default: the active one). */
    public static function used(?string $ws = null): int
    {
        if ($ws !== null && $ws !== Workspace::idOrNull()) {
            return Workspace::run($ws, fn() => self::used());
        }
        $d = (array)Store::read('quota', []);
        return ($d['day'] ?? '') === self::day() ? max(0, (int)($d['used'] ?? 0)) : 0;
    }

    /** ['used' => n, 'limit' => n (0 = unlimited)] for the vouchers-per-day limit. */
    public static function usage(?string $ws = null): array
    {
        $ws ??= Workspace::id();
        return ['used' => self::used($ws), 'limit' => (int)(Workspace::limits($ws)['vouchers_per_day'] ?? 0)];
    }

    /** Usage vs limit for the settings page: routers, staff (owner not counted), vouchers today, log rows. Each: ['used','limit'] (limit 0 = unlimited). */
    public static function plan(): array
    {
        $lim = Workspace::limits();
        return [
            'routers' => ['used' => count(App::ownRouters()), 'limit' => (int)$lim['routers']],
            'staff' => ['used' => max(0, count(Auth::users()) - 1), 'limit' => (int)$lim['staff']],
            'vouchers' => self::usage(),
            'log_rows' => self::logUsage(),
        ];
    }

    /** Rows currently stored in the capped log collections vs the `log_rows` limit (per collection, the fullest one). */
    public static function logUsage(?string $ws = null): array
    {
        $ws ??= Workspace::id();
        $max = 0;
        Workspace::run($ws, function () use (&$max) {
            foreach (Store::CAPPED_LOGS as $l) {
                $max = max($max, Store::count($l));
            }
        });
        return ['used' => $max, 'limit' => (int)(Workspace::limits($ws)['log_rows'] ?? 0)];
    }

    /** Same refusal as reserve() but counts nothing (dry runs, previews). */
    public static function check(int $n): void
    {
        $limit = (int)(Workspace::limits()['vouchers_per_day'] ?? 0);
        if ($limit > 0 && $n > 0 && self::used() + $n > $limit) {
            throw self::exceeded(self::used(), $limit, $n);
        }
    }

    private static function exceeded(int $used, int $limit, int $n): QuotaException
    {
        $e = new QuotaException(t('Daily voucher limit reached (:used of :limit used today, :n requested). Try again tomorrow or ask the platform admin to raise the limit.', [
            ':used' => (string)$used, ':limit' => (string)$limit, ':n' => (string)$n,
        ]));
        $e->used = $used;
        $e->limit = $limit;
        $e->requested = $n;
        return $e;
    }

    /**
     * Reserve $n vouchers for today. Returns a token for release() (null when nothing was counted: unlimited or $n <= 0).
     * @throws QuotaException with used/limit when used + $n would exceed the limit (nothing is counted then)
     */
    public static function reserve(int $n): ?array
    {
        $limit = (int)(Workspace::limits()['vouchers_per_day'] ?? 0);
        if ($limit <= 0 || $n <= 0) {
            return null;
        }
        $day = self::day();
        $used = 0;
        $ok = false;
        Store::update('quota', function ($cur) use ($day, $n, $limit, &$used, &$ok) {
            $cur = (array)$cur;
            $u = ($cur['day'] ?? '') === $day ? max(0, (int)($cur['used'] ?? 0)) : 0;
            $used = $u;
            if ($u + $n > $limit) {
                return ['day' => $day, 'used' => $u];
            }
            $ok = true;
            return ['day' => $day, 'used' => $u + $n];
        }, []);
        if (!$ok) {
            throw self::exceeded($used, $limit, $n);
        }
        return ['day' => $day, 'n' => $n, 'ws' => Workspace::id()];
    }

    /** Give back $n (default: everything) of a reservation, e.g. generation failed or produced fewer vouchers. Never goes below 0. */
    public static function release(?array $tok, ?int $n = null): void
    {
        if (!$tok) {
            return;
        }
        $n = max(0, min((int)$tok['n'], $n ?? (int)$tok['n']));
        if ($n === 0) {
            return;
        }
        $day = (string)$tok['day'];
        $fn = function () use ($day, $n) {
            Store::update('quota', function ($cur) use ($day, $n) {
                $cur = (array)$cur;
                if (($cur['day'] ?? '') !== $day) {
                    return $cur;   // day rolled over: yesterday's units are gone anyway
                }
                $cur['used'] = max(0, (int)($cur['used'] ?? 0) - $n);
                return $cur;
            }, []);
        };
        $ws = (string)($tok['ws'] ?? '');
        $ws !== '' && $ws !== Workspace::idOrNull() ? Workspace::run($ws, $fn) : $fn();
    }

    /** Run $fn after reserving $n; the reservation is released if $fn throws. */
    public static function guard(int $n, callable $fn)
    {
        $tok = self::reserve($n);
        try {
            return $fn();
        } catch (Throwable $e) {
            self::release($tok);
            throw $e;
        }
    }
}
