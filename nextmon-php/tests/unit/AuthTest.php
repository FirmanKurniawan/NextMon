<?php
function auth_reset(): void
{
    fresh_store();
    I18n::init('en');
    $_SESSION = [];
    $_POST = [];
    $_SERVER['HTTP_X_CSRF_TOKEN'] = '';
    unset($_SERVER['HTTP_X_CSRF_TOKEN']);
    $r = new ReflectionProperty(Auth::class, 'cur');
    $r->setValue(null, null);
}

test('CSRF: token is stable per session, 48 hex chars; verifies via POST and header', function () {
    auth_reset();
    $t = Auth::csrf();
    eq(48, strlen($t));
    ok(ctype_xdigit($t));
    eq($t, Auth::csrf(), 'stable');
    $_POST['_csrf'] = $t;
    ok(Auth::verifyCsrf(), 'post');
    $_POST = [];
    $_SERVER['HTTP_X_CSRF_TOKEN'] = $t;
    ok(Auth::verifyCsrf(), 'header');
});
test('CSRF: missing, empty, wrong, array and prefix tokens are rejected', function () {
    auth_reset();
    $t = Auth::csrf();
    ok(!Auth::verifyCsrf(), 'missing');
    $_POST['_csrf'] = '';
    ok(!Auth::verifyCsrf(), 'empty');
    $_POST['_csrf'] = 'x' . $t;
    ok(!Auth::verifyCsrf(), 'wrong');
    $_POST['_csrf'] = substr($t, 0, 10);
    ok(!Auth::verifyCsrf(), 'prefix');
    $_POST['_csrf'] = [$t];
    ok(!Auth::verifyCsrf(), 'array');
});
test('roles -> capabilities', function () {
    auth_reset();
    Auth::create('adm', 'pw123456', 'admin');
    Auth::create('rs', 'pw123456', 'reseller');
    Auth::create('v', 'pw123456', 'viewer');
    Auth::create('weird', 'pw123456', 'root'); // unknown role downgraded
    eq('viewer', Auth::find('weird')['role']);
    eq('admin', Auth::find('ADM')['role'], 'case-insensitive lookup');
    foreach ([['adm', 'admin', true], ['rs', 'admin', false], ['rs', 'sell', true], ['rs', 'write', false], ['v', 'view', true], ['v', 'sell', false]] as [$u, $cap, $exp]) {
        $_SESSION['uid'] = Auth::find($u)['id'];
        (new ReflectionProperty(Auth::class, 'cur'))->setValue(null, null);
        eq($exp, Auth::can($cap), "$u/$cap");
    }
    $_SESSION['uid'] = 'nonexistent';
    (new ReflectionProperty(Auth::class, 'cur'))->setValue(null, null);
    ok(!Auth::check() && !Auth::can('view'));
});
test('passwords are stored hashed, never plain', function () {
    auth_reset();
    Auth::create('u1', 'SuperSecret!1', 'admin');
    $u = Auth::find('u1');
    ok(!str_contains(json_encode($u), 'SuperSecret'));
    ok(password_verify('SuperSecret!1', $u['hash']));
});
test('rate limit: 5 wrong passwords lock the user+ip, even the right password is refused while locked', function () {
    auth_reset();
    Auth::create('victim', 'RightPass123', 'admin');
    for ($i = 1; $i <= 5; $i++) {
        [$ok, $msg] = Auth::attempt('victim', 'wrong' . $i, '10.0.0.9');
        ok(!$ok, 'attempt ' . $i);
        ok(str_contains($msg, 'Wrong username or password'), "attempt $i msg: $msg");
    }
    [$ok, $msg] = Auth::attempt('victim', 'RightPass123', '10.0.0.9');
    ok(!$ok && str_contains($msg, 'Too many attempts'), $msg);
    [$ok, $msg] = Auth::attempt('victim', 'wrong', '10.0.0.9');
    ok(str_contains($msg, 'Too many attempts'), 'still locked');
    // a different IP is not locked for this user key (per user+ip)
    [$ok, $msg] = Auth::attempt('victim', 'nope', '10.0.0.10');
    ok(str_contains($msg, 'Wrong username'), 'other ip: ' . $msg);
});
test('rate limit: lock expires', function () {
    auth_reset();
    Auth::create('u', 'RightPass123', 'admin');
    for ($i = 0; $i < 5; $i++) {
        Auth::attempt('u', 'bad', '1.1.1.1');
    }
    $a = Store::read('login_attempts');
    foreach ($a as $k => $e) {
        if (isset($e['until'])) {
            $a[$k]['until'] = time() - 1;
            $a[$k]['t'] = time() - 5000;
        }
    }
    Store::write('login_attempts', $a);
    [$ok, $msg] = Auth::attempt('u', 'bad', '1.1.1.1');
    ok(str_contains($msg, 'Wrong username'), 'unlocked after expiry: ' . $msg);
});
test('rate limit: per-IP limit triggers across many usernames (password spraying)', function () {
    auth_reset();
    $locked = false;
    for ($i = 0; $i < 25; $i++) {
        [$ok, $msg] = Auth::attempt('user' . $i, 'x', '9.9.9.9');
        if (str_contains($msg, 'Too many')) {
            $locked = true;
            break;
        }
    }
    ok($locked, 'IP lock after <= 25 attempts');
});
test('rate limit: unknown user is indistinguishable from wrong password', function () {
    auth_reset();
    Auth::create('real', 'RightPass123', 'admin');
    [, $m1] = Auth::attempt('real', 'bad', '2.2.2.2');
    [, $m2] = Auth::attempt('ghost', 'bad', '2.2.2.2');
    eq($m1, $m2);
});
test('failed attempts are written to the audit log', function () {
    auth_reset();
    Auth::attempt('someone', 'bad', '3.3.3.3');
    $a = Audit::tail(5);
    eq('login.fail', $a[0]['action']);
    eq('someone', $a[0]['detail']);
});
