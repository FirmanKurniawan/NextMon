<?php
/**
 * Platform admin pages (capability `platform`): workspaces (accounts) list, create, suspend / activate, limits, owner password reset, delete.
 * Entering a workspace is POST /platform/switch (WorkspaceSwitchController). This is the CORE implementation: functional and audited;
 * the account-management agent may restyle / extend it.
 *   GET  /platform/accounts
 *   POST /platform/accounts/create   name, slug?, owner, password, routers?, staff?, vouchers_per_day?, log_rows?
 *   POST /platform/accounts/status   id, status = active|suspended
 *   POST /platform/accounts/limits   id, routers, staff, vouchers_per_day, log_rows   (empty = platform default)
 *   POST /platform/accounts/reset    id, password        (owner password reset; kills the owner's other sessions)
 *   POST /platform/accounts/delete   id                  (workspace + everything in it)
 */
class PlatformController
{
    private const LIMIT_KEYS = ['routers', 'staff', 'vouchers_per_day', 'log_rows'];

    private static function limitsFromPost(): array
    {
        $l = [];
        foreach (self::LIMIT_KEYS as $k) {
            $v = App::post($k);
            if ($v !== '' && ctype_digit($v)) {
                $l[$k] = (int)$v;
            }
        }
        return $l;
    }

    public static function accounts(): void
    {
        $rows = [];
        foreach (Workspace::all() as $w) {
            $id = (string)$w['id'];
            $users = array_values(array_filter(Auth::allUsers(), fn($u) => (string)($u['workspace'] ?? 'main') === $id));
            $owner = '';
            foreach ($users as $u) {
                if ($u['id'] === ($w['owner'] ?? '')) {
                    $owner = $u['username'];
                }
            }
            $rows[] = $w + [
                'owner_name' => $owner,
                'user_count' => count($users),
                'router_count' => count(Workspace::run($id, fn() => (array)Store::read('routers', []))),
                'eff' => Workspace::limits($id),
                'vq' => Quota::usage($id),
                'lq' => Quota::logUsage($id),
            ];
        }
        App::render('platform_accounts', [
            'title' => t('Accounts'), 'page' => 'platform', 'rows' => $rows, 'defaults' => Workspace::platform()['limits'], 'home' => (string)(Auth::user()['workspace'] ?? 'main'),
        ]);
    }

    public static function create(): void
    {
        try {
            $w = Workspace::create([
                'name' => App::post('name'), 'slug' => App::post('slug'), 'owner' => App::post('owner'),
                'password' => (string)($_POST['password'] ?? ''), 'limits' => self::limitsFromPost(),
            ]);
        } catch (InvalidArgumentException $e) {
            App::redirect('/platform/accounts', t($e->getMessage()), 'err');
        }
        App::redirect('/platform/accounts', t('Account created: :s', [':s' => $w['slug']]));
    }

    public static function status(): void
    {
        $id = App::post('id');
        $st = App::post('status') === 'suspended' ? 'suspended' : 'active';
        if (!Workspace::valid($id) || !Workspace::get($id)) {
            App::redirect('/platform/accounts', t('Workspace not found.'), 'err');
        }
        Workspace::setStatus($id, $st);
        App::redirect('/platform/accounts', $st === 'suspended' ? t('Account suspended.') : t('Account reactivated.'));
    }

    public static function limits(): void
    {
        $id = App::post('id');
        if (!Workspace::valid($id) || !Workspace::get($id)) {
            App::redirect('/platform/accounts', t('Workspace not found.'), 'err');
        }
        // an empty field removes the override (falls back to the platform default)
        Store::global('workspaces')->update(function ($list) use ($id) {
            foreach ($list as $i => $w) {
                if (($w['id'] ?? '') === $id) {
                    $list[$i]['limits'] = self::limitsFromPost();
                }
            }
            return $list;
        }, []);
        Workspace::platformLog('workspace.limits', $id . ' ' . json_encode(self::limitsFromPost()));
        App::redirect('/platform/accounts', t('Limits saved.'));
    }

    public static function reset(): void
    {
        $id = App::post('id');
        $w = Workspace::valid($id) ? Workspace::get($id) : null;
        $pw = (string)($_POST['password'] ?? '');
        if (!$w || empty($w['owner'])) {
            App::redirect('/platform/accounts', t('Workspace not found.'), 'err');
        }
        $owner = null;
        foreach (Auth::allUsers() as $u) {
            if ($u['id'] === $w['owner']) {
                $owner = $u;
            }
        }
        if (!$owner) {
            App::redirect('/platform/accounts', t('User not found.'), 'err');
        }
        $pe = Workspace::run($id, fn() => Security::passwordError($pw, $owner['username']));
        if ($pe !== null) {
            App::redirect('/platform/accounts', $pe, 'err');
        }
        $hash = Auth::hash($pw);
        Store::global('users')->update(function ($l) use ($owner, $hash) {
            foreach ($l as $i => $x) {
                if ($x['id'] === $owner['id']) {
                    $l[$i]['hash'] = $hash;
                }
            }
            return $l;
        }, []);
        foreach (array_keys(Security::sessions($owner['id'])) as $h) {
            Security::revoke($h);   // the old password's sessions must die
        }
        Workspace::platformLog('workspace.reset_password', $id . ' ' . $owner['username']);
        App::redirect('/platform/accounts', t('Owner password reset.'));
    }

    public static function delete(): void
    {
        $id = App::post('id');
        if (!Workspace::valid($id) || !Workspace::get($id)) {
            App::redirect('/platform/accounts', t('Workspace not found.'), 'err');
        }
        if (!Workspace::delete($id)) {
            App::redirect('/platform/accounts', t('This workspace cannot be deleted (main, or it holds a platform admin).'), 'err');
        }
        App::redirect('/platform/accounts', t('Account deleted.'));
    }
}
