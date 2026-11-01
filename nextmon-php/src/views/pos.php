<?php /** Vars: $items $today $total */ ?>
<?= page_head(t('Quick sell (POS)'), t('Tap a package to create a voucher instantly and print the receipt.'),
    '<button class="btn" type="button" data-scan-open>' . icon('camera', 16) . e(t('Scan voucher QR')) . '</button>') ?>

<div class="grid">
  <section class="col-8">
    <?php if (!$items) { echo '<div class="card glass"><div class="card-b">' . empty_state('tag', t('No packages'), t('Create a profile with a price first.'), '<a class="btn btn-primary" href="' . e(url('/hotspot/profiles')) . '">' . e(t('Profiles')) . '</a>') . '</div></div>'; } else { ?>
    <div class="grid" id="pos-items" data-sell-url="<?= e(url('/pos/sell')) ?>">
      <?php foreach ($items as $it) { ?>
      <div class="col-4">
        <button class="card glass btn" type="button" data-sell="<?= e($it['name']) ?>" style="width:100%;height:auto;padding:var(--s4);flex-direction:column;align-items:flex-start;gap:var(--s2);text-align:left;white-space:normal">
          <span style="font-weight:600;font-size:var(--fs-16)"><?= e($it['name']) ?></span>
          <span class="stat-value" style="font-size:var(--fs-24);margin:0"><?= $it['price'] !== '' ? e(money($it['price'])) : '-' ?></span>
          <span class="muted"><?= e($it['validity'] ?: '-') ?> &middot; <?= e($it['rate'] ?: t('no limit')) ?></span>
        </button>
      </div>
      <?php } ?>
    </div>
    <?php } ?>
  </section>
  <section class="card glass col-4">
    <div class="card-h"><h2><?= e(t('Today')) ?></h2><b id="pos-total"><?= e(money($total)) ?></b></div>
    <div class="card-b" id="pos-today">
      <?php if (!$today) { echo '<p class="muted" id="pos-empty">' . e(t('No sales yet today.')) . '</p>'; } ?>
      <ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--s2)" id="pos-list">
        <?php foreach (array_slice($today, 0, 30) as $x) { ?>
        <li class="row" style="justify-content:space-between;font-size:var(--fs-13)"><span><span class="mono"><?= e($x['user']) ?></span> <span class="muted"><?= e($x['profile']) ?></span></span><span class="nowrap"><?= e(date('H:i', $x['ts'])) ?> &middot; <?= e(money($x['price'])) ?></span></li>
        <?php } ?>
      </ul>
    </div>
  </section>
</div>

<dialog class="modal" id="dlg-receipt" aria-labelledby="rc-t">
  <div class="modal-h"><h2 id="rc-t"><?= e(t('Voucher created')) ?></h2><button type="button" class="btn btn-ghost btn-icon" data-close aria-label="<?= e(t('Close')) ?>"><?= icon('x') ?></button></div>
  <div class="modal-b"><div class="receipt" id="receipt"></div></div>
  <div class="modal-f">
    <button class="btn" type="button" data-copy-voucher><?= e(t('Copy')) ?></button>
    <button class="btn" type="button" data-thermal-share><?= icon('printer', 16) ?>RawBT</button>
    <button class="btn" type="button" data-thermal-ble><?= icon('wifi', 16) ?>Bluetooth</button>
    <button class="btn btn-primary" type="button" data-print-receipt><?= icon('printer', 16) ?><?= e(t('Print')) ?></button>
  </div>
</dialog>
<script type="application/json" id="thermal-data">{"hotspot":"","items":[]}</script>

<dialog class="modal" id="dlg-scan" aria-labelledby="sc-t">
  <div class="modal-h"><h2 id="sc-t"><?= e(t('Scan voucher QR')) ?></h2><button type="button" class="btn btn-ghost btn-icon" data-close aria-label="<?= e(t('Close')) ?>"><?= icon('x') ?></button></div>
  <div class="modal-b"><video id="scan-video" playsinline muted style="width:100%;border-radius:var(--r2);background:#000;max-height:50vh"></video><p class="help" id="scan-msg" style="margin-top:var(--s2)"></p></div>
</dialog>
