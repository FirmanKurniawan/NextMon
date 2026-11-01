<?php /** Vars: $items $tag $hotspot $templates $presets $defaultPreset $loginBase */
$thermal = [];
foreach ($items as $i) {
    $thermal[] = ['u' => $i['user'], 'p' => $i['pass'], 'pr' => $i['profile'], 'price' => $i['price'], 'v' => $i['validity']];
}
$vpData = [
    'items' => array_map(fn($i) => ['user' => $i['user'], 'pass' => $i['pass'], 'profile' => $i['profile'], 'price' => $i['price'], 'validity' => $i['validity'], 'limit' => $i['limit'], 'comment' => $i['comment']], $items),
    'escpos' => asset('/assets/js/escpos.js'), 'hotspot' => $hotspot, 'loginBase' => $loginBase, 'templates' => $templates, 'presets' => $presets, 'defaultPreset' => $defaultPreset, 'base' => App::$base,
    'i18n' => [
        'code' => t('Voucher code'), 'username' => t('Username'), 'password' => t('Password'), 'scan' => t('Scan to login'), 'profile' => t('Package'), 'valid' => t('Valid'), 'price' => t('Price'),
        'clipped' => t('The card is larger than the printable area at this scale. Lower the scale or change paper.'),
        'perSheet' => t('per sheet'), 'sheets' => t('sheets'), 'eccH' => t('Error correction forced to H for the centre logo.'),
        'notImage' => t('Choose an image file.'), 'empty' => t('No vouchers found for this batch.'), 'presetName' => t('Preset name'), 'saved' => t('Saved.'), 'confirmDel' => t('Delete this preset?'),
        'presetNone' => t('No preset'), 'custom' => t('custom'), 'pngFail' => t('Could not create the PNG in this browser. Use Print instead.'),
        'limit' => t('Time limit'), 'ssid' => t('Wi-Fi network'), 'wpass' => t('Wi-Fi password'), 'serial' => t('No.'),
        'copied' => t('Copied.'), 'copyFail' => t('Could not copy.'), 'lookalike' => t('Some codes contain I, l or O. They are underlined on the card; a slashed zero is the digit 0. The gap inside a code is only for reading.'),
        'bigJob' => t('Sending many vouchers with image QR codes is slow over Bluetooth. Continue?'), 'tooLong' => t('Too much data for the RawBT link. Use native QR or fewer vouchers.'), 'sending' => t('Sending to the printer...'), 'sent' => t('Sent to the printer.'),
        'noBle' => t('Web Bluetooth is not supported in this browser (use Chrome on Android/desktop over HTTPS).'), 'scanTh' => t('Scan to login'),
    ],
];
$swatches = ['#0b7285', '#1d4ed8', '#4338ca', '#6d28d9', '#0f766e', '#15803d', '#b45309', '#be123c', '#334155', '#111827'];
$chk = function (string $opt, string $label) {
    return '<label class="check"><input type="checkbox" data-opt="' . e($opt) . '"> ' . e($label) . '</label>';
};
$rng = function (string $opt, string $label, $min, $max, $step, string $unit = '') {
    return '<label class="vp-range"><span>' . e($label) . '</span><input type="range" data-opt="' . e($opt) . '" data-unit="' . e($unit) . '" min="' . $min . '" max="' . $max . '" step="' . $step . '"><output></output></label>';
};
?><!doctype html>
<html lang="<?= e(I18n::lang()) ?>" data-theme="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title><?= e(t('Print vouchers')) ?> - NextMON</title>
<link rel="stylesheet" href="<?= e(asset('/assets/css/app.css')) ?>">
<link rel="stylesheet" href="<?= e(asset('/assets/css/voucher.css')) ?>">
<script src="<?= e(asset('/assets/js/theme.js')) ?>"></script>
<style id="vp-pagestyle">@page { size: 210mm 297mm; margin: 0 }</style>
</head>
<body data-base="<?= e(App::$base) ?>" data-page="print" data-csrf="<?= e(Auth::csrf()) ?>">
<div class="vp-bar glass">
  <a class="btn btn-sm" href="<?= e(url('/vouchers')) ?>" aria-label="<?= e(t('Back')) ?>">&larr;<span class="vp-hm"> <?= e(t('Back')) ?></span></a>
  <b><?= e(count($items)) ?> <?= e(t('vouchers')) ?></b><span class="muted mono vp-tag"><?= e($tag) ?></span>
  <span class="stat" id="vp-info"></span>
  <span class="spacer"></span>
  <span class="vp-hm vp-bar-tools">
    <label class="sr-only" for="vp-zoom"><?= e(t('Zoom')) ?></label>
    <select class="select select-sm" id="vp-zoom" data-opt="zoom" style="width:auto"><option value="fit"><?= e(t('Fit')) ?></option><option value="0.5">50%</option><option value="0.75">75%</option><option value="1">100%</option><option value="1.5">150%</option><option value="2.5">250%</option></select>
    <button class="btn btn-sm" type="button" data-thermal-share title="RawBT">RawBT</button>
    <button class="btn btn-sm" type="button" data-thermal-ble>Bluetooth</button>
    <button class="btn btn-sm btn-primary" type="button" data-vp-print><?= icon('printer', 16) ?><?= e(t('Print')) ?></button>
  </span>
</div>
<script type="application/json" id="thermal-data"><?= json_encode(['hotspot' => $hotspot, 'items' => $thermal], JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP) ?></script>
<script type="application/json" id="vp-data"><?= json_encode($vpData, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_INVALID_UTF8_SUBSTITUTE) ?></script>

<div class="vp vp-root" id="vp-root">
  <main class="vp-stage" id="vp-stage" aria-live="polite"></main>

  <aside class="vp-panel" aria-label="<?= e(t('Print settings')) ?>">
    <details class="vp-sec" open>
      <summary><span><?= e(t('Design')) ?></span><button class="btn btn-sm btn-ghost" type="button" data-reset><?= e(t('Reset')) ?></button></summary>
      <div class="vp-thumbs" id="vp-thumbs"></div>
    </details>

    <details class="vp-sec" open>
      <summary><span><?= e(t('Paper and layout')) ?></span></summary>
      <div class="vp-two">
        <div class="field"><label for="o-paper"><?= e(t('Paper')) ?></label>
          <select class="select select-sm" id="o-paper" data-opt="paper"><option value="a4">A4</option><option value="a5">A5</option><option value="letter">Letter</option><option value="f4">F4 / Folio</option><option value="t58">Thermal 58 mm</option><option value="t80">Thermal 80 mm</option></select></div>
        <div class="field"><label for="o-cols"><?= e(t('Columns')) ?></label>
          <select class="select select-sm" id="o-cols" data-opt="cols" data-num="1"><option value="0"><?= e(t('Auto (fit)')) ?></option><?php for ($c = 1; $c <= 8; $c++) { ?><option value="<?= $c ?>"><?= $c ?></option><?php } ?></select></div>
      </div>
      <div style="margin-top:6px"><?= $chk('land', t('Landscape')) ?></div>
      <?= $rng('scale', t('Card scale'), 50, 150, 1, '%') ?>
      <?= $rng('gap', t('Gap'), 0, 12, 0.5, ' mm') ?>
      <?= $rng('margin', t('Margin'), 0, 20, 0.5, ' mm') ?>
      <?= $chk('guides', t('Cut guides')) ?>
    </details>

    <details class="vp-sec" open>
      <summary><span><?= e(t('Fields')) ?></span></summary>
      <div class="vp-fields">
        <?= $chk('f.brand', t('Brand')) ?><?= $chk('f.logo', t('Logo')) ?>
        <?= $chk('f.profile', t('Profile')) ?><?= $chk('f.validity', t('Validity')) ?>
        <?= $chk('f.price', t('Price')) ?><?= $chk('f.pass', t('Password')) ?>
        <?= $chk('f.qr', t('QR code')) ?><?= $chk('f.dns', t('Host')) ?>
        <?= $chk('f.serial', t('Number')) ?><?= $chk('f.wifi', t('Wi-Fi network')) ?>
      </div>
      <div style="margin-top:4px"><?= $chk('group', t('Group characters (abc 123)')) ?></div>
      <p class="help"><?= e(t('The gap in a grouped code is only for reading. Copy, PNG and the QR always use the raw code.')) ?></p>
    </details>

    <details class="vp-sec" open>
      <summary><span><?= e(t('QR code')) ?></span></summary>
      <div class="field"><label for="o-qrmode"><?= e(t('Content')) ?></label>
        <select class="select select-sm" id="o-qrmode" data-opt="qrMode"><option value="login"><?= e(t('Auto-login link (username + password)')) ?></option><option value="user"><?= e(t('Login link, username only')) ?></option><option value="code"><?= e(t('Voucher code only')) ?></option></select></div>
      <div class="vp-two" style="margin-top:6px">
        <div class="field"><label for="o-ecc"><?= e(t('Error correction')) ?></label>
          <select class="select select-sm" id="o-ecc" data-opt="ecc"><option value="L">L - 7%</option><option value="M">M - 15%</option><option value="Q">Q - 25%</option><option value="H">H - 30%</option></select></div>
        <div class="field"><label for="o-qrstyle"><?= e(t('Modules')) ?></label>
          <select class="select select-sm" id="o-qrstyle" data-opt="qrStyle"><option value="square"><?= e(t('Square (sharpest)')) ?></option><option value="round"><?= e(t('Rounded')) ?></option></select></div>
      </div>
      <div style="margin-top:6px"><?= $chk('qrLogo', t('Logo in the centre of the QR')) ?></div>
      <p class="help" id="vp-ecc-note"></p>
    </details>

    <details class="vp-sec" open>
      <summary><span><?= e(t('Brand')) ?></span></summary>
      <div class="field"><label for="o-name"><?= e(t('Name on card')) ?></label><input class="input input-sm" id="o-name" data-opt="name" maxlength="60" placeholder="<?= e($hotspot) ?>"></div>
      <div class="vp-two" style="margin-top:8px">
        <div class="field"><label for="o-ssid"><?= e(t('Wi-Fi network')) ?></label><input class="input input-sm" id="o-ssid" data-opt="ssid" maxlength="32" autocomplete="off" placeholder="SSID"></div>
        <div class="field"><label for="o-wpass"><?= e(t('Wi-Fi password')) ?></label><input class="input input-sm" id="o-wpass" data-opt="wifipass" maxlength="63" autocomplete="off"></div>
      </div>
      <p class="help"><?= e(t('Shown by the Wi-Fi Card design. The password is public by design: it is printed on the card.')) ?></p>
      <div class="field" style="margin-top:8px"><label><?= e(t('Accent colour')) ?></label>
        <div class="vp-swatches"><input type="color" class="vp-color" id="vp-color" aria-label="<?= e(t('Accent colour')) ?>" data-opt="accent">
          <?php foreach ($swatches as $sw) { ?><button type="button" class="vp-sw" data-sw="<?= e($sw) ?>" style="background:<?= e($sw) ?>" aria-label="<?= e($sw) ?>" aria-pressed="false"></button><?php } ?></div></div>
      <div class="field" style="margin-top:8px"><label for="vp-logo-file"><?= e(t('Logo')) ?></label>
        <div class="row" style="gap:8px"><input type="file" id="vp-logo-file" accept="image/*" class="input input-sm" style="padding-top:4px"><img id="vp-logo-prev" class="vp-logo-prev" alt="" hidden><button type="button" class="btn btn-sm btn-icon btn-ghost" data-logo-clear aria-label="<?= e(t('Remove logo')) ?>"><?= icon('x', 16) ?></button></div>
        <p class="help"><?= e(t('Stays in this browser. Shrunk to 220 px.')) ?></p></div>
      <div style="margin-top:6px"><?= $chk('ink', t('Ink saver (black and white, no fills)')) ?></div>
    </details>

    <details class="vp-sec" open>
      <summary><span><?= e(t('Presets')) ?></span></summary>
      <div class="field"><select class="select select-sm" id="vp-preset" aria-label="<?= e(t('Presets')) ?>"></select></div>
      <div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap">
        <button class="btn btn-sm" type="button" data-preset-save><?= e(t('Save current')) ?></button>
        <?php if (Auth::can('write')) { ?><button class="btn btn-sm" type="button" data-preset-def><?= e(t('Make default')) ?></button><?php } ?>
        <button class="btn btn-sm btn-danger" type="button" data-preset-del><?= e(t('Delete')) ?></button>
      </div>
    </details>

    <details class="vp-sec" open>
      <summary><span><?= e(t('Output')) ?></span></summary>
      <div class="vp-selbar" id="vp-selbar"><span><?= e(t('Selected')) ?>: <b class="mono" id="vp-selname"></b></span><button type="button" class="btn btn-sm btn-ghost" data-clear-sel><?= e(t('Clear')) ?></button></div>
      <div class="vp-actions">
        <button class="btn btn-primary wide" type="button" data-vp-print><?= icon('printer', 16) ?><?= e(t('Print all')) ?></button>
        <button class="btn" type="button" data-print-sel><?= e(t('Print selected')) ?></button>
        <button class="btn" type="button" data-png><?= icon('download', 16) ?>PNG</button>
        <button class="btn wide" type="button" data-copy><?= e(t('Copy code')) ?></button>
      </div>
      <p class="help"><?= e(t('Click a card in the preview to select it. With no selection the first card is used. For a PDF choose Save as PDF in the print dialog.')) ?></p>
      <div class="field" style="margin-top:8px"><label for="o-tqr"><?= e(t('QR on thermal printers (RawBT / Bluetooth)')) ?></label>
        <select class="select select-sm" id="o-tqr" data-opt="tqr"><option value="native"><?= e(t('Native ESC/POS QR (fast)')) ?></option><option value="raster"><?= e(t('Image QR (older printers)')) ?></option><option value="off"><?= e(t('No QR, text only')) ?></option></select>
        <p class="help"><?= e(t('Thermal width follows the paper: 80 mm uses 48 columns, anything else 58 mm / 32 columns. Sends the selected card, or all.')) ?></p></div>
    </details>
  </aside>

  <nav class="vp-dock" aria-label="<?= e(t('Print')) ?>">
    <button class="btn btn-primary" type="button" data-vp-print><?= icon('printer', 16) ?><?= e(t('Print')) ?></button>
    <button class="btn" type="button" data-png><?= icon('download', 16) ?>PNG</button>
    <button class="btn" type="button" data-thermal-share>RawBT</button>
    <button class="btn" type="button" data-thermal-ble>BT</button>
  </nav>
</div>
<script src="<?= e(asset('/assets/js/app.js')) ?>" defer></script>
<script src="<?= e(asset('/assets/js/qr.js')) ?>" defer></script>
<script src="<?= e(asset('/assets/js/pages.js')) ?>" defer></script>
<script src="<?= e(asset('/assets/js/voucher.js')) ?>" defer></script>
</body>
</html>
