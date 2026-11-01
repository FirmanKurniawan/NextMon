<?php
/**
 * NextMON CLI.   php bin/nextmon.php <command>
 *   storage:status    backend, schema version, document names, log sizes, integrity
 *   storage:migrate   import data/*.json + *.log into SQLite (backs up first; --force re-imports and overwrites)
 *   storage:vacuum    checkpoint WAL and VACUUM
 *   cache:clear       drop the speed caches in data/cache (router read cache, dashboard payload, breakers, pooled-socket markers,
 *                     compiled routes / language files). Safe any time; they are rebuilt on demand.
 *   tenant:status     multi-tenant migration state (legacy data left, workspaces, users)
 *   tenant:migrate    move pre-multi-tenant data into workspace "main" (backup first, idempotent; also runs automatically on first use)
 *   tenant:list       workspaces with status, slug, owner and limits
 *   crypto:rotate     new data key; re-encrypts router passwords, Telegram token, gateway keys (old key kept as secret.key.bak-*)
 */
if (PHP_SAPI !== 'cli') {
    exit(1);
}
require dirname(__DIR__) . '/src/App.php';
App::init();

$cmd = $argv[1] ?? 'help';
if (strncmp($cmd, 'tenant:', 7) === 0) {
    putenv('NEXTMON_TENANT_AUTO=0');   // we run (or report on) the migration ourselves
}
$force = in_array('--force', $argv, true);
$out = fn(string $s) => fwrite(STDOUT, $s . "\n");

switch ($cmd) {
    case 'storage:status':
        $out('data dir : ' . Store::dir());
        $out('configured: ' . Store::configuredBackend() . '   active: ' . Store::backendName());
        $b = Store::backend();
        if ($b instanceof SqliteStore) {
            $s = $b->status();
            $out('file      : ' . $s['file'] . ' (' . $s['size'] . ' bytes, wal ' . $s['wal_size'] . ')');
            $out('schema    : v' . $s['schema_version'] . ' / latest v' . $s['schema_latest'] . '   journal: ' . $s['journal_mode'] . '   integrity: ' . $s['integrity']);
            $out('json import: ' . ($s['json_imported'] ? date('Y-m-d H:i:s', (int)$s['json_imported']) : 'not done'));
            $out('documents : ' . ($s['docs'] ? implode(', ', $s['docs']) : '-'));
            foreach ($s['logs'] as $c => $n) {
                $out(sprintf('log %-14s %d rows', $c, $n));
            }
        } else {
            $out('documents : ' . implode(', ', Store::allNames()));
            $out('(JSON fallback; pdo_sqlite ' . (SqliteStore::available() ? 'available - unset NEXTMON_STORAGE=json / data/storage.conf to use it' : 'not available') . ')');
        }
        exit(0);
    case 'storage:migrate':
        if (!SqliteStore::available()) {
            fwrite(STDERR, "pdo_sqlite is not available; nothing to migrate to.\n");
            exit(2);
        }
        try {
            $s = new SqliteStore(Store::dir(), false);
            $r = $s->importJson($force);
        } catch (Throwable $e) {
            fwrite(STDERR, 'Migration failed (JSON files untouched, nothing imported): ' . $e->getMessage() . "\n");
            exit(1);
        }
        if ($r['already']) {
            $out('Already migrated (use --force to re-import and overwrite).');
        } else {
            $out("Imported {$r['docs']} documents, {$r['logs']} log rows, skipped {$r['skipped']}.");
            if ($r['backup'] !== '') {
                $out('Backup of originals: ' . $r['backup']);
            }
        }
        exit(0);
    case 'storage:vacuum':
        $b = Store::backend();
        if (!$b instanceof SqliteStore) {
            $out('JSON backend: nothing to vacuum.');
            exit(0);
        }
        $r = $b->vacuum();
        $out("Vacuumed: {$r['before']} -> {$r['after']} bytes");
        exit(0);
    case 'tenant:status':
        foreach (TenantMigration::status() as $k => $v) {
            $out(sprintf('%-26s %s', $k, is_bool($v) ? ($v ? 'yes' : 'no') : (is_array($v) ? (implode(', ', $v) ?: '-') : $v)));
        }
        exit(0);
    case 'tenant:migrate':
        try {
            $r = TenantMigration::run();
        } catch (Throwable $e) {
            fwrite(STDERR, 'Migration failed (data untouched or partially moved; run again, it is idempotent): ' . $e->getMessage() . "
");
            exit(1);
        }
        if ($r['skipped']) {
            $out('Already migrated.');
        } else {
            $out("Moved {$r['docs']} documents, {$r['logs']} log rows/files, {$r['users']} users -> workspace main.");
            if ($r['backup'] !== '') {
                $out('Backup of the data before the move: ' . $r['backup']);
            }
            if ($r['moved']) {
                $out('Directories / files moved: ' . implode(', ', $r['moved']));
            }
        }
        exit(0);
    case 'tenant:list':
        foreach (Workspace::all() as $w) {
            $out(sprintf('%-12s %-20s %-10s owner=%s limits=%s', $w['id'], $w['slug'], $w['status'] ?? 'active', $w['owner'] ?: '-', json_encode(Workspace::limits($w['id']))));
        }
        exit(0);
    case 'cache:clear':
        $n = 0;
        foreach (glob(Store::dir() . '/ws/*/cache/{c-*.dat,sales-*.json,import-*.json}', GLOB_BRACE) ?: [] as $f) {
            $n += @unlink($f) ? 1 : 0;
        }
        foreach (glob(Store::dir() . '/cache/{c-*.dat,c-*.tmp,rc-*.json,routes.php,lang-*.ser,sales-*.json}', GLOB_BRACE) ?: [] as $f) {
            $n += @unlink($f) ? 1 : 0;
        }
        $out("Removed $n cache files (" . Cache::backend() . ' backend' . (Cache::backend() === 'apcu' ? ': APCu entries expire by TTL, restart php-fpm to flush them now' : '') . ').');
        exit(0);
    case 'crypto:rotate':
        try {
            $n = Crypto::rotate();
        } catch (Throwable $e) {
            fwrite(STDERR, 'Rotation failed: ' . $e->getMessage() . "\n");
            exit(1);
        }
        $out("Re-encrypted $n secret(s) with a new key. The previous key is kept as data/secret.key.bak-*: delete it (and old backups) when satisfied.");
        exit(0);
    default:
        $out("Usage: php bin/nextmon.php storage:status|storage:migrate [--force]|storage:vacuum|tenant:status|tenant:migrate|tenant:list|cache:clear|crypto:rotate");
        exit($cmd === 'help' ? 0 : 1);
}
