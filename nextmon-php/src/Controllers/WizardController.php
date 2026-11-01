<?php
/**
 * Setup wizard: prepares a router for NextMON step by step. Every step can be previewed ("show commands", nothing is sent)
 * and then applied. Risky operations need an explicit confirmation tick. Each applied command is logged to data/wizard.log.
 * Commands follow docs/mikrotik-scripts/*.rsc. Live-router behaviour is UNVERIFIED (only the Demo driver was exercised).
 */
class WizardController
{
    public const STEPS = ['check', 'user', 'services', 'scripts', 'walled', 'ntp', 'template'];
    private const TEMPLATE_DIR_NAME = 'hotspot-nextmon';

    // ---- pages --------------------------------------------------------------------------------

    public static function index(): void
    {
        $cfg = App::routerCfg();
        $profiles = [];
        $hsProfiles = [];
        $error = '';
        try {
            $r = App::driver();
            foreach ($r->print('/ip/hotspot/user/profile', [], ['name', 'on-login']) as $p) {
                $m = Scripts::parseMeta((string)($p['on-login'] ?? ''));
                $profiles[] = ['name' => $p['name'], 'meta' => $m, 'has' => trim((string)($p['on-login'] ?? '')) !== ''];
            }
            $hsProfiles = array_column($r->print('/ip/hotspot/profile', [], ['name']), 'name');
        } catch (RouterOSException $e) {
            $error = $e->getMessage();
        }
        $out = $_SESSION['wizard_out'] ?? null;
        unset($_SESSION['wizard_out']);
        $cred = $_SESSION['wizard_cred'] ?? null;
        $tplDir = self::templateDir();
        App::render('wizard', [
            'title' => t('Setup wizard'), 'page' => 'wizard', 'cfg' => $cfg, 'demo' => App::isDemo(), 'error' => $error,
            'profiles' => $profiles, 'hsProfiles' => $hsProfiles, 'out' => $out, 'p' => self::params(true), 'cred' => $cred && $cred['router'] === ($cfg['id'] ?? '') ? ['user' => $cred['user']] : null,
            'log' => array_values(array_filter(Store::tailLog('wizard.log', 200), fn($l) => ($l['router'] ?? '') === ($cfg['id'] ?? ''))),
            'tplFiles' => $tplDir ? self::templateFiles($tplDir) : [], 'tplDir' => $tplDir, 'zipOk' => class_exists('ZipArchive'),
            'steps' => self::STEPS,
        ]);
    }

    public static function run(): void
    {
        $step = App::post('step');
        $mode = App::post('mode') === 'apply' ? 'apply' : 'preview';
        if (!in_array($step, self::STEPS, true)) {
            App::redirect('/wizard', t('Unknown action.'), 'err');
        }
        if ($mode === 'apply' && $step !== 'check' && App::post('confirm') !== '1') {
            App::redirect('/wizard#s-' . $step, t('Tick the confirmation box before applying.'), 'err');
        }
        try {
            $p = self::params(false);
        } catch (InvalidArgumentException $e) {
            App::redirect('/wizard#s-' . $step, $e->getMessage(), 'err');
        }
        $_SESSION['wizard_p'] = $p;
        $r = App::driver();
        App::setTimeout($r, 90);
        $rid = App::currentRouterId();
        try {
            $ops = self::ops($step, $r, $p);
        } catch (InvalidArgumentException $e) {
            App::redirect('/wizard#s-' . $step, $e->getMessage(), 'err');
        }
        $res = [];
        $halt = false;
        foreach ($ops as $op) {
            $row = ['label' => $op['label'], 'cli' => $op['cli'], 'detail' => $op['detail'] ?? '', 'status' => 'plan', 'msg' => $op['note'] ?? ''];
            if ($mode === 'apply') {
                if ($halt) {
                    $row['status'] = 'skip';
                    $row['msg'] = t('Skipped because an earlier command failed.');
                } elseif (!empty($op['ack']) && empty($_POST['ack_' . $op['ack']])) {
                    $row['status'] = 'skip';
                    $row['msg'] = t('Not applied: tick the extra confirmation for this command.');
                } elseif ($op['fn'] === null) {
                    $row['status'] = 'skip';
                } else {
                    try {
                        $x = ($op['fn'])($r);
                        [$row['status'], $row['msg']] = is_array($x) ? $x : ['ok', (string)$x];
                    } catch (Throwable $e) {
                        $row['status'] = 'err';
                        $row['msg'] = $e->getMessage();
                        $halt = !empty($op['stop']);
                    }
                }
                Store::appendLog('wizard.log', ['ts' => time(), 'router' => $rid, 'step' => $step, 'label' => $op['label'], 'cli' => self::mask($op['cli']), 'status' => $row['status'], 'msg' => self::mask(mb_substr($row['msg'], 0, 300)), 'user' => Auth::user()['username'] ?? '']);
            }
            $res[] = $row;
        }
        if ($mode === 'apply') {
            Audit::log('wizard.' . $step, count(array_filter($res, fn($x) => $x['status'] === 'ok')) . ' ok');
        }
        $_SESSION['wizard_out'] = ['step' => $step, 'mode' => $mode, 'rows' => $res];
        App::redirect('/wizard#s-' . $step);
    }

    /** Use the generated least-privilege API user for this router from now on. */
    public static function useUser(): void
    {
        $cred = $_SESSION['wizard_cred'] ?? null;
        $cfg = App::routerCfg();
        if (!$cred || !$cfg || $cred['router'] !== $cfg['id'] || App::post('confirm') !== '1') {
            App::redirect('/wizard#s-user', t('Nothing to switch, or confirmation missing.'), 'err');
        }
        Store::update('routers', function ($list) use ($cred) {
            foreach ($list as &$r) {
                if ($r['id'] === $cred['router']) {
                    $r['user'] = $cred['user'];
                    $r['pass'] = (string)$cred['pass'];   // already encrypted when it was generated
                }
            }
            return $list;
        }, []);
        unset($_SESSION['wizard_cred']);
        Audit::log('wizard.switch-user', $cfg['id'] . ' -> ' . $cred['user']);
        App::redirect('/wizard#s-user', t('NextMON now connects with the least-privilege user. Use Routers > Test to confirm.'));
    }

    public static function templateZip(): void
    {
        $dir = self::templateDir();
        if (!$dir || !class_exists('ZipArchive')) {
            App::redirect('/wizard#s-template', t('Template folder or the PHP zip extension is not available.'), 'err');
        }
        $tmp = tempnam(sys_get_temp_dir(), 'klt');
        $z = new ZipArchive();
        if ($z->open($tmp, ZipArchive::OVERWRITE) !== true) {
            App::redirect('/wizard#s-template', t('Could not build the archive.'), 'err');
        }
        foreach (self::templateFiles($dir) as $rel => $size) {
            $z->addFile($dir . '/' . $rel, self::TEMPLATE_DIR_NAME . '/' . $rel);
        }
        $z->close();
        Audit::log('wizard.template.zip');
        header('Content-Type: application/zip');
        header('Content-Disposition: attachment; filename="hotspot-nextmon.zip"');
        header('Content-Length: ' . filesize($tmp));
        header('Cache-Control: no-store');
        readfile($tmp);
        @unlink($tmp);
        exit;
    }

    // ---- parameters ------------------------------------------------------------------------------

    private static function params(bool $lenient): array
    {
        $d = ['server_ip' => '', 'level' => 'op', 'api_user' => 'nextmon', 'ssl' => '', 'portal' => (string)(parse_url(App::origin(), PHP_URL_HOST) ?: ''),
            'ntp_servers' => 'id.pool.ntp.org', 'tz' => 'Asia/Jakarta', 'mode' => 'remc', 'lock_user' => '1', 'html_dir' => self::TEMPLATE_DIR_NAME, 'hs_profile' => ''];
        $d = array_replace($d, (array)($_SESSION['wizard_p'] ?? []));
        if ($lenient) {
            return $d;
        }
        $g = fn(string $k) => App::post($k, (string)$d[$k]);
        $p = ['server_ip' => $g('server_ip'), 'level' => $g('level'), 'api_user' => $g('api_user'), 'ssl' => App::post('ssl', ''), 'portal' => strtolower($g('portal')),
            'ntp_servers' => $g('ntp_servers'), 'tz' => $g('tz'), 'mode' => App::post('ol_mode', (string)$d['mode']), 'lock_user' => App::post('lock_user', ''), 'html_dir' => $g('html_dir'), 'hs_profile' => $g('hs_profile')];
        if ($p['server_ip'] !== '' && !preg_match('/^[0-9A-Fa-f:.]{2,45}(\/\d{1,3})?$/', $p['server_ip'])) {
            throw new InvalidArgumentException(t('Server address must be an IP or CIDR, for example 192.168.88.10 or 192.168.88.0/24.'));
        }
        if (!in_array($p['level'], ['op', 'ro'], true) || !preg_match('/^[A-Za-z0-9_.\-]{1,32}$/', $p['api_user'])) {
            throw new InvalidArgumentException(t('Check the API user name (letters, digits, - _ .).'));
        }
        if ($p['portal'] !== '' && !preg_match('/^[a-z0-9.\-*]{1,100}$/', $p['portal'])) {
            throw new InvalidArgumentException(t('Enter a valid host name (wildcards * and ? allowed).'));
        }
        if (!preg_match('/^[A-Za-z0-9.\-]+(,[A-Za-z0-9.\-]+)*$/', $p['ntp_servers']) || ($p['tz'] !== '' && !preg_match('#^[A-Za-z_]+(/[A-Za-z_\-+0-9]+){0,2}$#', $p['tz']))) {
            throw new InvalidArgumentException(t('Check the NTP servers and time zone.'));
        }
        if (!in_array($p['mode'], Scripts::MODES, true) || !preg_match('#^[A-Za-z0-9_\-/]{1,40}$#', $p['html_dir']) || ($p['hs_profile'] !== '' && !preg_match('/^[\w.\- ]{1,40}$/', $p['hs_profile']))) {
            throw new InvalidArgumentException(t('Check the on-login mode and the template folder name.'));
        }
        return $p;
    }

    private static function mask(string $s): string
    {
        return preg_replace('/(password=)("[^"]*"|\S+)/i', '$1"***"', $s);
    }

    // ---- command builders ---------------------------------------------------------------------------

    private static function q(string $v): string
    {
        return preg_match('/^[\w.\/:,\-*@]+$/', $v) ? $v : '"' . str_replace(['\\', '"', '$'], ['\\\\', '\\"', '\\$'], $v) . '"';
    }

    private static function cli(string $path, string $verb, array $a = [], string $find = ''): string
    {
        $s = trim(str_replace('/', ' ', $path)) . ' ' . $verb;
        if ($find !== '') {
            $s .= ' [find ' . $find . ']';
        }
        foreach ($a as $k => $v) {
            $s .= ' ' . $k . '=' . self::q((string)$v);
        }
        return '/' . $s;
    }

    private static function op(string $label, string $cli, ?callable $fn, ?string $ack = null, string $note = '', bool $stop = true, string $detail = ''): array
    {
        return ['label' => $label, 'cli' => $cli, 'fn' => $fn, 'ack' => $ack, 'note' => $note, 'stop' => $stop, 'detail' => $detail];
    }

    private static function idOf(Driver $r, string $path, string $name): ?string
    {
        $row = $r->print($path, ['name' => $name], ['name'])[0] ?? null;
        return $row['.id'] ?? null;
    }

    /** @return array[] ops for a step; reading router state is fine, changing it happens only inside ['fn'] */
    private static function ops(string $step, Driver $r, array $p): array
    {
        switch ($step) {
            case 'check':
                return self::opsCheck($r);
            case 'user':
                return self::opsUser($r, $p);
            case 'services':
                return self::opsServices($r, $p);
            case 'scripts':
                return self::opsScripts($r, $p);
            case 'walled':
                return self::opsWalled($r, $p);
            case 'ntp':
                return self::opsNtp($r, $p);
            case 'template':
                return self::opsTemplate($r, $p);
        }
        return [];
    }

    private static function opsCheck(Driver $r): array
    {
        return [
            self::op(t('Read system resource'), '/system resource print', function (Driver $r) {
                $x = $r->print('/system/resource')[0] ?? [];
                $ver = (string)($x['version'] ?? '?');
                $old = preg_match('/^(\d+)\.(\d+)/', $ver, $m) && ((int)$m[1] < 6 || ((int)$m[1] === 6 && (int)$m[2] < 43));
                return [$old ? 'warn' : 'ok', ($x['board-name'] ?? '?') . ' / RouterOS ' . $ver . ' / uptime ' . ($x['uptime'] ?? '?') . ' / CPU ' . ($x['cpu-load'] ?? '?') . '%' . ($old ? ' - ' . t('older than 6.43: legacy login is used') : '')];
            }),
            self::op(t('Read identity'), '/system identity print', fn(Driver $r) => (string)($r->print('/system/identity')[0]['name'] ?? '?')),
            self::op(t('Find hotspot servers'), '/ip hotspot print', function (Driver $r) {
                $h = $r->print('/ip/hotspot', [], ['name', 'interface']);
                return $h ? ['ok', implode(', ', array_map(fn($x) => ($x['name'] ?? '') . ' (' . ($x['interface'] ?? '') . ')', $h))] : ['warn', t('No hotspot server configured yet. Run /ip hotspot setup on the router first.')];
            }),
            self::op(t('Check API services'), '/ip service print', function (Driver $r) {
                $o = [];
                foreach ($r->print('/ip/service', [], ['name', 'port', 'address', 'disabled']) as $s) {
                    if (in_array($s['name'], ['api', 'api-ssl'], true)) {
                        $o[] = $s['name'] . ':' . $s['port'] . ' ' . (NetworkController::off($s) ? 'disabled' : 'enabled') . (($s['address'] ?? '') !== '' ? ' from ' . $s['address'] : ' from any');
                    }
                }
                return implode('; ', $o) ?: 'n/a';
            }),
            self::op(t('Check clock / NTP'), '/system clock print; /system ntp client print', function (Driver $r) {
                $c = $r->print('/system/clock')[0] ?? [];
                $n = $r->print('/system/ntp/client')[0] ?? [];
                $on = NetworkController::off($n) ? false : in_array((string)($n['enabled'] ?? ''), ['true', 'yes'], true);
                return [$on ? 'ok' : 'warn', ($c['date'] ?? '?') . ' ' . ($c['time'] ?? '') . ' ' . ($c['time-zone-name'] ?? '') . ' / NTP ' . ($on ? 'on (' . ($n['status'] ?? '') . ')' : 'OFF - voucher expiry needs correct time')];
            }),
            self::op(t('Look for an existing NextMON API user'), '/user print where name~"nextmon"', function (Driver $r) {
                $u = array_filter($r->print('/user', [], ['name', 'group', 'address']), fn($x) => strpos($x['name'] ?? '', 'nextmon') === 0);
                return $u ? implode('; ', array_map(fn($x) => $x['name'] . ' (' . ($x['group'] ?? '') . ')', $u)) : t('none yet');
            }),
        ];
    }

    private static function opsUser(Driver $r, array $p): array
    {
        $gname = $p['level'] === 'ro' ? 'nextmon-ro' : 'nextmon-op';
        $policy = $p['level'] === 'ro' ? 'read,api' : 'read,write,api,test,policy';
        $gid = self::idOf($r, '/user/group', $gname);
        $uid = self::idOf($r, '/user', $p['api_user']);
        $ops = [];
        $gAttrs = ['name' => $gname, 'policy' => $policy, 'comment' => 'NextMON ' . ($p['level'] === 'ro' ? 'read-only' : 'operator')];
        $ops[] = $gid
            ? self::op(t('Update group :g', [':g' => $gname]), self::cli('/user/group', 'set', ['policy' => $policy], 'name=' . $gname), fn(Driver $r) => $r->set('/user/group', $gid, ['policy' => $policy]) ?? 'updated')
            : self::op(t('Create group :g', [':g' => $gname]), self::cli('/user/group', 'add', $gAttrs), fn(Driver $r) => $r->add('/user/group', $gAttrs) ? 'created' : 'created');
        $uAttrs = ['name' => $p['api_user'], 'group' => $gname, 'comment' => 'NextMON API'];
        if ($p['server_ip'] !== '') {
            $uAttrs['address'] = $p['server_ip'];
        }
        $gen = function () use ($p) {
            $pw = Voucher::code(24, 'mixed');
            $_SESSION['wizard_cred'] = ['router' => App::currentRouterId(), 'user' => $p['api_user'], 'pass' => Crypto::encrypt($pw)];
            return $pw;
        };
        if (!$uid) {
            $ops[] = self::op(t('Create user :u', [':u' => $p['api_user']]), self::cli('/user', 'add', $uAttrs + ['password' => '<random 24 chars>']), function (Driver $r) use ($uAttrs, $gen) {
                $pw = $gen();
                $r->add('/user', $uAttrs + ['password' => $pw]);
                return t('Created. The generated password is stored for this session only; use "Use this user in NextMON" below, or note it from the router.');
            }, null, t('A random 24-character password is generated when you apply.'));
        } else {
            $ops[] = self::op(t('User :u already exists', [':u' => $p['api_user']]), self::cli('/user', 'set', $uAttrs + ['password' => '<random 24 chars>'], 'name=' . $p['api_user']), function (Driver $r) use ($uAttrs, $uid, $gen) {
                $pw = $gen();
                $r->set('/user', $uid, $uAttrs + ['password' => $pw]);
                return t('Password reset and group/address updated.');
            }, 'resetuser', t('Needs the extra confirmation: this resets the password of the existing user and may disconnect the program using it.'), false);
        }
        if ($p['server_ip'] === '') {
            $ops[0]['note'] = trim(($ops[0]['note'] ?? '') . ' ' . t('No server address given: the user will be allowed from anywhere. Fill "NextMON server address" to restrict it.'));
        }
        return $ops;
    }

    private static function opsServices(Driver $r, array $p): array
    {
        $ops = [];
        $addr = $p['server_ip'];
        $apiId = self::idOf($r, '/ip/service', 'api');
        $attrs = ['disabled' => 'no', 'port' => '8728'];
        if ($addr !== '') {
            $attrs['address'] = $addr;
        }
        $ops[] = self::op(t('Enable API (8728)'), self::cli('/ip/service', 'set', $attrs, 'name=api'), function (Driver $r) use ($apiId, $attrs) {
            if (!$apiId) {
                throw new RouterOSException('service api not found');
            }
            $r->set('/ip/service', $apiId, $attrs);
            return 'ok';
        }, $addr !== '' ? 'lockout' : null, $addr !== '' ? t('Restricting the API to :a locks NextMON out if NextMON connects from another address. Needs the extra confirmation.', [':a' => $addr]) : t('No address restriction (any source). Recommended: set the NextMON server address.'));
        if ($p['ssl'] === '1') {
            $have = fn($n) => self::idOf($r, '/certificate', $n);
            if (!$have('nextmon-api')) {
                $ca = ['name' => 'nextmon-ca', 'common-name' => 'nextmon-ca', 'days-valid' => '3650', 'key-usage' => 'key-cert-sign,crl-sign'];
                $ce = ['name' => 'nextmon-api', 'common-name' => 'nextmon-api', 'days-valid' => '3650'];
                if (!$have('nextmon-ca')) {
                    $ops[] = self::op(t('Create certificate authority'), self::cli('/certificate', 'add', $ca), fn(Driver $r) => $r->add('/certificate', $ca) ? 'ok' : 'ok');
                    $ops[] = self::op(t('Sign CA (can take up to a minute)'), '/certificate sign nextmon-ca', fn(Driver $r) => $r->command('/certificate/sign', ['number' => 'nextmon-ca']) ? 'signed' : 'signed');
                }
                $ops[] = self::op(t('Create API certificate'), self::cli('/certificate', 'add', $ce), fn(Driver $r) => $r->add('/certificate', $ce) ? 'ok' : 'ok');
                $ops[] = self::op(t('Sign API certificate'), '/certificate sign nextmon-api ca=nextmon-ca', fn(Driver $r) => $r->command('/certificate/sign', ['number' => 'nextmon-api', 'ca' => 'nextmon-ca']) ? 'signed' : 'signed');
            }
            $sslId = self::idOf($r, '/ip/service', 'api-ssl');
            $sa = ['disabled' => 'no', 'port' => '8729', 'certificate' => 'nextmon-api'] + ($addr !== '' ? ['address' => $addr] : []);
            $ops[] = self::op(t('Enable API-SSL (8729)'), self::cli('/ip/service', 'set', $sa, 'name=api-ssl'), function (Driver $r) use ($sslId, $sa) {
                if (!$sslId) {
                    throw new RouterOSException('service api-ssl not found');
                }
                $r->set('/ip/service', $sslId, $sa);
                return 'ok';
            }, $addr !== '' ? 'lockout' : null);
        }
        return $ops;
    }

    private static function cleanupSource(): string
    {
        return <<<'RSC'
:local purge false
:foreach s in=[/system scheduler find where name~"^kl-exp-"] do={
  :local n [/system scheduler get $s name]
  :local u [:pick $n 7 [:len $n]]
  :if ([:len [/ip hotspot user find where name=$u]]=0) do={
    /system scheduler remove $s
    :log info ("nextmon-cleanup: orphan scheduler removed " . $n)
  }
}
:if ($purge) do={
  :foreach i in=[/ip hotspot user find where limit-uptime=1s] do={
    :local u [/ip hotspot user get $i name]
    :if ([:len [/ip hotspot active find where user=$u]]=0) do={
      /ip hotspot user remove $i
      :log info ("nextmon-cleanup: expired user removed " . $u)
    }
  }
}
RSC;
    }

    private static function opsScripts(Driver $r, array $p): array
    {
        $ops = [];
        $src = self::cleanupSource();
        $sid = self::idOf($r, '/system/script', 'nextmon-cleanup');
        $ops[] = self::op($sid ? t('Update expiry cleanup script') : t('Install expiry cleanup script'), self::cli('/system/script', $sid ? 'set' : 'add', ['name' => 'nextmon-cleanup', 'policy' => 'read,write,policy,test', 'source' => '<see below>']), function (Driver $r) use ($sid, $src) {
            $a = ['source' => $src, 'policy' => 'read,write,policy,test'];
            $sid ? $r->set('/system/script', $sid, $a) : $r->add('/system/script', ['name' => 'nextmon-cleanup'] + $a);
            return 'ok';
        }, null, t('Removes orphan expiry schedulers (docs/mikrotik-scripts/02).'), true, $src);
        $kid = self::idOf($r, '/system/scheduler', 'nextmon-cleanup');
        $sch = ['interval' => '1h', 'start-time' => 'startup', 'on-event' => '/system script run nextmon-cleanup', 'policy' => 'read,write,policy,test', 'comment' => 'nextmon'];
        $ops[] = self::op($kid ? t('Update cleanup scheduler') : t('Add cleanup scheduler (hourly)'), self::cli('/system/scheduler', $kid ? 'set' : 'add', ['name' => 'nextmon-cleanup'] + $sch), function (Driver $r) use ($kid, $sch) {
            $kid ? $r->set('/system/scheduler', $kid, $sch) : $r->add('/system/scheduler', ['name' => 'nextmon-cleanup'] + $sch);
            return 'ok';
        });
        $sel = (array)($_POST['profiles'] ?? []);
        $price = (array)($_POST['price'] ?? []);
        $valid = (array)($_POST['validity'] ?? []);
        foreach ($r->print('/ip/hotspot/user/profile', [], ['name', 'on-login']) as $pr) {
            $n = (string)$pr['name'];
            if (!in_array($n, $sel, true) || in_array($n, ['default', 'default-encryption'], true)) {
                continue;
            }
            $pc = preg_replace('/[^0-9]/', '', (string)($price[$n] ?? '0')) ?: '0';
            $vl = strtolower(trim((string)($valid[$n] ?? '')));
            if (!Scripts::validDuration($vl)) {
                throw new InvalidArgumentException(t('Invalid validity for profile :p (example 1d, 3h, 30d).', [':p' => $n]));
            }
            $script = Scripts::onLogin($p['mode'], $pc, $vl, $pc, $p['lock_user'] === '1', false, $n);
            $had = trim((string)($pr['on-login'] ?? '')) !== '';
            $pid = $pr['.id'];
            $ops[] = self::op(t('Install on-login script on profile :p', [':p' => $n]), self::cli('/ip/hotspot/user/profile', 'set', ['on-login' => '<see below>'], 'name=' . $n), function (Driver $r) use ($pid, $script) {
                $r->set('/ip/hotspot/user/profile', $pid, ['on-login' => $script]);
                return 'ok';
            }, $had ? 'overwrite' : null, $had ? t('This profile already has an on-login script. Replacing it changes pricing/expiry behaviour. Needs the extra confirmation.') : '', false, $script);
        }
        return $ops;
    }

    /** Recommended walled garden hosts (docs/mikrotik-scripts/08). */
    public static function walledDefaults(string $portal): array
    {
        $l = [];
        if ($portal !== '') {
            $l[] = $portal;
        }
        return array_merge($l, ['*.midtrans.com', '*.xendit.co', '*.tripay.co.id', 'captive.apple.com', 'connectivitycheck.gstatic.com']);
    }

    /** @return int number of entries added (existing hosts are left alone) */
    public static function applyWalledGarden(Driver $r, string $portal): int
    {
        $have = array_column($r->print('/ip/hotspot/walled-garden', [], ['dst-host']), 'dst-host');
        $n = 0;
        foreach (self::walledDefaults($portal) as $h) {
            if (!in_array($h, $have, true)) {
                $r->add('/ip/hotspot/walled-garden', ['dst-host' => $h, 'action' => 'allow', 'comment' => 'nextmon']);
                $n++;
            }
        }
        return $n;
    }

    private static function opsWalled(Driver $r, array $p): array
    {
        $have = array_column($r->print('/ip/hotspot/walled-garden', [], ['dst-host']), 'dst-host');
        $ops = [];
        foreach (self::walledDefaults($p['portal']) as $h) {
            $a = ['dst-host' => $h, 'action' => 'allow', 'comment' => 'nextmon'];
            if (in_array($h, $have, true)) {
                $ops[] = self::op(t('Already present: :h', [':h' => $h]), self::cli('/ip/hotspot/walled-garden', 'add', $a), null, null, t('Nothing to do.'));
            } else {
                $ops[] = self::op(t('Allow :h without login', [':h' => $h]), self::cli('/ip/hotspot/walled-garden', 'add', $a), function (Driver $r) use ($a) {
                    $r->add('/ip/hotspot/walled-garden', $a);
                    return 'ok';
                }, null, '', false);
            }
        }
        return $ops;
    }

    private static function opsNtp(Driver $r, array $p): array
    {
        $n = $r->print('/system/ntp/client')[0] ?? [];
        $on = in_array((string)($n['enabled'] ?? ''), ['true', 'yes'], true);
        $ops = [self::op(t('Show current NTP/SNTP state'), '/system ntp client print', fn() => [$on ? 'ok' : 'warn', 'enabled=' . ($on ? 'yes' : 'no') . ' status=' . ($n['status'] ?? '?') . ' servers=' . ($n['servers'] ?? ($n['primary-ntp'] ?? '?'))])];
        if (!$on) {
            $key = array_key_exists('servers', $n) ? 'servers' : (array_key_exists('server-dns-names', $n) ? 'server-dns-names' : 'primary-ntp');
            $a = ['enabled' => 'yes', $key => $p['ntp_servers']];
            $ops[] = self::op(t('Enable NTP client'), self::cli('/system/ntp/client', 'set', $a), function (Driver $r) use ($a, $key, $p) {
                if ($key === 'primary-ntp' && !filter_var($p['ntp_servers'], FILTER_VALIDATE_IP)) {
                    throw new RouterOSException(t('This RouterOS version needs an IP address for primary-ntp. Enter an NTP server IP.'));
                }
                $r->command('/system/ntp/client/set', $a);
                return 'ok';
            }, null, t('Voucher expiry is calculated from the router clock.'));
        }
        if ($p['tz'] !== '') {
            $ops[] = self::op(t('Set time zone :z', [':z' => $p['tz']]), self::cli('/system/clock', 'set', ['time-zone-name' => $p['tz']]), function (Driver $r) use ($p) {
                $r->command('/system/clock/set', ['time-zone-name' => $p['tz']]);
                return 'ok';
            }, 'tz', t('Changing the time zone shifts the router clock; needs the extra confirmation.'), false);
        }
        return $ops;
    }

    public static function templateDir(): ?string
    {
        foreach ([dirname(App::$root) . '/shared/hotspot-login', App::$root . '/shared/hotspot-login'] as $d) {
            if (is_file($d . '/login.html')) {
                return $d;
            }
        }
        return null;
    }

    /** @return array rel path => size (files that belong on the router) */
    public static function templateFiles(string $dir): array
    {
        $out = [];
        $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS));
        foreach ($it as $f) {
            $rel = str_replace('\\', '/', substr($f->getPathname(), strlen($dir) + 1));
            if ($f->isFile() && strncmp($rel, 'tools/', 6) !== 0 && substr($rel, -8) !== '.test.js' && strcasecmp($rel, 'README.md') !== 0) {
                $out[$rel] = $f->getSize();
            }
        }
        ksort($out);
        return $out;
    }

    private static function opsTemplate(Driver $r, array $p): array
    {
        $dir = $p['html_dir'];
        $files = self::templateDir() ? self::templateFiles(self::templateDir()) : [];
        $ops = [];
        $ops[] = self::op(t('Check that :f is on the router', [':f' => $dir . '/login.html']), '/file print where name="' . $dir . '/login.html"', function (Driver $r) use ($dir) {
            $f = $r->print('/file', [], ['name']);
            $hit = array_filter($f, fn($x) => ($x['name'] ?? '') === $dir . '/login.html' || ($x['name'] ?? '') === 'flash/' . $dir . '/login.html');
            return $hit ? ['ok', t('Found.')] : ['warn', t('Not found yet. Upload the folder first (see the instructions), then check again.')];
        }, null, '', false);
        if (App::isDemo()) {
            array_unshift($ops, self::op(t('Demo only: pretend the files were uploaded'), '# (demo router has no FTP)', function (Driver $r) use ($dir, $files) {
                foreach (array_keys($files) ?: ['login.html'] as $rel) {
                    $r->add('/file', ['name' => $dir . '/' . $rel, 'type' => 'file', 'size' => '1000', 'creation-time' => strtolower(date('M/d/Y H:i:s'))]);
                }
                return 'ok';
            }, null, t('Simulation for the demo router only.'), false));
        }
        if ($p['hs_profile'] !== '') {
            $pid = self::idOf($r, '/ip/hotspot/profile', $p['hs_profile']);
            $ops[] = self::op(t('Point hotspot profile :p to the template', [':p' => $p['hs_profile']]), self::cli('/ip/hotspot/profile', 'set', ['html-directory' => $dir], 'name=' . $p['hs_profile']), function (Driver $r) use ($dir, $pid) {
                if (!$pid) {
                    throw new RouterOSException('hotspot profile not found');
                }
                $f = array_filter($r->print('/file', [], ['name']), fn($x) => in_array($x['name'] ?? '', [$dir . '/login.html', 'flash/' . $dir . '/login.html'], true));
                if (!$f) {
                    throw new RouterOSException(t('Template files not found on the router; upload them first.'));
                }
                $r->set('/ip/hotspot/profile', $pid, ['html-directory' => $dir]);
                return t('Done. Guests now see the NextMON login page.');
            }, 'htmldir', t('This changes the live login page for all guests. Needs the extra confirmation.'));
        }
        return $ops;
    }
}
