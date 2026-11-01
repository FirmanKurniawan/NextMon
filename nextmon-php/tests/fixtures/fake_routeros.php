<?php
/**
 * Fake RouterOS API server for tests.  php fake_routeros.php <plain|legacy>
 * Prints "PORT <n>" on stdout, serves ONE connection, exits.
 * plain : v6.43+ login (=name= =password=), user admin / secret
 * legacy: first /login answers !done =ret=<32 hex>, expects =response=00md5(0 pass challenge)
 */
$mode = $argv[1] ?? 'plain';
$srv = stream_socket_server('tcp://127.0.0.1:0', $en, $es);
if (!$srv) {
    fwrite(STDERR, "listen failed: $es\n");
    exit(1);
}
$name = stream_socket_get_name($srv, false);
echo 'PORT ' . substr($name, strrpos($name, ':') + 1) . "\n";
flush();
$c = @stream_socket_accept($srv, 15);
if (!$c) {
    exit(1);
}
stream_set_timeout($c, 10);

function enc(int $l): string
{
    if ($l < 0x80) return chr($l);
    if ($l < 0x4000) return chr(($l >> 8) | 0x80) . chr($l & 0xFF);
    if ($l < 0x200000) return chr(($l >> 16) | 0xC0) . chr(($l >> 8) & 0xFF) . chr($l & 0xFF);
    if ($l < 0x10000000) return chr(($l >> 24) | 0xE0) . chr(($l >> 16) & 0xFF) . chr(($l >> 8) & 0xFF) . chr($l & 0xFF);
    return chr(0xF0) . pack('N', $l);
}
function rd($c, int $n): string
{
    $b = '';
    while (strlen($b) < $n) {
        $x = fread($c, $n - strlen($b));
        if ($x === false || $x === '') exit(0);
        $b .= $x;
    }
    return $b;
}
function rlen($c): int
{
    $f = ord(rd($c, 1));
    if (!($f & 0x80)) return $f;
    if (($f & 0xC0) === 0x80) return (($f & 0x3F) << 8) | ord(rd($c, 1));
    if (($f & 0xE0) === 0xC0) { $b = rd($c, 2); return (($f & 0x1F) << 16) | (ord($b[0]) << 8) | ord($b[1]); }
    if (($f & 0xF0) === 0xE0) { $b = rd($c, 3); return (($f & 0x0F) << 24) | (ord($b[0]) << 16) | (ord($b[1]) << 8) | ord($b[2]); }
    return unpack('N', rd($c, 4))[1];
}
function sentence($c): array
{
    $w = [];
    while (($l = rlen($c)) !== 0) {
        $w[] = rd($c, $l);
    }
    return $w;
}
function send($c, array $words): void
{
    $o = '';
    foreach ($words as $w) $o .= enc(strlen($w)) . $w;
    fwrite($c, $o . "\0");
}
$challenge = str_repeat('ab', 16);
$authed = false;
while (true) {
    $s = sentence($c);
    if (!$s) continue;
    $cmd = $s[0];
    $a = [];
    foreach (array_slice($s, 1) as $w) {
        if ($w !== '' && $w[0] === '=') { $p = strpos($w, '=', 1); $a[substr($w, 1, $p - 1)] = substr($w, $p + 1); }
    }
    if ($cmd === '/quit') { send($c, ['!fatal', 'session terminated on request']); break; }
    if ($cmd === '/login') {
        if ($mode === 'legacy' && !isset($a['response'])) { send($c, ['!done', '=ret=' . $challenge]); continue; }
        if ($mode === 'legacy') {
            $ok = ($a['name'] ?? '') === 'admin' && ($a['response'] ?? '') === '00' . md5("\0" . 'secret' . hex2bin($challenge));
        } else {
            $ok = ($a['name'] ?? '') === 'admin' && ($a['password'] ?? '') === 'secret';
        }
        if ($ok) { $authed = true; send($c, ['!done']); }
        else { send($c, ['!trap', '=message=invalid user name or password (6)']); send($c, ['!done']); }
        continue;
    }
    if (!$authed) { send($c, ['!fatal', 'not logged in']); break; }
    if ($cmd === '/ip/hotspot/user/print') {
        send($c, ['!re', '=.id=*1', '=name=alice', '=comment=' . str_repeat('x', 200)]);          // 1-byte len words + 2-byte
        send($c, ['!re', '=.id=*2', '=name=bob', '=comment=' . str_repeat('y', 20000)]);          // 3-byte? (>0x4000 => 3 bytes)
        send($c, ['!re', '=.id=*3', '=name=carl', '=comment=' . str_repeat('z', 300000)]);        // 3-byte len (>=0x4000, <0x200000)
        send($c, ['!done']);
        continue;
    }
    if ($cmd === '/ip/hotspot/user/add') { send($c, ['!done', '=ret=*9F']); continue; }
    if ($cmd === '/boom') { send($c, ['!trap', '=message=no such command']); send($c, ['!done']); continue; }
    send($c, ['!done']);
}
fclose($c);
