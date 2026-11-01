<?php
// tenant-ok-file: this class moves un-namespaced legacy files into ws/main; it is the only code that reads the old layout.
/**
 * (This class is the only code that reads the old un-namespaced layout.)
 * One-time move of pre-multi-tenant (single owner) data into workspace `main`.
 *
 *  - runs automatically the first time Store::backend() is created on a data dir without the marker file data/tenant.migrated,
 *    and from the CLI: php bin/nextmon.php tenant:migrate | tenant:status
 *  - BACKUP FIRST: data/backup-tenant-<stamp>/ (nextmon.db or every top-level data file, plus orders/ and demo state)
 *  - moves un-namespaced collections to ws/main/<name>, data/orders + data/backups + demo-*.json under data/ws/main/
 *  - users get workspace=main; the oldest admin becomes role `platform` (platform admin + owner of main); workspace record `main` is
 *    created with unlimited limits; the API-key and status-session indexes are rebuilt
 *  - idempotent and safe to interrupt: every step skips what is already done, the marker is written last
 */
final class TenantMigration
{
    public static function marker(): string
    {
        return Store::dir() . '/tenant.migrated';
    }

    public static function done(): bool
    {
        return is_file(self::marker());
    }

    /** Called from Store::backend(): cheap when already migrated (one stat). */
    public static function auto(): void
    {
        if (!self::done()) {
            self::run();
        }
    }

    /** What is left to migrate (read-only). */
    public static function status(): array
    {
        $be = Store::backend();
        $noWs = 0;
        foreach (Auth::allUsers() as $u) {
            if (empty($u['workspace'])) {
                $noWs++;
            }
        }
        $dir = Store::dir();
        return [
            'migrated' => self::done(),
            'legacy_collections' => $be->hasLegacy(Store::GLOBAL_DOCS),
            'users_without_workspace' => $noWs,
            'legacy_dirs' => array_values(array_filter(['orders', 'backups'], fn($d) => is_dir($dir . '/' . $d))),   // tenant-ok: legacy layout migration
            'legacy_demo_files' => count(glob($dir . '/demo-*.json') ?: []),   // tenant-ok: legacy layout migration
            'workspaces' => count(Workspace::all()),
            'users' => count(Auth::allUsers()),
        ];
    }

    /** @return array report: skipped(bool), backup, docs, logs, users, dirs, ... */
    public static function run(): array
    {
        $rep = ['skipped' => false, 'backup' => '', 'docs' => 0, 'logs' => 0, 'users' => 0, 'moved' => []];
        $be = Store::backend();   // FIRST: creating the backend may itself run the migration (auto), which must not nest inside our lock
        $dir = Store::dir();
        $lock = @fopen($dir . '/.tenant-lock', 'c');   // tenant-ok: legacy layout migration
        if ($lock) {
            flock($lock, LOCK_EX);
        }
        try {
            if (self::done()) {
                $rep['skipped'] = true;
                return $rep;
            }
            $st = self::status();
            $need = $st['legacy_collections'] || $st['users_without_workspace'] > 0 || $st['legacy_dirs'] || $st['legacy_demo_files'] > 0;
            if (!$need && Auth::hasUsers() && !Workspace::get('main') && !self::hasPlatformUser()) {
                $need = true;   // users exist but nobody is platform admin yet (e.g. only the users doc was imported)
            }
            if ($need) {
                $stamp = date('Ymd-His') . '-' . bin2hex(random_bytes(2));
                $bk = $dir . '/backup-tenant-' . $stamp;
                if (!@mkdir($bk, 0770, true) && !is_dir($bk)) {   // tenant-ok: legacy layout migration
                    throw new RuntimeException('Cannot create backup dir ' . $bk);
                }
                $be->backupAll($bk);
                foreach (glob($dir . '/demo-*.json') ?: [] as $f) {   // tenant-ok: legacy layout migration
                    @copy($f, $bk . '/' . basename($f));   // tenant-ok: legacy layout migration
                }
                foreach (['orders'] as $d) {
                    if (is_dir($dir . '/' . $d)) {   // tenant-ok: legacy layout migration
                        self::copyTree($dir . '/' . $d, $bk . '/' . $d);
                    }
                }
                $rep['backup'] = $bk;

                $moved = $be->migrateLegacy(Store::GLOBAL_DOCS, 'main');
                $rep['docs'] = $moved['docs'];
                $rep['logs'] = $moved['logs'];
                $mainDir = $dir . '/ws/main';
                @mkdir($mainDir, 0770, true);   // tenant-ok: legacy layout migration
                foreach (['orders', 'backups'] as $d) {
                    if (is_dir($dir . '/' . $d)) {   // tenant-ok: legacy layout migration
                        self::moveTree($dir . '/' . $d, $mainDir . '/' . $d);
                        $rep['moved'][] = $d;
                    }
                }
                foreach (glob($dir . '/demo-*.json') ?: [] as $f) {   // tenant-ok: legacy layout migration
                    $id = substr(basename($f), 5, -5);
                    @mkdir($mainDir . '/demo', 0770, true);   // tenant-ok: legacy layout migration
                    $to = $mainDir . '/demo/' . $id . '.json';
                    if (is_file($to)) {
                        @unlink($f);
                    } elseif (@rename($f, $to)) {
                        $rep['moved'][] = basename($f);
                    }
                }
            }
            // users -> workspace main, oldest admin -> platform + owner
            $owner = '';
            Store::global('users')->update(function ($list) use (&$rep, &$owner) {
                $list = (array)$list;
                $hasPlatform = false;
                foreach ($list as $i => $u) {
                    if (empty($u['workspace'])) {
                        $list[$i]['workspace'] = 'main';
                        $rep['users']++;
                    }
                    if (($u['role'] ?? '') === 'platform' && ($list[$i]['workspace'] ?? '') === 'main') {
                        $hasPlatform = true;
                        $owner = $owner ?: (string)$u['id'];
                    }
                }
                if (!$hasPlatform) {
                    $best = null;
                    foreach ($list as $i => $u) {
                        if (($u['role'] ?? '') === 'admin' && ($list[$i]['workspace'] ?? '') === 'main' && ($best === null || ($u['created'] ?? PHP_INT_MAX) < ($list[$best]['created'] ?? PHP_INT_MAX))) {
                            $best = $i;
                        }
                    }
                    if ($best !== null) {
                        $list[$best]['role'] = 'platform';
                        $owner = (string)$list[$best]['id'];
                    }
                }
                return array_values($list);
            }, []);
            if (Auth::hasUsers() || $need) {
                $name = Workspace::run('main', fn() => (string)Store::setting('hotspot_name', 'Main'));
                Workspace::ensureMain($owner !== '' ? $owner : null, $name);
                Workspace::run('main', function () {
                    Workspace::reindexKeys();
                    Workspace::reindexSessions();
                });
            }
            @file_put_contents(self::marker(), json_encode(['at' => time(), 'report' => $rep]));
            return $rep;
        } finally {
            if ($lock) {
                flock($lock, LOCK_UN);
                fclose($lock);
            }
        }
    }

    private static function hasPlatformUser(): bool
    {
        foreach (Auth::allUsers() as $u) {
            if (($u['role'] ?? '') === 'platform') {
                return true;
            }
        }
        return false;
    }

    private static function copyTree(string $from, string $to): void
    {
        if (!is_dir($to)) {
            @mkdir($to, 0770, true);
        }
        foreach (scandir($from) ?: [] as $f) {
            if ($f === '.' || $f === '..') {
                continue;
            }
            is_dir($from . '/' . $f) ? self::copyTree($from . '/' . $f, $to . '/' . $f) : @copy($from . '/' . $f, $to . '/' . $f);
        }
    }

    /** Move a directory; when the target exists, merge file by file (existing target files win). */
    private static function moveTree(string $from, string $to): void
    {
        if (!is_dir($to)) {
            if (@rename($from, $to)) {
                return;
            }
            @mkdir($to, 0770, true);
        }
        foreach (scandir($from) ?: [] as $f) {
            if ($f === '.' || $f === '..') {
                continue;
            }
            $a = $from . '/' . $f;
            $b = $to . '/' . $f;
            if (is_dir($a)) {
                self::moveTree($a, $b);
            } elseif (is_file($b)) {
                @unlink($a);
            } else {
                @rename($a, $b);
            }
        }
        @rmdir($from);
    }
}
