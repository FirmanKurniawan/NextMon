<?php
class BackupController
{
    public static function index(): void
    {
        $r = App::driver();
        $files = array_values(array_filter($r->print('/file', [], ['name', 'type', 'size', 'creation-time']), fn($f) => preg_match('/\.(rsc|backup)$/i', $f['name'] ?? '')));
        App::render('backup', ['title' => t('Backup'), 'page' => 'backup', 'files' => $files]);
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
