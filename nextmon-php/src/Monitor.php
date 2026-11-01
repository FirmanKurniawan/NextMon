<?php
/**
 * Router monitor: poll (latency/uptime/CPU/RAM/active users), rolling history, alert rules with debounce,
 * stock/expiry checks and scheduled /export backups. Driven by Scheduler (cron) or "run now" in the UI.
 * Works on any Driver (real RouterOS or Demo).
 */
final class Monitor
{
    public const HIST_MAX = 2100; // ~7 days at 5 min

    // ---- config ------------------------------------------------------------------

    public static function defaults(): array
    {
        return [
            'poll_min' => 5,
            'stock_min' => 30,
            'ping_target' => '1.1.1.1',
            'channels' => ['telegram', 'webhook'],
            'cron_token' => '',
            'sim_down' => [],
            'enabled' => ['offline' => true, 'cpu' => true, 'mem' => true, 'stock' => true, 'expiring' => true, 'backup' => true],
            'rules' => [
                'offline_after' => 2,     // consecutive failed polls before "offline"
                'recover_after' => 2,     // consecutive good polls before "back online"
                'remind_min' => 120,      // re-notify while still offline
                'cpu_high' => 85, 'cpu_samples' => 3,
                'mem_high' => 90, 'mem_samples' => 3,
                'stock_default' => 10, 'stock_per' => [],
                'expiring_hours' => 48,
                'cooldown_min' => 60,
            ],
            'backup' => ['freq' => 'daily', 'at' => '03:00', 'dow' => 0, 'keep' => 7, 'binary' => false],
        ];
    }

    public static function config(): array
    {
        $def = self::defaults();
        $st = (array)Store::read('monitor', []);
        $c = array_replace($def, $st);
        foreach (['enabled', 'rules', 'backup'] as $k) {
            $c[$k] = array_replace($def[$k], (array)($st[$k] ?? []));
        }
        return $c;
    }

    public static function saveConfig(array $patch): void
    {
        Store::update('monitor', fn($cur) => array_replace((array)$cur, $patch), []);
    }

    public static function token(): string
    {
        $c = (array)Store::read('monitor', []);
        if (empty($c['cron_token'])) {
            $tok = bin2hex(random_bytes(16));
            self::saveConfig(['cron_token' => $tok]);
            return $tok;
        }
        return (string)$c['cron_token'];
    }

    // ---- helpers -------------------------------------------------------------------

    private static function safe(string $s): string
    {
        return preg_replace('/[^A-Za-z0-9_.\-]/', '_', $s);
    }

    public static function fmtDur(int $s): string
    {
        if ($s < 60) {
            return $s . 's';
        }
        $d = intdiv($s, 86400);
        $h = intdiv($s % 86400, 3600);
        $m = intdiv($s % 3600, 60);
        return ($d ? $d . 'd ' : '') . ($h || $d ? $h . 'h ' : '') . $m . 'm';
    }

    /** "12ms", "12ms345us", "345us", "1s20ms" => float ms */
    public static function parseMs(string $v): ?float
    {
        if (!preg_match_all('/(\d+)(s|ms|us)/', $v, $m, PREG_SET_ORDER)) {
            return null;
        }
        $t = 0.0;
        foreach ($m as $x) {
            $t += (float)$x[1] * ['s' => 1000.0, 'ms' => 1.0, 'us' => 0.001][$x[2]];
        }
        return $t;
    }

    public static function routerName(string $rid): string
    {
        foreach (App::ownRouters() as $r) {
            if ($r['id'] === $rid) {
                return (string)$r['name'];
            }
        }
        return $rid;
    }

    public static function state(): array
    {
        return (array)Store::read('monitor-state', []);
    }

    private static function patchState(string $rid, array $new): void
    {
        Store::update('monitor-state', function ($s) use ($rid, $new) {
            $s[$rid] = $new;
            return $s;
        }, []);
    }

    public static function history(string $rid, int $since = 0): array
    {
        $h = (array)Store::read('monitor-hist-' . self::safe($rid), []);
        if ($since > 0) {
            $h = array_values(array_filter($h, fn($p) => (int)$p['ts'] >= $since));
        }
        return $h;
    }

    // ---- alerts ----------------------------------------------------------------------

    /** Write to alert history and push to the configured channels. */
    public static function alert(string $rid, string $rule, string $level, string $text): void
    {
        $c = self::config();
        $name = self::routerName($rid);
        $msg = ['err' => '[!] ', 'warn' => '[!] ', 'ok' => '[OK] ', 'info' => ''][$level] ?? '';
        $msg .= 'NextMON - ' . $name . ': ' . $text;
        $sent = false;
        $res = '-';
        if ($c['channels']) {
            [$sent, $res] = Notify::send($msg, 'monitor:' . $rule, array_values((array)$c['channels']));
        }
        Store::appendLog('alerts.log', ['ts' => time(), 'router' => $rid, 'name' => $name, 'rule' => $rule, 'level' => $level, 'text' => $text, 'sent' => $sent, 'result' => $res]);
    }

    public static function alertLog(int $n = 200): array
    {
        return Store::tailLog('alerts.log', $n);
    }

    private static function cool(array &$st, string $key, int $seconds): bool
    {
        $now = time();
        if ($now - (int)($st['alerts'][$key] ?? 0) < $seconds) {
            return false;
        }
        $st['alerts'][$key] = $now;
        return true;
    }

    // ---- poll ----------------------------------------------------------------------

    /** Probe one router. @return array point {ts, ok, lat, net, cpu, mem, up, act, err?} */
    public static function probe(array $cfg, array $c): array
    {
        $ts = time();
        $t0 = microtime(true);
        $demo = App::demoForced() || ($cfg['type'] ?? '') === 'demo';
        try {
            if ($demo && in_array($cfg['id'], (array)$c['sim_down'], true)) {
                throw new RouterOSException('Simulated outage (demo)');
            }
            $r = App::driverFor($cfg);
            $res = $r->print('/system/resource')[0] ?? [];
            $lat = (int)round((microtime(true) - $t0) * 1000);
            if ($r->isDemo()) {
                $lat = (int)(11 + 6 * abs(sin($ts / 900)) + mt_rand(0, 9));
            }
            $act = count($r->print('/ip/hotspot/active', [], ['user']));
            $net = null;
            if ($c['ping_target'] !== '' && preg_match('/^[A-Za-z0-9.\-:]{1,100}$/', (string)$c['ping_target'])) {
                try {
                    App::setTimeout($r, 12);
                    $ms = [];
                    foreach ($r->command('/tool/ping', ['address' => $c['ping_target'], 'count' => '2']) as $row) {
                        $v = self::parseMs((string)($row['time'] ?? ''));
                        if ($v !== null) {
                            $ms[] = $v;
                        }
                    }
                    $net = $ms ? round(array_sum($ms) / count($ms), 1) : null;
                } catch (Throwable $e) {
                    $net = null;
                }
            }
            $tot = (float)($res['total-memory'] ?? 0);
            return [
                'ts' => $ts, 'ok' => 1, 'lat' => $lat, 'net' => $net, 'cpu' => (int)($res['cpu-load'] ?? 0),
                'mem' => $tot > 0 ? (int)round(100 * ($tot - (float)($res['free-memory'] ?? 0)) / $tot) : 0,
                'up' => Scripts::seconds((string)($res['uptime'] ?? '')), 'act' => $act,
                'info' => trim(($res['board-name'] ?? '') . ' ' . ($res['version'] ?? '')),
            ];
        } catch (Throwable $e) {
            return ['ts' => $ts, 'ok' => 0, 'err' => mb_substr($e->getMessage(), 0, 160)];
        }
    }

    /** Apply thresholds with debounce; returns the updated per-router state. */
    public static function evaluate(array $cfg, array $st, array $p, array $c): array
    {
        $rid = $cfg['id'];
        $R = $c['rules'];
        $E = $c['enabled'];
        $cool = max(1, (int)$R['cooldown_min']) * 60;
        $st += ['online' => true, 'fails' => 0, 'goods' => 0, 'since' => $p['ts'], 'cpu_n' => 0, 'mem_n' => 0, 'alerts' => []];
        $st['last'] = $p;
        $st['last_check'] = $p['ts'];
        if ($p['ok']) {
            $st['fails'] = 0;
            if (!$st['online']) {
                $st['goods']++;
                if ($st['goods'] >= max(1, (int)$R['recover_after'])) {
                    $down = isset($st['down_since']) ? $p['ts'] - (int)$st['down_since'] : 0;
                    $st['online'] = true;
                    $st['since'] = $p['ts'];
                    unset($st['down_since'], $st['alerts']['offline']);
                    if (!empty($E['offline'])) {
                        self::alert($rid, 'online', 'ok', t('Router is back online after :d.', [':d' => self::fmtDur($down)]));
                    }
                }
            }
            foreach (['cpu' => 'CPU', 'mem' => 'RAM'] as $m => $label) {
                $limit = (int)$R[$m . '_high'];
                $n = $m . '_n';
                if ($limit > 0 && $p[$m] >= $limit) {
                    $st[$n]++;
                    if (!empty($E[$m]) && $st[$n] >= max(1, (int)$R[$m . '_samples']) && self::cool($st, $m, $cool)) {
                        self::alert($rid, $m, 'warn', t(':l is high: :v% (threshold :t%).', [':l' => $label, ':v' => $p[$m], ':t' => $limit]));
                    }
                } else {
                    if ($st[$n] >= max(1, (int)$R[$m . '_samples']) && !empty($E[$m])) {
                        self::alert($rid, $m, 'ok', t(':l back to normal: :v%.', [':l' => $label, ':v' => $p[$m]]));
                    }
                    $st[$n] = 0;
                    unset($st['alerts'][$m]);
                }
            }
        } else {
            $st['goods'] = 0;
            $st['fails']++;
            $st['last_err'] = $p['err'] ?? '';
            if ($st['fails'] === 1) {
                $st['first_fail'] = $p['ts'];
            }
            if ($st['online'] && $st['fails'] >= max(1, (int)$R['offline_after'])) {
                $st['online'] = false;
                $st['down_since'] = $st['first_fail'] ?? $p['ts'];
                $st['alerts']['offline'] = $p['ts'];
                if (!empty($E['offline'])) {
                    self::alert($rid, 'offline', 'err', t('Router is unreachable (:n failed checks): :e', [':n' => $st['fails'], ':e' => $p['err'] ?? '']));
                }
            } elseif (!$st['online'] && !empty($E['offline']) && (int)$R['remind_min'] > 0 && self::cool($st, 'offline', (int)$R['remind_min'] * 60)) {
                self::alert($rid, 'offline', 'err', t('Router still offline for :d.', [':d' => self::fmtDur($p['ts'] - (int)($st['down_since'] ?? $p['ts']))]));
            }
        }
        return $st;
    }

    private static function demoBackfill(array $cfg): void
    {
        $key = 'monitor-hist-' . self::safe($cfg['id']);
        if (Store::read($key, []) || !(App::demoForced() || ($cfg['type'] ?? '') === 'demo')) {
            return;
        }
        $now = time();
        $pts = [];
        $up0 = 86400 * 12 + 3600 * 5;
        mt_srand(99);
        for ($i = 287; $i >= 1; $i--) {
            $ts = $now - $i * 300;
            $down = $i >= 108 && $i <= 111; // a short outage ~9 h ago
            $hour = (int)date('G', $ts);
            $busy = max(0, sin(($hour - 8) / 24 * 2 * M_PI * 1.1));
            if ($down) {
                $pts[] = ['ts' => $ts, 'ok' => 0, 'err' => 'connection timed out'];
                continue;
            }
            $spike = ($i % 61 === 0) ? mt_rand(40, 90) : 0;
            $pts[] = [
                'ts' => $ts, 'ok' => 1, 'lat' => (int)(10 + 4 * $busy + mt_rand(0, 8) + $spike), 'net' => round(18 + 6 * $busy + mt_rand(0, 90) / 10, 1),
                'cpu' => (int)min(97, 8 + 30 * $busy + mt_rand(0, 9) + ($i > 40 && $i < 44 ? 70 : 0)), 'mem' => (int)(42 + 8 * $busy + mt_rand(0, 4)),
                'up' => $up0 - $i * 300, 'act' => (int)(2 + 12 * $busy + mt_rand(0, 3)), 'info' => 'RB750Gr3 (demo)',
            ];
        }
        mt_srand();
        Store::write($key, $pts);
    }

    /** Job: poll every router. */
    public static function jobPoll(): string
    {
        $c = self::config();
        $routers = App::ownRouters();
        $bad = 0;
        foreach ($routers as $cfg) {
            self::demoBackfill($cfg);
            $p = self::probe($cfg, $c);
            $st = self::evaluate($cfg, (array)(self::state()[$cfg['id']] ?? []), $p, $c);
            self::patchState($cfg['id'], $st);
            Store::update('monitor-hist-' . self::safe($cfg['id']), function ($h) use ($p) {
                $h[] = $p;
                return count($h) > self::HIST_MAX ? array_slice($h, -self::HIST_MAX) : array_values($h);
            }, []);
            $bad += $p['ok'] ? 0 : 1;
        }
        return t(':n routers polled, :b unreachable.', [':n' => count($routers), ':b' => $bad]);
    }

    // ---- stock & expiring ---------------------------------------------------------------

    /** Unused vouchers per profile (profiles created through NextMON/Mikhmon on-login only). */
    public static function stockOf(Driver $r): array
    {
        $users = $r->print('/ip/hotspot/user', [], ['name', 'profile', 'uptime', 'disabled', 'limit-uptime', 'comment']);
        $profiles = $r->print('/ip/hotspot/user/profile', [], ['name', 'on-login']);
        $count = [];
        foreach ($profiles as $p) {
            if (in_array($p['name'], ['default', 'default-encryption'], true) || Scripts::parseMeta((string)($p['on-login'] ?? '')) === null) {
                continue;
            }
            $count[$p['name']] = 0;
        }
        foreach ($users as $u) {
            if (isset($count[$u['profile'] ?? '']) && ($u['disabled'] ?? '') !== 'true' && ($u['uptime'] ?? '0s') === '0s' && ($u['limit-uptime'] ?? '') !== '1s' && Voucher::expiryOf((string)($u['comment'] ?? '')) === '') {
                $count[$u['profile']]++;
            }
        }
        return $count;
    }

    /** @return array[] [name, profile, expires_ts] for users whose comment expiry is within $hours */
    public static function expiringOf(Driver $r, int $hours): array
    {
        $now = time();
        $out = [];
        foreach ($r->print('/ip/hotspot/user', [], ['name', 'profile', 'comment', 'disabled', 'limit-uptime']) as $u) {
            $e = Voucher::expiryOf((string)($u['comment'] ?? ''));
            if ($e === '' || ($u['disabled'] ?? '') === 'true' || ($u['limit-uptime'] ?? '') === '1s') {
                continue;
            }
            $d = DateTime::createFromFormat('M/d/Y H:i:s', $e);
            if ($d && $d->getTimestamp() > $now && $d->getTimestamp() <= $now + $hours * 3600) {
                $out[] = ['name' => $u['name'], 'profile' => $u['profile'] ?? '', 'ts' => $d->getTimestamp()];
            }
        }
        usort($out, fn($a, $b) => $a['ts'] <=> $b['ts']);
        return $out;
    }

    public static function jobStock(): string
    {
        $c = self::config();
        $R = $c['rules'];
        $msgs = [];
        foreach (App::ownRouters() as $cfg) {
            $rid = $cfg['id'];
            $st = (array)(self::state()[$rid] ?? []);
            if (isset($st['online']) && !$st['online']) {
                continue; // offline: the poll job already alerts
            }
            try {
                $r = App::driverFor($cfg);
                $stock = self::stockOf($r);
                $exp = self::expiringOf($r, (int)$R['expiring_hours']);
            } catch (Throwable $e) {
                $msgs[] = $cfg['name'] . ': ' . $e->getMessage();
                continue;
            }
            $st['stock'] = $stock;
            $st['stock_ts'] = time();
            $st['expiring'] = count($exp);
            $low = 0;
            foreach ($stock as $prof => $n) {
                $min = (int)($R['stock_per'][$prof] ?? $R['stock_default']);
                $key = 'stock:' . $prof;
                if ($min > 0 && $n < $min) {
                    $low++;
                    if (!empty($c['enabled']['stock']) && self::cool($st, $key, 86400)) {
                        self::alert($rid, 'stock', 'warn', t('Low voucher stock for profile :p: :n left (minimum :m).', [':p' => $prof, ':n' => $n, ':m' => $min]));
                    }
                } else {
                    unset($st['alerts'][$key]);
                }
            }
            if ($exp && !empty($c['enabled']['expiring']) && self::cool($st, 'expiring', 12 * 3600)) {
                $names = implode(', ', array_map(fn($x) => $x['name'], array_slice($exp, 0, 8)));
                self::alert($rid, 'expiring', 'info', t(':n users expire within :h hours: :l', [':n' => count($exp), ':h' => (int)$R['expiring_hours'], ':l' => $names . (count($exp) > 8 ? ', ...' : '')]));
            }
            self::patchState($rid, $st);
            $msgs[] = $cfg['name'] . ': ' . $low . ' low, ' . count($exp) . ' expiring';
        }
        return implode('; ', $msgs) ?: 'no routers';
    }

    // ---- backups ----------------------------------------------------------------------------

    public static function backupDue(array $c, int $last, int $now): bool
    {
        $b = $c['backup'];
        if (($b['freq'] ?? 'off') === 'off') {
            return false;
        }
        [$h, $m] = array_map('intval', explode(':', preg_match('/^\d{1,2}:\d\d$/', (string)$b['at']) ? $b['at'] : '03:00'));
        $slot = mktime($h, $m, 0, (int)date('n', $now), (int)date('j', $now), (int)date('Y', $now));
        if ($slot > $now) {
            $slot -= 86400;
        }
        if ($b['freq'] === 'weekly') {
            for ($i = 0; $i < 7 && (int)date('w', $slot) !== (int)$b['dow']; $i++) {
                $slot -= 86400;
            }
        }
        return $last < $slot;
    }

    public static function backupDir(string $rid): string
    {
        return Workspace::dir('backups/' . self::safe($rid));
    }

    /** @return array[] [router, file, size, ts] newest first */
    public static function backups(): array
    {
        $out = [];
        foreach (App::ownRouters() as $cfg) {
            foreach (glob(self::backupDir($cfg['id']) . '/*.rsc') ?: [] as $f) {   // tenant-ok: the active workspace's own backups dir
                $out[] = ['router' => $cfg['id'], 'name' => $cfg['name'], 'file' => basename($f), 'size' => (int)filesize($f), 'ts' => (int)filemtime($f)];
            }
        }
        usort($out, fn($a, $b) => $b['ts'] <=> $a['ts'] ?: strcmp($b['file'], $a['file']));
        return $out;
    }

    /** @return array [bool ok, string message] */
    public static function backupRouter(array $cfg, array $c): array
    {
        $b = $c['backup'];
        $keep = max(1, (int)$b['keep']);
        $r = App::driverFor($cfg);
        App::setTimeout($r, 45);
        $stamp = date('Ymd-His');
        $base = 'nextmon-auto-' . $stamp;
        $ident = (string)($r->print('/system/identity')[0]['name'] ?? $cfg['name']);
        $txt = '';
        try {
            foreach ($r->command('/export') as $row) {
                $txt .= ($row['ret'] ?? implode(' ', $row)) . "\n";
            }
        } catch (Throwable $e) {
            $txt = '';
        }
        $where = [];
        if (trim($txt) !== '') {
            $dir = self::backupDir($cfg['id']);
            $f = $dir . '/' . self::safe($ident) . '-' . $stamp . '.rsc';
            file_put_contents($f, $txt, LOCK_EX);
            $where[] = 'local ' . basename($f) . ' (' . fmt_bytes(strlen($txt)) . ')';
            $list = glob($dir . '/*.rsc') ?: [];
            rsort($list);
            foreach (array_slice($list, $keep) as $old) {
                @unlink($old);
            }
        } else {
            $r->command('/export', ['file' => $base]);
            $where[] = 'router file ' . $base . '.rsc (export text not available over API; fetch via FTP/SFTP)';
        }
        if (!empty($b['binary'])) {
            $r->command('/system/backup/save', ['name' => $base]);
            $where[] = 'router file ' . $base . '.backup';
        }
        // rotate our own files on the router
        $mine = array_values(array_filter($r->print('/file', [], ['name']), fn($x) => preg_match('/^nextmon-auto-\d{8}-\d{6}\.(rsc|backup)$/', $x['name'] ?? '')));
        foreach (['rsc', 'backup'] as $ext) {
            $sel = array_values(array_filter($mine, fn($x) => substr($x['name'], -strlen($ext)) === $ext));
            usort($sel, fn($a, $b2) => strcmp($b2['name'], $a['name']));
            foreach (array_slice($sel, $keep) as $old) {
                try {
                    $r->remove('/file', $old['.id']);
                } catch (Throwable $e) {
                    // ignore: file may be gone
                }
            }
        }
        return [true, implode('; ', $where)];
    }

    public static function jobBackup(): string
    {
        $c = self::config();
        $msgs = [];
        foreach (App::ownRouters() as $cfg) {
            try {
                [, $m] = self::backupRouter($cfg, $c);
                $msgs[] = $cfg['name'] . ': ' . $m;
            } catch (Throwable $e) {
                $msgs[] = $cfg['name'] . ': FAILED ' . $e->getMessage();
                if (!empty($c['enabled']['backup'])) {
                    self::alert($cfg['id'], 'backup', 'err', t('Scheduled backup failed: :e', [':e' => $e->getMessage()]));
                }
            }
        }
        return implode('; ', $msgs) ?: 'no routers';
    }

    // ---- charts (server-side SVG, no JS) --------------------------------------------------------

    /**
     * @param array[] $pts history points; $series = [[key, cssClass, label]]; $max null = auto, 100 for percentages
     * Outage periods (ok=0) are shaded.
     */
    public static function chart(array $pts, array $series, ?float $max, string $unit, int $from, int $to, bool $mini = false): string
    {
        $W = 600;
        $H = $mini ? 48 : 150;
        $L = $mini ? 2 : 36;
        $B = $mini ? 2 : 18;
        $T = 6;
        $span = max(1, $to - $from);
        $x = fn($ts) => $L + ($W - $L - 4) * (($ts - $from) / $span);
        $vals = [];
        foreach ($pts as $p) {
            foreach ($series as $s) {
                if (isset($p[$s[0]]) && $p['ok']) {
                    $vals[] = (float)$p[$s[0]];
                }
            }
        }
        $top = $max ?? max(10.0, ceil((max($vals ?: [10]) * 1.15) / 10) * 10);
        $y = fn($v) => $T + ($H - $T - $B) * (1 - min(1, max(0, $v / $top)));
        $o = '<svg class="nm-chart' . ($mini ? ' nm-mini' : '') . '" viewBox="0 0 ' . $W . ' ' . $H . '" role="img" aria-label="' . e(implode(' / ', array_column($series, 2)) . ($unit !== '' ? ' (' . $unit . ')' : '')) . '" preserveAspectRatio="none">';
        for ($i = 0; $i <= 4 && !$mini; $i++) {
            $gy = $T + ($H - $T - $B) * $i / 4;
            $o .= '<line class="nm-grid" x1="' . $L . '" x2="' . $W . '" y1="' . round($gy, 1) . '" y2="' . round($gy, 1) . '"/>';
            $o .= '<text class="nm-axis" x="' . ($L - 4) . '" y="' . round($gy + 3, 1) . '" text-anchor="end">' . e(rtrim(rtrim(number_format($top * (1 - $i / 4), $top < 10 ? 1 : 0, '.', ''), '0'), '.') ?: '0') . '</text>';
        }
        // time ticks
        $step = $span <= 8 * 3600 ? 3600 : ($span <= 30 * 3600 ? 6 * 3600 : 86400);
        for ($tk = (int)(ceil($from / $step) * $step); $tk < $to && !$mini; $tk += $step) {
            $o .= '<text class="nm-axis" x="' . round($x($tk), 1) . '" y="' . ($H - 4) . '" text-anchor="middle">' . e(date($step >= 86400 ? 'd/m' : 'H:i', $tk)) . '</text>';
        }
        // outage bands
        $gap = 0;
        $prev = null;
        foreach ($pts as $p) {
            if (!$p['ok']) {
                $x0 = $x($prev['ts'] ?? $p['ts']);
                $o .= '<rect class="nm-down" x="' . round($x0, 1) . '" y="' . $T . '" width="' . round(max(2, $x($p['ts']) - $x0 + 2), 1) . '" height="' . ($H - $T - $B) . '"/>';
            }
            $prev = $p;
        }
        foreach ($series as $s) {
            $d = '';
            $pen = false;
            $n = 0;
            foreach ($pts as $p) {
                if (!$p['ok'] || !isset($p[$s[0]])) {
                    $pen = false;
                    continue;
                }
                $d .= ($pen ? 'L' : 'M') . round($x($p['ts']), 1) . ' ' . round($y((float)$p[$s[0]]), 1) . ' ';
                $pen = true;
                $n++;
            }
            if ($n) {
                $o .= '<path class="nm-line ' . e($s[1]) . '" d="' . trim($d) . '"><title>' . e($s[2] . ' (' . $unit . ')') . '</title></path>';
            }
        }
        return $o . '</svg>';
    }

    /** Thin the series to at most $n buckets (average) to keep the SVG small. */
    public static function downsample(array $pts, int $n = 240): array
    {
        if (count($pts) <= $n) {
            return $pts;
        }
        $size = (int)ceil(count($pts) / $n);
        $out = [];
        foreach (array_chunk($pts, $size) as $chunk) {
            $bad = array_filter($chunk, fn($p) => !$p['ok']);
            if ($bad) {
                $out[] = reset($bad);
                continue;
            }
            $m = ['ts' => $chunk[intdiv(count($chunk), 2)]['ts'], 'ok' => 1];
            foreach (['lat', 'net', 'cpu', 'mem', 'act', 'up'] as $k) {
                $v = array_filter(array_column($chunk, $k), fn($z) => $z !== null);
                if ($v) {
                    $m[$k] = array_sum($v) / count($v);
                }
            }
            $out[] = $m;
        }
        return $out;
    }
}
