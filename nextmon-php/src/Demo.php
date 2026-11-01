<?php
/**
 * In-memory/JSON-persisted mock of a MikroTik router. Same calls as RouterOS client.
 * State is stored per demo router in data/demo-<id>.json so changes survive between requests.
 */
require_once __DIR__ . '/Driver.php';

class Demo implements Driver
{
    private array $db = [];
    private string $file;

    public function __construct(string $file)
    {
        $this->file = $file;
        if (is_file($file)) {
            $j = json_decode((string)file_get_contents($file), true);
            if (is_array($j) && isset($j['t'])) {
                $this->db = $j;
            }
        }
        if (!$this->db) {
            $this->db = $this->seed();
            $this->save();
        }
        if (DemoNet::ensure($this->db)) { // network-module tables (PPPoE, DHCP, ARP, walled garden, ...)
            $this->save();
        }
    }

    public function isDemo(): bool
    {
        return true;
    }

    private function save(): void
    {
        @file_put_contents($this->file, json_encode($this->db, JSON_UNESCAPED_SLASHES), LOCK_EX);
    }

    private function nid(): string
    {
        $this->db['n']++;
        return '*' . strtoupper(dechex($this->db['n']));
    }

    private function norm(string $p): string
    {
        return '/' . trim(str_replace(' ', '/', $p), '/');
    }

    private static function bool($v): string
    {
        return in_array((string)$v, ['yes', 'true', '1'], true) ? 'true' : 'false';
    }

    // ---- Driver --------------------------------------------------------------------

    public function print(string $path, array $query = [], array $props = []): array
    {
        $p = $this->norm($path);
        switch ($p) {
            case '/system/resource':
                return [$this->resource()];
            case '/system/health':
                return [['voltage' => '24.1', 'temperature' => (string)(38 + (int)(4 * sin(time() / 90))), 'cpu-temperature' => (string)(48 + (int)(5 * sin(time() / 60)))]];
            case '/system/identity':
                return [['name' => $this->db['identity']]];
            case '/system/clock':
                return [['date' => strtolower(date('M/d/Y')), 'time' => date('H:i:s'), 'time-zone-name' => date_default_timezone_get()]];
            case '/ip/hotspot/active':
                $this->jitter();
                break;
            case '/log':
                $this->db['t']['/log'] = $this->logs();
                break;
        }
        $rows = $this->db['t'][$p] ?? [];
        foreach ($query as $k => $v) {
            $rows = array_filter($rows, fn($row) => (string)($row[$k] ?? '') === (string)$v);
        }
        $rows = array_values($rows);
        if ($props) {
            $keep = array_flip(array_merge(['.id'], $props));
            $rows = array_map(fn($row) => array_intersect_key($row, $keep), $rows);
        }
        return $rows;
    }

    public function add(string $path, array $attrs): string
    {
        $p = $this->norm($path);
        $row = ['.id' => $this->nid()];
        foreach ($attrs as $k => $v) {
            $row[$k] = $v === true ? 'yes' : ($v === false ? 'no' : (string)$v);
        }
        if ($p === '/ip/hotspot/user') {
            $row += ['uptime' => '0s', 'bytes-in' => '0', 'bytes-out' => '0', 'disabled' => 'false', 'limit-uptime' => '', 'mac-address' => '', 'comment' => '', 'limit-bytes-total' => ''];
        }
        if ($p === '/queue/simple' || $p === '/ip/hotspot/ip-binding' || $p === '/ip/firewall/address-list') {
            $row += ['disabled' => 'false', 'comment' => ''];
        }
        $this->db['t'][$p][] = $row;
        $this->save();
        return $row['.id'];
    }

    public function set(string $path, string $id, array $attrs): void
    {
        $p = $this->norm($path);
        foreach ($this->db['t'][$p] ?? [] as $i => $row) {
            if (($row['.id'] ?? '') === $id || (($row['name'] ?? null) === $id && $id !== '')) {
                foreach ($attrs as $k => $v) {
                    $v = $v === true ? 'yes' : ($v === false ? 'no' : (string)$v);
                    $this->db['t'][$p][$i][$k] = $k === 'disabled' ? self::bool($v) : $v;
                }
                $this->save();
                return;
            }
        }
        throw new RouterOSException('no such item');
    }

    public function remove(string $path, string $id): void
    {
        $p = $this->norm($path);
        $before = count($this->db['t'][$p] ?? []);
        $this->db['t'][$p] = array_values(array_filter($this->db['t'][$p] ?? [], fn($r) => ($r['.id'] ?? '') !== $id));
        if ($before === count($this->db['t'][$p])) {
            throw new RouterOSException('no such item');
        }
        $this->save();
    }

    public function command(string $path, array $attrs = [], array $query = []): array
    {
        $p = $this->norm($path);
        switch ($p) {
            case '/interface/monitor-traffic':
                $t = time();
                $base = ($attrs['interface'] ?? '') === 'ether1' ? 6.0e6 : 3.0e6;
                return [[
                    'name' => $attrs['interface'] ?? 'ether1',
                    'rx-bits-per-second' => (string)(int)($base * (1.2 + sin($t / 7) * 0.5 + mt_rand(-10, 10) / 100)),
                    'tx-bits-per-second' => (string)(int)($base * 0.4 * (1.2 + cos($t / 9) * 0.5 + mt_rand(-10, 10) / 100)),
                ]];
            case '/tool/ping':
                $n = max(1, min(10, (int)($attrs['count'] ?? 4)));
                $rows = [];
                $recv = 0;
                for ($i = 0; $i < $n; $i++) {
                    $lost = mt_rand(0, 19) === 0;
                    $recv += $lost ? 0 : 1;
                    $row = ['seq' => (string)$i, 'host' => $attrs['address'] ?? '', 'sent' => (string)($i + 1), 'received' => (string)$recv, 'packet-loss' => (string)(int)(100 * ($i + 1 - $recv) / ($i + 1))];
                    if (!$lost) {
                        $row += ['size' => '56', 'ttl' => '58', 'time' => mt_rand(8, 34) . 'ms'];
                    } else {
                        $row['status'] = 'timeout';
                    }
                    $rows[] = $row;
                }
                return $rows;
            case '/tool/traceroute':
                $rows = [];
                $ms = 1;
                foreach (['10.5.50.1', '36.80.0.1', '36.80.12.9', '180.240.190.5', '103.28.12.1', $attrs['address'] ?? '8.8.8.8'] as $i => $ip) {
                    $ms += mt_rand(2, 9);
                    $rows[] = ['hop' => (string)($i + 1), 'address' => $ip, 'loss' => '0', 'sent' => '3', 'last' => $ms . 'ms', 'avg' => $ms . '.2', 'best' => ($ms - 1) . '.0', 'worst' => ($ms + 2) . '.1'];
                }
                return $rows;
            case '/tool/torch':
                $rows = [];
                foreach ($this->db['t']['/ip/hotspot/active'] as $i => $a) {
                    if ($i > 6) {
                        break;
                    }
                    $rows[] = ['src-address' => $a['address'], 'dst-address' => ['142.250.4.' . mt_rand(1, 250), '157.240.7.' . mt_rand(1, 250), '104.18.22.' . mt_rand(1, 250)][$i % 3], 'ip-protocol' => 'tcp', 'tx' => (string)mt_rand(20000, 900000), 'rx' => (string)mt_rand(100000, 4000000)];
                }
                return $rows;
            case '/system/backup/save':
                $name = ($attrs['name'] ?? 'backup') . '.backup';
                $this->add('/file', ['name' => $name, 'type' => 'backup', 'size' => (string)mt_rand(90000, 220000), 'creation-time' => strtolower(date('M/d/Y H:i:s'))]);
                return [];
            case '/export':
                $name = ($attrs['file'] ?? 'export') . '.rsc';
                $this->add('/file', ['name' => $name, 'type' => 'script', 'size' => '18342', 'creation-time' => strtolower(date('M/d/Y H:i:s')), 'contents' => "# demo export\n/ip hotspot user profile\nadd name=1Jam rate-limit=2M/2M\n"]);
                return [['ret' => "# NEXTMON DEMO EXPORT " . date('c') . "\n/system identity set name=" . $this->db['identity'] . "\n/ip hotspot user profile\nadd name=1Jam rate-limit=2M/2M shared-users=1\n"]];
            case '/ip/hotspot/user/reset-counters':
                foreach ($this->db['t']['/ip/hotspot/user'] as $i => $u) {
                    if (($u['.id'] ?? '') === ($attrs['numbers'] ?? '')) {
                        $this->db['t']['/ip/hotspot/user'][$i]['uptime'] = '0s';
                        $this->db['t']['/ip/hotspot/user'][$i]['bytes-in'] = '0';
                        $this->db['t']['/ip/hotspot/user'][$i]['bytes-out'] = '0';
                    }
                }
                $this->save();
                return [];
        }
        $net = DemoNet::command($this->db, $p, $attrs, $query);
        if ($net !== null) {
            $this->save();
            return $net;
        }
        return [];
    }

    // ---- generated data ----------------------------------------------------------------

    private function resource(): array
    {
        $up = max(60, time() - $this->db['boot']);
        $d = intdiv($up, 86400);
        $h = intdiv($up % 86400, 3600);
        $m = intdiv($up % 3600, 60);
        $total = 268435456;
        return [
            'uptime' => ($d ? $d . 'd' : '') . $h . 'h' . $m . 'm',
            'version' => '6.49.13 (long-term)',
            'build-time' => 'Feb/07/2025 08:21:40',
            'free-memory' => (string)(int)($total * (0.55 + 0.05 * sin(time() / 120))),
            'total-memory' => (string)$total,
            'cpu' => 'MIPS 1004Kc V2.9',
            'cpu-count' => '4',
            'cpu-frequency' => '880',
            'cpu-load' => (string)(int)(14 + 10 * sin(time() / 20) + mt_rand(0, 6)),
            'free-hdd-space' => '9437184',
            'total-hdd-space' => '16777216',
            'architecture-name' => 'mipsbe',
            'board-name' => 'RB750Gr3 (demo)',
            'platform' => 'MikroTik',
        ];
    }

    private function jitter(): void
    {
        foreach ($this->db['t']['/ip/hotspot/active'] as $i => $a) {
            $this->db['t']['/ip/hotspot/active'][$i]['bytes-in'] = (string)((int)$a['bytes-in'] + mt_rand(1000, 90000));
            $this->db['t']['/ip/hotspot/active'][$i]['bytes-out'] = (string)((int)$a['bytes-out'] + mt_rand(5000, 400000));
        }
    }

    private function logs(): array
    {
        $msgs = ['logged in', 'logged out: user request', 'trying to log in by mac-cookie', 'logged out: session timeout', 'login failed: invalid username or password'];
        $rows = [];
        mt_srand(7);
        for ($i = 0; $i < 60; $i++) {
            $t = time() - $i * 137;
            $u = $this->db['t']['/ip/hotspot/user'][mt_rand(0, max(0, count($this->db['t']['/ip/hotspot/user']) - 1))]['name'] ?? 'guest';
            $rows[] = ['.id' => '*L' . $i, 'time' => date('H:i:s', $t), 'topics' => 'hotspot,account,info,debug', 'message' => $u . ' (10.5.50.' . mt_rand(10, 250) . '): ' . $msgs[mt_rand(0, 4)]];
        }
        mt_srand();
        return array_reverse($rows);
    }

    private function seed(): array
    {
        mt_srand(42);
        $db = ['n' => 0, 'boot' => time() - 86400 * 12 - 3600 * 5, 'identity' => 'MikroTik-Demo', 't' => []];
        $id = function () use (&$db) {
            $db['n']++;
            return '*' . strtoupper(dechex($db['n']));
        };
        $code = function ($len) {
            $c = 'abcdefghjkmnpqrstuvwxyz23456789';
            $o = '';
            for ($i = 0; $i < $len; $i++) {
                $o .= $c[mt_rand(0, strlen($c) - 1)];
            }
            return $o;
        };

        // profiles
        $profiles = [
            ['1Jam', 2000, '1h', '2M/2M'], ['3Jam', 4000, '3h', '3M/3M'], ['1Hari', 5000, '1d', '3M/3M'],
            ['7Hari', 25000, '7d', '5M/5M'], ['30Hari', 80000, '30d', '10M/10M'],
        ];
        $db['t']['/ip/hotspot/user/profile'] = [['.id' => $id(), 'name' => 'default', 'shared-users' => '1', 'rate-limit' => '', 'on-login' => '', 'default' => 'true']];
        foreach ($profiles as $p) {
            $db['t']['/ip/hotspot/user/profile'][] = [
                '.id' => $id(), 'name' => $p[0], 'shared-users' => '1', 'rate-limit' => $p[3],
                'on-login' => Scripts::onLogin('remc', (string)$p[1], $p[2], (string)$p[1], true, false, $p[0]),
                'parent-queue' => 'none', 'address-pool' => 'dhcp_hotspot',
            ];
        }

        // users
        $db['t']['/ip/hotspot/user'] = [];
        $used = [];
        for ($i = 0; $i < 42; $i++) {
            $name = $code(6);
            $pr = $profiles[mt_rand(0, 4)];
            $batch = $i < 20 ? 'batchA' : 'batchB';
            $isUsed = $i % 3 === 0;
            $db['t']['/ip/hotspot/user'][] = [
                '.id' => $id(), 'name' => $name, 'password' => $i % 2 ? $name : $code(6), 'profile' => $pr[0],
                'comment' => ($isUsed ? strtolower(date('M/d/Y H:i:s', time() + 86400)) . ' ' : '') . ($i % 2 ? 'vc' : 'up') . '-' . mt_rand(100, 999) . '-' . date('m.d.y') . '-' . $batch,
                'uptime' => $isUsed ? mt_rand(1, 3) . 'h' . mt_rand(1, 59) . 'm' : '0s',
                'bytes-in' => $isUsed ? (string)mt_rand(10000000, 900000000) : '0',
                'bytes-out' => $isUsed ? (string)mt_rand(1000000, 90000000) : '0',
                'limit-uptime' => '', 'limit-bytes-total' => '', 'mac-address' => $isUsed ? $this->mac() : '', 'disabled' => $i === 7 ? 'true' : 'false',
            ];
            if ($isUsed) {
                $used[] = $name;
            }
        }

        // active + hosts
        $db['t']['/ip/hotspot/active'] = [];
        $db['t']['/ip/hotspot/host'] = [];
        foreach (array_slice($used, 0, 9) as $i => $u) {
            $ip = '10.5.50.' . (20 + $i);
            $mac = $this->mac();
            $db['t']['/ip/hotspot/active'][] = [
                '.id' => $id(), 'server' => 'hotspot1', 'user' => $u, 'address' => $ip, 'mac-address' => $mac, 'login-by' => 'cookie,http-chap',
                'uptime' => mt_rand(1, 59) . 'm' . mt_rand(1, 59) . 's', 'session-time-left' => mt_rand(1, 20) . 'h', 'idle-time' => mt_rand(0, 40) . 's',
                'bytes-in' => (string)mt_rand(1000000, 90000000), 'bytes-out' => (string)mt_rand(100000, 9000000),
            ];
            $db['t']['/ip/hotspot/host'][] = ['.id' => $id(), 'mac-address' => $mac, 'address' => $ip, 'to-address' => $ip, 'server' => 'hotspot1', 'authorized' => 'true', 'bypassed' => 'false', 'comment' => ''];
        }
        for ($i = 0; $i < 4; $i++) {
            $ip = '10.5.50.' . (100 + $i);
            $db['t']['/ip/hotspot/host'][] = ['.id' => $id(), 'mac-address' => $this->mac(), 'address' => $ip, 'to-address' => $ip, 'server' => 'hotspot1', 'authorized' => 'false', 'bypassed' => 'false', 'comment' => ''];
        }
        $db['t']['/ip/hotspot/ip-binding'] = [
            ['.id' => $id(), 'mac-address' => '', 'address' => '10.5.50.2', 'to-address' => '', 'server' => 'all', 'type' => 'bypassed', 'disabled' => 'false', 'comment' => 'Printer kasir'],
            ['.id' => $id(), 'mac-address' => '', 'address' => '10.5.50.3', 'to-address' => '', 'server' => 'all', 'type' => 'bypassed', 'disabled' => 'false', 'comment' => 'CCTV'],
        ];

        // sales (Mikhmon format)
        $db['t']['/system/script'] = [];
        for ($d = 0; $d < 45; $d++) {
            $n = mt_rand(2, 9);
            for ($k = 0; $k < $n; $k++) {
                $ts = strtotime('today') - $d * 86400 + mt_rand(7 * 3600, 22 * 3600);
                if ($ts > time()) {
                    continue;
                }
                $pr = $profiles[mt_rand(0, 4)];
                $db['t']['/system/script'][] = [
                    '.id' => $id(),
                    'name' => Sales::recordName(['ts' => $ts, 'user' => $code(6), 'price' => $pr[1], 'ip' => '10.5.50.' . mt_rand(10, 250), 'mac' => $this->mac(), 'validity' => $pr[2], 'profile' => $pr[0], 'comment' => 'vc-' . mt_rand(100, 999) . '-demo']),
                    'owner' => strtolower(date('MY', $ts)), 'source' => strtolower(date('M/d/Y', $ts)), 'comment' => 'mikhmon',
                ];
            }
        }

        $db['t']['/interface'] = [
            ['.id' => $id(), 'name' => 'ether1', 'type' => 'ether', 'running' => 'true', 'disabled' => 'false', 'mac-address' => $this->mac(), 'comment' => 'WAN'],
            ['.id' => $id(), 'name' => 'ether2', 'type' => 'ether', 'running' => 'true', 'disabled' => 'false', 'mac-address' => $this->mac(), 'comment' => 'LAN'],
            ['.id' => $id(), 'name' => 'bridge-hotspot', 'type' => 'bridge', 'running' => 'true', 'disabled' => 'false', 'mac-address' => $this->mac(), 'comment' => ''],
            ['.id' => $id(), 'name' => 'wlan1', 'type' => 'wlan', 'running' => 'true', 'disabled' => 'false', 'mac-address' => $this->mac(), 'comment' => 'AP'],
        ];
        $db['t']['/ip/hotspot'] = [['.id' => $id(), 'name' => 'hotspot1', 'interface' => 'bridge-hotspot', 'profile' => 'hsprof1', 'disabled' => 'false']];
        $db['t']['/queue/simple'] = [
            ['.id' => $id(), 'name' => 'Kasir', 'target' => '10.5.50.2/32', 'max-limit' => '10M/10M', 'bytes' => '1203334/9903321', 'disabled' => 'false', 'comment' => ''],
            ['.id' => $id(), 'name' => 'CCTV', 'target' => '10.5.50.3/32', 'max-limit' => '2M/2M', 'bytes' => '90233/4403112', 'disabled' => 'false', 'comment' => ''],
            ['.id' => $id(), 'name' => 'Guest-All', 'target' => '10.5.50.0/24', 'max-limit' => '40M/40M', 'bytes' => '7203334/39903321', 'disabled' => 'true', 'comment' => 'Total limit'],
        ];
        $db['t']['/ip/firewall/address-list'] = [
            ['.id' => $id(), 'list' => 'nextmon-block', 'address' => '10.5.50.77', 'timeout' => '', 'disabled' => 'false', 'comment' => 'torrent abuse'],
            ['.id' => $id(), 'list' => 'nextmon-block', 'address' => '10.5.50.91', 'timeout' => '1d', 'disabled' => 'false', 'comment' => ''],
            ['.id' => $id(), 'list' => 'trusted', 'address' => '10.5.50.2', 'timeout' => '', 'disabled' => 'false', 'comment' => 'kasir'],
        ];
        $db['t']['/ip/firewall/filter'] = [];
        $db['t']['/file'] = [
            ['.id' => $id(), 'name' => 'auto-backup.backup', 'type' => 'backup', 'size' => '143360', 'creation-time' => strtolower(date('M/d/Y H:i:s', time() - 86400 * 2))],
        ];
        $db['t']['/log'] = [];
        $db['t']['/system/scheduler'] = [];
        mt_srand();
        return $db;
    }

    private function mac(): string
    {
        $m = [];
        for ($i = 0; $i < 6; $i++) {
            $m[] = sprintf('%02X', mt_rand(0, 255));
        }
        $m[0] = '02';
        return implode(':', $m);
    }
}
