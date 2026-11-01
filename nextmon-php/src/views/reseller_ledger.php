<?php /** Vars: $rows $pg $pages $total $f $names $resellers $in $out $refunded */
$qs = array_filter($f, fn($v) => $v !== '');
$typeBadge = ['topup' => 'ok', 'sale' => 'info', 'refund' => 'warn', 'commission' => 'ok', 'adjustment' => 'neutral'];
?>
<link rel="stylesheet" href="<?= e(asset('/assets/css/mod-security.css')) ?>">
<?= page_head(t('Reseller ledger'), t('Append-only record of every balance movement.'),
    '<a class="btn" href="' . e(url('/resellers/ledger?' . http_build_query($qs + ['export' => 'csv']))) . '">' . icon('download', 16) . 'CSV</a>'
    . '<a class="btn" href="' . e(url('/resellers')) . '">' . e(t('Resellers')) . '</a>') ?>

<section class="card glass">
  <form class="tbl-tools rs-filters" method="get" action="<?= e(url('/resellers/ledger')) ?>" role="search">
    <select class="select" name="uid" aria-label="<?= e(t('Reseller')) ?>" data-autosubmit><option value=""><?= e(t('All resellers')) ?></option>
      <?php foreach ($resellers as $u) { ?><option value="<?= e($u['id']) ?>"<?= sel($u['id'], $f['uid']) ?>><?= e($u['username']) ?></option><?php } ?></select>
    <select class="select" name="type" aria-label="<?= e(t('Type')) ?>" data-autosubmit><option value=""><?= e(t('All types')) ?></option>
      <?php foreach (Reseller::TYPES as $ty) { ?><option value="<?= $ty ?>"<?= sel($ty, $f['type']) ?>><?= e(t(ucfirst($ty))) ?></option><?php } ?></select>
    <input class="input" type="date" name="from" value="<?= e($f['from']) ?>" aria-label="<?= e(t('From')) ?>">
    <input class="input" type="date" name="to" value="<?= e($f['to']) ?>" aria-label="<?= e(t('To')) ?>">
    <input class="input search" type="search" name="q" value="<?= e($f['q']) ?>" placeholder="<?= e(t('Search note or profile')) ?>" aria-label="<?= e(t('Search')) ?>">
    <button class="btn btn-sm"><?= icon('filter', 16) ?><?= e(t('Filter')) ?></button>
    <span class="spacer"></span>
    <span class="muted"><?= e(t('In')) ?> <b class="rs-pos"><?= e(money($in)) ?></b> &middot; <?= e(t('Out')) ?> <b class="rs-neg"><?= e(money(-$out)) ?></b></span>
  </form>
  <?php if (!$rows) { echo '<div class="card-b">' . empty_state('list', t('No ledger entries'), t('Try other filters.')) . '</div>'; } else { ?>
  <div class="table-wrap"><table class="tbl resp">
    <thead><tr><th><?= e(t('Time')) ?></th><th><?= e(t('Reseller')) ?></th><th><?= e(t('Type')) ?></th><th><?= e(t('Note')) ?></th><th class="num"><?= e(t('Amount')) ?></th><th class="num"><?= e(t('Balance')) ?></th><th><?= e(t('By')) ?></th><th><span class="sr-only"><?= e(t('Actions')) ?></span></th></tr></thead>
    <tbody>
    <?php foreach ($rows as $r) { ?>
      <tr>
        <td data-label="<?= e(t('Time')) ?>" class="mono nowrap"><?= e(date('Y-m-d H:i', $r['ts'])) ?></td>
        <td data-label="<?= e(t('Reseller')) ?>"><?= e($names[$r['uid']] ?? '?') ?></td>
        <td data-label="<?= e(t('Type')) ?>"><?= badge(t(ucfirst($r['type'])), $typeBadge[$r['type']] ?? 'neutral') ?></td>
        <td data-label="<?= e(t('Note')) ?>" class="wrap"><?= e($r['note']) ?><?= isset($refunded[$r['id']]) ? ' ' . badge(t('Refunded'), 'warn') : '' ?></td>
        <td data-label="<?= e(t('Amount')) ?>" class="num mono <?= $r['amount'] < 0 ? 'rs-neg' : 'rs-pos' ?>"><?= e(($r['amount'] > 0 ? '+' : '') . number_format($r['amount'], 0, ',', '.')) ?></td>
        <td data-label="<?= e(t('Balance')) ?>" class="num mono"><?= e(number_format($r['bal'], 0, ',', '.')) ?></td>
        <td data-label="<?= e(t('By')) ?>"><?= e($r['by']) ?></td>
        <td class="actions" data-label=""><?php if ($r['type'] === 'sale' && !isset($refunded[$r['id']])) { ?><form class="inline-form" method="post" action="<?= e(url('/resellers/refund')) ?>" data-confirm="<?= e(t('Refund this sale (and reverse its commission)?')) ?>"><?= csrf_field() ?><input type="hidden" name="entry" value="<?= e($r['id']) ?>"><input type="hidden" name="back" value="<?= e('/resellers/ledger' . ($qs ? '?' . http_build_query($qs) : '')) ?>"><button class="btn btn-sm"><?= e(t('Refund')) ?></button></form><?php } ?></td>
      </tr>
    <?php } ?>
    </tbody>
  </table></div>
  <?= pager($pg, $pages, $total) ?>
  <?php } ?>
</section>
