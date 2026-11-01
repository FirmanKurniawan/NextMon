<?php /** Vars: $rows $pg $pages $total $sum $gateways */
$kinds = ['pending' => 'warn', 'paid' => 'ok', 'expired' => 'neutral', 'failed' => 'err', 'refunded' => 'info'];
$qs = array_filter(['status' => App::get('status'), 'gateway' => App::get('gateway'), 'q' => App::get('q'), 'from' => App::get('from'), 'to' => App::get('to')], 'strlen');
?>
<?= page_head(t('Online orders'), t('Orders from the public shop. A voucher is created on the router once, when payment is verified.'),
    '<a class="btn" href="' . e(url('/orders/export' . ($qs ? '?' . http_build_query($qs) : ''))) . '">' . icon('download', 16) . 'CSV</a>'
    . (Auth::can('admin') ? '<a class="btn" href="' . e(url('/shop/settings')) . '">' . icon('settings', 16) . e(t('Shop settings')) . '</a>' : '')
    . '<a class="btn" href="' . e(url('/shop')) . '" target="_blank" rel="noopener">' . icon('globe', 16) . e(t('Open shop')) . '</a>') ?>

<div class="grid" style="margin-bottom:var(--s4)">
  <section class="card glass col-3"><div class="card-b"><div class="stat-label"><?= e(t('Orders')) ?></div><div class="stat-value"><?= (int)$sum['count'] ?></div></div></section>
  <section class="card glass col-3"><div class="card-b"><div class="stat-label"><?= e(t('Paid')) ?></div><div class="stat-value"><?= (int)$sum['paid'] ?></div></div></section>
  <section class="card glass col-3"><div class="card-b"><div class="stat-label"><?= e(t('Revenue (paid)')) ?></div><div class="stat-value"><?= e(money($sum['revenue'])) ?></div></div></section>
  <section class="card glass col-3"><div class="card-b"><div class="stat-label"><?= e(t('Waiting / need attention')) ?></div><div class="stat-value"><?= (int)$sum['pending'] ?> / <?= (int)$sum['attention'] ?></div></div></section>
</div>

<section class="card glass">
  <form class="tbl-tools" method="get" action="<?= e(url('/orders')) ?>">
    <input class="input search" type="search" name="q" value="<?= e(App::get('q')) ?>" placeholder="<?= e(t('Order, name, phone, voucher')) ?>" aria-label="<?= e(t('Search')) ?>">
    <select class="select" name="status" aria-label="<?= e(t('Status')) ?>"><option value=""><?= e(t('All statuses')) ?></option><?php foreach (Orders::STATES as $s) { ?><option value="<?= $s ?>"<?= sel($s, App::get('status')) ?>><?= e(t(ucfirst($s))) ?></option><?php } ?></select>
    <select class="select" name="gateway" aria-label="<?= e(t('Gateway')) ?>"><option value=""><?= e(t('All gateways')) ?></option><?php foreach ($gateways as $id => $g) { ?><option value="<?= e($id) ?>"<?= sel($id, App::get('gateway')) ?>><?= e($g->label()) ?></option><?php } ?></select>
    <input class="input" type="date" name="from" value="<?= e(App::get('from')) ?>" aria-label="<?= e(t('From')) ?>">
    <input class="input" type="date" name="to" value="<?= e(App::get('to')) ?>" aria-label="<?= e(t('To')) ?>">
    <button class="btn btn-sm btn-primary"><?= e(t('Apply')) ?></button>
    <?php if ($qs) { ?><a class="btn btn-sm btn-ghost" href="<?= e(url('/orders')) ?>"><?= e(t('Reset')) ?></a><?php } ?>
  </form>
  <?php if (!$rows) { echo empty_state('list', t('No orders'), t('Orders appear here when customers buy from the shop.')); } else { ?>
  <div class="table-wrap"><table class="tbl resp">
    <thead><tr><th><?= e(t('Order')) ?></th><th><?= e(t('Time')) ?></th><th><?= e(t('Customer')) ?></th><th><?= e(t('Package')) ?></th><th class="num"><?= e(t('Amount')) ?></th><th><?= e(t('Gateway')) ?></th><th><?= e(t('Status')) ?></th><th><?= e(t('Voucher')) ?></th></tr></thead>
    <tbody>
    <?php foreach ($rows as $o) { ?>
      <tr>
        <td data-label="<?= e(t('Order')) ?>"><a class="mono" href="<?= e(url('/orders/view?id=' . rawurlencode($o['id']))) ?>"><?= e($o['id']) ?></a></td>
        <td data-label="<?= e(t('Time')) ?>" class="mono nowrap"><?= e(date('m-d H:i', (int)$o['created'])) ?></td>
        <td data-label="<?= e(t('Customer')) ?>"><?= e($o['customer']['name'] ?? '') ?><div class="muted mono"><?= e($o['customer']['phone'] ?? '') ?></div></td>
        <td data-label="<?= e(t('Package')) ?>"><?= e($o['package']['label']) ?></td>
        <td data-label="<?= e(t('Amount')) ?>" class="num nowrap"><?= e(money($o['amount'])) ?></td>
        <td data-label="<?= e(t('Gateway')) ?>"><?= e($o['gateway']) ?></td>
        <td data-label="<?= e(t('Status')) ?>"><?= badge(t(ucfirst($o['status'])), $kinds[$o['status']] ?? 'neutral') ?><?php if (!empty($o['flag'])) { ?> <?= badge(t('Amount mismatch'), 'err') ?><?php } ?></td>
        <td data-label="<?= e(t('Voucher')) ?>" class="mono"><?= !empty($o['voucher']) ? e($o['voucher']['user']) : ($o['status'] === 'paid' ? badge(t('Pending'), 'warn') : '-') ?></td>
      </tr>
    <?php } ?>
    </tbody>
  </table></div>
  <?= pager($pg, $pages, $total) ?>
  <?php } ?>
</section>
