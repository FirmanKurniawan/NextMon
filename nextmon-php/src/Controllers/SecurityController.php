<?php
/** Settings > Security: password policy, idle session timeout, signed-in sessions (list / revoke), login history. */
class SecurityController
{
    public static function index(): void
    {
        $me = Auth::user();
        $admin = Auth::can('admin');
        $names = [];
        foreach (Auth::users() as $u) {
            $names[$u['id']] = $u['username'];
        }
        App::render('security', [
            'title' => t('Security'), 'page' => 'security', 'me' => $me, 'admin' => $admin, 'policy' => Security::policy(),
            'sessions' => Security::sessions($admin ? null : $me['id']), 'names' => $names, 'curSid' => Security::currentHash(),
            'history' => Security::loginHistory($admin ? null : $me['username'], 60),
        ]);
    }

    public static function savePolicy(): void
    {
        Security::savePolicy([
            'pw_min' => (int)App::post('pw_min', '8'), 'pw_upper' => App::post('pw_upper') === '1', 'pw_digit' => App::post('pw_digit') === '1',
            'pw_symbol' => App::post('pw_symbol') === '1', 'pw_no_username' => App::post('pw_no_username') === '1',
            'timeout_min' => (int)App::post('timeout_min', '0'),
        ]);
        Audit::log('security.policy', json_encode(Security::policy()));
        App::redirect('/settings/security#policy', t('Security settings saved.'));
    }

    public static function revokeSession(): void
    {
        $h = App::post('sid');
        $me = Auth::user();
        $sessions = Security::sessions(Auth::can('admin') ? null : $me['id']);
        if (!isset($sessions[$h])) {
            App::redirect('/settings/security#sessions', t('Session not found.'), 'err');
        }
        if ($h === Security::currentHash()) {
            App::redirect('/settings/security#sessions', t('This is your current session. Use Sign out instead.'), 'err');
        }
        Security::revoke($h);
        Audit::log('session.revoke', (string)($sessions[$h]['uid'] ?? ''));
        App::redirect('/settings/security#sessions', t('Session signed out.'));
    }

    public static function revokeOthers(): void
    {
        $n = Security::revokeOthers(Auth::user()['id']);
        Audit::log('session.revoke_others', (string)$n);
        App::redirect('/settings/security#sessions', t(':n other sessions signed out.', [':n' => $n]));
    }
}
