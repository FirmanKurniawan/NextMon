<?php
/** Regression tests for the security review (trusted proxies, SSRF, open redirect, sanitiser, RouterOS limits, crypto rotation...). */

function sec_server(array $s): void
{
    foreach (['REMOTE_ADDR', 'HTTP_X_FORWARDED_FOR', 'HTTP_X_FORWARDED_PROTO', 'HTTP_X_FORWARDED_HOST', 'HTTPS', 'HTTP_HOST', 'HTTP_ORIGIN', 'HTTP_SEC_FETCH_SITE'] as $k) {
        unset($_SERVER[$k]);
    }
    foreach ($s as $k => $v) {
        $_SERVER[$k] = $v;
    }
    putenv('NEXTMON_TRUSTED_PROXIES=');
}

// ---- client IP / proxies ------------------------------------------------------------------------------------

test('Net::clientIp ignores X-Forwarded-For from an untrusted peer (rate-limit bypass)', function () {
    sec_server(['REMOTE_ADDR' => '203.0.113.9', 'HTTP_X_FORWARDED_FOR' => '1.2.3.4']);
    eq('203.0.113.9', Net::clientIp());
    eq('203.0.113.9', Audit::ip());
});
test('Net::clientIp honours X-Forwarded-For from loopback / configured proxies, rightmost foreign hop wins', function () {
    sec_server(['REMOTE_ADDR' => '127.0.0.1', 'HTTP_X_FORWARDED_FOR' => '9.9.9.9, 198.51.100.7']);
    eq('198.51.100.7', Net::clientIp(), 'client-supplied left part must not win');
    sec_server(['REMOTE_ADDR' => '10.0.0.5', 'HTTP_X_FORWARDED_FOR' => '198.51.100.7']);
    eq('10.0.0.5', Net::clientIp(), '10.0.0.5 is not trusted by default');
    putenv('NEXTMON_TRUSTED_PROXIES=10.0.0.0/8');
    eq('198.51.100.7', Net::clientIp());
    $_SERVER['HTTP_X_FORWARDED_FOR'] = 'garbage, 10.0.0.9';
    eq('10.0.0.5', Net::clientIp(), 'unparsable chain: fall back to the peer');
    $_SERVER['HTTP_X_FORWARDED_FOR'] = '198.51.100.7, 10.0.0.9';
    eq('198.51.100.7', Net::clientIp(), 'skips our own proxies from the right');
    putenv('NEXTMON_TRUSTED_PROXIES=');
});
test('HTTPS detection trusts X-Forwarded-Proto only from trusted proxies', function () {
    sec_server(['REMOTE_ADDR' => '203.0.113.9', 'HTTP_X_FORWARDED_PROTO' => 'https']);
    ok(!Net::isHttps());
    sec_server(['REMOTE_ADDR' => '127.0.0.1', 'HTTP_X_FORWARDED_PROTO' => 'https']);
    ok(Net::isHttps());
    sec_server(['REMOTE_ADDR' => '203.0.113.9', 'HTTPS' => 'on']);
    ok(Net::isHttps());
});
test('Net::host rejects header-injection style Host values', function () {
    sec_server(['REMOTE_ADDR' => '1.1.1.1', 'HTTP_HOST' => "evil.com\r\nX: y", 'SERVER_NAME' => 'srv.local']);
    eq('srv.local', Net::host());
    sec_server(['REMOTE_ADDR' => '1.1.1.1', 'HTTP_HOST' => 'a.b/c@evil', 'SERVER_NAME' => 'srv.local']);
    eq('srv.local', Net::host());
    sec_server(['REMOTE_ADDR' => '1.1.1.1', 'HTTP_HOST' => 'nextmon.example.com:8443']);
    eq('nextmon.example.com:8443', Net::host());
});

// ---- rate limit ---------------------------------------------------------------------------------------------

test('Net::hit counts per bucket+key and reports over-limit', function () {
    fresh_store();
    for ($i = 1; $i <= 3; $i++) {
        ok(!Net::hit('t', 'k', 3, 60), "call $i under limit");
    }
    ok(Net::hit('t', 'k', 3, 60), 'fourth call is over');
    ok(!Net::hit('t', 'other', 3, 60), 'other key unaffected');
    ok(!Net::hit('t2', 'k', 3, 60), 'other bucket unaffected');
});

// ---- SSRF ---------------------------------------------------------------------------------------------------

test('Net::isPublicIp: loopback, private, link-local, CGNAT, mapped and reserved ranges are not public', function () {
    foreach (['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '100.127.255.254',
        '192.0.0.1', '198.18.0.1', '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1',
        '::ffff:169.254.169.254', '64:ff9b::7f00:1', '2001:db8::1', 'not-an-ip', ''] as $ip) {
        ok(!Net::isPublicIp($ip), "$ip must be refused");
    }
    foreach (['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '172.32.0.1', '100.128.0.1'] as $ip) {
        ok(Net::isPublicIp($ip), "$ip is public");
    }
});
test('Net::checkOutboundUrl blocks internal targets, odd schemes, credentials and injection', function () {
    foreach (['http://127.0.0.1/hook', 'http://localhost/x', 'https://169.254.169.254/latest/meta-data/', 'http://10.0.0.1:8080/', 'http://[::1]/',
        'http://[::ffff:127.0.0.1]/', 'http://192.168.88.1/', 'file:///etc/passwd', 'gopher://8.8.8.8/', 'ftp://8.8.8.8/', 'http://user:pw@8.8.8.8/',
        "http://8.8.8.8/\r\nHost: x", 'http://8.8.8.8:99999/', 'javascript:alert(1)', '//8.8.8.8/', 'http:///x', 'http://0.0.0.0/', 'http://2130706433/', ''] as $u) {
        $why = Net::checkOutboundUrl($u, $pin);
        ok($why !== '', "must be blocked: " . json_encode($u));
    }
});
test('Net::checkOutboundUrl accepts public IP literals and pins the address; private allowed only with the env switch', function () {
    eq('', Net::checkOutboundUrl('https://8.8.8.8/hook', $pin));
    eq(['8.8.8.8:443:8.8.8.8'], $pin);
    eq('', Net::checkOutboundUrl('http://8.8.4.4:8080/x?y=1', $pin));
    eq(['8.8.4.4:8080:8.8.4.4'], $pin);
    ok(Net::checkOutboundUrl('http://192.168.1.10/n8n') !== '');
    putenv('NEXTMON_ALLOW_PRIVATE_WEBHOOK=1');
    eq('', Net::checkOutboundUrl('http://192.168.1.10/n8n'));
    putenv('NEXTMON_ALLOW_PRIVATE_WEBHOOK=');
});
test('Notify webhook to an internal address is blocked and reported, nothing is sent', function () {
    fresh_store();
    Store::saveSettings(['webhook_url' => 'http://127.0.0.1:9/steal']);
    [$ok, $msg] = Notify::send('hello', 'test', ['webhook']);
    ok(!$ok);
    ok(str_contains($msg, 'blocked'), $msg);
});

// ---- redirects / CSRF helpers ---------------------------------------------------------------------------------

test('App::localPath: open-redirect vectors fall back, local paths pass', function () {
    App::$base = '';
    foreach (['//evil.com', '/\\evil.com', '\\\\evil.com', 'http://evil.com', 'https://evil.com/x', 'javascript:alert(1)', "/ok\r\nSet-Cookie: x=1", "/a\nb", '', 'evil.com', '/\\/evil.com', "/\t/evil.com"] as $to) {
        eq('/fallback', App::localPath($to, '/fallback'), json_encode($to));
    }
    eq('/hotspot/users?q=a', App::localPath('/hotspot/users?q=a', '/fallback'));
    eq('/', App::localPath('/', '/fallback'));
    App::$base = '/nextmon';
    eq('/hotspot/users', App::localPath('/nextmon/hotspot/users', '/fallback'));
    App::$base = '';
});
test('App::sameSite rejects cross-site fetches and foreign Origins, allows same-origin and header-less clients', function () {
    sec_server(['REMOTE_ADDR' => '203.0.113.9', 'HTTP_HOST' => 'nextmon.example.com']);
    ok(App::sameSite(), 'no headers (curl, old browsers) => token decides');
    $_SERVER['HTTP_SEC_FETCH_SITE'] = 'cross-site';
    ok(!App::sameSite(), 'cross-site');
    unset($_SERVER['HTTP_SEC_FETCH_SITE']);
    $_SERVER['HTTP_ORIGIN'] = 'https://evil.example';
    ok(!App::sameSite(), 'foreign origin');
    $_SERVER['HTTP_ORIGIN'] = 'https://nextmon.example.com';
    ok(App::sameSite(), 'same origin');
    $_SERVER['HTTP_SEC_FETCH_SITE'] = 'same-origin';
    ok(App::sameSite());
    $_SERVER['HTTP_ORIGIN'] = 'https://nextmon.example.com.evil.io';
    ok(!App::sameSite(), 'suffix trick');
});

// ---- passwords / login -----------------------------------------------------------------------------------------

test('Security::passwordError refuses NUL bytes and passwords bcrypt would silently truncate', function () {
    fresh_store();
    I18n::init('en');
    ok(Security::passwordError("abcdefgh\0zzz") !== null);
    ok(Security::passwordError(str_repeat('a', 73)) !== null);
    eq(null, Security::passwordError(str_repeat('a', 72)));
});
test('Auth::hash uses bcrypt cost >= 12', function () {
    $h = Auth::hash('Correct horse 9');
    ok(password_verify('Correct horse 9', $h));
    ok((password_get_info($h)['options']['cost'] ?? 0) >= 12);
});
test('Auth::createFirstAdmin succeeds once; the second concurrent setup loses', function () {
    fresh_store();
    ok(Auth::createFirstAdmin('root', 'Passw0rd!x'));
    ok(!Auth::createFirstAdmin('intruder', 'Passw0rd!x'));
    eq(1, count(Auth::users()));
    eq('platform', Auth::users()[0]['role']);   // multi-tenant: the first account is the platform admin (and owner of workspace main)
    eq('main', Auth::users()[0]['workspace']);
});
test('login lock also trips per username across many source IPs (distributed guessing)', function () {
    fresh_store();
    I18n::init('en');
    $locked = false;
    for ($i = 1; $i <= 40; $i++) {
        [, $m] = Auth::attempt('target', 'guess' . $i, '198.51.100.' . $i);
        if (str_contains($m, 'Too many attempts')) {
            $locked = true;
            break;
        }
    }
    ok($locked && $i <= 32, "global per-user lock after $i attempts");
    [, $m] = Auth::attempt('target', 'x', '203.0.113.200');
    ok(str_contains($m, 'Too many attempts'), 'a brand-new IP is locked out as well');
});
test('oversized login password is rejected without hashing work and counts as a failure', function () {
    fresh_store();
    I18n::init('en');
    Auth::create('bigpw', 'Passw0rd!x', 'viewer');
    [$ok] = Auth::attempt('bigpw', str_repeat('A', 5000), '10.1.1.1');
    ok(!$ok);
});
test('failed-login notification text is short and free of control characters', function () {
    fresh_store();
    I18n::init('en');
    Auth::attempt("evil\x00\x1b[31m" . str_repeat('A', 300) . "\nline2", 'x', '10.2.2.2');
    $row = Store::tailLog('audit.log', 1)[0];
    ok(strlen($row['detail']) <= 60 && !preg_match('/[\x00-\x1f]/', $row['detail']), json_encode($row['detail']));
});

// ---- sanitiser ------------------------------------------------------------------------------------------------------

test('Sanitize::templateHtml strips scripts, handlers (incl. svg/onload with slash), frames, forms, js: urls and remote CSS', function () {
    $evil = [
        '<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '<svg/onload=alert(1)>', '<svg><script>alert(1)</script></svg>',
        '<iframe src="javascript:alert(1)"></iframe>', '<iframe srcdoc="<script>alert(1)</script>"></iframe>', '<a href="javascript:alert(1)">x</a>',
        '<a href="  jav&#x61;script:alert(1)">x</a>', '<div onclick="x()">a</div>', '<DIV ONMOUSEOVER=alert(1)>a</DIV>', '<form action="//evil"><input></form>',
        '<meta http-equiv="refresh" content="0;url=//evil">', '<base href="//evil/">', '<link rel=stylesheet href="//evil/x.css">', '<object data="x"></object>',
        '<embed src="x">', '<style>@import url(//evil/x.css);</style>', '<style>.a{background:url(http://evil/x.png)}</style>', '<div style="background:url(//evil/x)">',
        '<div style="width:expression(alert(1))">', '<div style="behavior:url(x.htc)">', '<div style="b\\61ckground:\\75rl(//evil)">', '<math><mi xlink:href="javascript:alert(1)">',
        '<img src="javascript:alert(1)">', '<img src="//evil/x.png">', '<img src="http://evil/x.png">', '<video src=x onerror=alert(1)>', '<!--[if]><script>alert(1)</script>-->',
    ];
    foreach ($evil as $e) {
        $out = Sanitize::templateHtml($e);
        ok(!preg_match('/<\s*(script|iframe|object|embed|form|input|meta|base|link)\b/i', $out), "tag survived in: $e => $out");
        ok(!preg_match('/\son[a-z]+\s*=/i', $out), "handler survived in: $e => $out");
        ok(!preg_match('/javascript:/i', $out), "js url survived in: $e => $out");
        ok(!preg_match('~(src|href)\s*=\s*["\']?\s*(https?:)?//evil|url\s*\(\s*["\']?\s*(https?:)?//evil|@import|<meta|<link|<base~i', $out), "remote url survived in: $e => $out");
        ok(!preg_match('/expression\s*\(|behavior|@import/i', $out), "css hazard survived in: $e => $out");
    }
});
test('Sanitize::templateHtml keeps layout markup, placeholders, data attributes and unicode', function () {
    $in = '<div class="vc" style="color:#333;background:#fff"><b>{{user}}</b> / {{pass}} <span class="qr" data-qr="{{login_url}}"></span><img src="{{logo}}" alt=""> Café ñ 日本</div>'
        . '<table><tr><td colspan="2">{{price}}</td></tr></table><style>.vc{border:1px solid #000}</style>';
    $out = Sanitize::templateHtml($in);
    foreach (['class="vc"', 'color:#333', '{{user}}', '{{pass}}', 'data-qr="{{login_url}}"', 'src="{{logo}}"', 'Café ñ 日本', '<td colspan="2">{{price}}</td>', '.vc{border:1px solid #000}'] as $needle) {
        ok(str_contains($out, $needle), "lost $needle in $out");
    }
    ok(str_contains(Sanitize::templateHtml('<img src="data:image/png;base64,iVBORw0KGgo=">'), 'data:image/png;base64'));
});

// ---- scripts / RouterOS client ------------------------------------------------------------------------------------

test('Scripts::validDuration rejects a trailing newline (RouterOS script injection) and absurd numbers', function () {
    ok(!Scripts::validDuration("1d\n"));
    ok(!Scripts::validDuration("1d\n/system reset-configuration"));
    ok(!Scripts::validDuration('1d"; /x; "'));
    ok(!Scripts::validDuration(str_repeat('9', 12) . 'd'));
    ok(Scripts::validDuration('1d2h30m'));
    ok(Scripts::validDuration(''));
});
test('Scripts::onLogin never embeds attacker controlled text (mode whitelist, digits-only prices, sanitised profile)', function () {
    $s = Scripts::onLogin('remc', "5000\"; /x; \"", "1d\n/system reset-configuration", "9\$(x)", true, true, 'bad"name$[/x]');
    ok(!str_contains($s, 'reset-configuration'));
    ok(!str_contains($s, '/x;'));
    ok(!str_contains($s, 'bad"name'));
    ok(!str_contains($s, '$(x)'));
    eq('', Scripts::onLogin('rm -rf', '1', '1d', '1', false, false, 'p'));
});
test('RouterOS refuses attribute names / paths that could smuggle extra API words', function () {
    $r = new RouterOS('x');
    foreach ([['add', ['/ip/hotspot/user', ['name=x' => 'y']]], ['add', ['/ip hotspot/user', ["na\0me" => 'y']]], ['print', ['/ip/hotspot/user', ['n ame' => 'y']]],
        ['command', ['/ip/../x', []]], ['command', ['/ip/hotspot?x', []]], ['set', ['/ip/hotspot/user', '*1', ['a=b' => 'c']]]] as [$m, $args]) {
        $e = throws(fn() => $r->$m(...$args), RouterOSException::class, $m);
        ok(str_contains($e->getMessage(), 'Invalid'), $e->getMessage());
    }
});
test('RouterOS: using a closed/never-connected client throws RouterOSException, not a TypeError', function () {
    $r = new RouterOS('x');
    throws(fn() => $r->talk(['/system/identity/print']), RouterOSException::class);
});
test('RouterOS: absurd word length from a hostile peer is rejected before allocating', function () {
    $r = new RouterOS('x');
    $f = fopen('php://memory', 'w+');
    fwrite($f, "\xF0\x7F\xFF\xFF\xFF"); // announces a 2 GB word
    rewind($f);
    $p = new ReflectionProperty(RouterOS::class, 'sock');
    $p->setValue($r, $f);
    $m = new ReflectionMethod(RouterOS::class, 'readSentence');
    $e = throws(fn() => $m->invoke($r), RouterOSException::class);
    ok(str_contains($e->getMessage(), 'too large'), $e->getMessage());
    eq(null, $p->getValue($r), 'connection dropped');
});
test('RouterOS: failed login leaves no socket and forgets the password', function () {
    $r = new RouterOS('127.0.0.1', 1, false, 1);
    throws(fn() => $r->connect('admin', 'secret-pass'), RouterOSException::class);
    $pp = new ReflectionProperty(RouterOS::class, 'pass');
    eq('', $pp->getValue($r));
});

// ---- crypto -------------------------------------------------------------------------------------------------------------

test('Crypto: key file is created once with a strict mode; IVs never repeat across many encryptions', function () {
    $d = fresh_store();
    Crypto::encrypt('x');
    $f = $d . '/secret.key';
    ok(is_file($f));
    if (DIRECTORY_SEPARATOR === '/') {
        eq(0, fileperms($f) & 0077, 'group/world bits must be clear');
    }
    $ivs = [];
    for ($i = 0; $i < 2000; $i++) {
        $ivs[substr(base64_decode(substr(Crypto::encrypt('same'), 3)), 0, 12)] = 1;
    }
    eq(2000, count($ivs), 'no nonce reuse in 2000 encryptions');
});
test('Crypto: a world-readable key file is tightened on first use (POSIX)', function () {
    if (DIRECTORY_SEPARATOR !== '/') {
        ok(true);
        return;
    }
    $d = fresh_store();
    file_put_contents($d . '/secret.key', base64_encode(random_bytes(32)));
    chmod($d . '/secret.key', 0644);
    Crypto::encrypt('x');
    eq(0, fileperms($d . '/secret.key') & 0077);
});
test('Crypto::rotate re-encrypts router passwords + Telegram token, keeps a backup of the old key', function () {
    $d = fresh_store();
    Store::write('routers', [['id' => 'r1', 'name' => 'A', 'pass' => Crypto::encrypt('router-secret')], ['id' => 'r2', 'name' => 'B', 'pass' => '']]);
    Store::saveSettings(['telegram' => ['enabled' => true, 'token' => Crypto::encrypt('tg-token'), 'chat_id' => '1', 'events' => []]]);
    $oldKey = file_get_contents($d . '/secret.key');
    $oldBlob = Store::read('routers')[0]['pass'];
    $n = Crypto::rotate();
    ok($n >= 2, "rotated $n");
    ok(file_get_contents($d . '/secret.key') !== $oldKey, 'key changed');
    eq(1, count(glob($d . '/secret.key.bak-*') ?: []), 'old key kept');
    $routers = Store::read('routers');
    eq('router-secret', Crypto::decrypt($routers[0]['pass']));
    ok($routers[0]['pass'] !== $oldBlob);
    eq('', $routers[1]['pass']);
    eq('tg-token', Crypto::decrypt(Store::setting('telegram')['token']));
    eq('', Crypto::decrypt($oldBlob), 'old ciphertext is useless with the new key');
});

// ---- store hardening ---------------------------------------------------------------------------------------------------

test('Store::sanitize can never yield a dot-path or hidden file name', function () {
    foreach (['..', '.', '../x', '.htaccess', '..\\..\\boot', '/etc/passwd', "a\0b"] as $n) {
        $s = Store::sanitize($n);
        ok($s !== '.' && $s !== '..' && ($s[0] ?? '') !== '.' && !str_contains($s, '/') && !str_contains($s, '\\') && !str_contains($s, "\0"), json_encode($n) . ' => ' . $s);
    }
    eq('users', Store::sanitize('users'));
    eq('monitor-hist-r1', Store::sanitize('monitor-hist-r1'));
});
test('data dir gets deny rules for Apache (both generations) and IIS', function () {
    $d = fresh_store();
    Store::dir();
    $ht = (string)file_get_contents($d . '/.htaccess');
    ok(str_contains($ht, 'Require all denied') && str_contains($ht, 'Deny from all'));
    ok(str_contains((string)file_get_contents($d . '/web.config'), 'accessType="Deny"'));
});

// ---- reseller batch ownership (IDOR) -------------------------------------------------------------------------------------

test('Reseller batch ownership: a reseller may print only batches recorded for them; staff may print anything', function () {
    fresh_store();
    I18n::init('en');
    Auth::create('rs1', 'Passw0rd!x', 'reseller');
    Auth::create('rs2', 'Passw0rd!x', 'reseller');
    Auth::create('boss', 'Passw0rd!x', 'admin');
    $uid = fn($n) => Auth::find($n)['id'];
    $as = function (string $name) use ($uid) {
        $r = new ReflectionProperty(Auth::class, 'cur');
        $r->setValue(null, null);
        $_SESSION = ['uid' => $uid($name)];
        $_SERVER['REMOTE_ADDR'] = '127.0.0.1';
    };
    $as('rs1');
    Reseller::recordBatch('vc-123-10.28.26-mine');
    ok(Reseller::mayPrint('vc-123-10.28.26-mine'));
    ok(!Reseller::mayPrint('vc-999-10.28.26-admin-stock'), 'someone else\'s batch');
    ok(!Reseller::mayPrint(''), 'no tag');
    $as('rs2');
    ok(!Reseller::mayPrint('vc-123-10.28.26-mine'), 'other reseller');
    $as('boss');
    ok(Reseller::mayPrint('vc-999-10.28.26-admin-stock'));
    $_SESSION = [];
    $r = new ReflectionProperty(Auth::class, 'cur');
    $r->setValue(null, null);
});

// ---- misc ----------------------------------------------------------------------------------------------------------------

test('BackupController::cell neutralises spreadsheet formulas but leaves numbers alone', function () {
    eq("'=cmd|' /c calc'!A1", BackupController::cell("=cmd|' /c calc'!A1"));
    eq("'@SUM(1)", BackupController::cell('@SUM(1)'));
    eq("'+1+1x", BackupController::cell('+1+1x'));
    eq('-5', BackupController::cell('-5'));
    eq('abc-123', BackupController::cell('abc-123'));
});
test('Shop::ipMatch handles CIDR for callback allow-lists', function () {
    ok(Shop::ipMatch('10.1.2.3', '10.0.0.0/8'));
    ok(!Shop::ipMatch('11.1.2.3', '10.0.0.0/8'));
    ok(Shop::ipMatch('::1', '::1'));
    ok(!Shop::ipMatch('127.0.0.1', '::1'));
});
