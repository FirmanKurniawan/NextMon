<?php
/**
 * Demo data + commands for the network module (PPPoE, DHCP, ARP, walled garden, services, users, NTP).
 * Used by Demo.php so the UI is explorable without a device. Tables are added lazily to existing demo files.
 */
final class DemoNet
{
    private const TABLES = [
        '/ppp/profile', '/ppp/secret', '/ppp/active', '/ip/dhcp-server/lease', '/ip/arp', '/ip/hotspot/walled-garden',
        '/ip/hotspot/walled-garden/ip', '/system/ntp/client', '/user/group', '/user', '/ip/service', '/certificate',
    ];

    private static function nid(array &$db): string
    {
        $db['n'] = ($db['n'] ?? 0) + 1;
        return '*' . strtoupper(dechex($db['n']));
    }

    private static function mac(): string
    {
        $m = [];
        for ($i = 0; $i < 6; $i++) {
            $m[] = sprintf('%02X', mt_rand(0, 255));
        }
        $m[0] = '02';
        return implode(':', $m);
    }

    /** @return bool true when something was added (caller saves) */
    public static function ensure(array &$db): bool
    {
        if (!isset($db['t']) || !is_array($db['t'])) {
            return false;
        }
        $missing = false;
        foreach (self::TABLES as $t) {
            if (!isset($db['t'][$t])) {
                $missing = true;
            }
        }
        $changed = false;
        if (!isset($db['t']['/ip/hotspot/profile'])) {
            $db['t']['/ip/hotspot/profile'] = [['.id' => self::nid($db), 'name' => 'hsprof1', 'hotspot-address' => '10.5.50.1', 'html-directory' => 'hotspot', 'login-by' => 'cookie,http-chap,http-pap', 'use-radius' => 'false']];
            $changed = true;
        }
        if (!$missing) {
            return $changed;
        }
        mt_srand(4242);
        $T = &$db['t'];

        // ---- PPPoE ----
        $T['/ppp/profile'] = [];
        foreach ([['default', '', '', ''], ['default-encryption', '', '', ''], ['pppoe-5M', '10.20.0.1', 'pppoe-pool', '5M/5M'], ['pppoe-10M', '10.20.0.1', 'pppoe-pool', '10M/10M'], ['pppoe-20M', '10.20.0.1', 'pppoe-pool', '20M/20M']] as $p) {
            $T['/ppp/profile'][] = ['.id' => self::nid($db), 'name' => $p[0], 'local-address' => $p[1], 'remote-address' => $p[2], 'rate-limit' => $p[3], 'only-one' => $p[0] === 'default' ? 'default' : 'yes', 'default' => in_array($p[0], ['default', 'default-encryption'], true) ? 'true' : 'false'];
        }
        $names = ['budi.santoso', 'siti.rahma', 'agus.wijaya', 'dewi.lestari', 'rudi.hartono', 'ani.suryani', 'joko.susilo', 'rina.marlina', 'eko.prasetyo', 'sri.wahyuni', 'bambang.s', 'lilis.k', 'hendra.g', 'yanti.p', 'tono.w', 'maya.s', 'andi.f', 'nur.aini', 'dedi.k', 'fitri.h', 'rizal.m', 'wati.s'];
        $profs = ['pppoe-5M', 'pppoe-10M', 'pppoe-20M'];
        $T['/ppp/secret'] = [];
        $T['/ppp/active'] = [];
        foreach ($names as $i => $n) {
            $mac = self::mac();
            $dis = $i === 6 || $i === 15;
            $T['/ppp/secret'][] = [
                '.id' => self::nid($db), 'name' => $n, 'password' => substr(md5($n . 'x'), 0, 8), 'service' => 'pppoe', 'profile' => $profs[$i % 3],
                'caller-id' => '', 'local-address' => '', 'remote-address' => $i % 7 === 0 ? '10.20.1.' . (10 + $i) : '', 'disabled' => $dis ? 'true' : 'false',
                'comment' => ($i % 4 === 0 ? 'Blok ' . chr(65 + $i % 5) . ' no.' . (3 + $i) : '') . ($dis ? ' (nunggak)' : ''),
                'last-logged-out' => strtolower(date('M/d/Y H:i:s', time() - mt_rand(3600, 86400 * 5))),
            ];
            if (!$dis && $i % 3 !== 2) {
                $T['/ppp/active'][] = [
                    '.id' => self::nid($db), 'name' => $n, 'service' => 'pppoe', 'caller-id' => $mac, 'address' => '10.20.0.' . (10 + $i),
                    'uptime' => mt_rand(0, 6) . 'd' . mt_rand(0, 23) . 'h' . mt_rand(0, 59) . 'm', 'encoding' => 'MPPE128 stateless', 'session-id' => '0x81' . sprintf('%06X', mt_rand(0, 16777215)), 'radius' => 'false',
                ];
            }
        }

        // ---- DHCP leases ----
        $T['/ip/dhcp-server/lease'] = [];
        $hosts = ['android-3f9a', 'iPhone-Budi', 'DESKTOP-K2L9', 'Galaxy-A14', 'OPPO-A57', 'redmi-note-11', 'laptop-kasir', 'cctv-dvr', 'printer-epson', 'iPad-Siti', 'HUAWEI-P30', 'realme-8', 'vivo-y21', 'TV-LG', 'android-91bc', ''];
        foreach ($hosts as $i => $h) {
            $static = in_array($h, ['laptop-kasir', 'cctv-dvr', 'printer-epson'], true);
            $ip = '10.5.50.' . ($static ? 2 + array_search($h, ['printer-epson', 'cctv-dvr', 'laptop-kasir'], true) : 120 + $i);
            $T['/ip/dhcp-server/lease'][] = [
                '.id' => self::nid($db), 'address' => $ip, 'mac-address' => self::mac(), 'client-id' => '', 'server' => 'dhcp-hotspot', 'host-name' => $h,
                'status' => $i % 7 === 6 ? 'waiting' : 'bound', 'dynamic' => $static ? 'false' : 'true', 'disabled' => 'false', 'blocked' => 'false',
                'expires-after' => $i % 7 === 6 ? '' : mt_rand(0, 9) . 'h' . mt_rand(1, 59) . 'm' . mt_rand(1, 59) . 's', 'last-seen' => mt_rand(1, 50) . 'm',
                'comment' => $static ? ['printer-epson' => 'Printer kasir', 'cctv-dvr' => 'CCTV', 'laptop-kasir' => 'Laptop kasir'][$h] : '',
            ];
        }

        // ---- ARP ----
        $T['/ip/arp'] = [];
        foreach ($T['/ip/dhcp-server/lease'] as $i => $l) {
            if ($l['status'] === 'waiting') {
                continue;
            }
            $T['/ip/arp'][] = ['.id' => self::nid($db), 'address' => $l['address'], 'mac-address' => $l['mac-address'], 'interface' => 'bridge-hotspot', 'dynamic' => $l['dynamic'], 'complete' => 'true', 'disabled' => 'false', 'published' => 'false', 'invalid' => 'false', 'comment' => $l['comment']];
        }
        $T['/ip/arp'][] = ['.id' => self::nid($db), 'address' => '36.80.0.1', 'mac-address' => self::mac(), 'interface' => 'ether1', 'dynamic' => 'true', 'complete' => 'true', 'disabled' => 'false', 'published' => 'false', 'invalid' => 'false', 'comment' => 'gateway ISP'];
        $T['/ip/arp'][] = ['.id' => self::nid($db), 'address' => '10.5.50.250', 'mac-address' => self::mac(), 'interface' => 'bridge-hotspot', 'dynamic' => 'false', 'complete' => 'true', 'disabled' => 'false', 'published' => 'false', 'invalid' => 'false', 'comment' => 'AP lantai 2'];

        // ---- walled garden ----
        $T['/ip/hotspot/walled-garden'] = [];
        foreach ([['captive.apple.com', 'captive portal iOS'], ['connectivitycheck.gstatic.com', 'captive portal Android'], ['*.midtrans.com', 'nextmon'], ['*.xendit.co', 'nextmon'], ['nextmon.example.com', 'nextmon'], ['*.whatsapp.net', 'WA tanpa login']] as $i => $w) {
            $T['/ip/hotspot/walled-garden'][] = ['.id' => self::nid($db), 'dst-host' => $w[0], 'action' => 'allow', 'server' => '', 'dynamic' => 'false', 'disabled' => $i === 5 ? 'true' : 'false', 'comment' => $w[1]];
        }
        $T['/ip/hotspot/walled-garden/ip'] = [
            ['.id' => self::nid($db), 'dst-address' => '10.5.50.1', 'protocol' => 'tcp', 'dst-port' => '8080', 'action' => 'accept', 'server' => '', 'dynamic' => 'false', 'disabled' => 'false', 'comment' => 'Server NextMON'],
            ['.id' => self::nid($db), 'dst-address' => '8.8.8.8', 'protocol' => 'udp', 'dst-port' => '53', 'action' => 'accept', 'server' => '', 'dynamic' => 'false', 'disabled' => 'false', 'comment' => 'DNS publik'],
        ];

        // ---- system bits used by the wizard ----
        $T['/system/ntp/client'] = [['enabled' => 'true', 'mode' => 'unicast', 'servers' => 'id.pool.ntp.org', 'primary-ntp' => '103.31.249.1', 'secondary-ntp' => '', 'status' => 'synchronized']];
        $T['/user/group'] = [
            ['.id' => self::nid($db), 'name' => 'read', 'policy' => 'local,telnet,ssh,read,test,winbox,password,web,sniff,sensitive,api,romon,rest-api'],
            ['.id' => self::nid($db), 'name' => 'write', 'policy' => 'local,telnet,ssh,read,write,test,winbox,password,web,sniff,sensitive,api,romon,rest-api'],
            ['.id' => self::nid($db), 'name' => 'full', 'policy' => 'local,telnet,ssh,ftp,reboot,read,write,policy,test,winbox,password,web,sniff,sensitive,api,romon,rest-api'],
        ];
        $T['/user'] = [['.id' => self::nid($db), 'name' => 'admin', 'group' => 'full', 'address' => '', 'last-logged-in' => strtolower(date('M/d/Y H:i:s', time() - 7200)), 'disabled' => 'false', 'comment' => 'system default user']];
        $T['/ip/service'] = [];
        foreach ([['telnet', 23, 'true'], ['ftp', 21, 'false'], ['www', 80, 'false'], ['ssh', 22, 'false'], ['www-ssl', 443, 'true'], ['api', 8728, 'false'], ['winbox', 8291, 'false'], ['api-ssl', 8729, 'true']] as $s) {
            $T['/ip/service'][] = ['.id' => self::nid($db), 'name' => $s[0], 'port' => (string)$s[1], 'address' => '', 'certificate' => '', 'disabled' => $s[2], 'invalid' => 'false'];
        }
        $T['/certificate'] = [];
        if (!isset($T['/system/scheduler'])) {
            $T['/system/scheduler'] = [];
        }
        mt_srand();
        return true;
    }

    /** Extra commands. Returns null when the path is not handled here. */
    public static function command(array &$db, string $p, array $attrs, array $query): ?array
    {
        switch ($p) {
            case '/ip/dhcp-server/lease/make-static':
                $id = (string)($attrs['.id'] ?? $attrs['numbers'] ?? '');
                foreach ($db['t']['/ip/dhcp-server/lease'] ?? [] as $i => $l) {
                    if (($l['.id'] ?? '') === $id) {
                        $db['t']['/ip/dhcp-server/lease'][$i]['dynamic'] = 'false';
                        return [];
                    }
                }
                throw new RouterOSException('no such item');
            case '/system/ntp/client/set':
                $db['t']['/system/ntp/client'][0] = array_replace($db['t']['/system/ntp/client'][0] ?? [], array_map(fn($v) => $v === true ? 'yes' : (string)$v, $attrs));
                if (($attrs['enabled'] ?? '') === 'yes') {
                    $db['t']['/system/ntp/client'][0]['enabled'] = 'true';
                    $db['t']['/system/ntp/client'][0]['status'] = 'synchronized';
                }
                return [];
            case '/system/clock/set':
                return [];
            case '/system/script/run':
                return [];
            case '/certificate/sign':
                foreach ($db['t']['/certificate'] ?? [] as $i => $c) {
                    if (($c['name'] ?? '') === ($attrs['number'] ?? $attrs['.id'] ?? '') || ($c['.id'] ?? '') === ($attrs['.id'] ?? '-')) {
                        $db['t']['/certificate'][$i]['trusted'] = 'true';
                        $db['t']['/certificate'][$i]['private-key'] = 'true';
                    }
                }
                return [];
        }
        return null;
    }
}
