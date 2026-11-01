<?php
/** Vars: $c $cards $rid $range $from $to $hist $alerts $afilter $routers $backups $sched $stock $cronCli $cronUrl $canAdmin $canW */
$R = $c['rules'];
$lastTick = (int)($sched['last_tick'] ?? 0);
$stale = $lastTick === 0 || time() - $lastTick > max(10, (int)$c['poll_min'] * 3) * 60;
$cur = null;
foreach ($cards as $cd) {
    if ($cd['cfg']['id'] === $rid) {
        $cur = $cd;
    }
}
$curDemo = $cur && (App::demoForced() || ($cur['cfg']['type'] ?? '') === 'demo');
$simOn = in_array($rid, (array)$c['sim_down'], true);
$levelKind = ['err' => 'err', 'warn' => 'warn', 'ok' => 'ok', 'info' => 'info'];
?>
<link rel="stylesheet" href="<?= e(asset('/assets/css/mod-network.css')) ?>">
<?php
$acts = '';
if ($canW) {
    $acts = '<form method="post" action="' . e(url('/monitor/run')) . '" class="inline-form">' . csrf_field() . '<input type="hidden" name="job" value="all"><input type="hidden" name="router" value="' . e($rid) . '"><button class="btn btn-primary">' . icon('refresh', 16) . e(t('Run checks now')) . '</button></form>';
}
echo page_head(t('Monitor'), t('Router status, latency history, alerts and scheduled backups.'), $acts);
?>

<?php if ($stale) { ?>
<div class="alert warn" style="margin-bottom:var(--s4)"><?= icon('alert', 18) ?><div><?= e($lastTick === 0 ? t('The scheduler has never run. Set up cron (Scheduler tab) or press "Run checks now".') : t('The scheduler has not run for a while (last: :t). Check your cron job.', [':t' => ago($lastTick)])) ?></div></div>
<?php } ?>

<div class="nm-cards">
<?php foreach ($cards as $cd) { $r = $cd['cfg']; $st = $cd['st']; $p = $st['last'] ?? null; $known = $p !== null; $on = $known && ($st['online'] ?? true); ?>
  <section class="card glass nm-card<?= $r['id'] === $rid ? ' is-sel' : '' ?>"><div class="card-b">
    <div class="nm-head">
      <a href="<?= e(url('/monitor?router=' . rawurlencode($r['id']) . '&range=' . $range)) ?>"><span class="nm-dot <?= !$known ? '' : ($on ? 'on' : 'off') ?>"></span><?= e($r['name']) ?></a>
      <?= !$known ? badge(t('No data'), 'neutral') : ($on ? badge(t('Online'), 'ok') : badge(t('Offline'), 'err')) ?>
    </div>
    <?php if ($known && !empty($p['ok'])) { ?>
    <div class="nm-metrics">
      <div><b><?= (int)$p['lat'] ?> ms</b><span><?= e(t('Latency')) ?></span></div>
      <div><b><?= (int)$p['act'] ?></b><span><?= e(t('Active users')) ?></span></div>
      <div><b><?= e(Monitor::fmtDur((int)$p['up'])) ?></b><span><?= e(t('Router uptime')) ?></span></div>
    </div>
    <div><div class="stat-label">CPU <b style="margin-left:auto"><?= (int)$p['cpu'] ?>%</b></div><div class="progress<?= $p['cpu'] >= $R['cpu_high'] && $R['cpu_high'] > 0 ? ' err' : '' ?>" style="margin-top:var(--s2)"><i style="width:<?= (int)$p['cpu'] ?>%"></i></div></div>
    <div><div class="stat-label">RAM <b style="margin-left:auto"><?= (int)$p['mem'] ?>%</b></div><div class="progress<?= $p['mem'] >= $R['mem_high'] && $R['mem_high'] > 0 ? ' warn' : '' ?>" style="margin-top:var(--s2)"><i style="width:<?= (int)$p['mem'] ?>%"></i></div></div>
    <?php } elseif ($known) { ?>
    <p class="muted" style="margin:0"><?= e(t('Unreachable')) ?>: <?= e($st['last_err'] ?? '') ?></p>
    <?php } else { ?>
    <p class="muted" style="margin:0"><?= e(t('Waiting for the first poll.')) ?></p>
    <?php } ?>
    <?= $cd['spark'] ?>
    <div class="stat-sub"><?= $cd['uptime_pct'] !== null ? e(t('Availability 24h: :p%', [':p' => $cd['uptime_pct']])) : '' ?><?= $cd['lat_avg'] !== null ? ' &middot; ' . e(t('avg :n ms', [':n' => $cd['lat_avg']])) : '' ?><?= $known ? ' &middot; ' . e(ago((int)$st['last_check'])) : '' ?></div>
  </div></section>
<?php } ?>
</div>

<?php if ($cur) { $routerName = $cur['cfg']['name']; ?>
<section class="card glass" style="margin-bottom:var(--s4)">
  <div class="card-h"><h2><?= e(t('History')) ?>: <?= e($routerName) ?></h2>
    <div class="row">
      <?php if ($curDemo && $canAdmin) { ?>
      <form method="post" action="<?= e(url('/monitor/simulate')) ?>" class="inline-form"><?= csrf_field() ?><input type="hidden" name="router" value="<?= e($rid) ?>"><button class="btn btn-sm"><?= e($simOn ? t('Stop simulated outage') : t('Simulate outage (demo)')) ?></button></form>
      <?php } ?>
      <div class="seg" role="group" aria-label="<?= e(t('Range')) ?>">
        <?php foreach (['6h', '24h', '7d'] as $rg) { ?><a href="<?= e(url('/monitor?router=' . rawurlencode($rid) . '&range=' . $rg)) ?>"<?= $rg === $range ? ' aria-current="true" class="on"' : '' ?>><?= $rg ?></a><?php } ?>
      </div></div></div>
  <div class="card-b">
    <?php if (count($hist) < 2) { echo empty_state('activity', t('Not enough data yet'), t('History fills in as the scheduler polls the router.')); } else { ?>
    <div class="nm-charts">
      <div><h3><?= e(t('Latency')) ?><span class="nm-legend"><span><i style="background:var(--chart-1)"></i><?= e(t('NextMON to router')) ?></span><span><i style="background:var(--chart-3)"></i><?= e(t('Router to :h', [':h' => $c['ping_target']])) ?></span></span></h3>
        <?= Monitor::chart($hist, [['lat', 'nm-l1', t('NextMON to router')], ['net', 'nm-l2', t('Router to internet')]], null, 'ms', $from, $to) ?></div>
      <div><h3>CPU / RAM<span class="nm-legend"><span><i style="background:var(--chart-1)"></i>CPU %</span><span><i style="background:var(--chart-3)"></i>RAM %</span></span></h3>
        <?= Monitor::chart($hist, [['cpu', 'nm-l1', 'CPU'], ['mem', 'nm-l2', 'RAM']], 100.0, '%', $from, $to) ?></div>
      <div><h3><?= e(t('Active hotspot users')) ?></h3>
        <?= Monitor::chart($hist, [['act', 'nm-l3', t('Active users')]], null, '', $from, $to) ?></div>
      <div><h3><?= e(t('Router uptime')) ?> <span class="muted" style="font-weight:400"><?= e(t('(drops = reboot)')) ?></span></h3>
        <?= Monitor::chart(array_map(function ($p) { if (isset($p['up'])) { $p['up'] = $p['up'] / 3600; } return $p; }, $hist), [['up', 'nm-l1', t('Uptime')]], null, 'h', $from, $to) ?></div>
    </div>
    <p class="help" style="margin-top:var(--s3)"><?= e(t('Shaded bands mark periods when the router did not answer.')) ?><?= $curDemo ? ' ' . e(t('Demo router: the first 24 h of history is simulated.')) : '' ?></p>
    <?php } ?>
  </div>
</section>
<?php } ?>

<section class="card glass">
  <div class="tabs" role="tablist" data-hash-tabs>
    <?php foreach (['alerts' => 'Alerts', 'rules' => 'Alert rules', 'stock' => 'Stock', 'backups' => 'Backups', 'scheduler' => 'Scheduler'] as $k => $l) { ?>
    <button type="button" role="tab" id="tab-<?= $k ?>" aria-controls="panel-<?= $k ?>" aria-selected="<?= $k === 'alerts' ? 'true' : 'false' ?>" data-tab="<?= $k ?>"><?= e(t($l)) ?></button>
    <?php } ?>
  </div>

  <div class="tabpanel" role="tabpanel" id="panel-alerts" aria-labelledby="tab-alerts">
    <div class="nm-toolbar">
      <form class="nm-q" method="get" action="<?= e(url('/monitor')) ?>"><input type="hidden" name="router" value="<?= e($rid) ?>"><input type="hidden" name="range" value="<?= e($range) ?>">
        <label class="sr-only" for="af"><?= e(t('Router')) ?></label>
        <select class="select select-sm" id="af" name="arouter" data-autosubmit style="width:auto"><option value=""><?= e(t('All routers')) ?></option>
          <?php foreach ($routers as $r) { ?><option value="<?= e($r['id']) ?>"<?= sel($r['id'], $afilter) ?>><?= e($r['name']) ?></option><?php } ?></select>
        <noscript><button class="btn btn-sm"><?= e(t('Filter')) ?></button></noscript></form>
      <?php if ($canAdmin) { ?><form method="post" action="<?= e(url('/monitor/test')) ?>" class="inline-form"><?= csrf_field() ?><input type="hidden" name="router" value="<?= e($rid) ?>"><button class="btn btn-sm"><?= icon('bell', 16) ?><?= e(t('Send test alert')) ?></button></form><?php } ?>
    </div>
    <?php if (!$alerts) { echo empty_state('bell', t('No alerts yet'), t('Alerts appear here when a rule triggers.')); } else { ?>
    <div class="table-wrap"><table class="tbl resp">
      <thead><tr><th><?= e(t('Time')) ?></th><th><?= e(t('Router')) ?></th><th><?= e(t('Rule')) ?></th><th><?= e(t('Message')) ?></th><th><?= e(t('Delivery')) ?></th></tr></thead>
      <tbody>
      <?php foreach ($alerts as $a) { ?>
        <tr>
          <td data-label="<?= e(t('Time')) ?>" class="mono nowrap"><?= e(date('m-d H:i', (int)$a['ts'])) ?></td>
          <td data-label="<?= e(t('Router')) ?>"><?= e($a['name'] ?? $a['router']) ?></td>
          <td data-label="<?= e(t('Rule')) ?>"><?= badge($a['rule'], $levelKind[$a['level'] ?? 'info'] ?? 'neutral') ?></td>
          <td data-label="<?= e(t('Message')) ?>" class="wrap"><?= e($a['text']) ?></td>
          <td data-label="<?= e(t('Delivery')) ?>" class="wrap muted"><?= !empty($a['sent']) ? badge(t('Sent'), 'ok') : '' ?> <?= e($a['result'] ?? '') ?></td>
        </tr>
      <?php } ?>
      </tbody>
    </table></div>
    <?php } ?>
  </div>

  <div class="tabpanel" role="tabpanel" id="panel-rules" aria-labelledby="tab-rules" hidden>
    <form class="card-b stack" method="post" action="<?= e(url('/monitor/save')) ?>">
      <?= csrf_field() ?>
      <fieldset style="border:0;padding:0;margin:0" <?= $canAdmin ? '' : 'disabled' ?>>
      <div class="nm-rules">
        <div class="nm-rule"><h3><?= e(t('Router offline / recovery')) ?></h3>
          <label class="switch"><input type="checkbox" name="en[offline]" value="1"<?= chk($c['enabled']['offline']) ?>><span class="track"></span><span><?= e(t('Enabled')) ?></span></label>
          <div class="field"><label for="r-off"><?= e(t('Offline after N failed checks')) ?></label><input class="input" id="r-off" type="number" min="1" max="20" name="offline_after" value="<?= (int)$R['offline_after'] ?>"></div>
          <div class="field"><label for="r-rec"><?= e(t('Back online after N good checks')) ?></label><input class="input" id="r-rec" type="number" min="1" max="20" name="recover_after" value="<?= (int)$R['recover_after'] ?>"><p class="help"><?= e(t('Debounce: avoids flapping alerts.')) ?></p></div>
          <div class="field"><label for="r-rem"><?= e(t('Remind every (minutes, 0 = never)')) ?></label><input class="input" id="r-rem" type="number" min="0" max="1440" name="remind_min" value="<?= (int)$R['remind_min'] ?>"></div>
        </div>
        <div class="nm-rule"><h3>CPU</h3>
          <label class="switch"><input type="checkbox" name="en[cpu]" value="1"<?= chk($c['enabled']['cpu']) ?>><span class="track"></span><span><?= e(t('Enabled')) ?></span></label>
          <div class="field"><label for="r-cpu"><?= e(t('Threshold (%)')) ?></label><input class="input" id="r-cpu" type="number" min="0" max="100" name="cpu_high" value="<?= (int)$R['cpu_high'] ?>"></div>
          <div class="field"><label for="r-cpus"><?= e(t('Consecutive checks above threshold')) ?></label><input class="input" id="r-cpus" type="number" min="1" max="20" name="cpu_samples" value="<?= (int)$R['cpu_samples'] ?>"></div>
          <h3 style="margin-top:var(--s2)">RAM</h3>
          <label class="switch"><input type="checkbox" name="en[mem]" value="1"<?= chk($c['enabled']['mem']) ?>><span class="track"></span><span><?= e(t('Enabled')) ?></span></label>
          <div class="field"><label for="r-mem"><?= e(t('Threshold (%)')) ?></label><input class="input" id="r-mem" type="number" min="0" max="100" name="mem_high" value="<?= (int)$R['mem_high'] ?>"></div>
          <div class="field"><label for="r-mems"><?= e(t('Consecutive checks above threshold')) ?></label><input class="input" id="r-mems" type="number" min="1" max="20" name="mem_samples" value="<?= (int)$R['mem_samples'] ?>"></div>
        </div>
        <div class="nm-rule"><h3><?= e(t('Voucher stock')) ?></h3>
          <label class="switch"><input type="checkbox" name="en[stock]" value="1"<?= chk($c['enabled']['stock']) ?>><span class="track"></span><span><?= e(t('Enabled')) ?></span></label>
          <div class="field"><label for="r-st"><?= e(t('Minimum unused vouchers per profile')) ?></label><input class="input" id="r-st" type="number" min="0" name="stock_default" value="<?= (int)$R['stock_default'] ?>"><p class="help"><?= e(t('0 = do not alert.')) ?></p></div>
          <div class="field"><label for="r-stp"><?= e(t('Per-profile minimum (one per line: profile = number)')) ?></label><textarea class="textarea mono" id="r-stp" name="stock_per" rows="3" placeholder="1Jam = 20"><?php foreach ((array)$R['stock_per'] as $pn => $pv) { echo e($pn . ' = ' . $pv) . "\n"; } ?></textarea></div>
          <h3 style="margin-top:var(--s2)"><?= e(t('Expiring users')) ?></h3>
          <label class="switch"><input type="checkbox" name="en[expiring]" value="1"<?= chk($c['enabled']['expiring']) ?>><span class="track"></span><span><?= e(t('Enabled')) ?></span></label>
          <div class="field"><label for="r-ex"><?= e(t('Warn when users expire within (hours)')) ?></label><input class="input" id="r-ex" type="number" min="1" max="720" name="expiring_hours" value="<?= (int)$R['expiring_hours'] ?>"></div>
        </div>
        <div class="nm-rule"><h3><?= e(t('Delivery')) ?></h3>
          <fieldset style="border:0;padding:0;margin:0"><legend class="label"><?= e(t('Channels')) ?></legend>
            <div class="stack" style="gap:var(--s1);margin-top:var(--s2)">
              <label class="check"><input type="checkbox" name="channels[]" value="telegram"<?= chk(in_array('telegram', (array)$c['channels'], true)) ?>>Telegram</label>
              <label class="check"><input type="checkbox" name="channels[]" value="webhook"<?= chk(in_array('webhook', (array)$c['channels'], true)) ?>>Webhook</label>
            </div><p class="help"><?= e(t('Credentials are set under Notifications. Alerts are always kept in the history.')) ?></p></fieldset>
          <div class="field"><label for="r-cd"><?= e(t('Repeat the same alert at most every (minutes)')) ?></label><input class="input" id="r-cd" type="number" min="1" max="1440" name="cooldown_min" value="<?= (int)$R['cooldown_min'] ?>"></div>
          <label class="switch"><input type="checkbox" name="en[backup]" value="1"<?= chk($c['enabled']['backup']) ?>><span class="track"></span><span><?= e(t('Alert when a scheduled backup fails')) ?></span></label>
        </div>
        <div class="nm-rule"><h3><?= e(t('Polling')) ?></h3>
          <div class="field"><label for="p-int"><?= e(t('Poll every (minutes)')) ?></label><input class="input" id="p-int" type="number" min="1" max="60" name="poll_min" value="<?= (int)$c['poll_min'] ?>"></div>
          <div class="field"><label for="p-st"><?= e(t('Stock/expiry check every (minutes)')) ?></label><input class="input" id="p-st" type="number" min="5" max="1440" name="stock_min" value="<?= (int)$c['stock_min'] ?>"></div>
          <div class="field"><label for="p-ping"><?= e(t('Internet ping target (from the router)')) ?></label><input class="input mono" id="p-ping" name="ping_target" value="<?= e($c['ping_target']) ?>"><p class="help"><?= e(t('Empty = skip.')) ?></p></div>
        </div>
        <div class="nm-rule"><h3><?= e(t('Scheduled backup')) ?></h3>
          <div class="field"><label for="b-fr"><?= e(t('Frequency')) ?></label><select class="select" id="b-fr" name="backup_freq"><?php foreach (['off' => 'Off', 'daily' => 'Daily', 'weekly' => 'Weekly'] as $k => $l) { ?><option value="<?= $k ?>"<?= sel($k, $c['backup']['freq']) ?>><?= e(t($l)) ?></option><?php } ?></select></div>
          <div class="field"><label for="b-at"><?= e(t('Time (HH:MM)')) ?></label><input class="input mono" id="b-at" name="backup_at" value="<?= e($c['backup']['at']) ?>" pattern="[0-2]?[0-9]:[0-5][0-9]"></div>
          <div class="field"><label for="b-dow"><?= e(t('Weekday (weekly)')) ?></label><select class="select" id="b-dow" name="backup_dow"><?php foreach (['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as $i => $dn) { ?><option value="<?= $i ?>"<?= sel($i, $c['backup']['dow']) ?>><?= e(t($dn)) ?></option><?php } ?></select></div>
          <div class="field"><label for="b-keep"><?= e(t('Keep the newest N backups')) ?></label><input class="input" id="b-keep" type="number" min="1" max="60" name="backup_keep" value="<?= (int)$c['backup']['keep'] ?>"></div>
          <label class="switch"><input type="checkbox" name="backup_binary" value="1"<?= chk($c['backup']['binary']) ?>><span class="track"></span><span><?= e(t('Also create a binary .backup on the router')) ?></span></label>
        </div>
      </div>
      </fieldset>
      <?php if ($canAdmin) { ?><div><button class="btn btn-primary"><?= e(t('Save')) ?></button></div><?php } else { ?><p class="help"><?= e(t('Only admins can change alert rules.')) ?></p><?php } ?>
    </form>
  </div>

  <div class="tabpanel" role="tabpanel" id="panel-stock" aria-labelledby="tab-stock" hidden>
    <?php if (!$stock) { echo empty_state('ticket', t('No stock data yet'), t('Run the stock check from the Scheduler tab.')); } else { ?>
    <div class="table-wrap"><table class="tbl resp">
      <thead><tr><th><?= e(t('Profile')) ?></th><th class="num"><?= e(t('Unused vouchers')) ?></th><th class="num"><?= e(t('Minimum')) ?></th><th><?= e(t('Status')) ?></th></tr></thead>
      <tbody><?php foreach ($stock as $pn => $n) { $min = (int)($R['stock_per'][$pn] ?? $R['stock_default']); ?>
        <tr><td data-label="<?= e(t('Profile')) ?>"><?= e($pn) ?></td><td data-label="<?= e(t('Unused vouchers')) ?>" class="num"><?= (int)$n ?></td><td data-label="<?= e(t('Minimum')) ?>" class="num"><?= $min ?: '-' ?></td>
          <td data-label="<?= e(t('Status')) ?>"><?= $min > 0 && $n < $min ? badge(t('Low'), 'warn') : badge('OK', 'ok') ?></td></tr>
      <?php } ?></tbody>
    </table></div>
    <?php } ?>
  </div>

  <div class="tabpanel" role="tabpanel" id="panel-backups" aria-labelledby="tab-backups" hidden>
    <div class="card-b stack">
      <p class="muted"><?= e(t('Scheduled /export files are stored in data/backups/<router>/ (not web accessible). The newest :n are kept.', [':n' => (int)$c['backup']['keep']])) ?></p>
      <?php if ($canW) { ?><form method="post" action="<?= e(url('/monitor/run')) ?>" class="inline-form"><?= csrf_field() ?><input type="hidden" name="job" value="backup"><button class="btn"><?= icon('download', 16) ?><?= e(t('Back up now')) ?></button></form><?php } ?>
    </div>
    <?php if (!$backups) { echo empty_state('file', t('No stored backups yet')); } else { ?>
    <div class="table-wrap"><table class="tbl resp">
      <thead><tr><th><?= e(t('File')) ?></th><th><?= e(t('Router')) ?></th><th class="num"><?= e(t('Size')) ?></th><th><?= e(t('Created')) ?></th><th><span class="sr-only"><?= e(t('Actions')) ?></span></th></tr></thead>
      <tbody><?php foreach ($backups as $b) { ?>
        <tr><td data-label="<?= e(t('File')) ?>" class="mono"><?= e($b['file']) ?></td><td data-label="<?= e(t('Router')) ?>"><?= e($b['name']) ?></td><td data-label="<?= e(t('Size')) ?>" class="num"><?= e(fmt_bytes($b['size'])) ?></td><td data-label="<?= e(t('Created')) ?>" class="mono"><?= e(date('Y-m-d H:i', $b['ts'])) ?></td>
          <td class="actions" data-label=""><?php if ($canAdmin) { ?><a class="btn btn-sm" href="<?= e(url('/monitor/backup?router=' . rawurlencode($b['router']) . '&file=' . rawurlencode($b['file']))) ?>"><?= icon('download', 16) ?><?= e(t('Download')) ?></a><?php } ?></td></tr>
      <?php } ?></tbody>
    </table></div>
    <?php } ?>
  </div>

  <div class="tabpanel" role="tabpanel" id="panel-scheduler" aria-labelledby="tab-scheduler" hidden>
    <div class="table-wrap"><table class="tbl resp">
      <thead><tr><th><?= e(t('Job')) ?></th><th><?= e(t('Last run')) ?></th><th><?= e(t('Result')) ?></th><th><?= e(t('Runs')) ?></th><th><span class="sr-only"><?= e(t('Actions')) ?></span></th></tr></thead>
      <tbody>
      <?php foreach (['poll' => 'Router poll + alerts', 'stock' => 'Voucher stock + expiring users', 'backup' => 'Scheduled backup'] as $j => $l) { $s = (array)($sched['jobs'][$j] ?? []); ?>
        <tr><td data-label="<?= e(t('Job')) ?>"><b><?= e($j) ?></b> <span class="muted"><?= e(t($l)) ?></span></td>
          <td data-label="<?= e(t('Last run')) ?>" class="nowrap"><?= !empty($s['last']) ? e(date('m-d H:i:s', $s['last'])) . ' <span class="muted">(' . e(ago((int)$s['last'])) . ')</span>' : '-' ?></td>
          <td data-label="<?= e(t('Result')) ?>" class="wrap"><?= isset($s['ok']) ? ($s['ok'] ? badge('OK', 'ok') : badge(t('Failed'), 'err')) : '' ?> <span class="muted"><?= e($s['msg'] ?? '') ?></span></td>
          <td data-label="<?= e(t('Runs')) ?>" class="num"><?= (int)($s['runs'] ?? 0) ?></td>
          <td class="actions" data-label=""><?php if ($canW) { ?><form method="post" action="<?= e(url('/monitor/run')) ?>" class="inline-form"><?= csrf_field() ?><input type="hidden" name="job" value="<?= e($j) ?>"><button class="btn btn-sm"><?= e(t('Run now')) ?></button></form><?php } ?></td></tr>
      <?php } ?>
      </tbody>
    </table></div>
    <?php if ($canAdmin) { $tok = Monitor::token(); ?>
    <div class="card-b stack">
      <h3 style="margin:0"><?= e(t('Cron setup')) ?></h3>
      <p class="muted"><?= e(t('Run the scheduler every minute (or every 5 minutes). Each job decides by itself whether it is due; a lock prevents overlapping runs.')) ?></p>
      <div><div class="label"><?= e(t('Linux / hosting with crontab')) ?></div><pre class="nm-pre" tabindex="0" id="cron-lin">* * * * * <?= e($cronCli) ?> --quiet</pre></div>
      <div><div class="label"><?= e(t('Windows Task Scheduler (run every 1 minute)')) ?></div><pre class="nm-pre" tabindex="0" id="cron-win">schtasks /Create /SC MINUTE /MO 1 /TN "NextMON cron" /TR "php <?= e(App::$root) ?>\cron.php --quiet"</pre></div>
      <div><div class="label"><?= e(t('Shared hosting without CLI (cPanel cron / cron-job.org, every 5 minutes)')) ?></div><pre class="nm-pre" tabindex="0" id="cron-web">curl -fsS "<?= e($cronUrl) ?>?token=<?= e($tok) ?>" &gt;/dev/null</pre>
        <p class="help"><?= e(t('The token is a secret: anyone with the URL can trigger the jobs (not read data). Regenerate it if it leaks.')) ?></p></div>
      <form method="post" action="<?= e(url('/monitor/token')) ?>" data-confirm="<?= e(t('Generate a new token? Existing cron URLs stop working.')) ?>"><?= csrf_field() ?><button class="btn btn-sm"><?= icon('key', 16) ?><?= e(t('Regenerate token')) ?></button></form>
    </div>
    <?php } ?>
  </div>
</section>
