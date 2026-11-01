<?php /** Public voucher status. Vars: $session $user $res $err $cfg */
$labels = ['new' => ['Unused', 'neutral'], 'online' => ['Online now', 'ok'], 'used' => ['Used', 'info'], 'expired' => ['Expired', 'warn'], 'disabled' => ['Disabled', 'err']];
$brand = (string)(($cfg['hotspot_name'] ?? '') ?: 'NextMON');
?><!doctype html>
<html lang="<?= e(I18n::lang()) ?>" data-theme="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= e(t('Voucher status')) ?></title>
<meta name="robots" content="noindex">
<link rel="stylesheet" href="<?= e(asset('/assets/css/app.css')) ?>">
<link rel="stylesheet" href="<?= e(asset('/assets/css/voucher.css')) ?>">
<script src="<?= e(asset('/assets/js/theme.js')) ?>"></script>
</head>
<body>
<main class="st-wrap">
  <div class="st-card glass">
    <div class="st-head"><span class="brand-mark"><?= brand_mark(18) ?></span><span class="st-brand"><?= e($brand) ?></span></div>
    <h1><?= e(t('Check voucher status')) ?></h1>
    <p class="muted" style="margin:0 0 var(--s4)"><?= e(t('Enter your voucher code to see the remaining time.')) ?></p>
    <form method="get" action="<?= e(url('/status')) ?>" class="stack">
      <?php if ($session === '' || !$cfg) { ?>
        <div class="field"><label for="s-sess"><?= e(t('Session name')) ?></label><input class="input mono" id="s-sess" name="session" value="<?= e($session) ?>" required></div>
      <?php } else { ?><input type="hidden" name="session" value="<?= e($session) ?>"><?php } ?>
      <div class="field"><label for="s-user"><?= e(t('Voucher code')) ?></label><input class="input mono" id="s-user" name="user" value="<?= e($user) ?>" required autocapitalize="off" autocomplete="off" autofocus></div>
      <button class="btn btn-primary btn-lg"><?= e(t('Check')) ?></button>
    </form>
    <?php if ($err) { ?><div class="alert err" role="alert" style="margin-top:var(--s4)"><?= icon('alert', 18) ?><div><?= e($err) ?></div></div><?php } ?>
    <?php if ($res) { [$l, $k] = $labels[$res['status']] ?? [$res['status'], 'neutral'];
        $limit = !in_array($res['limit_uptime'] ?? '', ['', '0s', '1s'], true) ? $res['limit_uptime'] : '-'; ?>
    <div class="st-res">
      <div class="st-top"><b class="st-code"><?= e($res['user']) ?></b><?= badge(t($l), $k) ?></div>
      <div class="st-grid">
        <div><small><?= e(t('Profile')) ?></small><b><?= e($res['profile']) ?></b></div>
        <div><small><?= e(t('Time left')) ?></small><b><?= e($res['time_left'] ?: '-') ?></b></div>
        <div><small><?= e(t('Expires')) ?></small><b><?= e($res['expires'] ?: '-') ?></b></div>
        <div><small><?= e(t('Time used')) ?></small><b><?= e($res['uptime']) ?></b></div>
        <div><small><?= e(t('Time limit')) ?></small><b><?= e($limit) ?></b></div>
        <div><small><?= e(t('Data used')) ?></small><b><?= e(fmt_bytes($res['bytes_in'] + $res['bytes_out'])) ?></b></div>
      </div>
    </div>
    <?php } ?>
  </div>
</main>
</body>
</html>
