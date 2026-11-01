<?php
/**
 * Multi-connection fake RouterOS API server backed by the Demo mock, with a simulated network.
 * Used to MEASURE (not unit-test) how many TCP connects / logins / round-trips a page costs against a slow link.
 *
 *   php fake_router_server.php --port=18728 --latency=120 [--bw=0] [--users=2000] [--sales=3000] [--data=<dir>] [--user=admin] [--pass=secret]
 *
 *   latency  one-way-ish delay in ms added to EVERY reply (== RTT) and to the TCP/login handshake. Replies of sentences that
 *            arrive together (pipelined, tagged) are delayed concurrently, so pipelining really saves time.
 *   bw       simulated downstream KB/s (0 = unlimited): adds bytes/bw to the reply delay
 *   users/sales  extra hotspot users / mikhmon sales scripts to create at start (bulk data)
 * Stats: sentence "/__stats" returns one !re with connections, logins, sentences, rows (and "/__reset" zeroes them).
 */
require_once dirname(__DIR__, 2) . '/src/App.php';
App::init();

$o = ['port' => 18728, 'latency' => 0, 'bw' => 0, 'users' => 0, 'sales' => 0, 'data' => sys_get_temp_dir() . '/nm-fake-router', 'user' => 'admin', 'pass' => 'secret'];
foreach (array_slice($argv, 1) as $a) {
    if (preg_match('/^--(\w+)=(.*)$/', $a, $m)) {
        $o[$m[1]] = is_numeric($m[2]) ? $m[2] + 0 : $m[2];
    }
}
@mkdir($o['data'], 0775, true);
$file = $o['data'] . '/demo-fake.json';
@unlink($file);
$demo = new Demo($file);
if ($o['users'] || $o['sales']) {
    $rp = new ReflectionProperty($demo, 'db');
    $rp->setAccessible(true);
    $db = $rp->getValue($demo);
    $n = &$db['n'];
    $profs = array_column($db['t']['/ip/hotspot/user/profile'] ?? [], 'name') ?: ['default'];
    for ($i = 0; $i < $o['users']; $i++) {
        $n++;
        $db['t']['/ip/hotspot/user'][] = ['.id' => '*' . strtoupper(dechex($n)), 'name' => 'u' . str_pad((string)$i, 6, '0', STR_PAD_LEFT), 'password' => 'p' . $i,
            'profile' => $profs[$i % count($profs)], 'comment' => 'vc-' . (100 + $i % 90) . '-b' . ($i % 40), 'uptime' => $i % 3 ? '1h' : '0s', 'bytes-in' => '1000', 'bytes-out' => '2000',
            'disabled' => 'false', 'limit-uptime' => '', 'mac-address' => '', 'limit-bytes-total' => '', 'server' => 'all'];
    }
    for ($i = 0; $i < $o['sales']; $i++) {
        $n++;
        $ts = time() - $i * 1500;
        $db['t']['/system/script'][] = ['.id' => '*' . strtoupper(dechex($n)), 'name' => Sales::recordName(['ts' => $ts, 'user' => 's' . $i, 'price' => 2000 + 1000 * ($i % 5), 'profile' => $profs[$i % count($profs)], 'comment' => 'vc']),
            'owner' => date('MY', $ts), 'comment' => 'mikhmon', 'source' => 'x'];
    }
    $rp->setValue($demo, $db);
    $sv = new ReflectionMethod($demo, 'save');
    $sv->setAccessible(true);
    $sv->invoke($demo);
}

function enc(int $l): string
{
    if ($l < 0x80) return chr($l);
    if ($l < 0x4000) return chr(($l >> 8) | 0x80) . chr($l & 0xFF);
    if ($l < 0x200000) return chr(($l >> 16) | 0xC0) . chr(($l >> 8) & 0xFF) . chr($l & 0xFF);
    return chr(($l >> 24) | 0xE0) . chr(($l >> 16) & 0xFF) . chr(($l >> 8) & 0xFF) . chr($l & 0xFF);
}
function frame(array $w): string
{
    $s = '';
    foreach ($w as $x) $s .= enc(strlen($x)) . $x;
    return $s . "\0";
}
/** parse as many complete sentences as the buffer holds; returns [sentences, rest] */
function parse(string $b): array
{
    $out = [];
    while (true) {
        $p = 0; $words = []; $n = strlen($b); $ok = false;
        while ($p < $n) {
            $c = ord($b[$p]);
            if ($c < 0x80) { $l = $c; $p += 1; }
            elseif (($c & 0xC0) === 0x80) { if ($p + 2 > $n) break; $l = (($c & 0x3F) << 8) | ord($b[$p + 1]); $p += 2; }
            elseif (($c & 0xE0) === 0xC0) { if ($p + 3 > $n) break; $l = (($c & 0x1F) << 16) | (ord($b[$p + 1]) << 8) | ord($b[$p + 2]); $p += 3; }
            else { if ($p + 4 > $n) break; $l = (($c & 0x0F) << 24) | (ord($b[$p + 1]) << 16) | (ord($b[$p + 2]) << 8) | ord($b[$p + 3]); $p += 4; }
            if ($l === 0) { $ok = true; break; }
            if ($p + $l > $n) break;
            $words[] = substr($b, $p, $l);
            $p += $l;
        }
        if (!$ok) return [$out, $b];
        $out[] = $words;
        $b = substr($b, $p);
    }
}

$srv = stream_socket_server('tcp://127.0.0.1:' . $o['port'], $en, $es);
if (!$srv) { fwrite(STDERR, "listen failed: $es\n"); exit(1); }
$nm = stream_socket_get_name($srv, false);
echo 'READY ' . substr($nm, strrpos($nm, ':') + 1) . "\n";
flush();
$lat = $o['latency'] / 1000.0;
$stats = ['connections' => 0, 'logins' => 0, 'sentences' => 0, 'rows' => 0];
$conns = [];   // id => [sock, buf, authed, ready_at, out(queue of [due, bytes])]

while (true) {
    $read = [$srv];
    foreach ($conns as $c) $read[] = $c['sock'];
    $w = null; $e = null;
    $next = null;
    foreach ($conns as $c) foreach ($c['out'] as $q) $next = $next === null ? $q[0] : min($next, $q[0]);
    $to = $next === null ? 1.0 : max(0.0, min(1.0, $next - microtime(true)));
    if (@stream_select($read, $w, $e, (int)$to, (int)(($to - (int)$to) * 1e6)) !== false) {
        foreach ($read as $s) {
            if ($s === $srv) {
                $cs = @stream_socket_accept($srv, 0);
                if ($cs) {
                    stream_set_blocking($cs, false);
                    $stats['connections']++;
                    $conns[(int)$cs] = ['sock' => $cs, 'buf' => '', 'authed' => false, 'ready_at' => microtime(true) + $lat, 'out' => []];
                }
                continue;
            }
            $id = (int)$s;
            $d = fread($s, 1 << 20);
            if ($d === false || ($d === '' && feof($s))) { fclose($s); unset($conns[$id]); continue; }
            $conns[$id]['buf'] .= $d;
            [$sents, $conns[$id]['buf']] = parse($conns[$id]['buf']);
            foreach ($sents as $words) {
                $stats['sentences']++;
                $cmd = $words[0] ?? '';
                $a = []; $q = []; $tag = null; $prop = [];
                foreach (array_slice($words, 1) as $x) {
                    if (strncmp($x, '.tag=', 5) === 0) { $tag = $x; continue; }
                    if ($x !== '' && $x[0] === '=') { $p = strpos($x, '=', 1); $a[substr($x, 1, $p - 1)] = substr($x, $p + 1); }
                    elseif ($x !== '' && $x[0] === '?') { $p = strpos($x, '='); if ($p) $q[substr($x, 1, $p - 1)] = substr($x, $p + 1); }
                }
                $reply = [];
                if ($cmd === '/__stats') { $reply[] = ['!re', ...array_map(fn($k, $v) => "=$k=$v", array_keys($stats), $stats)]; $reply[] = ['!done']; }
                elseif ($cmd === '/__reset') { $stats = array_map(fn() => 0, $stats); $reply[] = ['!done']; }
                elseif ($cmd === '/quit') { $reply[] = ['!fatal', 'session terminated on request']; }
                elseif ($cmd === '/login') {
                    $stats['logins']++;
                    $ok = ($a['name'] ?? '') === $o['user'] && ($a['password'] ?? '') === $o['pass'];
                    $reply = $ok ? [['!done']] : [['!trap', '=message=invalid user name or password (6)'], ['!done']];
                    $conns[$id]['authed'] = $ok;
                } elseif (!$conns[$id]['authed']) {
                    $reply = [['!fatal', 'not logged in']];
                } else {
                    try {
                        $verb = substr($cmd, strrpos($cmd, '/') + 1);
                        $path = substr($cmd, 0, strrpos($cmd, '/'));
                        $pl = isset($a['.proplist']) ? explode(',', $a['.proplist']) : [];
                        unset($a['.proplist']);
                        if ($verb === 'print') {
                            $rows = $demo->print($path, $q, array_values(array_diff($pl, ['.id'])));
                            foreach ($rows as $r) { $stats['rows']++; $reply[] = array_merge(['!re'], array_map(fn($k, $v) => "=$k=$v", array_keys($r), $r)); }
                            $reply[] = ['!done'];
                        } elseif ($verb === 'add') {
                            $reply[] = ['!done', '=ret=' . $demo->add($path, $a)];
                        } elseif ($verb === 'set') {
                            $i = $a['.id'] ?? ''; unset($a['.id']); $demo->set($path, $i, $a); $reply[] = ['!done'];
                        } elseif ($verb === 'remove') {
                            $demo->remove($path, $a['.id'] ?? ''); $reply[] = ['!done'];
                        } else {
                            foreach ($demo->command($cmd, $a, $q) as $r) { $reply[] = array_merge(['!re'], array_map(fn($k, $v) => "=$k=$v", array_keys($r), $r)); }
                            $reply[] = ['!done'];
                        }
                    } catch (Throwable $ex) {
                        $reply = [['!trap', '=message=' . $ex->getMessage()], ['!done']];
                    }
                }
                $bytes = '';
                foreach ($reply as $r) {
                    if ($tag !== null && $r[0] !== '!fatal') $r[] = $tag;
                    $bytes .= frame($r);
                }
                $bw = $o['bw'] > 0 ? strlen($bytes) / ($o['bw'] * 1024.0) : 0.0;
                $due = max(microtime(true), $conns[$id]['ready_at']) + $lat + $bw;
                $conns[$id]['out'][] = [$due, $bytes, $cmd === '/quit'];
            }
        }
    }
    foreach ($conns as $id => &$c) {
        while ($c['out'] && $c['out'][0][0] <= microtime(true)) {
            [, $bytes, $close] = array_shift($c['out']);
            stream_set_blocking($c['sock'], true);
            @fwrite($c['sock'], $bytes);
            stream_set_blocking($c['sock'], false);
            if ($close) { @fclose($c['sock']); unset($conns[$id]); break; }
        }
    }
    unset($c);
}
