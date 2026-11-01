<?php /** Vars: $profiles $meta $batches $servers $templates $maxQty $hotspot $loginBase */
$vg = ['hotspot' => $hotspot, 'loginBase' => $loginBase, 'templates' => $templates,
    'i18n' => ['code' => t('Voucher code'), 'username' => t('Username'), 'password' => t('Password'), 'scan' => t('Scan to login'), 'profile' => t('Package'), 'valid' => t('Valid'), 'price' => t('Price'), 'limit' => t('Time limit'), 'ssid' => t('Wi-Fi network'), 'wpass' => t('Wi-Fi password'), 'serial' => t('No.')]];
?>
<link rel="stylesheet" href="<?= e(asset('/assets/css/voucher.css')) ?>">
<?= page_head(t('Vouchers'), t('Generate a batch, pick a card design, then print or save it.'),
    Auth::can('write') ? '<a class="btn" href="' . e(url('/vouchers/templates')) . '">' . icon('file', 16) . e(t('Templates')) . '</a>' : '') ?>
<script type="application/json" id="vg-data"><?= json_encode($vg, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP) ?></script>

<div class="grid" id="vg-root">
  <section class="card glass col-7">
    <div class="card-h"><h2><?= e(t('New batch')) ?></h2></div>
    <form class="card-b stack" method="post" action="<?= e(url('/vouchers/generate')) ?>">
      <?= csrf_field() ?>
      <input type="hidden" name="design" id="g-design" value="aurora"><input type="hidden" name="tpl" id="g-tpl" value="">
      <div class="vg-grid3">
        <div class="field vg-span2"><label for="g-prof"><?= e(t('Profile')) ?></label>
          <select class="select" id="g-prof" name="profile" required data-meta="<?= jattr($meta) ?>">
            <?php foreach ($profiles as $p) { $m = $meta[$p] ?? null; ?><option value="<?= e($p) ?>"><?= e($p) ?><?= $m && $m['sprice'] !== '' ? ' - ' . e(money($m['sprice'])) : '' ?><?= $m && $m['validity'] !== '' ? ' / ' . e($m['validity']) : '' ?></option><?php } ?>
          </select></div>
        <div class="field"><label for="g-qty"><?= e(t('Quantity')) ?></label><input class="input" id="g-qty" name="qty" type="number" min="1" max="<?= (int)$maxQty ?>" value="10" required></div>
        <div class="vg-span3"><p class="help" id="g-prof-info" style="margin:0">&nbsp;</p></div>
        <div class="field"><label for="g-batch"><?= e(t('Batch name (comment)')) ?></label><input class="input" id="g-batch" name="batch" maxlength="24" placeholder="<?= e(date('Md')) ?>"></div>
        <div class="field"><label for="g-prefix"><?= e(t('Prefix')) ?></label><input class="input mono" id="g-prefix" name="prefix" maxlength="8" autocapitalize="off"></div>
        <div class="field"><label for="g-len"><?= e(t('Code length')) ?></label><input class="input" id="g-len" name="length" type="number" min="3" max="16" value="6"></div>
        <div class="field"><label for="g-cs"><?= e(t('Characters')) ?></label>
          <select class="select" id="g-cs" name="charset"><option value="safe"><?= e(t('abc + 346 (no look-alikes)')) ?></option><option value="safeupper"><?= e(t('ABC + 346 (no look-alikes)')) ?></option><option value="lowernum">abc + 234</option><option value="num">0-9</option><option value="lower">abc</option><option value="upper">ABC</option><option value="uppernum">ABC + 234</option><option value="mixed">aBc + 234</option></select><p class="help" style="margin:4px 0 0"><?= e(t('"No look-alikes" also drops 5/s, 2/z, 8/b, 9/q and u/v, so a code can be read aloud or typed without doubt.')) ?></p></div>
        <div class="field"><label for="g-mode"><?= e(t('Mode')) ?></label>
          <select class="select" id="g-mode" name="mode"><option value="vc"><?= e(t('Username = password')) ?></option><option value="up"><?= e(t('Username + password')) ?></option></select></div>
        <?php if (count($servers) > 1) { ?><div class="field"><label for="g-srv"><?= e(t('Hotspot server')) ?></label><select class="select" id="g-srv" name="server"><option value="all">all</option><?php foreach ($servers as $s) { ?><option><?= e($s) ?></option><?php } ?></select></div><?php } ?>
        <div class="field"><label for="g-lim"><?= e(t('Time limit')) ?></label><input class="input mono" id="g-lim" name="limit_uptime" placeholder="1h" autocapitalize="off"></div>
        <div class="field"><label for="g-bytes"><?= e(t('Data limit (bytes)')) ?></label><input class="input mono" id="g-bytes" name="limit_bytes" inputmode="numeric"></div>
        <div class="vg-span3"><p class="help" style="margin:0"><b><?= e(t('Validity')) ?></b> <?= e(t('runs from first login (profile). ')) ?><b><?= e(t('Time limit')) ?></b> <?= e(t('is total online time and pauses while logged out; it must not exceed validity.')) ?></p></div>
      </div>
      <div class="field"><label><?= e(t('Card design')) ?></label><div class="vg-thumbs" id="vg-thumbs"></div>
        <p class="help"><?= e(t('Colours, paper, columns and QR options are adjusted in the print view.')) ?></p></div>
      <button class="btn btn-primary btn-lg" style="width:100%"><?= icon('ticket', 18) ?><?= e(t('Generate and open print view')) ?></button>
    </form>
  </section>

  <section class="card glass col-5">
    <div class="card-h"><h2><?= e(t('Quick print')) ?></h2></div>
    <form class="card-b" method="post" action="<?= e(url('/vouchers/quick')) ?>">
      <?= csrf_field() ?>
      <div class="vg-quick"><input class="input mono" name="code" required autocapitalize="off" autocomplete="off" placeholder="<?= e(t('Voucher code')) ?>" aria-label="<?= e(t('Voucher code')) ?>"><button class="btn"><?= icon('printer', 16) ?><?= e(t('Print')) ?></button></div>
      <p class="help" style="margin-top:6px"><?= e(t('Print or re-print a single existing voucher by its username.')) ?></p>
    </form>
    <div class="card-h"><h2><?= e(t('Recent batches')) ?></h2></div>
    <?php if (!$batches) { echo empty_state('ticket', t('No batches yet'), t('Generated vouchers appear here, grouped by their comment tag.')); } else { ?>
    <div class="table-wrap" style="max-height:520px">
      <table class="tbl resp">
        <thead><tr><th><?= e(t('Batch')) ?></th><th><?= e(t('Profile')) ?></th><th class="num"><?= e(t('Used / total')) ?></th><th></th></tr></thead>
        <tbody>
        <?php foreach (array_slice($batches, 0, 40) as $b) { ?>
          <tr>
            <td data-label="<?= e(t('Batch')) ?>" class="mono wrap"><?= e($b['tag']) ?></td>
            <td data-label="<?= e(t('Profile')) ?>"><?= e($b['profile']) ?></td>
            <td data-label="<?= e(t('Used / total')) ?>" class="num"><?= (int)$b['used'] ?> / <?= (int)$b['count'] ?></td>
            <td class="actions" data-label="">
              <a class="btn btn-sm" href="<?= e(url('/vouchers/print?comment=' . rawurlencode($b['tag']))) ?>" title="<?= e(t('Print or re-print this batch')) ?>"><?= icon('printer', 16) ?><span class="hide-m"><?= e(t('Print')) ?></span></a>
              <?php if (Auth::can('write')) { ?><form class="inline-form" method="post" action="<?= e(url('/vouchers/delete')) ?>" data-confirm="<?= e(t('Delete all users in this batch?')) ?>"><?= csrf_field() ?><input type="hidden" name="tag" value="<?= e($b['tag']) ?>"><button class="btn btn-sm btn-danger btn-icon" aria-label="<?= e(t('Delete')) ?>"><?= icon('trash', 16) ?></button></form><?php } ?>
            </td>
          </tr>
        <?php } ?>
        </tbody>
      </table>
    </div>
    <?php } ?>
  </section>
</div>
<script src="<?= e(asset('/assets/js/voucher.js')) ?>" defer></script>
