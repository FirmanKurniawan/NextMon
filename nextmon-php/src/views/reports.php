<?php /** Vars: $period $value $prof $profiles $rows $pg $pages $total $count $avg $chart */
$q = ['period' => $period, 'value' => $value, 'profile' => $prof];
$inputType = ['day' => 'date', 'month' => 'month', 'year' => 'number', 'all' => 'hidden'][$period];
$owner = $period === 'month' ? strtolower(date('MY', strtotime($value . '-01'))) : '';
?>
<?= page_head(t('Sales report'), t('Read from the router (/system script) in Mikhmon-compatible format.'),
    '<a class="btn" href="' . e(url('/reports/export?' . http_build_query($q + ['format' => 'csv']))) . '">' . icon('download', 16) . 'CSV</a>'
    . '<a class="btn" href="' . e(url('/reports/export?' . http_build_query($q + ['format' => 'xls']))) . '">' . icon('download', 16) . 'XLS</a>') ?>

<section class="card glass" style="margin-bottom:var(--s4)">
  <form class="tbl-tools" method="get" action="<?= e(url('/reports')) ?>">
    <select class="select" name="period" id="rp-period" aria-label="<?= e(t('Period')) ?>" data-period>
      <?php foreach (['day' => 'Day', 'month' => 'Month', 'year' => 'Year', 'all' => 'All time'] as $k => $l) { ?><option value="<?= $k ?>"<?= sel($k, $period) ?>><?= e(t($l)) ?></option><?php } ?>
    </select>
    <input class="input" id="rp-value" name="value" type="<?= $inputType ?>" value="<?= e($value) ?>" aria-label="<?= e(t('Date')) ?>" <?= $period === 'year' ? 'min="2000" max="2100"' : '' ?>>
    <select class="select" name="profile" aria-label="<?= e(t('Profile')) ?>"><option value=""><?= e(t('All profiles')) ?></option><?php foreach ($profiles as $p) { ?><option<?= sel($p, $prof) ?>><?= e($p) ?></option><?php } ?></select>
    <button class="btn btn-sm btn-primary"><?= e(t('Apply')) ?></button>
    <span class="spacer"></span>
    <?php if ($owner && Auth::can('admin')) { ?>
    <button class="btn btn-sm btn-danger" form="rp-del" type="submit"><?= icon('trash', 16) ?><?= e(t('Delete this month')) ?></button>
    <?php } ?>
  </form>
  <?php if ($owner && Auth::can('admin')) { ?>
  <form method="post" id="rp-del" action="<?= e(url('/reports/delete')) ?>" data-confirm="<?= e(t('Delete all sales records of this month from the router?')) ?>">
    <?= csrf_field() ?><input type="hidden" name="owner" value="<?= e($owner) ?>">
  </form>
  <?php } ?>
</section>

<div class="grid">
  <section class="card glass col-4"><div class="card-b"><div class="stat-label"><?= e(t('Total income')) ?></div><div class="stat-value" data-count="<?= (int)$total ?>" data-money><?= e(money($total)) ?></div></div></section>
  <section class="card glass col-4"><div class="card-b"><div class="stat-label"><?= e(t('Vouchers sold')) ?></div><div class="stat-value" data-count="<?= (int)$count ?>"><?= (int)$count ?></div></div></section>
  <section class="card glass col-4"><div class="card-b"><div class="stat-label"><?= e(t('Average per sale')) ?></div><div class="stat-value" data-count="<?= (int)$avg ?>" data-money><?= e(money($avg)) ?></div></div></section>

  <section class="card glass col-8">
    <div class="card-h"><h2><?= e(t('Income per day')) ?></h2></div>
    <div class="card-b"><div class="chart-box"><canvas id="rp-bars" role="img" aria-label="<?= e(t('Income per day')) ?>"></canvas></div></div>
  </section>
  <section class="card glass col-4">
    <div class="card-h"><h2><?= e(t('By profile')) ?></h2></div>
    <div class="card-b"><div class="chart-box"><canvas id="rp-pie" role="img" aria-label="<?= e(t('Income by profile')) ?>"></canvas></div><div class="legend" id="rp-legend"></div></div>
  </section>
  <script type="application/json" id="report-data"><?= json_encode($chart + ['currency' => Store::setting('currency', 'Rp')], JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_UNICODE) ?></script>

  <section class="card glass col-12">
    <div class="tbl-tools"><input class="input search" type="search" placeholder="<?= e(t('Filter this list')) ?>" data-filter="#sales-tbl" aria-label="<?= e(t('Filter')) ?>"></div>
    <?php if (!$rows) { echo empty_state('chart', t('No sales in this period'), t('Sales appear after users log in with a profile whose expired mode ends with "c" (remc / ntfc).')); } else { ?>
    <div class="table-wrap"><table class="tbl resp" id="sales-tbl">
      <thead><tr><th data-sort><?= e(t('Date')) ?></th><th><?= e(t('Time')) ?></th><th data-sort><?= e(t('User')) ?></th><th data-sort><?= e(t('Profile')) ?></th><th class="num"><?= e(t('Price')) ?></th><th>IP</th><th>MAC</th><th><?= e(t('Validity')) ?></th></tr></thead>
      <tbody>
      <?php foreach ($rows as $r) { ?>
        <tr>
          <td data-label="<?= e(t('Date')) ?>" class="mono"><?= e($r['date']) ?></td>
          <td data-label="<?= e(t('Time')) ?>" class="mono"><?= e($r['time']) ?></td>
          <td data-label="<?= e(t('User')) ?>" class="mono"><b><?= e($r['user']) ?></b></td>
          <td data-label="<?= e(t('Profile')) ?>"><?= e($r['profile']) ?></td>
          <td data-label="<?= e(t('Price')) ?>" class="num"><?= e(money($r['price'])) ?></td>
          <td data-label="IP" class="mono"><?= e($r['ip']) ?></td>
          <td data-label="MAC" class="mono"><?= e($r['mac']) ?></td>
          <td data-label="<?= e(t('Validity')) ?>" class="mono"><?= e($r['validity']) ?></td>
        </tr>
      <?php } ?>
      </tbody>
    </table></div>
    <?= pager($pg, $pages, $count) ?>
    <?php } ?>
  </section>
</div>
