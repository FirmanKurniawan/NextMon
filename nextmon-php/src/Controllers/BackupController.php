<?php
class BackupController
{
    public static function index(): void
    {
        $hasRouter = App::currentRouterId() !== '';   // app-data restore must work on an empty workspace too
        $files = [];
        if ($hasRouter) {
            $files = array_values(array_filter(App::driver()->print('/file', [], ['name', 'type', 'size', 'creation-time']), fn($f) => preg_match('/\.(rsc|backup)$/i', $f['name'] ?? '')));
        }
        $admin = Auth::can('admin');
        App::render('backup', [
            'title' => t('Backup'), 'page' => 'backup', 'files' => $files, 'hasRouter' => $hasRouter, 'admin' => $admin,
            'pending' => $admin ? Backup::pending((string)(Auth::user()['id'] ?? '')) : null,
            'safety' => $admin ? Backup::safetyFiles() : [],
        ]);
    }

    // ---- app data (workspace) backup / restore: owner only, see Backup.php and docs/BACKUP-FORMAT.md ----------------------

    private static function limited(string $bucket, int $max): void
    {
        if (Net::hit($bucket, Workspace::id() . '|' . (Auth::user()['id'] ?? ''), $max, 600)) {
            App::redirect('/backup', t('Too many attempts. Try again in :m min.', [':m' => 10]), 'err');
        }
    }

    public static function appExport(): void
    {
        self::limited('backup-export', 10);
        $secrets = App::get('secrets') === '1';
        try {
            $body = Backup::export($secrets);
        } catch (Throwable $e) {
            App::redirect('/backup', $e instanceof BackupError ? $e->getMessage() : t('Server error'), 'err');
        }
        Audit::log('backup.export', $secrets ? 'with encrypted secrets' : 'no secrets');
        self::send('nextmon-data-' . date('Ymd-His') . '.json', 'application/json');
        echo $body;
        exit;
    }

    public static function safetyDownload(): void
    {
        $f = Backup::safetyPath(App::get('name'));
        if (!$f) {
            App::redirect('/backup', t('File not found.'), 'err');
        }
        Audit::log('backup.safety.download', basename($f));
        self::send(basename($f), 'application/json');
        readfile($f);
        exit;
    }

    /** Step 1: upload + full validation. Nothing is written except the pending preview. */
    public static function restorePreview(): void
    {
        self::limited('backup-restore', 12);
        $f = $_FILES['file'] ?? null;
        if (!$f || !is_array($f) || ($f['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
            App::redirect('/backup', t('Choose a backup file first.'), 'err');
        }
        if ($f['error'] === UPLOAD_ERR_INI_SIZE || $f['error'] === UPLOAD_ERR_FORM_SIZE || $f['size'] > Backup::MAX_BYTES) {
            App::redirect('/backup', t('File is too large (max :n MB).', [':n' => Backup::MAX_BYTES / 1048576]), 'err');
        }
        if ($f['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($f['tmp_name'])) {
            App::redirect('/backup', t('Upload failed.'), 'err');
        }
        $raw = (string)file_get_contents($f['tmp_name'], false, null, 0, Backup::MAX_BYTES + 1);
        try {
            $parsed = Backup::parse($raw);
        } catch (BackupError $e) {
            Audit::log('backup.restore.rejected', mb_substr($e->getMessage(), 0, 200));
            App::redirect('/backup', $e->getMessage(), 'err');
        }
        Backup::stash($parsed, (string)$f['name'], (string)(Auth::user()['id'] ?? ''));
        Audit::log('backup.restore.preview', (string)$f['name']);
        App::redirect('/backup#restore');
    }

    public static function restoreCancel(): void
    {
        Backup::discard();
        App::redirect('/backup', t('Restore cancelled. Nothing was changed.'));
    }

    /** Step 2: explicit confirmation (typed word + token), then safety backup + atomic replace. */
    public static function restoreApply(): void
    {
        self::limited('backup-restore', 12);
        $uid = (string)(Auth::user()['id'] ?? '');
        $data = Backup::pendingData($uid, App::post('token'));
        if ($data === null) {
            App::redirect('/backup', t('The restore preview expired. Upload the file again.'), 'err');
        }
        if (strtoupper(App::post('confirm')) !== 'RESTORE') {
            App::redirect('/backup#restore', t('Type RESTORE to confirm.'), 'err');
        }
        $sel = array_values(array_filter(array_map('strval', (array)($_POST['c'] ?? [])), fn($c) => isset(Backup::COLLECTIONS[$c])));
        try {
            $r = Backup::apply($data, $sel);
        } catch (BackupError $e) {
            Audit::log('backup.restore.failed', mb_substr($e->getMessage(), 0, 200));
            App::redirect('/backup#restore', $e->getMessage(), 'err');
        }
        Backup::discard();
        Audit::log('backup.restore', implode(',', $r['applied']) . ' safety=' . $r['safety']);
        App::redirect('/backup', t('Restore complete: :c. Previous data saved as :f', [':c' => implode(', ', $r['applied']), ':f' => $r['safety']]));
    }

    public static function create(): void
    {
        $r = App::driver();
        $name = 'nextmon-' . date('Ymd-His');
        if (App::post('type') === 'rsc') {
            $r->command('/export', ['file' => $name]);
            $msg = t('Export created on router: :f', [':f' => $name . '.rsc']);
        } else {
            $r->command('/system/backup/save', ['name' => $name]);
            $msg = t('Backup created on router: :f', [':f' => $name . '.backup']);
        }
        Audit::log('backup.create', $name);
        App::redirect('/backup', $msg);
    }

    public static function download(): void
    {
        $r = App::driver();
        $type = App::get('type');
        $stamp = date('Ymd');
        Audit::log('backup.download', $type);
        switch ($type) {
            case 'users':
                self::send("nextmon-users-$stamp.csv", 'text/csv');
                echo "\xEF\xBB\xBF";
                $o = fopen('php://output', 'w');
                fputcsv($o, ['name', 'password', 'profile', 'comment', 'limit-uptime', 'limit-bytes-total', 'mac-address', 'disabled'], ",", chr(34), "");
                foreach ($r->print('/ip/hotspot/user', [], ['name', 'password', 'profile', 'comment', 'limit-uptime', 'limit-bytes-total', 'mac-address', 'disabled']) as $u) {
                    fputcsv($o, array_map([self::class, 'cell'], [$u['name'], $u['password'] ?? '', $u['profile'] ?? '', $u['comment'] ?? '', $u['limit-uptime'] ?? '', $u['limit-bytes-total'] ?? '', $u['mac-address'] ?? '', $u['disabled'] ?? '']), ",", chr(34), "");
                }
                fclose($o);
                exit;
            case 'profiles':
                self::send("nextmon-profiles-$stamp.json", 'application/json');
                echo json_encode($r->print('/ip/hotspot/user/profile'), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
                exit;
            case 'rsc':
                // best effort: RouterOS may return the export text as "ret" values
                $rows = $r->command('/export');
                $txt = '';
                foreach ($rows as $row) {
                    $txt .= ($row['ret'] ?? implode(' ', $row)) . "\n";
                }
                if (trim($txt) === '') {
                    App::redirect('/backup', t('The router did not return export text over the API. Create the export on the router and fetch the file via FTP/Winbox.'), 'err');
                }
                self::send("nextmon-export-$stamp.rsc", 'text/plain');
                echo $txt;
                exit;
            case 'file':
                $name = basename(App::get('name'));
                if (!preg_match('/^[A-Za-z0-9_.\-]{1,100}\.(rsc|backup)$/D', $name)) { // only the backup/export files listed on the page, never user.dat & co
                    App::redirect('/backup', t('Unknown export type.'), 'err');
                }
                $rows = $r->print('/file', ['name' => $name], ['name', 'contents']);
                if (!$rows || !isset($rows[0]['contents'])) {
                    App::redirect('/backup', t('File contents are not available over the API (binary or too large). Download it via FTP/Winbox.'), 'err');
                }
                self::send($name, 'application/octet-stream');
                echo $rows[0]['contents'];
                exit;
            case 'app':
                // NextMON's own settings without secrets
                $routers = array_map(function ($x) {
                    unset($x['pass']);
                    return $x;
                }, App::routers());
                $users = array_map(fn($u) => ['username' => $u['username'], 'role' => $u['role']], Auth::users());
                $s = Store::settings();
                unset($s['telegram']['token']);
                self::send("nextmon-app-$stamp.json", 'application/json');
                echo json_encode(['routers' => $routers, 'users' => $users, 'settings' => $s], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
                exit;
        }
        App::redirect('/backup', t('Unknown export type.'), 'err');
    }

    /** Spreadsheet formula guard (the CSV importer strips the leading apostrophe again) */
    public static function cell(string $v): string
    {
        return $v !== '' && strpos("=+-@\t\r", $v[0]) !== false && !preg_match('/^[+-]?\d+([.,]\d+)?$/', $v) ? "'" . $v : $v;
    }

    private static function send(string $name, string $mime): void
    {
        header('Content-Type: ' . $mime . '; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . preg_replace('/[^A-Za-z0-9_.\-]/', '_', $name) . '"');
        header('Cache-Control: no-store');
    }
}
