<?php
class AuthController
{
    /**
     * Optional first-run lock (public / Docker deployments): set env NEXTMON_SETUP_TOKEN, then open /setup?token=THAT once.
     * Without it the first visitor to /setup becomes admin, so finish setup before exposing the port.
     */
    private static function setupAllowed(): bool
    {
        $want = (string)getenv('NEXTMON_SETUP_TOKEN');
        if ($want === '') {
            return true;
        }
        $given = App::get('token');
        if ($given !== '' && hash_equals($want, $given)) {
            $_SESSION['setup_ok'] = true;
        }
        return !empty($_SESSION['setup_ok']);
    }

    public static function setupForm(): void
    {
        if (Auth::hasUsers()) {
            App::redirect('/login');
        }
        if (!self::setupAllowed()) {
            http_response_code(403);
            App::renderBare('auth', ['mode' => 'setup', 'error' => t('Setup is locked. Open /setup?token=... with the value of NEXTMON_SETUP_TOKEN.'), 'val' => '']);
            return;
        }
        App::renderBare('auth', ['mode' => 'setup', 'error' => '', 'val' => '']);
    }

    public static function setup(): void
    {
        if (Auth::hasUsers()) {
            App::redirect('/login');
        }
        if (!self::setupAllowed()) {
            http_response_code(403);
            App::renderBare('auth', ['mode' => 'setup', 'error' => t('Setup is locked. Open /setup?token=... with the value of NEXTMON_SETUP_TOKEN.'), 'val' => '']);
            return;
        }
        $u = App::post('username');
        $p = (string)($_POST['password'] ?? '');
        $c = (string)($_POST['password2'] ?? '');
        $err = '';
        if (!preg_match('/^[A-Za-z0-9_.\-]{3,32}$/', $u)) {
            $err = t('Username: 3-32 letters, digits, dot, dash or underscore.');
        } elseif (strlen($p) < 8) {
            $err = t('Password must be at least 8 characters.');
        } elseif (($pe = Security::passwordError($p, $u)) !== null) { // [SECURITY-HOOK]
            $err = $pe;
        } elseif ($p !== $c) {
            $err = t('Passwords do not match.');
        }
        if ($err) {
            App::renderBare('auth', ['mode' => 'setup', 'error' => $err, 'val' => $u]);
            return;
        }
        if (!Auth::createFirstAdmin($u, $p)) { // lost a race with another first request
            App::redirect('/login');
        }
        Auth::attempt($u, $p, Audit::ip());
        App::redirect('/', t('Admin account created. Welcome!'));
    }

    public static function loginForm(): void
    {
        if (!Auth::hasUsers()) {
            App::redirect('/setup');
        }
        if (Auth::check()) {
            App::redirect('/');
        }
        App::renderBare('auth', ['mode' => 'login', 'error' => '', 'val' => '']);
    }

    public static function login(): void
    {
        if (!Auth::hasUsers()) {
            App::redirect('/setup');
        }
        $u = App::post('username');
        [$ok, $msg] = Auth::attempt($u, (string)($_POST['password'] ?? ''), Audit::ip());
        if ($ok) {
            App::redirect('/');
        }
        http_response_code(401);
        App::renderBare('auth', ['mode' => 'login', 'error' => $msg, 'val' => $u]);
    }

    public static function logout(): void
    {
        ImportController::purgeSession();
        Auth::logout();
        session_start();
        App::redirect('/login');
    }

    public static function lang(): void
    {
        $l = App::get('l');
        if (in_array($l, ['id', 'en'], true)) {
            $_SESSION['lang'] = $l;
            setcookie('klang', $l, ['expires' => time() + 31536000, 'path' => App::$base ?: '/', 'samesite' => 'Lax']);
        }
        App::back('/');
    }
}
