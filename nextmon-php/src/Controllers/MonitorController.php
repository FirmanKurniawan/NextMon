<?php
class MonitorController
{
    private const RANGES = ['6h' => 21600, '24h' => 86400, '7d' => 604800];

    public static function index(): void
    {
        $c = Monitor::config();
        $routers = App::routers();
        $rid = App::get('router') ?: App::currentRouterId();
        if (!array_filter($routers, fn($r) => $r['id'] === $rid)) {
            $rid = $routers[0]['id'] ?? 'demo';
        }
        $range = isset(self::RANGES[App::get('range')]) ? App::get('range') : '24h';
        $now = time();
        $from = $now - self::RANGES[$range];
        $state = Monitor::state();
        $cards = [];
        foreach ($routers as $r) {
            $h24 = Monitor::history($r['id'], $now - 86400);
            $good = array_values(array_filter($h24, fn($p) => $p['ok']));
            $lats = array_column($good, 'lat');
            $cards[] = [
                'cfg' => $r, 'st' => (array)($state[$r['id']] ?? []),
                'uptime_pct' => $h24 ? round(100 * count($good) / count($h24), 2) : null,
                'lat_avg' => $lats ? round(array_sum($lats) / count($lats)) : null,
                'spark' => Monitor::chart(Monitor::downsample($h24, 72), [['lat', 'nm-l1', 'Latency']], null, 'ms', $now - 86400, $now, true),
            ];
        }
        $hist = Monitor::downsample(Monitor::history($rid, $from), 240);
        $alerts = Monitor::alertLog(300);
        $fr = App::get('arouter');
        if ($fr !== '') {
            $alerts = array_values(array_filter($alerts, fn($a) => ($a['router'] ?? '') === $fr));
        }
        App::render('monitor', [
            'title' => t('Monitor'), 'page' => 'monitor', 'c' => $c, 'cards' => $cards, 'rid' => $rid, 'range' => $range,
            'from' => $from, 'to' => $now, 'hist' => $hist, 'alerts' => array_slice($alerts, 0, 100), 'afilter' => $fr, 'routers' => $routers,
            'backups' => Monitor::backups(), 'sched' => Scheduler::state(), 'stock' => (array)($state[$rid]['stock'] ?? []),
            'cronCli' => 'php ' . App::$root . '/cron.php', 'cronUrl' => App::origin() . '/cron.php',
            'canAdmin' => Auth::can('admin'), 'canW' => Auth::can('write'),
        ]);
    }

    public static function save(): void
    {
        $c = Monitor::config();
        $int = fn(string $k, int $min, int $max, int $d) => max($min, min($max, (int)App::post($k, (string)$d)));
        $rules = $c['rules'];
        $rules['offline_after'] = $int('offline_after', 1, 20, 2);
        $rules['recover_after'] = $int('recover_after', 1, 20, 2);
        $rules['remind_min'] = $int('remind_min', 0, 1440, 120);
        $rules['cpu_high'] = $int('cpu_high', 0, 100, 85);
        $rules['cpu_samples'] = $int('cpu_samples', 1, 20, 3);
        $rules['mem_high'] = $int('mem_high', 0, 100, 90);
        $rules['mem_samples'] = $int('mem_samples', 1, 20, 3);
        $rules['stock_default'] = $int('stock_default', 0, 100000, 10);
        $rules['expiring_hours'] = $int('expiring_hours', 1, 720, 48);
        $rules['cooldown_min'] = $int('cooldown_min', 1, 1440, 60);
        $per = [];
        foreach (preg_split('/\R/', App::post('stock_per')) ?: [] as $line) {
            if (preg_match('/^\s*([^=:]{1,60}?)\s*[=:]\s*(\d{1,6})\s*$/', $line, $m)) {
                $per[$m[1]] = (int)$m[2];
            }
        }
        $rules['stock_per'] = $per;
        $enabled = [];
        foreach (array_keys($c['enabled']) as $k) {
            $enabled[$k] = !empty($_POST['en'][$k]);
        }
        $ch = array_values(array_intersect((array)($_POST['channels'] ?? []), ['telegram', 'webhook']));
        $at = App::post('backup_at', '03:00');
        $b = [
            'freq' => in_array(App::post('backup_freq'), ['off', 'daily', 'weekly'], true) ? App::post('backup_freq') : 'daily',
            'at' => preg_match('/^([01]?\d|2[0-3]):[0-5]\d$/', $at) ? $at : '03:00',
            'dow' => max(0, min(6, (int)App::post('backup_dow', '0'))),
            'keep' => $int('backup_keep', 1, 60, 7),
            'binary' => !empty($_POST['backup_binary']),
        ];
        $target = App::post('ping_target', '1.1.1.1');
        Monitor::saveConfig([
            'poll_min' => $int('poll_min', 1, 60, 5), 'stock_min' => $int('stock_min', 5, 1440, 30),
            'ping_target' => preg_match('/^[A-Za-z0-9.\-:]{0,100}$/', $target) ? $target : '1.1.1.1',
            'channels' => $ch, 'enabled' => $enabled, 'rules' => $rules, 'backup' => $b,
        ]);
        Audit::log('monitor.save');
        App::redirect('/monitor#rules', t('Saved.'));
    }

    public static function run(): void
    {
        $job = App::post('job');
        $only = $job === 'all' ? [] : (in_array($job, Scheduler::JOBS, true) ? [$job] : null);
        if ($only === null) {
            App::redirect('/monitor', t('Unknown action.'), 'err');
        }
        $res = Scheduler::run($only, true, 'ui');
        if ($res['locked']) {
            App::redirect('/monitor', t('Another run is in progress. Try again in a moment.'), 'err');
        }
        Audit::log('monitor.run', $job);
        $msg = implode(' | ', array_map(fn($j) => $j['job'] . ': ' . ($j['ok'] ? 'ok' : 'FAILED') . ' - ' . $j['msg'], $res['jobs']));
        App::redirect('/monitor' . (preg_match('/^[\w\-]+$/', App::post('router')) ? '?router=' . App::post('router') : ''), $msg, 'ok');
    }

    public static function token(): void
    {
        Monitor::saveConfig(['cron_token' => bin2hex(random_bytes(16))]);
        Audit::log('monitor.token');
        App::redirect('/monitor#scheduler', t('New cron token generated. Update your cron jobs.'));
    }

    public static function test(): void
    {
        $rid = App::post('router');
        Monitor::alert(App::routerCfg($rid) ? $rid : App::currentRouterId(), 'test', 'info', t('Test alert from the Monitor page.'));
        App::redirect('/monitor#alerts', t('Test alert recorded. See the history and the notification log.'));
    }

    /** Demo only: toggle a simulated outage so alerts can be demonstrated. */
    public static function simulate(): void
    {
        $rid = App::post('router');
        $c = Monitor::config();
        $cfg = App::routerCfg($rid);
        if (!$cfg || !(App::demoForced() || ($cfg['type'] ?? '') === 'demo')) {
            App::redirect('/monitor', t('Only available for demo routers.'), 'err');
        }
        $list = array_values(array_diff((array)$c['sim_down'], [$rid]));
        $on = !in_array($rid, (array)$c['sim_down'], true);
        if ($on) {
            $list[] = $rid;
        }
        Monitor::saveConfig(['sim_down' => $list]);
        Audit::log('monitor.simulate', $rid . ($on ? ' down' : ' up'));
        App::redirect('/monitor?router=' . rawurlencode($rid), $on ? t('Outage simulated: run a poll a few times to see the alert.') : t('Outage simulation stopped.'));
    }

    public static function backupDownload(): void
    {
        $rid = App::get('router');
        $file = basename(App::get('file'));
        if (!preg_match('/^[A-Za-z0-9_.\-]+\.rsc$/', $file) || !App::routerCfg($rid)) {
            App::redirect('/monitor#backups', t('File not found.'), 'err');
        }
        $f = Monitor::backupDir($rid) . '/' . $file;
        if (!is_file($f)) {
            App::redirect('/monitor#backups', t('File not found.'), 'err');
        }
        Audit::log('monitor.backup.download', $rid . '/' . $file);
        header('Content-Type: text/plain; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $file . '"');
        header('Cache-Control: no-store');
        readfile($f);
        exit;
    }
}
