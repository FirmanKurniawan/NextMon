<?php
class RoutersController
{
    public static function index(): void
    {
        App::render('routers', ['title' => t('Routers'), 'page' => 'routers', 'routers' => App::routers(), 'current' => App::currentRouterId(), 'forced' => App::demoForced()]);
    }

    public static function save(): void
    {
        $id = App::post('id');
        if ($id !== '' && App::isShared($id)) {
            App::redirect('/routers', t('A shared router can only be changed by its owner.'), 'err');
        }
        $name = mb_substr(App::post('name'), 0, 40);
        $type = App::post('type') === 'demo' ? 'demo' : 'real';
        $host = App::post('host');
        $port = (int)App::post('port', '8728');
        if ($port < 1 || $port > 65535) {
            $port = App::post('ssl') === '1' ? 8729 : 8728;
        }
        $user = App::post('user');
        $pass = (string)($_POST['pass'] ?? '');
        $session = preg_replace('/[^A-Za-z0-9_\-]/', '', App::post('session'));
        if ($name === '') {
            App::redirect('/routers', t('Name is required.'), 'err');
        }
        if ($type === 'real' && !preg_match('/^[A-Za-z0-9.\-:]+$/', $host)) {
            App::redirect('/routers', t('Invalid host.'), 'err');
        }
        if ($session === '') {
            $session = strtolower(preg_replace('/[^A-Za-z0-9]/', '', $name)) ?: 'router';
        }
        $new = ['id' => $id ?: bin2hex(random_bytes(4)), 'name' => $name, 'session' => $session, 'type' => $type, 'host' => $host,
            'port' => $port ?: 8728, 'ssl' => App::post('ssl') === '1', 'verify_tls' => App::post('ssl') === '1' && App::post('verify_tls') === '1', 'user' => $user, 'hotspot_name' => mb_substr(App::post('hotspot_name'), 0, 60)];
        $limitHit = false;
        Store::update('routers', function ($list) use ($new, $id, $pass, &$limitHit) {
            $found = false;
            foreach ($list as $i => $r) {
                if ($id !== '' && $r['id'] === $id) {
                    // keep the old encrypted password when the field is left blank
                    $new['pass'] = $pass !== '' ? Crypto::encrypt($pass) : ($r['pass'] ?? '');
                    $list[$i] = $new;
                    $found = true;
                }
            }
            if (!$found) {
                if (!Workspace::allows('routers', count($list))) {   // plan limit, checked inside the lock
                    $limitHit = true;
                    return $list;
                }
                $new['pass'] = $pass !== '' ? Crypto::encrypt($pass) : '';
                $list[] = $new;
            }
            return $list;
        }, []);
        if ($limitHit) {
            App::redirect('/routers', t('Router limit reached for this account (:n).', [':n' => Workspace::limits()['routers']]), 'err');
        }
        Workspace::reindexSessions();
        if ($id !== '') {
            CachedDriver::flush($id);   // host / credentials may have changed: drop cached reads of this router
        }
        Audit::log($id ? 'router.edit' : 'router.add', $name);
        App::redirect('/routers', t('Router saved.'));
    }

    public static function delete(): void
    {
        $id = App::post('id');
        if (App::isShared($id)) {   // a shared router belongs to its owner: the recipient can only stop using it (POST /routers/share/revoke)
            App::redirect('/routers', t('A shared router can only be changed by its owner.'), 'err');
        }
        $list = App::ownRouters();
        if (count($list) <= 1) {
            App::redirect('/routers', t('At least one router must remain.'), 'err');
        }
        Store::update('routers', fn($l) => array_values(array_filter((array)$l, fn($r) => $r['id'] !== $id)), []);
        Share::dropRouter($id);
        Workspace::reindexSessions();
        if (($_SESSION['router'] ?? '') === $id) {
            unset($_SESSION['router']);
        }
        CachedDriver::flush($id);
        Audit::log('router.delete', $id);
        App::redirect('/routers', t('Router deleted.'));
    }

    /**
     * POST /routers/share   router = <own router id>, to = <workspace slug>, mode = ro|rw   (owner side; re-sharing replaces the mode)
     * POST /routers/share/revoke   share = <share id>   OR   router + to   (owner revokes; a recipient may drop a share it received)
     */
    public static function share(): void
    {
        try {
            Share::grant(App::post('router'), App::post('to'), App::post('mode', 'ro'));
        } catch (InvalidArgumentException $e) {
            App::redirect('/routers', t($e->getMessage()), 'err');
        }
        App::redirect('/routers', t('Router shared.'));
    }

    public static function unshare(): void
    {
        $id = App::post('share');
        if ($id === '') {
            $to = Workspace::bySlug(App::post('to'));
            foreach ($to ? Share::outgoing(App::post('router')) : [] as $s) {
                if ($s['to'] === $to['id']) {
                    $id = $s['id'];
                }
            }
            if ($id === '' && App::post('router') !== '') {   // a recipient dropping a router shared with it
                $in = Share::for(App::post('router'));
                $id = $in['id'] ?? '';
            }
        }
        if ($id === '' || !Share::revoke($id)) {
            App::redirect('/routers', t('Share not found.'), 'err');
        }
        App::redirect('/routers', t('Share removed.'));
    }

    public static function select(): void
    {
        $id = App::post('router') ?: App::post('id');   // the nav picker posts router, other forms post id
        if (App::routerCfg($id)) {
            $_SESSION['router'] = $id;
        }
        App::back('/');
    }

    /** JSON: test connection with posted values (blank password = reuse stored one when id given) */
    public static function test(): void
    {
        $id = App::post('id');
        $cfg = [
            'id' => 'test', 'type' => App::post('type') === 'demo' ? 'demo' : 'real',
            'host' => App::post('host'), 'port' => (int)App::post('port', '8728'), 'ssl' => App::post('ssl') === '1', 'verify_tls' => App::post('verify_tls') === '1', 'user' => App::post('user'),
            'pass' => '',
        ];
        $pass = (string)($_POST['pass'] ?? '');
        if ($cfg['type'] === 'demo') {
            App::json(['ok' => true, 'message' => 'Demo router OK']);
        }
        if ($cfg['port'] < 1 || $cfg['port'] > 65535) {
            App::json(['ok' => false, 'message' => t('Invalid API port (1-65535). Default is 8728, or 8729 for API-SSL.')]);
        }
        if (!preg_match('/^[A-Za-z0-9.\-:]+$/', $cfg['host'])) {
            App::json(['ok' => false, 'message' => t('Invalid host.')]);
        }
        if ($pass === '' && $id !== '' && ($old = App::routerCfg($id))) {
            $cfg['pass'] = $old['pass'] ?? '';
        } else {
            $cfg['pass'] = Crypto::encrypt($pass);
        }
        try {
            $r = App::driverFor($cfg);
            $res = $r->print('/system/resource')[0] ?? [];
            $idn = $r->print('/system/identity')[0]['name'] ?? '';
            App::json(['ok' => true, 'message' => $idn . ' - RouterOS ' . ($res['version'] ?? '?') . ' (' . ($res['board-name'] ?? '?') . ')']);
        } catch (Throwable $e) {
            App::json(['ok' => false, 'message' => $e->getMessage()]);
        }
    }
}
