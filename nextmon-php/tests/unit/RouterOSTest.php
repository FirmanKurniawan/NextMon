<?php
function enc_len(int $n): string
{
    $m = new ReflectionMethod(RouterOS::class, 'encLen');
    return $m->invoke(null, $n);
}

test('length encoding: boundaries for 1/2/3/4/5-byte forms', function () {
    eq("\x00", enc_len(0));
    eq("\x7F", enc_len(0x7F));
    eq("\x80\x80", enc_len(0x80));
    eq("\xBF\xFF", enc_len(0x3FFF));
    eq("\xC0\x40\x00", enc_len(0x4000));
    eq("\xDF\xFF\xFF", enc_len(0x1FFFFF));
    eq("\xE0\x20\x00\x00", enc_len(0x200000));
    eq("\xEF\xFF\xFF\xFF", enc_len(0x0FFFFFFF));
    eq("\xF0\x10\x00\x00\x00", enc_len(0x10000000));
    eq("\xF0\xFF\xFF\xFF\xFF", enc_len(0xFFFFFFFF));
});
test('length encode -> decode roundtrip across the whole range', function () {
    $dec = new ReflectionMethod(RouterOS::class, 'readLen');
    foreach ([0, 1, 127, 128, 255, 300, 16383, 16384, 100000, 2097151, 2097152, 5000000, 268435455, 268435456] as $n) {
        $r = new RouterOS('x');
        $f = fopen('php://memory', 'w+');
        fwrite($f, enc_len($n));
        rewind($f);
        $p = new ReflectionProperty(RouterOS::class, 'sock');
        $p->setValue($r, $f);
        eq($n, $dec->invoke($r), "len $n");
    }
});

/** Start tests/fixtures/fake_routeros.php; returns [process, port] */
function start_fake(string $mode)
{
    $p = proc_open([PHP_BINARY, __DIR__ . '/../fixtures/fake_routeros.php', $mode], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
    $line = fgets($pipes[1]);
    if (!preg_match('/^PORT (\d+)/', (string)$line, $m)) {
        throw new AssertFail('fake server did not start: ' . $line . stream_get_contents($pipes[2]));
    }
    return [$p, (int)$m[1], $pipes];
}

test('login (v6.43+ plain) + print with long words against a fake socket server', function () {
    [$proc, $port, $pipes] = start_fake('plain');
    $r = new RouterOS('127.0.0.1', $port, false, 5);
    $r->connect('admin', 'secret');
    $rows = $r->print('/ip/hotspot/user');
    eq(3, count($rows));
    eq('alice', $rows[0]['name']);
    eq(200, strlen($rows[0]['comment']));
    eq(20000, strlen($rows[1]['comment']), '2-byte length word');
    eq(300000, strlen($rows[2]['comment']), '3-byte length word');
    eq('*9F', $r->add('/ip/hotspot/user', ['name' => 'n']));
    $e = throws(fn() => $r->command('/boom'), RouterOSException::class);
    eq('no such command', $e->getMessage());
    $r->close();
    proc_terminate($proc);
    proc_close($proc);
});
test('login rejects wrong password with RouterOSException', function () {
    [$proc, $port] = start_fake('plain');
    $r = new RouterOS('127.0.0.1', $port, false, 5);
    $e = throws(fn() => $r->connect('admin', 'WRONG'), RouterOSException::class);
    ok(str_contains($e->getMessage(), 'invalid user name or password'), $e->getMessage());
    proc_terminate($proc);
    proc_close($proc);
});
test('legacy MD5 challenge login is performed when router answers with =ret=', function () {
    [$proc, $port] = start_fake('legacy');
    $r = new RouterOS('127.0.0.1', $port, false, 5);
    $r->connect('admin', 'secret');
    eq(3, count($r->print('/ip/hotspot/user')));
    $r->close();
    proc_terminate($proc);
    proc_close($proc);
});
test('connect to closed port throws RouterOSException quickly', function () {
    $s = stream_socket_server('tcp://127.0.0.1:0');
    $port = (int)substr(stream_socket_get_name($s, false), strrpos(stream_socket_get_name($s, false), ':') + 1);
    fclose($s);
    $t = microtime(true);
    throws(fn() => (new RouterOS('127.0.0.1', $port, false, 2))->connect('a', 'b'), RouterOSException::class);
    ok(microtime(true) - $t < 4);
});
test('server closing mid-word gives RouterOSException, not a hang/warning', function () {
    $srv = stream_socket_server('tcp://127.0.0.1:0');
    $n = stream_socket_get_name($srv, false);
    $cl = stream_socket_client('tcp://' . $n, $en, $es, 2);
    $conn = stream_socket_accept($srv, 2);
    fwrite($conn, "\x05ab"); // announces 5 bytes, delivers 2, then hangs up
    fclose($conn);
    stream_set_timeout($cl, 2);
    $r = new RouterOS('127.0.0.1', 1, false, 2);
    (new ReflectionProperty(RouterOS::class, 'sock'))->setValue($r, $cl);
    throws(fn() => (new ReflectionMethod($r, 'readSentence'))->invoke($r), RouterOSException::class);
});
