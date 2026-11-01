<?php
// Re-runnable: dumps the PHP edition's id dictionary (lang/id.php + lang/id.d/*.php) to src/i18n/id.json.
// usage: php scripts/port-lang.php   (needs PHP only for this one-off port; the Next app itself never runs PHP)
$root = dirname(__DIR__, 2) . '/nextmon-php/lang';
$d = (array)require $root . '/id.php';
foreach (glob($root . '/id.d/*.php') ?: [] as $f) { $d = array_merge($d, (array)require $f); }
ksort($d);
file_put_contents(__DIR__ . '/../src/i18n/id.json', json_encode($d, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT) . "\n");
echo count($d), " keys\n";
