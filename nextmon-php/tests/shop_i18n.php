<?php
/** Lists t('...') strings used by the shop module that have no entry in lang/id.php or lang/id.d/*.php. Run: php tests/shop_i18n.php */
$root = dirname(__DIR__);
$dict = require $root . '/lang/id.php';
foreach (glob($root . '/lang/id.d/*.php') as $f) {
    $dict = array_merge($dict, require $f);
}
$files = array_merge(glob($root . '/src/Payment*.php'), [$root . '/src/Shop.php', $root . '/src/Orders.php', $root . '/src/Controllers/ShopController.php', $root . '/src/Controllers/OrdersController.php', $root . '/src/nav.d/shop.php'], glob($root . '/src/views/shop*.php'), glob($root . '/src/views/orders*.php'));
$missing = [];
foreach ($files as $f) {
    preg_match_all("/\bt\('((?:[^'\\\\]|\\\\.)*)'/", (string)file_get_contents($f), $m);
    foreach ($m[1] as $k) {
        $k = stripslashes($k);
        if (!isset($dict[$k])) {
            $missing[$k] = basename($f);
        }
    }
}
foreach (['Online orders', 'Shop settings'] as $k) { // nav labels are translated by the layout
    if (!isset($dict[$k])) {
        $missing[$k] = 'nav.d/shop.php';
    }
}
foreach ($missing as $k => $f) {
    echo "MISSING [$f] $k\n";
}
echo count($missing) . " missing\n";
