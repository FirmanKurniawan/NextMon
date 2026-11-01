<?php
/** PPPoE, DHCP leases, ARP and Walled garden. Everything goes through the Driver so it works on RouterOS and Demo. */
class NetworkController
{
    // ---- helpers -----------------------------------------------------------------------

    public static function off(array $row): bool
    {
        return in_array((string)($row['disabled'] ?? ''), ['true', 'yes'], true);
    }

    private static function isTrue($v): bool
    {
        return in_array((string)$v, ['true', 'yes'], true);
    }

    /** RouterOS item ids only (*1A). */
    private static function ids(): array
    {
        return array_values(array_filter(App::postArr('ids'), fn($i) => (bool)preg_match('/^\*[0-9A-Fa-f]+$/', $i)));
    }

    private static function validId(string $id): bool
    {
        return $id === '' || (bool)preg_match('/^\*[0-9A-Fa-f]+$/', $id);
    }

    private static function validIp(string $v, bool $empty = true): bool
    {
        return $v === '' ? $empty : (bool)filter_var($v, FILTER_VALIDATE_IP);
    }

    private static function validMac(string $v, bool $empty = true): bool
    {
        return $v === '' ? $empty : (bool)preg_match('/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/', $v);
    }

    private static function search(array $rows, string $q, array $fields): array
    {
        $q = strtolower($q);
        if ($q === '') {
            return $rows;
        }
        return array_values(array_filter($rows, function ($r) use ($q, $fields) {
            foreach ($fields as $f) {
                if (strpos(strtolower((string)($r[$f] ?? '')), $q) !== false) {
                    return true;
                }
            }
            return false;
        }));
    }

    /** Run $fn for every id; one failure does not abort the rest. @return array [done, failed, lastError] */
    private static function each(array $ids, callable $fn): array
    {
        $ok = 0;
        $bad = 0;
        $err = '';
        foreach ($ids as $id) {
            try {
                $fn($id);
                $ok++;
            } catch (RouterOSException $e) {
                $bad++;
                $err = $e->getMessage();
            }
        }
        return [$ok, $bad, $err];
    }

    private static function report(string $back, array $res, string $action): void
    {
        [$ok, $bad, $err] = $res;
        Audit::log($action, "$ok ok, $bad failed");
        if ($ok === 0 && $bad === 0) {
            App::redirect($back, t('Nothing selected.'), 'err');
        }
        App::redirect($back, t('Done: :n items.', [':n' => $ok]) . ($bad ? ' ' . t(':n failed: :e', [':n' => $bad, ':e' => $err]) : ''), $bad ? 'err' : 'ok');
    }

    // ---- PPPoE ---------------------------------------------------------------------------

    public static function pppoe(): void
    {
        $r = App::driver();
        $q = App::get('q');
        $prof = App::get('profile');
        $status = App::get('status');
        $secrets = $r->print('/ppp/secret');
        $active = $r->print('/ppp/active');
        $profiles = $r->print('/ppp/profile');
        $online = [];
        foreach ($active as $a) {
            $online[$a['name']] = $a;
        }
        foreach ($secrets as &$s) {
            $s['_online'] = isset($online[$s['name']]);
            $s['_addr'] = $online[$s['name']]['address'] ?? '';
        }
        unset($s);
        $rows = array_values(array_filter(self::search($secrets, $q, ['name', 'comment', 'caller-id', 'remote-address']), function ($s) use ($prof, $status) {
            if ($prof !== '' && ($s['profile'] ?? '') !== $prof) {
                return false;
            }
            return match ($status) {
                'online' => $s['_online'], 'offline' => !$s['_online'] && !self::off($s), 'disabled' => self::off($s), default => true,
            };
        }));
        $total = count($rows);
        [$rows, $pg, $pages] = App::paginate($rows, 100);
        $inUse = array_count_values(array_column($secrets, 'profile'));
        App::render('pppoe', [
            'title' => t('PPPoE'), 'page' => 'pppoe', 'rows' => $rows, 'active' => self::search($active, App::get('aq'), ['name', 'address', 'caller-id']), 'profiles' => $profiles,
            'q' => $q, 'prof' => $prof, 'status' => $status, 'pg' => $pg, 'pages' => $pages, 'total' => $total, 'inUse' => $inUse,
            'counts' => ['secrets' => count($secrets), 'active' => count($active), 'disabled' => count(array_filter($secrets, fn($s) => self::off($s)))],
        ]);
    }

    public static function pppSecretSave(): void
    {
        $r = App::driver();
        $id = App::post('id');
        $name = App::post('name');
        $pass = $_POST['password'] ?? '';
        $pass = is_string($pass) ? $pass : '';
        $service = App::post('service', 'pppoe');
        $caller = strtoupper(App::post('caller_id'));
        $local = App::post('local_address');
        $remote = App::post('remote_address');
        if (!self::validId($id) || !preg_match('/^[\w.@\-]{1,64}$/', $name) || !in_array($service, ['any', 'pppoe', 'pptp', 'l2tp', 'sstp', 'ovpn'], true)
            || !preg_match('/^[\w.\-]{1,40}$/', App::post('profile', 'default')) || !self::validMac($caller) || !self::validIp($local) || !self::validIp($remote)
            || ($id === '' && ($pass === '' || strlen($pass) > 64)) || preg_match('/[\r\n"]/', $pass)) {
            App::redirect('/pppoe', t('Check name, password, profile, MAC, and IP addresses.'), 'err');
        }
        $attrs = ['name' => $name, 'service' => $service, 'profile' => App::post('profile', 'default'), 'caller-id' => $caller, 'local-address' => $local, 'remote-address' => $remote, 'comment' => App::post('comment')];
        if ($pass !== '') {
            $attrs['password'] = $pass;
        }
        $id !== '' ? $r->set('/ppp/secret', $id, $attrs) : $r->add('/ppp/secret', $attrs);
        Audit::log('ppp.secret.save', $name);
        App::redirect('/pppoe', t('Secret saved.'));
    }

    public static function pppSecretAction(): void
    {
        $r = App::driver();
        $act = App::post('action');
        $ids = self::ids();
        $profile = App::post('profile');
        $names = [];
        if (in_array($act, ['remove', 'kick', 'disable'], true)) {
            foreach ($r->print('/ppp/secret', [], ['name']) as $s) {
                if (in_array($s['.id'], $ids, true)) {
                    $names[$s['.id']] = $s['name'];
                }
            }
        }
        $kick = function (string $name) use ($r) {
            foreach ($r->print('/ppp/active', ['name' => $name], ['name']) as $a) {
                $r->remove('/ppp/active', $a['.id']);
            }
        };
        switch ($act) {
            case 'enable':
            case 'disable':
                $res = self::each($ids, fn($id) => $r->set('/ppp/secret', $id, ['disabled' => $act === 'disable' ? 'yes' : 'no']));
                if ($act === 'disable') { // a disabled secret only blocks the next login: drop live sessions too
                    self::each(array_values($names), function ($n) use ($kick) {
                        $kick($n);
                    });
                }
                break;
            case 'remove':
                $res = self::each($ids, function ($id) use ($r, $names, $kick) {
                    if (isset($names[$id])) {
                        $kick($names[$id]);
                    }
                    $r->remove('/ppp/secret', $id);
                });
                break;
            case 'kick':
                $res = self::each($ids, function ($id) use ($names, $kick) {
                    $kick($names[$id] ?? '');
                });
                break;
            case 'setprofile':
                if (!preg_match('/^[\w.\-]{1,40}$/', $profile)) {
                    App::redirect('/pppoe', t('Choose a profile.'), 'err');
                }
                $res = self::each($ids, fn($id) => $r->set('/ppp/secret', $id, ['profile' => $profile]));
                break;
            default:
                App::redirect('/pppoe', t('Unknown action.'), 'err');
        }
        self::report('/pppoe', $res, 'ppp.secret.' . $act);
    }

    public static function pppActiveKick(): void
    {
        $r = App::driver();
        self::report('/pppoe#active', self::each(self::ids(), fn($id) => $r->remove('/ppp/active', $id)), 'ppp.active.kick');
    }

    public static function pppProfileSave(): void
    {
        $r = App::driver();
        $id = App::post('id');
        $name = App::post('name');
        $rate = App::post('rate_limit');
        if (!self::validId($id) || !preg_match('/^[\w.\-]{1,40}$/', $name) || ($rate !== '' && !preg_match('/^\d+[kMG]?(\/\d+[kMG]?)?( .+)?$/', $rate))
            || !preg_match('/^[\w.\-\/]{0,40}$/', App::post('local_address')) || !preg_match('/^[\w.\-\/]{0,40}$/', App::post('remote_address'))
            || !in_array(App::post('only_one', 'default'), ['default', 'yes', 'no'], true)) {
            App::redirect('/pppoe#profiles', t('Check name, rate limit (example 5M/5M) and addresses.'), 'err');
        }
        $attrs = ['name' => $name, 'local-address' => App::post('local_address'), 'remote-address' => App::post('remote_address'), 'rate-limit' => $rate, 'only-one' => App::post('only_one', 'default')];
        $id !== '' ? $r->set('/ppp/profile', $id, $attrs) : $r->add('/ppp/profile', $attrs);
        Audit::log('ppp.profile.save', $name);
        App::redirect('/pppoe#profiles', t('Profile saved.'));
    }

    public static function pppProfileDelete(): void
    {
        $r = App::driver();
        $id = App::post('id');
        $row = $r->print('/ppp/profile', ['.id' => $id])[0] ?? null;
        if (!$row || !self::validId($id)) {
            App::redirect('/pppoe#profiles', t('Profile not found.'), 'err');
        }
        if (in_array($row['name'], ['default', 'default-encryption'], true) || self::isTrue($row['default'] ?? '')) {
            App::redirect('/pppoe#profiles', t('Built-in profiles cannot be deleted.'), 'err');
        }
        if ($r->print('/ppp/secret', ['profile' => $row['name']], ['name'])) {
            App::redirect('/pppoe#profiles', t('Profile is still used by secrets. Move them to another profile first.'), 'err');
        }
        $r->remove('/ppp/profile', $id);
        Audit::log('ppp.profile.delete', $row['name']);
        App::redirect('/pppoe#profiles', t('Profile deleted.'));
    }

    // ---- DHCP leases -----------------------------------------------------------------------

    public static function dhcp(): void
    {
        $r = App::driver();
        $q = App::get('q');
        $type = App::get('type');
        $all = $r->print('/ip/dhcp-server/lease');
        $rows = array_values(array_filter(self::search($all, $q, ['address', 'mac-address', 'host-name', 'comment', 'server']), function ($l) use ($type) {
            $dyn = self::isTrue($l['dynamic'] ?? '');
            return $type === '' || ($type === 'dynamic' ? $dyn : !$dyn);
        }));
        usort($rows, fn($a, $b) => ip2long($a['address'] ?? '0') <=> ip2long($b['address'] ?? '0'));
        $total = count($rows);
        [$rows, $pg, $pages] = App::paginate($rows, 100);
        $servers = array_values(array_unique(array_column($r->print('/ip/dhcp-server', [], ['name']), 'name')));
        App::render('dhcp', ['title' => t('DHCP leases'), 'page' => 'dhcp', 'rows' => $rows, 'q' => $q, 'type' => $type, 'pg' => $pg, 'pages' => $pages, 'total' => $total, 'servers' => $servers, 'nDyn' => count(array_filter($all, fn($l) => self::isTrue($l['dynamic'] ?? '')))]);
    }

    public static function dhcpSave(): void
    {
        $r = App::driver();
        $id = App::post('id');
        $addr = App::post('address');
        $mac = strtoupper(App::post('mac'));
        $server = App::post('server');
        if (!self::validId($id) || !self::validIp($addr, false) || !self::validMac($mac, false) || !preg_match('/^[\w.\- ]{0,40}$/', $server)) {
            App::redirect('/dhcp', t('Check the IP address and MAC address.'), 'err');
        }
        $attrs = ['address' => $addr, 'mac-address' => $mac, 'comment' => App::post('comment')];
        if ($server !== '') {
            $attrs['server'] = $server;
        }
        $id !== '' ? $r->set('/ip/dhcp-server/lease', $id, $attrs) : $r->add('/ip/dhcp-server/lease', $attrs);
        Audit::log('dhcp.save', "$addr $mac");
        App::redirect('/dhcp', t('Lease saved.'));
    }

    public static function dhcpAction(): void
    {
        $r = App::driver();
        $act = App::post('action');
        $ids = self::ids();
        switch ($act) {
            case 'static':
                $res = self::each($ids, fn($id) => $r->command('/ip/dhcp-server/lease/make-static', ['numbers' => $id]));
                break;
            case 'remove':
                $res = self::each($ids, fn($id) => $r->remove('/ip/dhcp-server/lease', $id));
                break;
            case 'enable':
            case 'disable':
                $res = self::each($ids, fn($id) => $r->set('/ip/dhcp-server/lease', $id, ['disabled' => $act === 'disable' ? 'yes' : 'no']));
                break;
            default:
                App::redirect('/dhcp', t('Unknown action.'), 'err');
        }
        self::report('/dhcp', $res, 'dhcp.' . $act);
    }

    // ---- ARP -------------------------------------------------------------------------------

    public static function arp(): void
    {
        $r = App::driver();
        $q = App::get('q');
        $if = App::get('iface');
        $type = App::get('type');
        $all = $r->print('/ip/arp');
        $ifaces = array_values(array_unique(array_column($all, 'interface')));
        sort($ifaces);
        $rows = array_values(array_filter(self::search($all, $q, ['address', 'mac-address', 'comment', 'interface']), function ($a) use ($if, $type) {
            $dyn = self::isTrue($a['dynamic'] ?? '');
            return ($if === '' || ($a['interface'] ?? '') === $if) && ($type === '' || ($type === 'dynamic' ? $dyn : !$dyn));
        }));
        usort($rows, fn($a, $b) => ip2long($a['address'] ?? '0') <=> ip2long($b['address'] ?? '0'));
        $total = count($rows);
        [$rows, $pg, $pages] = App::paginate($rows, 100);
        $ifList = array_column($r->print('/interface', [], ['name']), 'name');
        App::render('arp', ['title' => t('ARP'), 'page' => 'arp', 'rows' => $rows, 'q' => $q, 'iface' => $if, 'type' => $type, 'ifaces' => $ifaces, 'ifList' => $ifList ?: $ifaces, 'pg' => $pg, 'pages' => $pages, 'total' => $total]);
    }

    public static function arpSave(): void
    {
        $r = App::driver();
        $id = App::post('id');
        $addr = App::post('address');
        $mac = strtoupper(App::post('mac'));
        $if = App::post('interface');
        if (!self::validId($id) || !self::validIp($addr, false) || !self::validMac($mac, false) || !preg_match('/^[\w.\-]{1,40}$/', $if)) {
            App::redirect('/arp', t('Check the IP address, MAC address and interface.'), 'err');
        }
        $attrs = ['address' => $addr, 'mac-address' => $mac, 'interface' => $if, 'comment' => App::post('comment')];
        $id !== '' ? $r->set('/ip/arp', $id, $attrs) : $r->add('/ip/arp', $attrs);
        Audit::log('arp.save', "$addr $mac");
        App::redirect('/arp', t('ARP entry saved.'));
    }

    public static function arpAction(): void
    {
        $r = App::driver();
        $act = App::post('action');
        $ids = self::ids();
        $byId = [];
        foreach ($r->print('/ip/arp') as $a) {
            $byId[$a['.id']] = $a;
        }
        $skipDyn = 0;
        switch ($act) {
            case 'static': // pin the current dynamic entry as a static one
                $res = self::each($ids, function ($id) use ($r, $byId) {
                    $a = $byId[$id] ?? null;
                    if ($a && self::isTrue($a['dynamic'] ?? '')) {
                        $r->add('/ip/arp', ['address' => $a['address'], 'mac-address' => $a['mac-address'], 'interface' => $a['interface'], 'comment' => $a['comment'] ?? '']);
                    }
                });
                break;
            case 'remove':
            case 'enable':
            case 'disable':
                $static = array_values(array_filter($ids, fn($id) => !self::isTrue($byId[$id]['dynamic'] ?? 'false')));
                $skipDyn = count($ids) - count($static); // RouterOS does not allow editing dynamic entries
                $res = self::each($static, function ($id) use ($r, $act) {
                    $act === 'remove' ? $r->remove('/ip/arp', $id) : $r->set('/ip/arp', $id, ['disabled' => $act === 'disable' ? 'yes' : 'no']);
                });
                break;
            default:
                App::redirect('/arp', t('Unknown action.'), 'err');
        }
        if ($skipDyn > 0 && $res[0] + $res[1] === 0) {
            App::redirect('/arp', t('Dynamic entries cannot be changed. Use "Make static" first.'), 'err');
        }
        self::report('/arp', $res, 'arp.' . $act);
    }

    // ---- Walled garden ------------------------------------------------------------------------

    public static function walled(): void
    {
        $r = App::driver();
        $q = App::get('q');
        $hosts = self::search($r->print('/ip/hotspot/walled-garden'), $q, ['dst-host', 'comment', 'server']);
        $ips = self::search($r->print('/ip/hotspot/walled-garden/ip'), $q, ['dst-address', 'dst-host', 'comment', 'dst-port']);
        $servers = array_values(array_unique(array_column($r->print('/ip/hotspot', [], ['name']), 'name')));
        App::render('walledgarden', [
            'title' => t('Walled garden'), 'page' => 'walledgarden', 'hosts' => $hosts, 'ips' => $ips, 'q' => $q, 'servers' => $servers,
            'portal' => (string)(parse_url(App::origin(), PHP_URL_HOST) ?: ''),
        ]);
    }

    public static function walledSave(): void
    {
        $r = App::driver();
        $kind = App::post('kind') === 'ip' ? 'ip' : 'host';
        $id = App::post('id');
        $server = App::post('server');
        $comment = App::post('comment');
        $back = '/walledgarden' . ($kind === 'ip' ? '#ip' : '');
        if (!self::validId($id) || !preg_match('/^[\w.\- ]{0,40}$/', $server)) {
            App::redirect($back, t('Check the entry.'), 'err');
        }
        if ($kind === 'host') {
            $host = strtolower(App::post('dst_host'));
            $action = App::post('action', 'allow');
            if (!preg_match('/^[a-z0-9*?][a-z0-9.\-*?_]{0,100}$/', $host) || !in_array($action, ['allow', 'deny'], true)) {
                App::redirect($back, t('Enter a valid host name (wildcards * and ? allowed).'), 'err');
            }
            $attrs = ['dst-host' => $host, 'action' => $action, 'comment' => $comment];
            if ($server !== '') {
                $attrs['server'] = $server;
            }
            $path = '/ip/hotspot/walled-garden';
            $label = $host;
        } else {
            $addr = App::post('dst_address');
            $proto = App::post('protocol', 'tcp');
            $port = App::post('dst_port');
            $action = App::post('action', 'accept');
            if (!preg_match('/^[0-9A-Fa-f:.\/]{3,60}$/', $addr) || !in_array($proto, ['', 'tcp', 'udp', 'icmp'], true) || !preg_match('/^\d{1,5}(-\d{1,5})?(,\d{1,5}(-\d{1,5})?)*$|^$/', $port)
                || !in_array($action, ['accept', 'drop', 'reject'], true)) {
                App::redirect($back, t('Check address, protocol and port.'), 'err');
            }
            $attrs = ['dst-address' => $addr, 'action' => $action, 'comment' => $comment];
            if ($proto !== '') {
                $attrs['protocol'] = $proto;
            }
            if ($port !== '') {
                $attrs['dst-port'] = $port;
            }
            if ($server !== '') {
                $attrs['server'] = $server;
            }
            $path = '/ip/hotspot/walled-garden/ip';
            $label = $addr;
        }
        $id !== '' ? $r->set($path, $id, $attrs) : $r->add($path, $attrs);
        Audit::log('walled.save', $kind . ' ' . $label);
        App::redirect($back, t('Entry saved.'));
    }

    public static function walledAction(): void
    {
        $r = App::driver();
        $kind = App::post('kind') === 'ip' ? 'ip' : 'host';
        $path = $kind === 'ip' ? '/ip/hotspot/walled-garden/ip' : '/ip/hotspot/walled-garden';
        $act = App::post('action');
        $ids = self::ids();
        switch ($act) {
            case 'remove':
                $res = self::each($ids, fn($id) => $r->remove($path, $id));
                break;
            case 'enable':
            case 'disable':
                $res = self::each($ids, fn($id) => $r->set($path, $id, ['disabled' => $act === 'disable' ? 'yes' : 'no']));
                break;
            case 'toggle':
                $byId = [];
                foreach ($r->print($path) as $w) {
                    $byId[$w['.id']] = $w;
                }
                $res = self::each($ids, fn($id) => $r->set($path, $id, ['disabled' => self::off($byId[$id] ?? []) ? 'no' : 'yes']));
                break;
            default:
                App::redirect('/walledgarden', t('Unknown action.'), 'err');
        }
        self::report('/walledgarden' . ($kind === 'ip' ? '#ip' : ''), $res, 'walled.' . $act);
    }

    /** Add the recommended defaults (docs/mikrotik-scripts/08) that are not present yet. */
    public static function walledDefaults(): void
    {
        $r = App::driver();
        $portal = strtolower(App::post('portal'));
        if ($portal !== '' && !preg_match('/^[a-z0-9.\-]{1,100}$/', $portal)) {
            App::redirect('/walledgarden', t('Enter a valid host name (wildcards * and ? allowed).'), 'err');
        }
        $n = WizardController::applyWalledGarden($r, $portal);
        Audit::log('walled.defaults', (string)$n);
        App::redirect('/walledgarden', t('Defaults applied: :n new entries.', [':n' => $n]));
    }
}
