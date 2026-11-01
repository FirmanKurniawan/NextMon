<?php /** Vars: $isRs, and for resellers: $cfg $bal $sum $rows $pg $pages $total $f $plist */ ?>
<link rel="stylesheet" href="<?= e(asset('/assets/css/mod-security.css')) ?>">
<?= page_head(t('My wallet'), t('Your balance, prices and sales as a reseller.')) ?>
<?php if (!$isRs) { echo '<div class="card glass"><div class="card-b">' . empty_state('user', t('This page is for reseller accounts'), t('Your role does not use a wallet.')) . '</div></div>'; return; } ?>
<?php if (!$cfg) { ?><div class="alert warn" style="margin-bottom:var(--s4)"><?= icon('alert', 18) ?><div><?= e(t('Your reseller account is not set up yet. Ask the administrator to configure it and add balance.')) ?></div></div>
<?php } elseif (!$cfg['active']) { ?><div class="alert err" style="margin-bottom:var(--s4)"><?= icon('alert', 18) ?><div><?= e(t('Your reseller account is disabled.')) ?></div></div><?php } ?>

<div class="grid" style="margin-bottom:var(--s4)">
  <section class="card glass col-3"><div class="card-b"><div class="stat-label"><?= e(t('My balance')) ?></div><div class="stat-value rs-balance <?= $bal < 0 ? 'rs-neg' : '' ?>"><?= e(money($bal)) ?></div>
    <?php if ($cfg && $cfg['credit'] > 0) { ?><div class="stat-sub"><?= e(t('Credit limit :c', [':c' => money($cfg['credit'])])) ?></div><?php } ?></div></section>
  <section class="card glass col-3"><div class="card-b"><div class="stat-label"><?= e(t('Sold today')) ?></div><div class="stat-value"><?= (int)$sum['today_n'] ?></div><div class="stat-sub"><?= e(money($sum['today_amt'])) ?></div></div></section>
  <section class="card glass col-3"><div class="card-b"><div class="stat-label"><?= e(t('Sold this month')) ?></div><div class="stat-value"><?= (int)$sum['month_n'] ?></div><div class="stat-sub"><?= e(money($sum['month_amt'])) ?></div></div></section>
  <section class="card glass col-3"><div class="card-b"><div class="stat-label"><?= e(t('Commission this month')) ?></div><div class="stat-value rs-pos"><?= e(money($sum['comm_month'])) ?></div><div class="stat-sub"><?= e(t('Total :c', [':c' => money($sum['comm_total'])])) ?></div></div></section>
</div>

<?php if (!empty($shopLink)) { ?>
<div class="alert info" style="margin-bottom:var(--s4)"><?= icon('cart', 18) ?><div><?= e(t('Your shop link (earn commission on paid shop orders):')) ?> <span class="mono"><?= e($shopLink) ?></span></div></div>
<?php } ?>

<?php if ($plist) { ?>
<section class="card glass" style="margin-bottom:var(--s4)">
  <div class="card-h"><h2><?= e(t('My price list')) ?></h2><a class="btn btn-sm btn-primary" href="<?= e(url('/pos')) ?>"><?= icon('cart', 16) ?><?= e(t('Quick sell (POS)')) ?></a></div>
  <div class="table-wrap"><table class="tbl resp">
    <thead><tr><th><?= e(t('Profile')) ?></th><th class="num"><?= e(t('Customer price')) ?></th><th class="num"><?= e(t('I pay')) ?></th><th class="num"><?= e(t('Commission')) ?></th><th class="num"><?= e(t('Net margin')) ?></th></tr></thead>
    <tbody>
    <?php foreach ($plist as $p) { ?>
      <tr>
        <td data-label="<?= e(t('Profile')) ?>"><b><?= e($p['name']) ?></b></td>
        <td data-label="<?= e(t('Customer price')) ?>" class="num mono"><?= e(money($p['base'])) ?></td>
        <td data-label="<?= e(t('I pay')) ?>" class="num mono"><?= e(money($p['cost'])) ?></td>
        <td data-label="<?= e(t('Commission')) ?>" class="num mono"><?= e(money($p['comm'])) ?></td>
        <td data-label="<?= e(t('Net margin')) ?>" class="num mono rs-pos"><?= e(money($p['base'] - $p['cost'] + $p['comm'])) ?></td>
      </tr>
    <?php } ?>
    </tbody>
  </table></div>
</section>
<?php } ?>

<section class="card glass">
  <div class="card-h"><h2><?= e(t('My transactions')) ?></h2><a class="btn btn-sm" href="<?= e(url('/me/wallet?' . http_build_query(array_filter(['type' => $f['type'], 'from' => $f['from'], 'to' => $f['to'], 'q' => $f['q']]) + ['export' => 'csv']))) ?>"><?= icon('download', 16) ?>CSV</a></div>
  <form class="tbl-tools rs-filters" method="get" action="<?= e(url('/me/wallet')) ?>" role="search">
    <select class="select" name="type" aria-label="<?= e(t('Type')) ?>" data-autosubmit><option value=""><?= e(t('All types')) ?></option>
      <?php foreach (Reseller::TYPES as $ty) { ?><option value="<?= $ty ?>"<?= sel($ty, $f['type']) ?>><?= e(t(ucfirst($ty))) ?></option><?php } ?></select>
    <input class="input" type="date" name="from" value="<?= e($f['from']) ?>" aria-label="<?= e(t('From')) ?>">
    <input class="input" type="date" name="to" value="<?= e($f['to']) ?>" aria-label="<?= e(t('To')) ?>">
    <button class="btn btn-sm"><?= icon('filter', 16) ?><?= e(t('Filter')) ?></button>
  </form>
  <?php if (!$rows) { echo '<div class="card-b">' . empty_state('list', t('No transactions yet')) . '</div>'; } else { ?>
  <div class="table-wrap"><table class="tbl resp">
    <thead><tr><th><?= e(t('Time')) ?></th><th><?= e(t('Type')) ?></th><th><?= e(t('Note')) ?></th><th class="num"><?= e(t('Amount')) ?></th><th class="num"><?= e(t('Balance')) ?></th></tr></thead>
    <tbody>
    <?php foreach ($rows as $r) { ?>
      <tr>
        <td data-label="<?= e(t('Time')) ?>" class="mono nowrap"><?= e(date('Y-m-d H:i', $r['ts'])) ?></td>
        <td data-label="<?= e(t('Type')) ?>"><?= badge(t(ucfirst($r['type'])), ['topup' => 'ok', 'sale' => 'info', 'refund' => 'warn', 'commission' => 'ok'][$r['type']] ?? 'neutral') ?></td>
        <td data-label="<?= e(t('Note')) ?>" class="wrap"><?= e($r['note']) ?></td>
        <td data-label="<?= e(t('Amount')) ?>" class="num mono <?= $r['amount'] < 0 ? 'rs-neg' : 'rs-pos' ?>"><?= e(($r['amount'] > 0 ? '+' : '') . number_format($r['amount'], 0, ',', '.')) ?></td>
        <td data-label="<?= e(t('Balance')) ?>" class="num mono"><?= e(number_format($r['bal'], 0, ',', '.')) ?></td>
      </tr>
    <?php } ?>
    </tbody>
  </table></div>
  <?= pager($pg, $pages, $total) ?>
  <?php } ?>
</section>
