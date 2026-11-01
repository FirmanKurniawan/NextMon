<?php /** Shared public shop frame (top). Vars: $title, $c, optional $refresh (bool: noscript meta refresh) */ ?><!doctype html>
<html lang="<?= e(I18n::lang()) ?>" data-theme="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title><?= e($title) ?></title>
<meta name="robots" content="noindex">
<meta name="theme-color" content="#0b7285">
<link rel="icon" href="<?= e(url('/assets/icon.svg')) ?>" type="image/svg+xml">
<link rel="stylesheet" href="<?= e(asset('/assets/css/app.css')) ?>">
<link rel="stylesheet" href="<?= e(asset('/assets/css/mod-shop.css')) ?>">
<script src="<?= e(asset('/assets/js/theme.js')) ?>"></script>
<?php if (!empty($refresh)) { ?><noscript><meta http-equiv="refresh" content="10"></noscript><?php } ?>
</head>
<body class="shp">
<div class="bg" aria-hidden="true"></div>
<main class="shp-wrap">
  <header class="shp-head">
    <a class="shp-brand" href="<?= e(url(Shop::homePath())) ?>"><span class="brand-mark"><?= brand_mark(18) ?></span><span><?= e($title) ?></span></a>
    <button class="btn btn-ghost btn-icon btn-sm" type="button" data-shp-theme aria-label="<?= e(t('Toggle theme')) ?>"><?= icon('moon', 18) ?></button>
  </header>
