<?php /** Fake payment page for the demo gateway. Vars: $c $title $o $ts $sigPaid $sigFail */
include __DIR__ . '/shop_top.php';
$form = function (string $status, string $sig, string $label, string $cls) use ($o, $ts) { ?>
      <form method="post" action="<?= e(url('/pay/callback')) ?>?g=mock<?= e(Shop::wQuery('&')) ?>">
        <input type="hidden" name="mock_ui" value="1">
        <input type="hidden" name="order_id" value="<?= e($o['id']) ?>">
        <input type="hidden" name="status" value="<?= e($status) ?>">
        <input type="hidden" name="amount" value="<?= (int)$o['amount'] ?>">
        <input type="hidden" name="ts" value="<?= (int)$ts ?>">
        <input type="hidden" name="mock_sig" value="<?= e($sig) ?>">
        <button class="btn <?= e($cls) ?> btn-lg shp-wide" type="submit"><?= e($label) ?></button>
      </form>
<?php }; ?>
  <section class="shp-card glass">
    <div class="alert warn"><?= icon('alert', 18) ?><div><?= e(t('Demo payment page. No real money is moved.')) ?></div></div>
    <h1 class="shp-h1" style="margin-top:var(--s4)"><?= e(t('Demo gateway')) ?></h1>
    <dl class="kv shp-kv">
      <dt><?= e(t('Order')) ?></dt><dd class="mono"><?= e($o['id']) ?></dd>
      <dt><?= e(t('Package')) ?></dt><dd><?= e($o['package']['label']) ?></dd>
      <dt><?= e(t('Total')) ?></dt><dd><b><?= e(money($o['amount'])) ?></b></dd>
    </dl>
    <div class="stack" style="gap:var(--s2)">
      <?php $form('paid', $sigPaid, t('Simulate successful payment'), 'btn-primary'); ?>
      <?php $form('failed', $sigFail, t('Simulate failed payment'), ''); ?>
      <a class="btn btn-ghost shp-wide" href="<?= e(Shop::orderUrl($o)) ?>"><?= e(t('Back to order')) ?></a>
    </div>
  </section>
<?php include __DIR__ . '/shop_bottom.php'; ?>
