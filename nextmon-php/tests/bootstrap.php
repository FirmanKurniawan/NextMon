<?php
/** Test bootstrap: isolated data dir, no demo forcing, CLI-safe app init. */
error_reporting(E_ALL);
ini_set('display_errors', '1');
$GLOBALS['__nextmon_tmp_root'] = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'nextmon-test-' . getmypid() . '-' . bin2hex(random_bytes(3));
@mkdir($GLOBALS['__nextmon_tmp_root'], 0775, true);
putenv('NEXTMON_DATA=' . str_replace(chr(92), '/', $GLOBALS['__nextmon_tmp_root']) . '/default');
putenv('NEXTMON_DEMO=');
putenv('NEXTMON_STORAGE=');
require dirname(__DIR__) . '/src/App.php';
App::init();
// multi-tenant: per-workspace collections need an active workspace. Tests run as workspace "main" unless they say otherwise
// (tests/unit/TenantTest.php covers the fail-closed behaviour with Workspace::clear()).
Workspace::set('main');

register_shutdown_function(function () {
    Store::reset();
    rrmdir($GLOBALS['__nextmon_tmp_root']);
});

function tmpdir(string $label = 't'): string
{
    $d = str_replace(chr(92), '/', $GLOBALS['__nextmon_tmp_root']) . '/' . $label . '-' . bin2hex(random_bytes(3));
    mkdir($d, 0775, true);
    return $d;
}

/** Point Store at a fresh data dir (and optionally a backend) */
function fresh_store(string $backend = ''): string
{
    Store::reset();
    $d = tmpdir('data');
    putenv('NEXTMON_DATA=' . $d);
    putenv('NEXTMON_STORAGE=' . $backend);
    return $d;
}

function rrmdir(string $d): void
{
    if (!is_dir($d)) {
        return;
    }
    foreach (scandir($d) ?: [] as $f) {
        if ($f === '.' || $f === '..') {
            continue;
        }
        $p = $d . '/' . $f;
        is_dir($p) && !is_link($p) ? rrmdir($p) : @unlink($p);
    }
    @rmdir($d);
}

// ---- mini test framework ----------------------------------------------------------------

class AssertFail extends Exception
{
}

$GLOBALS['__tests'] = [];

function test(string $name, callable $fn): void
{
    $GLOBALS['__tests'][] = [$name, $fn];
}

function ok($cond, string $msg = 'assertion failed'): void
{
    if (!$cond) {
        throw new AssertFail($msg);
    }
}

function eq($expected, $actual, string $msg = ''): void
{
    if ($expected !== $actual) {
        throw new AssertFail(($msg ? $msg . ': ' : '') . 'expected ' . var_export($expected, true) . ', got ' . var_export($actual, true));
    }
}

function throws(callable $fn, string $class = Throwable::class, string $msg = 'expected exception'): Throwable
{
    try {
        $fn();
    } catch (Throwable $e) {
        if ($e instanceof AssertFail) {
            throw $e;
        }
        if (!$e instanceof $class) {
            throw new AssertFail($msg . ': got ' . get_class($e) . ' ' . $e->getMessage());
        }
        return $e;
    }
    throw new AssertFail($msg . ' (nothing thrown)');
}
