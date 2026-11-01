<?php
class SettingsController
{
    public static function index(): void
    {
        $newKey = $_SESSION['newkey'] ?? '';
        unset($_SESSION['newkey']);
        App::render('settings', [
            'title' => t('Settings'), 'page' => 'settings', 's' => Store::settings(), 'users' => Auth::users(),
            'keys' => (array)Store::read('apikeys', []), 'newKey' => $newKey, 'forced' => App::demoForced(),
        ]);
    }

    public static function save(): void
    {
        $tz = App::post('timezone', 'Asia/Jakarta');
        if (!in_array($tz, timezone_identifiers_list(), true)) {
            $tz = 'Asia/Jakarta';
        }
        Store::saveSettings([
            'lang' => in_array(App::post('lang'), ['id', 'en'], true) ? App::post('lang') : 'id',
            'timezone' => $tz,
            'currency' => mb_substr(App::post('currency', 'Rp'), 0, 6),
            'hotspot_name' => mb_substr(App::post('hotspot_name'), 0, 60),
            'login_url' => preg_match('#^https?://[^\s"<>\\\\]+$#i', App::post('login_url')) ? App::post('login_url') : 'http://hotspot.local/login',
            'max_qty' => max(1, min(2000, (int)App::post('max_qty', '500'))),
            'live_report' => App::post('live_report') === '1',
            'status_cors' => mb_substr(implode(',', array_filter(array_map('trim', explode(',', App::post('status_cors'))), fn($o) => (bool)preg_match('#^https?://[A-Za-z0-9.\-:\[\]]+/?$#', $o))), 0, 500),
        ]);
        Audit::log('settings.save');
        App::redirect('/settings', t('Settings saved.'));
    }

    public static function password(): void
    {
        $u = Auth::user();
        $cur = (string)($_POST['current'] ?? '');
        $new = (string)($_POST['new'] ?? '');
        if (!password_verify($cur, $u['hash'])) {
            App::redirect('/settings#account', t('Current password is wrong.'), 'err');
        }
        if (strlen($new) < 8 || $new !== (string)($_POST['new2'] ?? '')) {
            App::redirect('/settings#account', t('New password must be 8+ characters and match the confirmation.'), 'err');
        }
        if (($pe = Security::passwordError($new, $u['username'])) !== null) { // [SECURITY-HOOK]
            App::redirect('/settings#account', $pe, 'err');
        }
        self::setHash($u['id'], Auth::hash($new));
        Security::revokeOthers($u['id']); // [SECURITY-HOOK] sign out other devices
        Audit::log('password.change');
        App::redirect('/settings#account', t('Password changed.'));
    }

    private static function setHash(string $id, string $hash): void
    {
        Store::update('users', function ($l) use ($id, $hash) {
            foreach ($l as $i => $x) {
                if ($x['id'] === $id) {
                    $l[$i]['hash'] = $hash;
                }
            }
            return $l;
        }, []);
    }

    private static function adminCount(): int
    {
        return count(array_filter(Auth::users(), fn($u) => in_array($u['role'], ['admin', 'platform'], true)));
    }

    public static function userSave(): void
    {
        $id = App::post('id');
        $name = App::post('username');
        $role = App::post('role');
        $pw = (string)($_POST['password'] ?? '');
        if (!in_array($role, Auth::ROLES, true)) {
            App::redirect('/settings#users', t('Unknown role.'), 'err');
        }
        // an owner hands out STAFF roles only; owner (admin) accounts are created by the platform admin
        if ($role === 'admin' && !Auth::can('platform') && ($id === '' || (Auth::inWorkspace($id)['role'] ?? '') !== 'admin')) {
            App::redirect('/settings#users', t('Only the platform admin can create owner accounts.'), 'err');
        }
        if ($id === '') {
            if (!preg_match('/^[A-Za-z0-9_.\-]{3,32}$/', $name) || strlen($pw) < 8) {
                App::redirect('/settings#users', t('Username 3-32 chars and password 8+ chars required.'), 'err');
            }
            if (($pe = Security::passwordError($pw, $name)) !== null) { // [SECURITY-HOOK]
                App::redirect('/settings#users', $pe, 'err');
            }
            if (Auth::find($name)) {
                App::redirect('/settings#users', t('Username already exists.'), 'err');
            }
            if (!Workspace::allows('staff', count(Auth::users()) - 1)) {   // the owner does not count against the staff limit
                App::redirect('/settings#users', t('Your plan allows at most :n staff accounts.', [':n' => Workspace::limits()['staff']]), 'err');
            }
            Auth::create($name, $pw, $role, $name);
            Audit::log('user.create', "$name ($role)");
        } else {
            $target = Auth::inWorkspace($id);   // only users of THIS workspace can be touched, whatever id is posted
            if (!$target) {
                App::redirect('/settings#users', t('User not found.'), 'err');
            }
            if ($target['role'] === 'platform' && !Auth::can('platform')) {
                App::redirect('/settings#users', t('Only a platform admin can change this account.'), 'err');
            }
            if ($target['role'] === 'platform') {
                $role = 'platform';   // the owner of a platform workspace keeps the platform role from this form
            }
            if (in_array($target['role'], ['admin', 'platform'], true) && !in_array($role, ['admin', 'platform'], true) && self::adminCount() <= 1) {
                App::redirect('/settings#users', t('Cannot demote the last admin.'), 'err');
            }
            Store::update('users', function ($l) use ($id, $role) {
                foreach ($l as $i => $x) {
                    if ($x['id'] === $id) {
                        $l[$i]['role'] = $role;
                    }
                }
                return $l;
            }, []);
            if ($pw !== '') {
                if (strlen($pw) < 8 || (($pe = Security::passwordError($pw, $target['username'])) !== null)) { // [SECURITY-HOOK]
                    App::redirect('/settings#users', $pe ?? t('Password must be at least 8 characters.'), 'err');
                }
                self::setHash($id, Auth::hash($pw));
                Security::revokeOthers($id); // admin reset: the old password's sessions must die
            }
            Audit::log('user.update', $target['username'] . " ($role)");
        }
        App::redirect('/settings#users', t('User saved.'));
    }

    public static function userDelete(): void
    {
        $id = App::post('id');
        $me = Auth::user();
        if ($id === $me['id']) {
            App::redirect('/settings#users', t('You cannot delete yourself.'), 'err');
        }
        $target = Auth::inWorkspace($id);   // never delete a user of another workspace
        if (!$target) {
            App::redirect('/settings#users', t('User not found.'), 'err');
        }
        if ($target['role'] === 'platform' && !Auth::can('platform')) {
            App::redirect('/settings#users', t('Only a platform admin can change this account.'), 'err');
        }
        Store::global('users')->update(fn($l) => array_values(array_filter($l, fn($x) => $x['id'] !== $id)), []);
        Audit::log('user.delete', $id);
        App::redirect('/settings#users', t('User deleted.'));
    }

    public static function keyCreate(): void
    {
        $name = mb_substr(App::post('name', 'key'), 0, 40);
        $scope = App::post('scope') === 'write' ? 'write' : 'read';
        $key = 'kl_' . bin2hex(random_bytes(20));
        Store::update('apikeys', function ($l) use ($name, $scope, $key) {
            $l[] = ['id' => bin2hex(random_bytes(4)), 'name' => $name, 'scope' => $scope, 'hash' => hash('sha256', $key), 'prefix' => substr($key, 0, 7), 'created' => time(), 'last' => 0];
            return $l;
        }, []);
        Workspace::indexKey(hash('sha256', $key));   // global index: key hash -> workspace, so /api/v1 finds the tenant
        $_SESSION['newkey'] = $key;
        Audit::log('apikey.create', "$name ($scope)");
        App::redirect('/settings#api', t('API key created. Copy it now - it is shown only once.'));
    }

    public static function keyDelete(): void
    {
        $id = App::post('id');
        foreach ((array)Store::read('apikeys', []) as $k) {
            if ($k['id'] === $id) {
                Workspace::unindexKey((string)$k['hash']);
            }
        }
        Store::update('apikeys', fn($l) => array_values(array_filter($l, fn($x) => $x['id'] !== $id)), []);
        Audit::log('apikey.delete', $id);
        App::redirect('/settings#api', t('API key revoked.'));
    }

    // ---- audit + notifications ---------------------------------------------------------------

    public static function audit(): void
    {
        App::render('audit', ['title' => t('Audit log'), 'page' => 'audit', 'rows' => Audit::tail(300)]);
    }

    public static function notifications(): void
    {
        App::render('notifications', [
            'title' => t('Notifications'), 'page' => 'notifications', 'tg' => (array)Store::setting('telegram', []),
            'hook' => (string)Store::setting('webhook_url', ''), 'log' => Store::tailLog('notify.log', 30),
        ]);
    }

    public static function notificationsSave(): void
    {
        $old = (array)Store::setting('telegram', []);
        $token = (string)($_POST['token'] ?? '');
        $events = array_values(array_intersect(App::postArr('events'), ['sale', 'voucher', 'router', 'login']));
        $hook = App::post('webhook_url');
        $hookNote = '';
        if ($hook !== '' && preg_match('#^https?://#i', $hook) && ($why = Net::checkOutboundUrl($hook)) !== '') {
            $hookNote = ' ' . t('Webhook URL rejected:') . ' ' . $why;   // SSRF guard: no internal / non-public targets
            $hook = '';
        }
        Store::saveSettings([
            'telegram' => [
                'enabled' => App::post('enabled') === '1',
                'token' => $token !== '' ? Crypto::encrypt($token) : ($old['token'] ?? ''),
                'chat_id' => mb_substr(App::post('chat_id'), 0, 40),
                'events' => $events,
            ],
            'webhook_url' => preg_match('#^https?://#i', $hook) ? $hook : '',
        ]);
        Audit::log('notifications.save');
        App::redirect('/notifications', t('Saved.') . $hookNote, $hookNote === '' ? 'ok' : 'err');
    }

    public static function notificationsTest(): void
    {
        [$ok, $msg] = Notify::send('NextMON test notification ' . date('H:i:s'), 'test');
        App::redirect('/notifications', ($ok ? t('Test sent: ') : t('Test failed: ')) . $msg, $ok ? 'ok' : 'err');
    }
}
