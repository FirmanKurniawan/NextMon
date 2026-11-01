<?php /** Public order status. Vars: $c $title $o(?array) $view(?array) $go $gw */
$st = $o['status'] ?? 'none';
$ready = !empty($view['ready']);
$refresh = $o && ($st === 'pending' || ($st === 'paid' && !$ready));
$go = !empty($go);
include __DIR__ . '/shop_top.php';
$poll = $o ? url('/shop/order') . '?id=' . rawurlencode($o['id']) . '&t=' . rawurlencode($o['token']) . '&json=1' : '';
$self = $o ? url('/shop/order') . '?id=' . rawurlencode($o['id']) . '&t=' . rawurlencode($o['token']) : '';
?>
  <section class="shp-card glass shp-live" <?php if ($o) { ?>data-poll="<?= e($poll) ?>" data-self="<?= e($self) ?>" data-status="<?= e($st) ?>" data-ready="<?= $ready ? '1' : '0' ?>" data-expires="<?= (int)($view['expires_in'] ?? 0) ?>"<?php if ($go && $st === 'pending' && $o['pay_url'] !== '') { ?> data-go="<?= e($o['pay_url']) ?>"<?php } ?><?php } ?>>
  <?php if (!$o) { ?>
    <?= empty_state('alert', t('Order not found'), t('The link is wrong or the order was removed.'), '<a class="btn btn-primary" href="' . e(url(Shop::homePath())) . '">' . e(t('Back to shop')) . '</a>') ?>

  <?php } elseif ($st === 'paid' && $ready) { $v = $view['voucher']; ?>
    <div class="shp-state ok"><span class="shp-state-ic"><?= icon('check', 22) ?></span><div><h1 class="shp-h1"><?= e(t('Payment received')) ?></h1><p class="muted"><?= e(t('Your voucher is ready. Save it before you leave this page.')) ?></p></div></div>

    <div class="shp-voucher">
      <div class="shp-vlabel"><?= e($v['pass'] !== $v['user'] ? t('Username') : t('Voucher code')) ?></div>
      <div class="shp-code mono" id="v-user"><?= e($v['user']) ?></div>
      <?php if ($v['pass'] !== $v['user']) { ?>
      <div class="shp-vlabel"><?= e(t('Password')) ?></div>
      <div class="shp-code mono" id="v-pass"><?= e($v['pass']) ?></div>
      <?php } ?>
      <div class="shp-actions">
        <button class="btn" type="button" data-shp-copy="<?= e($v['pass'] !== $v['user'] ? $v['user'] . ' / ' . $v['pass'] : $v['user']) ?>"><?= icon('file', 16) ?><span data-label="<?= e(t('Copy code')) ?>" data-done="<?= e(t('Copied')) ?>"><?= e(t('Copy code')) ?></span></button>
        <a class="btn btn-primary" href="<?= e($v['url']) ?>"><?= icon('zap', 16) ?><?= e(t('Connect automatically')) ?></a>
      </div>
      <p class="help shp-hint"><?= e(t('Tap "Connect automatically" while connected to the WiFi, or scan the QR code with another device.')) ?></p>
      <div class="shp-qr" data-qr="<?= e($v['url']) ?>" aria-label="QR"></div>
    </div>

    <dl class="kv shp-kv">
      <dt><?= e(t('Package')) ?></dt><dd><?= e($o['package']['label']) ?></dd>
      <dt><?= e(t('Amount')) ?></dt><dd><?= e(money($o['amount'])) ?></dd>
      <dt><?= e(t('Order')) ?></dt><dd class="mono"><?= e($o['id']) ?></dd>
    </dl>
    <?php $rc = App::routerCfg($o['router']); if ($rc) { ?>
    <a class="shp-link" href="<?= e(url('/status')) ?>?session=<?= e(rawurlencode($rc['session'] ?? $rc['id'])) ?>&amp;user=<?= e(rawurlencode($v['user'])) ?>&amp;w=<?= e(rawurlencode(Workspace::slug())) ?>"><?= e(t('Check remaining time')) ?> &rsaquo;</a>
    <?php } ?>

  <?php } elseif ($st === 'paid') { ?>
    <div class="shp-state"><span class="shp-spin" aria-hidden="true"></span><div><h1 class="shp-h1"><?= e(t('Payment received')) ?></h1><p class="muted"><?= e(t('We are preparing your voucher. This page updates by itself.')) ?></p></div></div>
    <?php if (($o['fulfil'] ?? '') === 'error') { ?><div class="alert warn"><?= icon('alert', 18) ?><div><?= e(t('The hotspot router did not answer yet. We keep retrying; if it takes long, contact the staff with order :id.', [':id' => $o['id']])) ?></div></div><?php } ?>

  <?php } elseif ($st === 'pending') { ?>
    <div class="shp-state"><span class="shp-spin" aria-hidden="true"></span><div><h1 class="shp-h1"><?= e(t('Waiting for payment')) ?></h1><p class="muted"><?= e(t('Complete the payment; this page updates by itself.')) ?></p></div></div>
    <dl class="kv shp-kv">
      <dt><?= e(t('Package')) ?></dt><dd><?= e($o['package']['label']) ?></dd>
      <dt><?= e(t('Total')) ?></dt><dd><b><?= e(money($o['amount'])) ?></b></dd>
      <dt><?= e(t('Order')) ?></dt><dd class="mono"><?= e($o['id']) ?></dd>
      <dt><?= e(t('Pay before')) ?></dt><dd class="mono" id="shp-count" data-countdown="<?= (int)$view['expires_in'] ?>"><?= e(date('H:i', (int)$o['expires'])) ?></dd>
    </dl>
    <?php if ($o['pay_url'] !== '') { ?>
      <a class="btn btn-primary btn-lg shp-wide" href="<?= e($o['pay_url']) ?>"><?= e(t('Pay now')) ?></a>
    <?php } ?>
    <?php if ($o['gateway'] === 'manual') { ?>
      <div class="shp-manual">
        <div class="shp-vlabel"><?= e(t('How to pay')) ?></div>
        <div class="shp-pre"><?= nl2br(e($o['pay_info'] !== '' ? $o['pay_info'] : t('Ask the staff for payment details and mention your order number.'))) ?></div>
        <p class="help"><?= e(t('After you transfer, the staff confirms your payment and the voucher appears here.')) ?></p>
      </div>
    <?php } ?>

  <?php } elseif ($st === 'refunded') { ?>
    <div class="shp-state warn"><span class="shp-state-ic"><?= icon('alert', 22) ?></span><div><h1 class="shp-h1"><?= e(t('Order refunded')) ?></h1><p class="muted"><?= e(t('This order was refunded and the voucher is no longer valid.')) ?></p></div></div>

  <?php } else { ?>
    <div class="shp-state err"><span class="shp-state-ic"><?= icon('x', 22) ?></span><div><h1 class="shp-h1"><?= e($st === 'expired' ? t('Order expired') : t('Payment failed')) ?></h1><p class="muted"><?= e(t('Nothing was charged for this order. If you already paid, contact the staff with order :id.', [':id' => $o['id']])) ?></p></div></div>
    <a class="btn btn-primary btn-lg shp-wide" href="<?= e(url(Shop::homePath())) ?>"><?= e(t('Order again')) ?></a>
  <?php } ?>
  </section>
<?php include __DIR__ . '/shop_bottom.php'; ?>
