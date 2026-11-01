<?php /** Vars: $o $gateway */
$kinds = ['pending' => 'warn', 'paid' => 'ok', 'expired' => 'neutral', 'failed' => 'err', 'refunded' => 'info'];
$act = fn(string $do, string $label, string $cls = '', string $extra = '', string $confirm = '') => '<form method="post" action="' . e(url('/orders/action')) . '" class="row"' . ($confirm !== '' ? ' data-confirm="' . e($confirm) . '"' : '') . '>' . csrf_field()
    . '<input type="hidden" name="id" value="' . e($o['id']) . '"><input type="hidden" name="do" value="' . e($do) . '">' . $extra . '<button class="btn ' . $cls . '">' . e($label) . '</button></form>';
?>
<?= page_head($o['id'], t('Order details'), '<a class="btn" href="' . e(url('/orders')) . '">&lsaquo; ' . e(t('Online orders')) . '</a>') ?>

<?php if (!empty($o['flag'])) { ?><div class="alert err" style="margin-bottom:var(--s4)"><?= icon('alert', 18) ?><div><?= e(t('The gateway reported a different amount than the order. The voucher was NOT created. Check the payment, then mark it paid manually if it is correct.')) ?></div></div><?php } ?>
<?php if ($o['status'] === 'paid' && empty($o['voucher'])) { ?><div class="alert warn" style="margin-bottom:var(--s4)"><?= icon('alert', 18) ?><div><?= e(t('Paid, but the voucher could not be created on the router:')) ?> <span class="mono"><?= e($o['fulfil_err'] ?? '') ?></span></div></div><?php } ?>

<div class="grid">
  <section class="card glass col-6">
    <div class="card-h"><h2><?= e(t('Order')) ?></h2><?= badge(t(ucfirst($o['status'])), $kinds[$o['status']] ?? 'neutral') ?></div>
    <div class="card-b"><dl class="kv">
      <dt><?= e(t('Package')) ?></dt><dd><?= e($o['package']['label']) ?> <span class="muted mono">(<?= e($o['package']['profile']) ?>)</span></dd>
      <dt><?= e(t('Amount')) ?></dt><dd><b><?= e(money($o['amount'])) ?></b></dd>
      <dt><?= e(t('Created')) ?></dt><dd class="mono"><?= e(date('Y-m-d H:i:s', (int)$o['created'])) ?></dd>
      <dt><?= e(t('Expires')) ?></dt><dd class="mono"><?= e(date('Y-m-d H:i:s', (int)$o['expires'])) ?></dd>
      <dt><?= e(t('Paid')) ?></dt><dd class="mono"><?= !empty($o['paid_at']) ? e(date('Y-m-d H:i:s', (int)$o['paid_at'])) . ' &middot; ' . e($o['paid_by'] ?? '') : '-' ?></dd>
      <dt><?= e(t('Gateway')) ?></dt><dd><?= e($gateway ? $gateway->label() : $o['gateway']) ?></dd>
      <dt><?= e(t('Gateway reference')) ?></dt><dd class="mono"><?= e($o['ref'] ?: '-') ?></dd>
      <dt>IP</dt><dd class="mono"><?= e($o['ip'] ?? '') ?></dd>
    </dl></div>
  </section>
  <section class="card glass col-6">
    <div class="card-h"><h2><?= e(t('Customer')) ?></h2></div>
    <div class="card-b"><dl class="kv">
      <dt><?= e(t('Name')) ?></dt><dd><?= e($o['customer']['name'] ?? '') ?></dd>
      <dt><?= e(t('Phone')) ?></dt><dd class="mono"><?= e($o['customer']['phone'] ?? '') ?: '-' ?></dd>
      <dt><?= e(t('Email')) ?></dt><dd><?= e($o['customer']['email'] ?? '') ?: '-' ?></dd>
    </dl></div>
    <div class="card-h"><h2><?= e(t('Voucher')) ?></h2></div>
    <div class="card-b">
      <?php if (!empty($o['voucher'])) { $v = $o['voucher']; ?>
      <dl class="kv"><dt><?= e(t('Code')) ?></dt><dd class="mono"><?= e($v['user']) ?><?= $v['pass'] !== $v['user'] ? ' / ' . e($v['pass']) : '' ?></dd><dt><?= e(t('Batch comment')) ?></dt><dd class="mono"><?= e($v['comment']) ?></dd></dl>
      <?php } else { echo '<p class="muted">' . e(t('Not created.')) . '</p>'; } ?>
    </div>
  </section>

  <section class="card glass col-12">
    <div class="card-h"><h2><?= e(t('Actions')) ?></h2></div>
    <div class="card-b row" style="gap:var(--s3);align-items:flex-start">
      <?php if (in_array($o['status'], ['pending', 'expired', 'failed'], true) || !empty($o['flag'])) { echo $act('markpaid', t('Mark as paid'), 'btn-primary', '', t('Confirm that the money for this order was received?')); } ?>
      <?php if ($o['status'] === 'paid' && empty($o['voucher'])) { echo $act('retry', t('Retry voucher creation'), 'btn-primary'); } ?>
      <?php if ($o['status'] === 'paid' && !empty($o['voucher'])) { echo $act('resend', t('Resend voucher to notification channel')); } ?>
      <?php if ($o['status'] === 'paid' && Auth::can('admin')) { ?>
      <form method="post" action="<?= e(url('/orders/action')) ?>" class="row" data-confirm="<?= e(t('Mark this order as refunded?')) ?>">
        <?= csrf_field() ?><input type="hidden" name="id" value="<?= e($o['id']) ?>"><input type="hidden" name="do" value="refund">
        <input class="input" name="note" placeholder="<?= e(t('Refund note (required)')) ?>" style="width:min(280px,100%)" required minlength="3">
        <label class="check"><input type="checkbox" name="disable" value="1" checked><?= e(t('Disable voucher on router')) ?></label>
        <button class="btn btn-danger"><?= e(t('Refund')) ?></button>
      </form>
      <?php } ?>
    </div>
    <p class="help" style="padding:0 var(--s4) var(--s4)"><?= e(t('Marking a refund only records it. Return the money in your gateway or bank yourself.')) ?></p>
  </section>

  <section class="card glass col-6">
    <div class="card-h"><h2><?= e(t('Notes')) ?></h2></div>
    <div class="card-b stack">
      <?php foreach (array_reverse($o['notes']) as $n) { ?><div><span class="muted mono"><?= e(date('m-d H:i', (int)$n['ts'])) ?> &middot; <?= e($n['by']) ?></span><div><?= e($n['text']) ?></div></div><?php } ?>
      <?php if (!$o['notes']) { echo '<p class="muted">-</p>'; } ?>
      <form method="post" action="<?= e(url('/orders/action')) ?>" class="row"><?= csrf_field() ?><input type="hidden" name="id" value="<?= e($o['id']) ?>"><input type="hidden" name="do" value="note">
        <input class="input" name="note" placeholder="<?= e(t('Add a note')) ?>" style="flex:1;min-width:160px" maxlength="500"><button class="btn"><?= e(t('Add')) ?></button></form>
    </div>
  </section>
  <section class="card glass col-6">
    <div class="card-h"><h2><?= e(t('Event log')) ?></h2></div>
    <div class="table-wrap" style="max-height:320px"><table class="tbl compact">
      <tbody>
      <?php foreach (array_reverse($o['events']) as $ev) { ?><tr><td class="mono nowrap"><?= e(date('m-d H:i:s', (int)$ev['ts'])) ?></td><td><?= badge($ev['type']) ?></td><td class="wrap"><?= e($ev['detail']) ?></td></tr><?php } ?>
      <?php if (!$o['events']) { echo '<tr><td class="muted">-</td></tr>'; } ?>
      </tbody>
    </table></div>
  </section>
</div>
