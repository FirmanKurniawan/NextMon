<?php /** Vars: $mode (login|setup), $error, $val */ $setup = $mode === 'setup'; ?><!doctype html>
<html lang="<?= e(I18n::lang()) ?>" data-theme="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title><?= e($setup ? t('Create admin account') : t('Sign in')) ?> - NextMON</title>
<meta name="theme-color" content="#0b7285">
<link rel="manifest" href="<?= e(url('/manifest.webmanifest')) ?>">
<link rel="icon" href="<?= e(url('/assets/icon.svg')) ?>" type="image/svg+xml">
<link rel="stylesheet" href="<?= e(asset('/assets/css/app.css')) ?>">
<script src="<?= e(asset('/assets/js/theme.js')) ?>"></script>
</head>
<body data-base="<?= e(App::$base) ?>">
<div class="bg" aria-hidden="true"></div>
<main class="auth-wrap">
  <form class="auth-card glass" method="post" action="<?= e(url($setup ? '/setup' : '/login')) ?>" autocomplete="on">
    <?= csrf_field() ?>
    <div class="brand" style="padding:0"><span class="brand-mark"><?= brand_mark(22) ?></span><span>NextMON</span></div>
    <h1><?= e($setup ? t('Create admin account') : t('Sign in')) ?></h1>
    <p class="muted" style="margin-bottom:var(--s5)"><?= e($setup ? t('First run: choose the administrator credentials. There is no default password.') : t('Manage your MikroTik hotspot.')) ?></p>
    <?php if ($error) { ?><div class="alert err" role="alert" style="margin-bottom:var(--s4)"><?= icon('alert', 18) ?><div><?= e($error) ?></div></div><?php } ?>
    <?php if (App::demoForced() || (!$setup && App::isDemo())) { ?><div class="alert info" style="margin-bottom:var(--s4)"><?= e(t('Demo mode is on: a simulated router is used.')) ?></div><?php } ?>
    <div class="stack">
      <div class="field"><label for="u"><?= e(t('Username')) ?></label><input class="input" id="u" name="username" value="<?= e($val) ?>" autocomplete="username" required autofocus></div>
      <div class="field"><label for="p"><?= e(t('Password')) ?></label><input class="input" id="p" type="password" name="password" autocomplete="<?= $setup ? 'new-password' : 'current-password' ?>" required <?= $setup ? 'minlength="8"' : '' ?>></div>
      <?php if ($setup) { ?><div class="field"><label for="p2"><?= e(t('Repeat password')) ?></label><input class="input" id="p2" type="password" name="password2" autocomplete="new-password" required minlength="8"><p class="help"><?= e(t('At least 8 characters.')) ?></p></div><?php } ?>
      <button class="btn btn-primary btn-lg" type="submit"><?= e($setup ? t('Create account') : t('Sign in')) ?></button>
    </div>
  </form>
</main>
</body>
</html>
