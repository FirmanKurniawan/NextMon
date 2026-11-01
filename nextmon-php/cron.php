<?php
/**
 * NextMON scheduler (CLI). Run every minute or every 5 minutes from cron / Task Scheduler:
 *   php /path/to/nextmon-php/cron.php                 run every job that is due
 *   php cron.php --job=poll,stock                   only these jobs (still respects their interval)
 *   php cron.php --job=backup --force               run now, ignore the schedule
 *   php cron.php --list                             show job status (per workspace)
 *   php cron.php --workspace=w_1a2b3c4d             only this workspace (default: every active one; suspended ones are skipped)
 * Exit code: 0 ok, 1 a job failed, 3 another run holds the lock.
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("CLI only. For shared hosting use public/cron.php?token=... instead.\n");
}
require __DIR__ . '/src/Scheduler.php';
Scheduler::boot(__DIR__);

$opt = getopt('', ['job::', 'force', 'list', 'quiet', 'help', 'workspace::']);
if (isset($opt['help'])) {
    echo "Usage: php cron.php [--job=poll,stock,backup] [--workspace=ID] [--force] [--list] [--quiet]\n";
    exit(0);
}
if (isset($opt['list'])) {
    foreach (Workspace::all() as $w) {
        $st = Workspace::run($w['id'], fn() => Scheduler::state());
        echo $w['id'] . ' (' . $w['slug'] . ', ' . ($w['status'] ?? 'active') . ")\n";
        foreach (Scheduler::JOBS as $j) {
            $s = $st['jobs'][$j] ?? [];
            printf("  %-8s last=%s ok=%s %s\n", $j, !empty($s['last']) ? date('Y-m-d H:i:s', $s['last']) : 'never', isset($s['ok']) ? ($s['ok'] ? 'yes' : 'NO') : '-', $s['msg'] ?? '');
        }
    }
    exit(0);
}
$only = isset($opt['job']) && is_string($opt['job']) ? array_values(array_intersect(Scheduler::JOBS, explode(',', $opt['job']))) : [];
$only_ws = isset($opt['workspace']) && is_string($opt['workspace']) && Workspace::valid($opt['workspace']) ? [$opt['workspace']] : null;
$res = Scheduler::run($only, isset($opt['force']), 'cli', $only_ws);
if ($res['locked']) {
    if (!isset($opt['quiet'])) {
        fwrite(STDERR, "Another cron.php run is still active (lock held).\n");
    }
    exit(3);
}
$fail = false;
foreach ($res['jobs'] as $j) {
    $fail = $fail || !$j['ok'];
    if (!isset($opt['quiet'])) {
        printf("[%s] %s %-7s %s%s\n", date('H:i:s'), $j['ws'] ?? '-', $j['job'], $j['ran'] ? ($j['ok'] ? 'ok' : 'FAILED') : 'skipped', $j['ran'] ? ' (' . $j['ms'] . ' ms) ' . $j['msg'] : ' - ' . $j['msg']);
    }
}
exit($fail ? 1 : 0);
