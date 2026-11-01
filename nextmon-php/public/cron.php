<?php
/**
 * Web trigger for the scheduler on hosting without crontab access (cPanel "cron job" with wget/curl, cron-job.org, ...):
 *   https://your-host/cron.php?token=SECRET[&job=poll,stock,backup]
 * The token is shown on the Monitor page (Scheduler tab). A lock prevents overlapping runs.
 */
require dirname(__DIR__) . '/src/Scheduler.php';
Scheduler::boot(dirname(__DIR__));
header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store');
$tok = (string)($_GET['token'] ?? ($_SERVER['HTTP_X_CRON_TOKEN'] ?? ''));
$scope = Scheduler::tokenScope($tok);   // ['*'] = platform token (all workspaces), [id] = one workspace's own token
if ($scope === null) {
    if (Net::hit('cronfail', Net::clientIp(), 10, 600)) { // brute-force throttle (the token is 128-bit, this is about noise)
        http_response_code(429);
        exit("too many attempts\n");
    }
    sleep(1);
    http_response_code(403);
    exit("forbidden\n");
}
$job = isset($_GET['job']) && is_string($_GET['job']) ? array_values(array_intersect(Scheduler::JOBS, explode(',', $_GET['job']))) : [];
$res = Scheduler::run($job, false, 'web', $scope === ['*'] ? null : $scope);
if ($res['locked']) {
    http_response_code(423);
    exit("locked\n");
}
$fail = false;
foreach ($res['jobs'] as $j) {
    $fail = $fail || !$j['ok'];
    echo ($j['ws'] ?? '-') . ' ' . $j['job'] . ' ' . ($j['ran'] ? ($j['ok'] ? 'ok' : 'FAILED') : 'skipped') . ($j['ran'] ? ' ' . $j['ms'] . 'ms' : '') . "\n";
}
if ($fail) {
    http_response_code(500);
}
