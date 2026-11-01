<?php
/**
 * Job runner for cron.php (CLI) and public/cron.php (web trigger with secret token).
 * One run at a time (flock on data/cron.lock). Each job has its own interval; call it every minute or every 5 minutes.
 * Jobs: poll (router monitor + alerts), stock (low voucher stock + expiring users), backup (scheduled /export + rotation).
 */
final class Scheduler
{
    public const JOBS = ['poll', 'stock', 'backup'];

    /** Minimal bootstrap without sessions/headers, shared by both entry points. */
    public static function boot(string $root): void
    {
        if (!class_exists('App', false)) {
            require_once $root . '/src/App.php';
        }
        App::$root = $root;
        spl_autoload_register(function ($c) use ($root) {
            foreach (['/src/', '/src/Controllers/'] as $d) {
                $f = $root . $d . $c . '.php';
                if (is_file($f)) {
                    require_once $f;
                    return;
                }
            }
        });
        require_once $root . '/src/Driver.php';
        require_once $root . '/src/helpers.php';
        error_reporting(E_ALL);
        ini_set('log_errors', '1');
        if (PHP_SAPI !== 'cli') {
            ini_set('display_errors', getenv('NEXTMON_DEBUG') ? '1' : '0'); // the web trigger must never print paths / secrets
            ini_set('html_errors', '0');
        }
        $_SESSION = [];
        date_default_timezone_set((string)Store::setting('timezone', 'Asia/Jakarta') ?: 'UTC');
        I18n::init((string)Store::setting('lang', 'id'));
    }

    /**
     * Which workspaces does this cron token cover? ['*'] = every active workspace (platform token), [id] = the workspace whose own
     * token it is, null = invalid. Suspended workspaces never match.
     */
    public static function tokenScope(string $given): ?array
    {
        if ($given === '') {
            return null;
        }
        $hit = null;
        if (hash_equals(Workspace::platformCronToken(), $given)) {
            $hit = ['*'];
        }
        foreach (Workspace::activeIds() as $ws) {   // no early exit: same work wherever (or whether) a token matches
            $t = (string)Workspace::run($ws, fn() => ((array)Store::read('monitor', []))['cron_token'] ?? '');
            if ($t !== '' && hash_equals($t, $given) && $hit === null) {
                $hit = [$ws];
            }
        }
        return $hit;
    }

    public static function tokenOk(string $given): bool
    {
        return self::tokenScope($given) !== null;
    }
    /** Scheduler state of the ACTIVE workspace. */
    public static function state(): array
    {
        return (array)Store::read('scheduler', []);
    }

    /** Seconds until/after which the job is due: returns true when it should run now. */
    public static function due(string $job, array $last, int $now): bool
    {
        $c = Monitor::config();
        $lastRun = (int)($last['last'] ?? 0);
        switch ($job) {
            case 'poll':
                return $now - $lastRun >= max(1, (int)$c['poll_min']) * 60 - 20;
            case 'stock':
                return $now - $lastRun >= max(1, (int)$c['stock_min']) * 60 - 20;
            case 'backup':
                return Monitor::backupDue($c, $lastRun, $now);
        }
        return false;
    }

    /**
     * Run the due jobs of every ACTIVE workspace (each inside Workspace::run, so data never mixes; suspended ones are skipped).
     * @param string[] $only job names (empty = all due jobs); $force ignores the interval
     * @param string[]|null $workspaces restrict to these workspace ids (null = all active)
     * @return array ['locked'=>bool, 'jobs'=>[[ws, job, ran, ok, msg, ms]]]
     */
    public static function run(array $only = [], bool $force = false, string $source = 'cli', ?array $workspaces = null): array
    {
        @set_time_limit(PHP_SAPI === 'cli' ? 0 : 170);
        @ignore_user_abort(true);
        $lock = @fopen(Store::path('cron.lock'), 'c');   // tenant-ok: one global cron lock (a run covers every workspace)
        if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
            return ['locked' => true, 'jobs' => []];
        }
        $out = [];
        try {
            $ids = $workspaces === null ? Workspace::activeIds() : array_values(array_filter($workspaces, fn($w) => Workspace::valid($w) && Workspace::isActive($w)));
            foreach ($ids as $ws) {
                $tz = date_default_timezone_get();
                try {
                    $out = array_merge($out, Workspace::run($ws, fn() => self::runWorkspace($ws, $only, $force, $source)));
                } catch (Throwable $e) {
                    error_log('[nextmon-cron] workspace ' . $ws . ': ' . $e);
                    $out[] = ['ws' => $ws, 'job' => '*', 'ran' => true, 'ok' => false, 'msg' => $e->getMessage(), 'ms' => 0];
                } finally {
                    date_default_timezone_set($tz);
                }
            }
        } finally {
            try {
                Cache::sweep();   // expired speed-cache files: nothing else removes them
            } catch (Throwable $e) {
                // housekeeping only
            }
            flock($lock, LOCK_UN);
            fclose($lock);
        }
        return ['locked' => false, 'jobs' => $out];
    }

    /** The job loop for the ACTIVE workspace. @return array[] job rows */
    private static function runWorkspace(string $ws, array $only, bool $force, string $source): array
    {
        $out = [];
        date_default_timezone_set((string)Store::setting('timezone', 'Asia/Jakarta') ?: 'UTC');
        I18n::init((string)Store::setting('lang', 'id'));
        $now = time();
        $st = self::state();
        foreach (self::JOBS as $job) {
            if ($only && !in_array($job, $only, true)) {
                continue;
            }
            $js = (array)($st['jobs'][$job] ?? []);
            if (!$force && !self::due($job, $js, $now)) {
                $out[] = ['ws' => $ws, 'job' => $job, 'ran' => false, 'ok' => true, 'msg' => 'not due', 'ms' => 0];
                continue;
            }
            $t0 = microtime(true);
            try {
                $msg = (string)Monitor::{'job' . ucfirst($job)}();
                $ok = true;
            } catch (Throwable $e) {
                $msg = $e->getMessage();
                $ok = false;
                error_log('[nextmon-cron] ' . $ws . ' ' . $job . ': ' . $e);
            }
            $ms = (int)round((microtime(true) - $t0) * 1000);
            $js = ['last' => time(), 'ok' => $ok, 'msg' => mb_substr($msg, 0, 400), 'ms' => $ms, 'runs' => (int)($js['runs'] ?? 0) + 1, 'source' => $source];
            $st = self::state();
            $st['jobs'][$job] = $js;
            $st['last_tick'] = time();
            Store::write('scheduler', $st);
            $out[] = ['ws' => $ws, 'job' => $job, 'ran' => true, 'ok' => $ok, 'msg' => $msg, 'ms' => $ms];
        }
        $st = self::state();
        $st['last_tick'] = time();
        $st['last_source'] = $source;
        Store::write('scheduler', $st);
        return $out;
    }
}
