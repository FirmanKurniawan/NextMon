<?php
/** App shell. Vars: $content, $title, $page */
$user = Auth::user();
$routers = App::routers();
$curId = App::currentRouterId();
$flash = App::takeFlash();
$groupName = '';
foreach (nav_items() as $g) {
    foreach ($g['items'] as $it) {
        if ($it[0] === $page) {
            $groupName = $g['group'];
        }
    }
}
$curName = '';
foreach ($routers as $r) {
    if ($r['id'] === $curId) {
        $curName = (string)$r['name'];
    }
}
$back = App::path() . (($_SERVER['QUERY_STRING'] ?? '') !== '' ? '?' . $_SERVER['QUERY_STRING'] : '');
$tabKeys = ['dashboard', 'users', Auth::can('sell') ? 'vouchers' : 'active', 'reports'];
$renderNav = function (bool $withTitles) use ($page) {
    foreach (nav_items() as $g) {
        $items = array_filter($g['items'], fn($i) => Auth::can($i[4]));
        if (!$items) {
            continue;
        }
        if ($withTitles) {
            echo '<div class="nav-title">' . e(t($g['group'])) . '</div>';
        }
        foreach ($items as $i) {
            echo '<a class="nav-link" href="' . e(url($i[1])) . '" data-key="' . e($i[0]) . '" aria-label="' . e(t($i[3])) . '"' . ($i[0] === $page ? ' aria-current="page"' : '') . '>' . icon($i[2], 18) . '<span class="nav-label">' . e(t($i[3])) . '</span></a>';
        }
    }
};
?><!doctype html>
<html lang="<?= e(I18n::lang()) ?>" data-theme="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title><?= e($title ? $title . ' - NextMON' : 'NextMON') ?></title>
<meta name="theme-color" content="#eaeff3" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#090f15" media="(prefers-color-scheme: dark)">
<link rel="manifest" href="<?= e(url('/manifest.webmanifest')) ?>">
<link rel="icon" href="<?= e(url('/assets/icon.svg')) ?>" type="image/svg+xml">
<link rel="icon" href="<?= e(url('/assets/icons/favicon.ico')) ?>" sizes="32x32 16x16">
<link rel="apple-touch-icon" href="<?= e(url('/assets/icons/apple-touch-icon.png')) ?>">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="NextMON">
<link rel="stylesheet" href="<?= e(asset('/assets/css/app.css')) ?>">
<script src="<?= e(asset('/assets/js/theme.js')) ?>"></script>
</head>
<body data-page="<?= e($page) ?>" data-base="<?= e(App::$base) ?>" data-csrf="<?= e(Auth::csrf()) ?>" data-lang="<?= e(I18n::lang()) ?>" data-demo="<?= App::isDemo() ? '1' : '0' ?>">
<a class="skip" href="#main"><?= e(t('Skip to content')) ?></a>
<div class="bg" aria-hidden="true"></div>
<div class="app">
  <aside class="sidebar glass" id="sidebar" aria-label="<?= e(t('Main navigation')) ?>">
    <a class="brand" href="<?= e(url('/')) ?>"><span class="brand-mark"><?= brand_mark(18) ?></span><span>NextMON</span></a>
    <nav><?php $renderNav(true); ?></nav>
    <?php if ($curName !== '') { ?><div class="sb-foot"><span class="live-dot" aria-hidden="true"></span><b><?= e($curName) ?></b></div><?php } ?>
  </aside>

  <div class="shell">
    <header class="topbar glass">
      <button class="btn btn-ghost btn-icon menu-btn" type="button" data-drawer-open aria-label="<?= e(t('Open menu')) ?>"><?= icon('menu') ?></button>
      <button class="btn btn-ghost btn-icon hide-m" type="button" data-sidebar-toggle aria-label="<?= e(t('Collapse sidebar')) ?>"><?= icon('sidebar') ?></button>
      <div class="crumbs"><span class="hide-m">NextMON</span><?php if ($groupName) { ?><span class="hide-m sep">/</span><span class="hide-m"><?= e(t($groupName)) ?></span><span class="hide-m sep">/</span><?php } ?><b><?= e($title) ?></b></div>
      <div class="spacer"></div>
      <button class="btn btn-sm" type="button" data-palette-open aria-keyshortcuts="Control+K" aria-label="<?= e(t('Search') . ' Ctrl K') ?>"><?= icon('search', 16) ?><span class="hide-m"><?= e(t('Search')) ?></span> <kbd class="hide-m">Ctrl K</kbd></button>
      <?php if (count($routers) > 0) { ?>
      <form method="post" action="<?= e(url('/routers/select')) ?>" class="row" style="flex-wrap:nowrap">
        <?= csrf_field() ?><input type="hidden" name="back" value="<?= e($back) ?>">
        <label class="sr-only" for="router-sel"><?= e(t('Router')) ?></label>
        <select id="router-sel" name="router" class="select select-sm" data-autosubmit style="max-width:170px">
          <?php foreach ($routers as $r) { ?><option value="<?= e($r['id']) ?>"<?= sel($r['id'], $curId) ?>><?= e($r['name']) ?><?= ($r['type'] ?? '') === 'demo' ? ' (demo)' : '' ?></option><?php } ?>
        </select>
        <noscript><button class="btn btn-sm"><?= e(t('Go')) ?></button></noscript>
      </form>
      <?php } ?>
      <?php if (Auth::can('admin')) { ?><a class="btn btn-ghost btn-icon hide-m" href="<?= e(url('/notifications')) ?>" aria-label="<?= e(t('Notifications')) ?>" data-tip="<?= e(t('Notifications')) ?>"><?= icon('bell') ?></a><?php } ?>
      <details class="menu">
        <summary class="btn btn-ghost btn-icon" aria-label="<?= e(t('Account')) ?>"><span class="avatar"><?= e(strtoupper(substr($user['username'] ?? '?', 0, 1))) ?></span></summary>
        <div class="menu-pop">
          <div class="who"><span class="avatar"><?= e(strtoupper(substr($user['username'] ?? '?', 0, 1))) ?></span><div><b><?= e($user['username'] ?? '') ?></b><span><?= e(Auth::roleLabel($user['role'] ?? 'viewer')) ?></span></div></div>
          <hr>
          <div class="opt"><span class="lbl" style="padding:0"><?= e(t('Theme')) ?></span>
            <div class="seg" role="group" aria-label="<?= e(t('Theme')) ?>">
              <button type="button" data-theme-set="light" aria-pressed="false" aria-label="<?= e(t('Light')) ?>"><?= icon('sun', 16) ?></button>
              <button type="button" data-theme-set="auto" aria-pressed="false"><?= e(t('Auto')) ?></button>
              <button type="button" data-theme-set="dark" aria-pressed="false" aria-label="<?= e(t('Dark')) ?>"><?= icon('moon', 16) ?></button>
            </div></div>
          <div class="lbl"><?= e(t('Accent')) ?></div>
          <div class="swatches" role="group" aria-label="<?= e(t('Accent')) ?>">
            <?php foreach (['teal', 'blue', 'violet', 'emerald', 'rose'] as $ac) { ?><button type="button" class="swatch" data-accent-set="<?= $ac ?>" aria-pressed="false" aria-label="<?= e(t(ucfirst($ac))) ?>" data-tip="<?= e(t(ucfirst($ac))) ?>"></button><?php } ?>
          </div>
          <div class="opt"><span class="lbl" style="padding:0"><?= e(t('Density')) ?></span>
            <div class="seg" role="group" aria-label="<?= e(t('Density')) ?>">
              <button type="button" data-density-set="compact" aria-pressed="false"><?= e(t('Compact')) ?></button>
              <button type="button" data-density-set="comfortable" aria-pressed="false"><?= e(t('Comfortable')) ?></button>
            </div></div>
          <div class="opt"><span class="lbl" style="padding:0"><?= e(t('Language')) ?></span>
            <div class="seg" role="group" aria-label="<?= e(t('Language')) ?>">
              <a href="<?= e(url('/lang?l=id&back=' . rawurlencode($back))) ?>" <?= I18n::lang() === 'id' ? 'aria-current="true"' : '' ?>>ID</a>
              <a href="<?= e(url('/lang?l=en&back=' . rawurlencode($back))) ?>" <?= I18n::lang() === 'en' ? 'aria-current="true"' : '' ?>>EN</a>
            </div></div>
          <hr>
          <a class="item" href="<?= e(url('/settings')) ?>#account"><?= icon('user', 16) ?><?= e(t('My account')) ?></a>
          <a class="item" href="<?= e(url('/status')) ?>" target="_blank" rel="noopener"><?= icon('ticket', 16) ?><?= e(t('Voucher status page')) ?></a>
          <button class="item hide-m" type="button" data-help-open><?= icon('key', 16) ?><?= e(t('Show shortcuts')) ?><kbd style="margin-left:auto">?</kbd></button>
          <form method="post" action="<?= e(url('/logout')) ?>"><?= csrf_field() ?><button class="item" type="submit"><?= icon('logout', 16) ?><?= e(t('Sign out')) ?></button></form>
        </div>
      </details>
    </header>

    <main id="main" class="content" tabindex="-1">
      <?php /* MULTITENANT-BANNER (core hook; the account/platform agent may restyle). App::$impersonating = platform admin inside someone else's workspace. */ ?>
      <?php if (App::$impersonating) { ?>
      <div class="alert warn impersonation-banner" role="alert" style="margin-bottom:var(--s4)"><?= icon('alert', 18) ?><div><?= e(t('Platform mode: you are working inside workspace :w. Every action is recorded in its audit log.', [':w' => (string)(Workspace::get(Workspace::id())['name'] ?? Workspace::id())])) ?>
        <form method="post" action="<?= e(url('/platform/switch')) ?>" style="display:inline"><?= csrf_field() ?><input type="hidden" name="workspace" value="home"><button class="btn btn-sm" type="submit"><?= e(t('Back to my workspace')) ?></button></form></div></div>
      <?php } ?>
      <?php /* /MULTITENANT-BANNER */ ?>
      <?php if (App::isDemo()) { ?>
      <div class="alert info" style="margin-bottom:var(--s4)" role="note"><?= icon('alert', 18) ?><div><?= e(t('Demo mode: data on this router is simulated. Add a real MikroTik under Routers to manage a device.')) ?></div></div>
      <?php } ?>
      <noscript><div class="alert warn"><?= e(t('JavaScript is disabled; live charts and some controls will not work.')) ?></div></noscript>
      <?php foreach ($flash as $f) { ?><div class="alert <?= $f[0] === 'err' ? 'err' : 'info' ?> no-js-only" data-flash="<?= e($f[0]) ?>" role="status"><?= e($f[1]) ?></div><?php } ?>
      <?= $content ?>
    </main>
  </div>
</div>

<nav class="tabbar glass" aria-label="<?= e(t('Quick navigation')) ?>">
  <?php foreach (nav_items() as $g) { foreach ($g['items'] as $i) { if (in_array($i[0], $tabKeys, true) && Auth::can($i[4])) { ?>
    <a class="tab" href="<?= e(url($i[1])) ?>"<?= $i[0] === $page ? ' aria-current="page"' : '' ?>><?= icon($i[2], 22) ?><span><?= e(t($i[3] === 'Quick sell (POS)' ? 'POS' : $i[3])) ?></span></a>
  <?php } } } ?>
  <button class="tab" type="button" data-drawer-open><?= icon('menu', 22) ?><span><?= e(t('Menu')) ?></span></button>
</nav>

<div class="drawer" id="drawer" aria-hidden="true">
  <div class="drawer-bg" data-drawer-close></div>
  <div class="drawer-panel glass" role="dialog" aria-modal="true" aria-label="<?= e(t('Menu')) ?>">
    <div class="row" style="justify-content:space-between"><a class="brand" href="<?= e(url('/')) ?>"><span class="brand-mark"><?= brand_mark(18) ?></span><span>NextMON</span></a>
      <button class="btn btn-ghost btn-icon" type="button" data-drawer-close aria-label="<?= e(t('Close')) ?>"><?= icon('x') ?></button></div>
    <nav><?php $renderNav(true); ?></nav>
  </div>
</div>

<div class="toasts" id="toasts" aria-live="polite" aria-atomic="false"></div>

<dialog class="modal palette glass" id="palette" aria-label="<?= e(t('Command palette')) ?>">
  <input class="pal-input" id="pal-input" type="text" placeholder="<?= e(t('Type a command or page name...')) ?>" autocomplete="off" aria-controls="pal-list">
  <ul class="pal-list" id="pal-list" role="listbox"></ul>
</dialog>

<dialog class="modal" id="confirm-dlg" aria-labelledby="confirm-title">
  <div class="modal-h"><h2 id="confirm-title"><?= e(t('Please confirm')) ?></h2></div>
  <div class="modal-b"><p id="confirm-msg"></p></div>
  <div class="modal-f"><button class="btn" type="button" data-confirm-no><?= e(t('Cancel')) ?></button><button class="btn btn-danger" type="button" data-confirm-yes><?= e(t('Confirm')) ?></button></div>
</dialog>

<?php
$jsStr = ['Close', 'Command palette', 'Focus search', 'Toggle sidebar', 'Show shortcuts', 'Select range', 'Go to', 'This page', 'Appearance', 'Recent', 'Accent', 'Density', 'Compact', 'Comfortable',
    'A new version of NextMON is ready.', 'Sent', 'received', 'loss', 'Host', 'Time', 'TTL', 'Size', 'timeout', 'Hop', 'Address', 'Loss %', 'Last', 'Avg', 'Best', 'Worst', 'Source', 'Destination', 'Proto', 'Port', 'TX', 'RX', 'Topics', 'Message', 'Identity', 'Board', 'RouterOS', 'Uptime', 'CPU load', 'Memory', 'Temperature', 'CPU temperature', 'Voltage', 'Auto', 'Light', 'Dark', 'Update', 'Web Bluetooth is not supported in this browser (use Chrome on Android/desktop over HTTPS).', 'Popup blocked', 'BarcodeDetector / camera not supported in this browser. Use Chrome on Android or desktop (HTTPS).', 'Account', 'Refresh data', 'Rows', 'All', 'Columns', 'General', 'Navigate', 'Select', 'Shortcuts'];
$jsDict = ['copied' => t('Copied'), 'error' => t('Something went wrong'), 'confirm' => t('Are you sure?'), 'selected' => t(':n selected'),
    'theme' => t('Toggle theme'), 'lang' => t('Switch language'), 'logout' => t('Sign out'), 'nodata' => t('No data'), 'offline' => t('You are offline'),
    'pages' => t('Pages'), 'actions' => t('Actions'), 'noresult' => t('No results'),
    'close' => t('Close'), 'rows' => t('rows'), 'all' => t('All'), 'columns' => t('Columns'), 'shortcuts' => t('Keyboard shortcuts'), 'general' => t('General'), 'navigate' => t('Navigate'), 'select' => t('Select')];
foreach ($jsStr as $p) {
    $jsDict[$p] = t($p);
}
?>
<script type="application/json" id="i18n"><?= json_encode($jsDict, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP) ?></script>
<?php // FRONTEND-PERF: page-specific scripts only (charts: canvases on dashboard/reports; qr: pos/vouchers/templates or any [data-qr]; pages.js: pages with a P.<page> initialiser)
$needCharts = in_array($page, ['dashboard', 'reports'], true);
$needQr = in_array($page, ['pos', 'vouchers', 'templates'], true) || strpos((string)$content, 'data-qr') !== false;
$needPages = in_array($page, ['dashboard', 'routers', 'profiles', 'vouchers', 'templates', 'reports', 'pos', 'tools'], true);
?>
<script src="<?= e(asset('/assets/js/app.js')) ?>" defer></script>
<?php if ($needCharts) { ?><script src="<?= e(asset('/assets/js/charts.js')) ?>" defer></script>
<?php } if ($needQr) { ?><script src="<?= e(asset('/assets/js/qr.js')) ?>" defer></script>
<?php } if ($needPages) { ?><script src="<?= e(asset('/assets/js/pages.js')) ?>" defer></script>
<?php } ?>
</body>
</html>
