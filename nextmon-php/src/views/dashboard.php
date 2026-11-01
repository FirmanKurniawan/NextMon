<?php /** Vars: $live, $appLog */ ?>
<?= page_head(t('Dashboard'), t('Router health, hotspot activity and income at a glance.'),
    '<button class="btn" type="button" data-dash-refresh>' . icon('refresh', 16) . e(t('Refresh')) . '</button>') ?>

<div id="dash" data-poll="<?= $live ? '8000' : '20000' ?>">
  <div class="bento">
    <!-- KPI row: count-up value, delta chip, live sparkline -->
    <section class="card glass stat-card lift col-3"><div class="card-b">
      <div class="stat-label"><span class="stat-ic"><?= icon('activity', 14) ?></span><?= e(t('Active sessions')) ?><span class="delta up" data-live-badge><span class="live-dot" style="width:6px;height:6px"></span><span class="hide-m"><?= e(t('Live')) ?></span></span></div>
      <div class="stat-value"><span class="skeleton" data-bind="active">0000</span></div>
      <div class="stat-sub"><span data-bind="users">&nbsp;</span> <?= e(t('users total')) ?></div>
      <div class="stat-spark"><canvas id="sp-active" role="img" aria-label="<?= e(t('Active sessions')) ?>"></canvas></div>
    </div></section>
    <section class="card glass stat-card lift col-3"><div class="card-b">
      <div class="stat-label"><span class="stat-ic"><?= icon('chart', 14) ?></span><?= e(t('Income today')) ?><span class="delta" id="delta-today" hidden></span></div>
      <div class="stat-value"><span class="skeleton" data-bind="income_today" data-money>000000</span></div>
      <div class="stat-sub"><span data-bind="count_today">&nbsp;</span> <?= e(t('vouchers sold')) ?></div>
      <div class="stat-spark"><canvas id="sp-today" role="img" aria-label="<?= e(t('Income, last 14 days')) ?>"></canvas></div>
    </div></section>
    <section class="card glass stat-card lift col-3"><div class="card-b">
      <div class="stat-label"><span class="stat-ic"><?= icon('chart', 14) ?></span><?= e(t('Income this month')) ?></div>
      <div class="stat-value"><span class="skeleton" data-bind="income_month" data-money>0000000</span></div>
      <div class="stat-sub"><span data-bind="count_month">&nbsp;</span> <?= e(t('vouchers sold')) ?></div>
      <div class="stat-spark"><canvas id="sp-count" role="img" aria-label="<?= e(t('Vouchers sold')) ?>"></canvas></div>
    </div></section>
    <section class="card glass stat-card lift col-3"><div class="card-b">
      <div class="stat-label"><span class="stat-ic"><?= icon('layers', 14) ?></span><?= e(t('Last 14 days')) ?></div>
      <div class="stat-value"><span class="skeleton" id="spark-sum">000000</span></div>
      <div class="stat-sub" id="spark-note">&nbsp;</div>
      <div class="stat-spark"><canvas id="spark" role="img" aria-label="<?= e(t('Income, last 14 days')) ?>"></canvas></div>
    </div></section>

    <!-- traffic (area + crosshair) and gauges -->
    <section class="card glass col-8" id="card-traffic">
      <div class="card-h"><h2><?= e(t('Live traffic')) ?></h2>
        <div class="row tr-head" style="gap:var(--s4)">
          <span><span class="muted">RX</span> <b id="rx-now" class="mono" style="color:var(--chart-1)">-</b></span>
          <span><span class="muted">TX</span> <b id="tx-now" class="mono" style="color:var(--chart-3)">-</b></span>
          <label class="sr-only" for="if-sel"><?= e(t('Interface')) ?></label><select id="if-sel" class="select select-sm" style="width:auto"></select>
        </div></div>
      <div class="card-b" style="padding-top:var(--s2)">
        <div class="chart-box lg"><div class="skeleton" data-skel style="position:absolute;inset:0;border-radius:var(--r2)"></div><canvas id="traffic" role="img" aria-label="<?= e(t('Live interface traffic')) ?>"></canvas></div>
        <div class="legend"><span><i style="background:var(--chart-1)"></i>RX</span><span><i style="background:var(--chart-3)"></i>TX</span></div>
      </div>
    </section>

    <section class="card glass col-4" id="card-sys">
      <div class="card-h"><h2><?= e(t('System resource')) ?></h2><span class="badge badge-ok" id="dash-state" hidden></span></div>
      <div class="card-b">
        <div class="gauges">
          <div class="gauge"><div data-g="cpu"><div class="skeleton circle" style="width:84px;height:84px;margin:auto"></div></div><div class="gauge-l">CPU</div><div class="gauge-s" id="cpu-v">&nbsp;</div></div>
          <div class="gauge"><div data-g="mem"><div class="skeleton circle" style="width:84px;height:84px;margin:auto"></div></div><div class="gauge-l">RAM</div><div class="gauge-s" id="mem-v">&nbsp;</div></div>
          <div class="gauge"><div data-g="disk"><div class="skeleton circle" style="width:84px;height:84px;margin:auto"></div></div><div class="gauge-l"><?= e(t('Disk')) ?></div><div class="gauge-s" id="disk-v">&nbsp;</div></div>
        </div>
        <dl class="kv" style="margin-top:var(--s4)">
          <dt><?= e(t('Identity')) ?></dt><dd data-bind="identity">-</dd>
          <dt><?= e(t('Board')) ?></dt><dd data-bind="board">-</dd>
          <dt>RouterOS</dt><dd data-bind="version">-</dd>
          <dt>Uptime</dt><dd data-bind="uptime">-</dd>
        </dl>
      </div>
    </section>

    <!-- composition + rhythm -->
    <section class="card glass col-4" id="card-donut">
      <div class="card-h"><h2><?= e(t('Users by profile')) ?></h2></div>
      <div class="card-b">
        <div class="chart-box" style="height:168px"><div class="skeleton circle" data-skel style="position:absolute;left:50%;top:50%;width:140px;height:140px;margin:-70px 0 0 -70px"></div><canvas id="donut" role="img" aria-label="<?= e(t('Users by profile')) ?>"></canvas></div>
        <div class="legend-list" id="donut-legend"></div>
      </div>
    </section>
    <section class="card glass col-8" id="card-heat">
      <div class="card-h"><h2><?= e(t('Sales heatmap')) ?></h2><span class="muted" id="heat-peak" style="font-size:var(--fs-12)"><?= e(t('Busiest hours by weekday')) ?></span></div>
      <div class="card-b">
        <div id="heat"><div class="skeleton block" data-skel style="height:170px"></div></div>
        <div class="heat-scale"><?= e(t('Less')) ?> <i data-l="0"></i><i data-l="1"></i><i data-l="2"></i><i data-l="3"></i><i data-l="4"></i> <?= e(t('More')) ?></div>
        <div class="ins-row" id="heat-ins" hidden></div>
      </div>
    </section>

    <!-- feeds -->
    <?php if ($live) { ?>
    <section class="card glass col-4">
      <div class="card-h"><h2><?= e(t('Live report')) ?></h2><span class="badge badge-info"><?= e(t('Latest sales')) ?></span></div>
      <div class="card-b" id="recent-sales"><div class="skeleton line"></div><div class="skeleton line" style="width:80%"></div><div class="skeleton line" style="width:90%"></div><div class="skeleton line" style="width:70%"></div></div>
    </section>
    <?php } ?>
    <section class="card glass <?= $live ? 'col-4' : 'col-6' ?>">
      <div class="card-h"><h2><?= e(t('Hotspot log')) ?></h2></div>
      <div class="card-b" id="hs-log"><div class="skeleton line"></div><div class="skeleton line" style="width:85%"></div><div class="skeleton line" style="width:92%"></div><div class="skeleton line" style="width:60%"></div></div>
    </section>
    <section class="card glass <?= $live ? 'col-4' : 'col-6' ?>">
      <div class="card-h"><h2><?= e(t('App log')) ?></h2><a href="<?= e(url('/audit')) ?>"><?= e(t('View all')) ?></a></div>
      <div class="card-b">
        <?php if (!$appLog) { echo '<p class="muted">' . e(t('No activity yet.')) . '</p>'; } else { ?>
        <ul class="feed">
          <?php foreach ($appLog as $a) { ?>
          <li><span class="wrap"><b><?= e($a['user']) ?></b> <?= e($a['action']) ?> <span class="muted"><?= e(mb_substr((string)$a['detail'], 0, 40)) ?></span></span><span class="muted nowrap"><?= e(ago((int)$a['ts'])) ?></span></li>
          <?php } ?>
        </ul>
        <?php } ?>
      </div>
    </section>
  </div>
</div>
