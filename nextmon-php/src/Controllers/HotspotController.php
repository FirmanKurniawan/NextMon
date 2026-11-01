<?php
class HotspotController
{
    private const USER_PROPS = ['name', 'password', 'profile', 'comment', 'uptime', 'bytes-in', 'bytes-out', 'limit-uptime', 'limit-bytes-total', 'mac-address', 'disabled', 'server'];

    // ---- users ---------------------------------------------------------------------

    public static function users(): void
    {
        $r = App::driver();
        $q = strtolower(App::get('q'));
        $prof = App::get('profile');
        $batch = App::get('batch');
        $status = App::get('status');
        // users + profiles + active sessions are independent: one round-trip, not three
        $got = Pipe::prints($r, [
            'users' => ['/ip/hotspot/user', [], self::USER_PROPS],
            'profiles' => ['/ip/hotspot/user/profile', [], ['name', 'on-login']],
            'active' => ['/ip/hotspot/active', [], ['user']],
        ]);
        $all = $got['users'];
        if (!Auth::can('write')) { // viewers / resellers must not read every voucher's password
            foreach ($all as &$pu) {
                unset($pu['password']);
            }
            unset($pu);
        }
        $profiles = $got['profiles'];
        $online = array_flip(array_column($got['active'], 'user'));

        $batches = [];
        foreach ($all as $u) {
            $b = Voucher::batchOf((string)($u['comment'] ?? ''));
            if ($b !== '') {
                $batches[$b] = true;
            }
        }
        ksort($batches);

        $rows = array_values(array_filter($all, function ($u) use ($q, $prof, $batch, $status, $online) {
            if ($u['name'] === 'default-trial') {
                return false;
            }
            if ($q !== '' && strpos(strtolower($u['name'] . ' ' . ($u['comment'] ?? '')), $q) === false) {
                return false;
            }
            if ($prof !== '' && ($u['profile'] ?? '') !== $prof) {
                return false;
            }
            if ($batch !== '' && Voucher::batchOf((string)($u['comment'] ?? '')) !== $batch) {
                return false;
            }
            $st = self::statusOf($u, isset($online[$u['name']]));
            return $status === '' || $st === $status;
        }));
        foreach ($rows as &$u) {
            $u['_status'] = self::statusOf($u, isset($online[$u['name']]));
            $u['_exp'] = Voucher::expiryOf((string)($u['comment'] ?? ''));
        }
        unset($u);
        $total = count($rows);
        [$rows, $pg, $pages] = App::paginate($rows, 100);
        $profInfo = [];
        foreach ($profiles as $p) {
            $profInfo[$p['name']] = Scripts::parseMeta((string)($p['on-login'] ?? ''));
        }
        App::render('users', [
            'title' => t('Hotspot users'), 'page' => 'users', 'rows' => $rows, 'profiles' => array_column($profiles, 'name'), 'profInfo' => $profInfo,
            'batches' => array_keys($batches), 'q' => App::get('q'), 'prof' => $prof, 'batch' => $batch, 'status' => $status,
            'pg' => $pg, 'pages' => $pages, 'total' => $total,
        ]);
    }

    private static function statusOf(array $u, bool $online): string
    {
        if (($u['disabled'] ?? '') === 'true') {
            return 'disabled';
        }
        if (($u['limit-uptime'] ?? '') === '1s') {
            return 'expired';
        }
        if ($online) {
            return 'online';
        }
        return ($u['uptime'] ?? '0s') !== '0s' ? 'used' : 'new';
    }

    /** Validates "limit-uptime must not exceed profile validity" (Mikhmon rule). Returns error text or ''. */
    public static function checkTimeLimit(Driver $r, string $profile, string $limit): string
    {
        if ($limit === '') {
            return '';
        }
        if (!Scripts::validDuration($limit)) {
            return t('Time limit format is invalid (example: 1h30m).');
        }
        foreach ($r->print('/ip/hotspot/user/profile', ['name' => $profile], ['name', 'on-login']) as $p) {
            $meta = Scripts::parseMeta((string)($p['on-login'] ?? ''));
            if ($meta && $meta['validity'] !== '' && Scripts::seconds($limit) > Scripts::seconds($meta['validity'])) {
                return t('Time limit (:l) must not exceed validity (:v).', [':l' => $limit, ':v' => $meta['validity']]);
            }
        }
        return '';
    }

    public static function userSave(): void
    {
        $r = App::driver();
        $id = App::post('id');
        $name = App::post('name');
        if (!preg_match('/^[\w.\-@]{1,64}$/', $name)) {
            App::back('/hotspot/users', t('Invalid username.'), 'err');
        }
        $attrs = [
            'name' => $name, 'password' => (string)($_POST['password'] ?? ''), 'profile' => App::post('profile', 'default'),
            'comment' => App::post('comment'), 'limit-uptime' => App::post('limit_uptime'), 'limit-bytes-total' => App::post('limit_bytes'),
            'mac-address' => App::post('mac'),
        ];
        if ($err = self::checkTimeLimit($r, $attrs['profile'], $attrs['limit-uptime'])) {
            App::back('/hotspot/users', $err, 'err');
        }
        if ($id !== '') {
            $attrs['disabled'] = App::post('disabled') === '1' ? 'yes' : 'no';
            // RouterOS "unset" values, so clearing a field in the form really clears it
            if ($attrs['limit-uptime'] === '') {
                $attrs['limit-uptime'] = '0s';
            }
            if ($attrs['limit-bytes-total'] === '') {
                $attrs['limit-bytes-total'] = '0';
            }
            if ($attrs['mac-address'] === '') {
                $attrs['mac-address'] = '00:00:00:00:00:00';
            }
            $r->set('/ip/hotspot/user', $id, $attrs);
            Audit::log('user.edit', $name);
        } else {
            $attrs = array_filter($attrs, fn($v) => $v !== '');
            $r->add('/ip/hotspot/user', $attrs);
            Audit::log('user.add', $name);
        }
        App::back('/hotspot/users', t('User saved.'));
    }

    public static function userAction(): void
    {
        $r = App::driver();
        $ids = App::postArr('ids');
        $act = App::post('action');
        if (!$ids) {
            App::back('/hotspot/users', t('Nothing selected.'), 'err');
        }
        if (!in_array($act, ['delete', 'enable', 'disable', 'kick', 'reset'], true)) {
            App::back('/hotspot/users', t('Unknown action.'), 'err');
        }
        $names = [];
        $activeBy = [];   // user name => [active session ids]
        $need = in_array($act, ['delete', 'kick'], true);
        $reqs = ['users' => ['/ip/hotspot/user', [], ['name']]];
        if ($need) {
            $reqs['active'] = ['/ip/hotspot/active', [], ['user']];
        }
        $got = Pipe::prints($r, $reqs);
        foreach ($got['users'] as $u) {
            $names[$u['.id']] = $u['name'];
        }
        foreach ($got['active'] ?? [] as $a) {
            $activeBy[(string)($a['user'] ?? '')][] = $a['.id'];
        }
        $n = 0;
        $kick = [];
        $del = [];
        $toggle = [];
        $reset = [];
        foreach ($ids as $id) {
            $nm = $names[$id] ?? '';
            switch ($act) {
                case 'delete':
                    if (!Auth::can('write')) {
                        break;
                    }
                    array_push($kick, ...($activeBy[$nm] ?? []));
                    $del[] = $id;
                    break;
                case 'enable':
                case 'disable':
                    $toggle[$id] = ['disabled' => $act === 'disable' ? 'yes' : 'no'];
                    break;
                case 'kick':
                    array_push($kick, ...($activeBy[$nm] ?? []));
                    break;
                case 'reset':
                    $reset[] = ['numbers' => $id];
                    break;
            }
            $n++;
        }
        // active sessions first (a deleted user must not stay online), then the users; each kind in one pipelined burst
        Pipe::removes($r, '/ip/hotspot/active', array_values(array_unique($kick)));
        Pipe::removes($r, '/ip/hotspot/user', $del);
        Pipe::sets($r, '/ip/hotspot/user', $toggle);
        Pipe::commands($r, '/ip/hotspot/user/reset-counters', $reset);
        Audit::log('user.' . $act, $n . ' users');
        App::back('/hotspot/users', t('Done: :n users.', [':n' => $n]));
    }

    // ---- profiles -----------------------------------------------------------------------

    public static function profiles(): void
    {
        $r = App::driver();
        $got = Pipe::prints($r, ['profiles' => ['/ip/hotspot/user/profile'], 'users' => ['/ip/hotspot/user', [], ['profile']]]);
        $rows = $got['profiles'];
        foreach ($rows as &$p) {
            $p['_meta'] = Scripts::parseMeta((string)($p['on-login'] ?? ''));
        }
        unset($p);
        $counts = [];
        foreach ($got['users'] as $u) {
            $k = (string)($u['profile'] ?? 'default');
            $counts[$k] = ($counts[$k] ?? 0) + 1;
        }
        App::render('profiles', ['title' => t('User profiles'), 'page' => 'profiles', 'rows' => $rows, 'counts' => $counts]);
    }

    /** Builds attrs + script from posted profile form. Returns [attrs|null, error] */
    private static function profileFromPost(): array
    {
        $name = App::post('name');
        if (!preg_match('/^[\w.\- ]{1,40}$/', $name)) {
            return [null, t('Invalid profile name.')];
        }
        $mode = App::post('mode', 'none');
        $validity = strtolower(App::post('validity'));
        if (!in_array($mode, Scripts::MODES, true)) {
            return [null, t('Unknown expired mode.')];
        }
        if (!Scripts::validDuration($validity)) {
            return [null, t('Validity format is invalid (example: 1d, 12h, 30d).')];
        }
        if ($mode !== 'none' && $validity === '') {
            return [null, t('Validity is required for this expired mode.')];
        }
        $rate = App::post('rate_limit');
        if ($rate !== '' && !preg_match('/^[0-9A-Za-z\/ .]+$/', $rate)) {
            return [null, t('Invalid rate limit (example: 2M/2M).')];
        }
        $attrs = [
            'name' => $name, 'rate-limit' => $rate, 'shared-users' => (string)max(1, (int)App::post('shared', '1')),
            'on-login' => Scripts::onLogin($mode, App::post('price'), $validity, App::post('sprice'), App::post('lock_user') === '1', App::post('lock_server') === '1', $name),
        ];
        foreach (['parent-queue' => 'parent_queue', 'address-pool' => 'pool'] as $k => $f) {
            if (App::post($f) !== '') {
                $attrs[$k] = App::post($f);
            }
        }
        return [$attrs, ''];
    }

    public static function profileSave(): void
    {
        [$attrs, $err] = self::profileFromPost();
        if (!$attrs) {
            App::redirect('/hotspot/profiles', $err, 'err');
        }
        $r = App::driver();
        $id = App::post('id');
        if ($id !== '') {
            $r->set('/ip/hotspot/user/profile', $id, $attrs);
        } else {
            $r->add('/ip/hotspot/user/profile', $attrs);
        }
        Audit::log($id ? 'profile.edit' : 'profile.add', $attrs['name']);
        App::redirect('/hotspot/profiles', t('Profile saved.'));
    }

    public static function profileDelete(): void
    {
        if (App::post('id') === '') {
            App::redirect('/hotspot/profiles', t('Profile not found.'), 'err');
        }
        $r = App::driver();
        $r->remove('/ip/hotspot/user/profile', App::post('id'));
        Audit::log('profile.delete', App::post('name'));
        App::redirect('/hotspot/profiles', t('Profile deleted.'));
    }

    public static function profilePreview(): void
    {
        [$attrs, $err] = self::profileFromPost();
        App::json($attrs ? ['ok' => true, 'script' => $attrs['on-login'] ?: '# (no script - mode "none")'] : ['ok' => false, 'error' => $err]);
    }

    // ---- active / hosts / bindings ------------------------------------------------------------

    public static function active(): void
    {
        $rows = App::driver()->print('/ip/hotspot/active');
        App::render('active', ['title' => t('Active sessions'), 'page' => 'active', 'rows' => $rows]);
    }

    public static function activeKick(): void
    {
        $r = App::driver();
        $n = 0;
        foreach (App::postArr('ids') as $id) {
            $r->remove('/ip/hotspot/active', $id);
            $n++;
        }
        Audit::log('active.kick', $n . ' sessions');
        App::back('/hotspot/active', t('Disconnected :n sessions.', [':n' => $n]));
    }

    public static function hosts(): void
    {
        $rows = App::driver()->print('/ip/hotspot/host');
        App::render('hosts', ['title' => t('Hosts'), 'page' => 'hosts', 'rows' => $rows]);
    }

    public static function hostRemove(): void
    {
        $r = App::driver();
        $n = 0;
        foreach (App::postArr('ids') as $id) {
            $r->remove('/ip/hotspot/host', $id);
            $n++;
        }
        Audit::log('host.remove', (string)$n);
        App::back('/hotspot/hosts', t('Done: :n hosts.', [':n' => $n]));
    }

    public static function bindings(): void
    {
        $rows = App::driver()->print('/ip/hotspot/ip-binding');
        App::render('bindings', ['title' => t('IP bindings'), 'page' => 'bindings', 'rows' => $rows]);
    }

    public static function bindingSave(): void
    {
        $r = App::driver();
        $type = in_array(App::post('type'), ['regular', 'bypassed', 'blocked'], true) ? App::post('type') : 'regular';
        $attrs = ['type' => $type, 'comment' => App::post('comment')];
        foreach (['mac-address' => 'mac', 'address' => 'address', 'to-address' => 'to_address', 'server' => 'server'] as $k => $f) {
            if (App::post($f) !== '') {
                $attrs[$k] = App::post($f);
            }
        }
        if (empty($attrs['mac-address']) && empty($attrs['address'])) {
            App::redirect('/hotspot/bindings', t('MAC or address is required.'), 'err');
        }
        $id = App::post('id');
        $id !== '' ? $r->set('/ip/hotspot/ip-binding', $id, $attrs) : $r->add('/ip/hotspot/ip-binding', $attrs);
        Audit::log('binding.save', ($attrs['mac-address'] ?? '') . ' ' . ($attrs['address'] ?? ''));
        App::redirect('/hotspot/bindings', t('Binding saved.'));
    }

    public static function bindingAction(): void
    {
        $r = App::driver();
        $act = App::post('action');
        $n = 0;
        foreach (App::postArr('ids') as $id) {
            if ($act === 'remove') {
                $r->remove('/ip/hotspot/ip-binding', $id);
            } else {
                $r->set('/ip/hotspot/ip-binding', $id, ['disabled' => $act === 'disable' ? 'yes' : 'no']);
            }
            $n++;
        }
        Audit::log('binding.' . $act, (string)$n);
        App::redirect('/hotspot/bindings', t('Done: :n bindings.', [':n' => $n]));
    }
}
