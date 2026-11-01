<?php /** Vars: $templates */
$default = '<div style="width:70mm;height:40mm;box-sizing:border-box;padding:3mm;border:.3mm solid #0d1b24;border-radius:2mm;display:grid;grid-template-columns:1fr 24mm;gap:3mm;font:3mm/1.25 sans-serif">
<div>
<b style="font-size:3.4mm;letter-spacing:.1em;text-transform:uppercase">{{hotspot}}</b>
{{creds}}
<div>{{profile}} - {{validity}} - {{price}}</div>
</div>
<div style="align-self:center">{{qr}}</div>
</div>';
$ph = [
    ['{{hotspot}}', t('Hotspot / brand name')], ['{{user}}', t('Username (voucher code)')], ['{{pass}}', t('Password')], ['{{code}}', t('Username grouped for reading (abc 123)')],
    ['{{creds}}', t('Ready-made code block (one or two rows, styled)')], ['{{profile}}', t('Profile / package')], ['{{price}}', t('Selling price')], ['{{validity}}', t('Validity')],
    ['{{limit}}', t('Time limit')], ['{{ssid}}', t('Wi-Fi network name (set in the print view)')], ['{{wifipass}}', t('Wi-Fi password (set in the print view)')], ['{{comment}}', t('Batch tag')], ['{{serial}}', t('Number in batch (001)')], ['{{dns}}', t('Hotspot host name')],
    ['{{login_url}}', t('Auto-login URL')], ['{{qr}}', t('QR code (SVG)')], ['{{logo}}', t('Logo image (if set)')], ['{{scan}}', t('Caption: scan to login')],
];
$designs = ['aurora' => 'Glass Aurora', 'mini' => 'Glass Mini', 'strip' => 'Compact Strip', 'dark' => 'Dark Glass', 'mono' => 'Minimal Mono', 'ticket' => 'Ticket', 't58' => 'Thermal 58', 't80' => 'Thermal 80', 'banner' => 'Brand Banner', 'wifi' => 'Wi-Fi Card', 'receipt' => 'Receipt Pro'];
$te = ['i18n' => ['code' => t('Voucher code'), 'username' => t('Username'), 'password' => t('Password'), 'scan' => t('Scan to login'), 'profile' => t('Package'), 'valid' => t('Valid'), 'price' => t('Price'), 'limit' => t('Time limit'), 'ssid' => t('Wi-Fi network'), 'wpass' => t('Wi-Fi password'), 'serial' => t('No.')]];
?>
<link rel="stylesheet" href="<?= e(asset('/assets/css/voucher.css')) ?>">
<?= page_head(t('Voucher templates'), t('Start from a built-in design or write your own HTML. Scripts and event attributes are stripped on save.'),
    '<a class="btn" href="' . e(url('/vouchers')) . '">&larr; ' . e(t('Vouchers')) . '</a>') ?>
<script type="application/json" id="te-data"><?= json_encode($te, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP) ?></script>

<div class="te" id="te-root">
  <section class="card glass">
    <div class="card-h"><h2><?= e(t('Editor')) ?></h2></div>
    <form class="card-b stack" method="post" action="<?= e(url('/vouchers/templates/save')) ?>" id="tpl-form">
      <?= csrf_field() ?><input type="hidden" name="id" id="te-id">
      <div class="form-grid">
        <div class="field full"><label for="te-name"><?= e(t('Template name')) ?></label><input class="input" id="te-name" name="name" required maxlength="40"></div>
        <div class="field"><label for="te-w"><?= e(t('Card width (mm)')) ?></label><input class="input mono" id="te-w" name="w" type="number" min="20" max="300" step="0.1" value="70"></div>
        <div class="field"><label for="te-h"><?= e(t('Card height (mm)')) ?></label><input class="input mono" id="te-h" name="h" type="number" min="10" max="300" step="0.1" value="40"></div>
      </div>
      <div class="field"><label for="te-html">HTML</label><textarea class="textarea mono" id="te-html" name="html" rows="14" spellcheck="false" required style="font-size:12.5px;line-height:1.45;height:auto;padding:var(--s3)"><?= e($default) ?></textarea>
        <div class="te-chips" aria-label="<?= e(t('Placeholders')) ?>"><?php foreach ($ph as $p) { ?><button type="button" class="te-chip" data-ph="<?= e($p[0]) ?>" title="<?= e($p[1]) ?>"><?= e($p[0]) ?></button><?php } ?></div>
        <p class="help"><?= e(t('Click a chip to insert it at the cursor. Millimetre units print true to size; the print view scales the card as a whole.')) ?></p></div>
      <div class="field"><label><?= e(t('Start from a design')) ?></label>
        <div class="te-chips"><?php foreach ($designs as $id => $nm) { ?><button type="button" class="te-chip" data-start="<?= e($id) ?>" style="font-family:var(--font)"><?= e($nm) ?></button><?php } ?></div>
        <p class="help"><?= e(t('Copies the design markup (CSS classes included) into the editor so you can adjust it.')) ?></p></div>
      <div class="row"><button class="btn btn-primary"><?= e(t('Save template')) ?></button><button class="btn" type="button" data-tpl-new><?= e(t('New')) ?></button></div>
    </form>
  </section>

  <div class="stack">
    <section class="card glass">
      <div class="card-h"><h2><?= e(t('Live preview')) ?></h2><label class="check" style="margin-left:auto"><input type="checkbox" id="te-two"> <?= e(t('Username + password')) ?></label></div>
      <div class="card-b"><div class="te-stage" id="te-stage"></div></div>
    </section>
    <section class="card glass">
      <div class="card-h"><h2><?= e(t('Variables')) ?></h2></div>
      <div class="card-b"><table class="te-vars"><tbody><?php foreach ($ph as $p) { ?><tr><td><?= e($p[0]) ?></td><td><?= e($p[1]) ?></td></tr><?php } ?></tbody></table></div>
    </section>
    <section class="card glass">
      <div class="card-h"><h2><?= e(t('Saved templates')) ?></h2></div>
      <div class="card-b">
        <?php if (!$templates) { echo '<p class="muted">' . e(t('None yet. The built-in designs are always available in the print view.')) . '</p>'; } else { ?>
        <ul class="te-list">
          <?php foreach ($templates as $tp) { ?>
          <li><span><b><?= e($tp['name']) ?></b> <span class="muted mono"><?= e($tp['w'] + 0) ?>x<?= e($tp['h'] + 0) ?> mm</span></span>
            <span class="row">
              <button class="btn btn-sm" type="button" data-tpl-load="<?= jattr($tp) ?>"><?= e(t('Edit')) ?></button>
              <form class="inline-form" method="post" action="<?= e(url('/vouchers/templates/delete')) ?>" data-confirm="<?= e(t('Delete this template?')) ?>"><?= csrf_field() ?><input type="hidden" name="id" value="<?= e($tp['id']) ?>"><button class="btn btn-sm btn-danger btn-icon" aria-label="<?= e(t('Delete')) ?>"><?= icon('trash', 16) ?></button></form>
            </span></li>
          <?php } ?>
        </ul>
        <?php } ?>
      </div>
    </section>
  </div>
</div>
<script src="<?= e(asset('/assets/js/voucher.js')) ?>" defer></script>
