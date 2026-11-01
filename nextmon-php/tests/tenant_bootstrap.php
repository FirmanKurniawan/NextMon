<?php
/**
 * Child process for tenant_isolation_test.php: talks to the PHP core directly (same NEXTMON_DATA as the HTTP server).
 *   php tests/tenant_bootstrap.php <cmd> [json-arg]
 * Prints exactly one line:  @@JSON@@{...}
 * Commands: init (create workspaces + platform user), legacy (single admin, no tenancy), users, list, suspend, unsuspend
 * It deliberately only uses the documented contract (docs/MULTITENANT.md) and degrades to {"core":false} when absent.
 */
error_reporting(E_ALL);
ini_set('display_errors', '0');
$root = dirname(__DIR__);
$cmd = $argv[1] ?? '';
$arg = json_decode($argv[2] ?? '', true) ?: [];
const BS_PW = 'Tenant-Iso-4821qzX!';

function bs_out(array $a): never
{
    echo "\n@@JSON@@" . json_encode($a, JSON_UNESCAPED_SLASHES) . "\n";
    exit(0);
}

try {
    require $root . '/src/App.php';
    App::init();
} catch (Throwable $e) {
    bs_out(['core' => false, 'error' => 'App::init failed: ' . $e->getMessage()]);
}

$core = class_exists('Workspace') && method_exists('Workspace', 'create');

/** all users, regardless of workspace */
function bs_users(): array
{
    if (class_exists('Store') && method_exists('Store', 'global')) {
        $g = Store::global('users');
        return (array)(is_object($g) ? $g->read([]) : $g);
    }
    return (array)Auth::users();
}

try {
    switch ($cmd) {
        case 'legacy':   // harness self-check against the current single-tenant app
            if ($core) {   // with the core present the "legacy" admin simply lives in workspace main
                Workspace::ensureMain();
                try {
                    Auth::create('legacy_admin', BS_PW, 'admin', 'Legacy', 'main');
                } catch (ArgumentCountError | NoWorkspaceException $e) {
                    Workspace::run('main', fn() => Auth::create('legacy_admin', BS_PW, 'admin', 'Legacy'));
                }
            } else {
                Auth::create('legacy_admin', BS_PW, 'admin', 'Legacy');
            }
            bs_out(['core' => $core, 'ok' => true]);
        case 'init':
            if (!$core) {
                bs_out(['core' => false, 'error' => 'class Workspace / Workspace::create missing']);
            }
            $res = ['core' => true, 'workspaces' => [], 'errors' => []];
            foreach ((array)($arg['workspaces'] ?? []) as $spec) {
                try {
                    $r = Workspace::create([
                        'name' => $spec['name'], 'slug' => $spec['slug'], 'limits' => $spec['limits'] ?? [],
                        'owner' => $spec['owner'], 'owner_username' => $spec['owner'], 'username' => $spec['owner'],
                        'password' => BS_PW, 'owner_password' => BS_PW,
                    ]);
                    $id = is_array($r) ? (string)($r['id'] ?? $r['workspace']['id'] ?? '') : (string)$r;
                    $res['workspaces'][] = $spec + ['id' => $id];
                } catch (Throwable $e) {
                    $res['errors'][] = "create {$spec['slug']}: " . $e->getMessage();
                }
            }
            try {
                if (method_exists('Workspace', 'ensureMain')) {
                    Workspace::ensureMain();
                }
                try {
                    Auth::create($arg['platform'], BS_PW, 'platform', 'Platform', 'main');   // 5th arg = workspace (core signature)
                } catch (ArgumentCountError | NoWorkspaceException $e) {
                    Workspace::run('main', fn() => Auth::create($arg['platform'], BS_PW, 'platform', 'Platform'));
                }
                $u = Auth::find($arg['platform']);
                $res['platform_ok'] = $u && ($u['role'] ?? '') === 'platform';
            } catch (Throwable $e) {
                $res['platform_ok'] = false;
                $res['errors'][] = 'platform user: ' . $e->getMessage();
            }
            bs_out($res);
        case 'users':
            bs_out(['core' => $core, 'users' => array_map(fn($u) => ['id' => $u['id'], 'username' => $u['username'], 'role' => $u['role'], 'workspace' => $u['workspace'] ?? ''], bs_users())]);
        case 'list':
            bs_out(['core' => $core, 'workspaces' => $core ? array_values(array_map(fn($w) => ['id' => $w['id'], 'slug' => $w['slug'] ?? '', 'status' => $w['status'] ?? ''], (array)Workspace::all())) : []]);
        case 'suspend':
        case 'unsuspend':
            $id = (string)$arg['id'];
            $sus = $cmd === 'suspend';
            $done = false;
            foreach ([$sus ? 'suspend' : 'unsuspend', $sus ? 'suspend' : 'resume', $sus ? 'suspend' : 'activate'] as $m) {
                if (method_exists('Workspace', $m)) {
                    Workspace::$m($id);
                    $done = true;
                    break;
                }
            }
            if (!$done && method_exists('Workspace', 'setStatus')) {
                Workspace::setStatus($id, $sus ? 'suspended' : 'active');
                $done = true;
            }
            if (!$done && method_exists('Workspace', 'update')) {
                Workspace::update($id, ['status' => $sus ? 'suspended' : 'active']);
                $done = true;
            }
            bs_out(['core' => true, 'ok' => $done, 'status' => (Workspace::get($id)['status'] ?? '?')]);
        default:
            bs_out(['error' => 'unknown command']);
    }
} catch (Throwable $e) {
    bs_out(['core' => $core, 'error' => get_class($e) . ': ' . $e->getMessage()]);
}
