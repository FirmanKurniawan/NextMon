<?php
test('encrypt/decrypt roundtrip incl. unicode', function () {
    fresh_store();
    foreach (['secret', 'pässwörd 日本語 !@#', str_repeat('A', 5000), '0'] as $p) {
        $c = Crypto::encrypt($p);
        ok(str_starts_with($c, 'v1:'), 'prefix');
        ok(!str_contains($c, $p) || $p === '0', 'no plaintext');
        eq($p, Crypto::decrypt($c));
    }
});
test('empty string stays empty', function () {
    fresh_store();
    eq('', Crypto::encrypt(''));
    eq('', Crypto::decrypt(''));
});
test('random IV: same plaintext gives different ciphertext', function () {
    fresh_store();
    ok(Crypto::encrypt('same') !== Crypto::encrypt('same'));
});
test('tampered / malformed blobs decrypt to empty string', function () {
    fresh_store();
    $c = Crypto::encrypt('hello');
    $raw = base64_decode(substr($c, 3));
    $raw[strlen($raw) - 1] = chr(ord($raw[strlen($raw) - 1]) ^ 1);
    eq('', Crypto::decrypt('v1:' . base64_encode($raw)), 'bit flip');
    eq('', Crypto::decrypt('v2:abcd'), 'wrong version');
    eq('', Crypto::decrypt('v1:!!!notbase64'), 'bad b64');
    eq('', Crypto::decrypt('v1:' . base64_encode('short')), 'too short');
    eq('', Crypto::decrypt('plain'), 'no prefix');
});
test('key file is created once with 32 bytes', function () {
    $d = fresh_store();
    Crypto::encrypt('x');
    $f = $d . '/secret.key';
    ok(is_file($f), 'secret.key');
    eq(32, strlen(base64_decode(file_get_contents($f), true)));
});
