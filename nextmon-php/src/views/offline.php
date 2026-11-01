<!doctype html>
<html lang="<?= e(I18n::lang()) ?>" data-theme="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Offline - NextMON</title>
<link rel="stylesheet" href="<?= e(asset('/assets/css/app.css')) ?>">
<script src="<?= e(asset('/assets/js/theme.js')) ?>"></script>
</head>
<body>
<div class="bg" aria-hidden="true"></div>
<main class="auth-wrap">
  <div class="auth-card glass">
    <?= empty_state('wifi', t('You are offline'), t('NextMON needs a connection to your server. Reconnect and try again.'), '<a class="btn btn-primary" href="' . e(url('/')) . '">' . e(t('Retry')) . '</a>') ?>
  </div>
</main>
</body>
</html>
