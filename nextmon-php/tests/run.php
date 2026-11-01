<?php
/**
 * Minimal test runner (no composer).   php tests/run.php [filter]
 * Runs tests/unit/*Test.php; each file registers cases with test('name', fn).
 */
require __DIR__ . '/bootstrap.php';

$filter = $argv[1] ?? '';
$pass = $fail = 0;
$failures = [];
set_error_handler(function ($no, $str, $file, $line) {
    if (!(error_reporting() & $no)) {
        return false;
    }
    throw new ErrorException($str, 0, $no, $file, $line);
});

foreach (glob(__DIR__ . '/unit/*Test.php') ?: [] as $file) {
    if ($filter !== '' && stripos(basename($file), $filter) === false) {
        continue;
    }
    $GLOBALS['__tests'] = [];
    require $file;
    $suite = basename($file, 'Test.php');
    echo "\n$suite\n";
    foreach ($GLOBALS['__tests'] as [$name, $fn]) {
        if (getenv('NEXTMON_TEST_ONLY') && stripos($name, (string)getenv('NEXTMON_TEST_ONLY')) === false) {
            continue;   // run a single case: NEXTMON_TEST_ONLY="substring of the test name"
        }
        $t = microtime(true);
        try {
            $fn();
            $pass++;
            printf("  PASS  %s (%d ms)\n", $name, (microtime(true) - $t) * 1000);
        } catch (Throwable $e) {
            $fail++;
            $failures[] = "$suite :: $name\n    " . get_class($e) . ': ' . $e->getMessage() . ' @ ' . basename($e->getFile()) . ':' . $e->getLine();
            printf("  FAIL  %s\n", $name);
        } finally {
            Store::reset();
            Workspace::set('main');
            putenv('NEXTMON_DATA=' . str_replace(chr(92), '/', $GLOBALS['__nextmon_tmp_root']) . '/default');
            putenv('NEXTMON_STORAGE=');
        }
    }
}
echo "\n";
foreach ($failures as $f) {
    echo "FAILED: $f\n";
}
echo "\nTests: " . ($pass + $fail) . "  Passed: $pass  Failed: $fail\n";
exit($fail ? 1 : 0);
