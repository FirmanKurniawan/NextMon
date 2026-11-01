<?php
/**
 * i18n audit.   php tests/i18n_audit.php [--strict] [--hard]
 *  1. extracts every t('literal') key used in src/ (+ nav.d labels, layout $jsStr) and diffs against lang/id.php + lang/id.d/*.php
 *  2. lists dictionary keys that are not referenced anywhere (possible orphans; dynamic keys are false positives)
 *  3. placeholder (:n) parity, conflicting duplicate keys across files
 *  4. --hard: heuristic list of hard-coded English text nodes / attributes in views (not wrapped in t()) and in JS
 * Exit code 1 with --strict when keys are missing. (en.php is empty: English is the source language, so parity = every used key exists in id.)
 */
$root = dirname(__DIR__);
$dict = require $root . '/lang/id.php';
foreach (glob($root . '/lang/id.d/*.php') ?: [] as $f) {
    $d = require $f;
    foreach ($d as $k => $_) {
        if (isset($dict[$k]) && $dict[$k] !== $d[$k]) {
            echo 'CONFLICT (later file overrides): ' . json_encode($k) . ' => ' . json_encode($dict[$k], JSON_UNESCAPED_UNICODE) . ' vs ' . json_encode($d[$k], JSON_UNESCAPED_UNICODE) . ' [' . basename($f) . "]\n";
        }
    }
    $dict = array_merge($dict, $d);
}
$files = [];
$it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root . '/src', FilesystemIterator::SKIP_DOTS));
foreach ($it as $f) {
    if ($f->getExtension() === 'php') {
        $files[] = $f->getPathname();
    }
}
foreach (['/cron.php', '/public/index.php', '/public/cron.php'] as $x) {
    if (is_file($root . $x)) {
        $files[] = $root . $x;
    }
}
$used = [];
$re1 = <<<'RX'
/(?<![\w>:$])t\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\$]|\\.)*)")/s
RX;
foreach ($files as $f) {
    $src = file_get_contents($f);
    if (preg_match_all($re1, $src, $m, PREG_SET_ORDER)) {
        foreach ($m as $x) {
            $k = ($x[1] ?? '') !== '' ? str_replace(["\\'", '\\\\'], ["'", '\\'], $x[1]) : stripcslashes($x[2] ?? '');
            $used[$k][] = str_replace($root . DIRECTORY_SEPARATOR, '', $f);
        }
    }
}
// nav.d items: ['key','/url','icon','Label','cap'] and group names are translated dynamically in the layout
$reNav = <<<'RX'
/\[\s*'[\w-]+'\s*,\s*'\/[^']*'\s*,\s*'[\w-]+'\s*,\s*'((?:[^'\\]|\\.)*)'\s*,\s*'\w+'\s*\]/
RX;
$reGroup = <<<'RX'
/'group'\s*=>\s*'((?:[^'\\]|\\.)*)'/
RX;
$navFiles = array_merge(glob($root . '/src/nav.d/*.php') ?: [], [$root . '/src/helpers.php']);
foreach ($navFiles as $f) {
    $src = file_get_contents($f);
    foreach ([$reNav, $reGroup] as $re) {
        if (preg_match_all($re, $src, $m)) {
            foreach ($m[1] as $k) {
                $used[stripslashes($k)][] = basename($f) . '(nav)';
            }
        }
    }
}
$lay = file_get_contents($root . '/src/views/layout.php');
if (preg_match('/\$jsStr = \[(.*?)\];/s', $lay, $m) && preg_match_all("/'((?:[^'\\\\]|\\\\.)*)'/", $m[1], $mm)) {
    foreach ($mm[1] as $k) {
        $used[stripslashes($k)][] = 'layout.php($jsStr)';
    }
}
$missing = [];
foreach ($used as $k => $where) {
    if ($k === '' || isset($dict[$k]) || !preg_match('/[A-Za-z]{2}/', $k)) {
        continue;
    }
    $missing[$k] = array_values(array_unique($where));
}
ksort($missing);
echo 'keys used: ' . count($used) . '   dictionary entries: ' . count($dict) . "\n";
echo "\n== MISSING in Indonesian dictionary (" . count($missing) . ") ==\n";
foreach ($missing as $k => $w) {
    echo '  ' . json_encode($k, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . '   <- ' . $w[0] . (count($w) > 1 ? ' +' . (count($w) - 1) : '') . "\n";
}
$orph = array_diff_key($dict, $used);
$blob = '';
foreach (array_merge($files, glob($root . '/public/assets/js/*.js') ?: []) as $f) {
    $blob .= file_get_contents($f) . "\n";
}
$orph = array_filter($orph, fn($v, $k) => strpos($blob, $k) === false && strpos($blob, addslashes($k)) === false, ARRAY_FILTER_USE_BOTH);
echo "\n== Dictionary keys with no reference found (" . count($orph) . ", may be dynamic) ==\n";
foreach (array_keys($orph) as $k) {
    echo '  ' . json_encode($k, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n";
}
echo "\n== Placeholder mismatches ==\n";
$bad = 0;
foreach ($dict as $k => $v) {
    preg_match_all('/:[a-z_]+/', $k, $a);
    preg_match_all('/:[a-z_]+/', (string)$v, $b);
    sort($a[0]);
    sort($b[0]);
    if ($a[0] !== $b[0]) {
        echo '  ' . json_encode($k) . ' => ' . json_encode($v, JSON_UNESCAPED_UNICODE) . "\n";
        $bad++;
    }
}
echo $bad ? '' : "  none\n";
if (in_array('--hard', $argv, true)) {
    echo "\n== Hard-coded English in views (heuristic) ==\n";
    foreach (glob($root . '/src/views/*.php') as $f) {
        foreach (file($f) as $i => $ln) {
            $s = preg_replace('/<\?(?:=|php).*?\?>/s', '', $ln);
            if (preg_match_all('/>([^<>{}]*[A-Za-z]{3,}[^<>{}]*)</', $s, $m)) {
                foreach ($m[1] as $txt) {
                    $txt = trim(html_entity_decode($txt));
                    if ($txt !== '' && preg_match('/[A-Za-z]{3,}/', $txt) && !preg_match('/^[\w.\/:%#-]+$/', $txt)) {
                        echo '  ' . basename($f) . ':' . ($i + 1) . '  ' . $txt . "\n";
                    }
                }
            }
            if (preg_match_all('/\b(?:placeholder|title|aria-label|alt)="([^"<>]*[A-Za-z]{3,}[^"<>]*)"/', $s, $m)) {
                foreach ($m[1] as $txt) {
                    echo '  ' . basename($f) . ':' . ($i + 1) . '  @attr ' . $txt . "\n";
                }
            }
        }
    }
    echo "\n== Hard-coded strings in JS (toast / textContent / placeholder / confirm literals; heuristic) ==\n";
    $reJs = <<<'RX'
/(?:K\.toast\(|\.textContent\s*=\s*|\.placeholder\s*=\s*|setAttribute\('(?:aria-label|title)',\s*|alert\(|confirm\()\s*('[^']*[A-Za-z]{3,}[^']*'|"[^"]*[A-Za-z]{3,}[^"]*")/
RX;
    foreach (glob($root . '/public/assets/js/*.js') as $f) {
        if (in_array(basename($f), ['sw.js', 'offline.js'], true) || strpos(basename($f), 'zz-') === 0) {
            continue;
        }
        foreach (file($f) as $i => $ln) {
            if (preg_match_all($reJs, $ln, $m)) {
                foreach ($m[1] as $s) {
                    echo '  ' . basename($f) . ':' . ($i + 1) . '  ' . $s . "\n";
                }
            }
        }
    }
}
exit(in_array('--strict', $argv, true) && $missing ? 1 : 0);
