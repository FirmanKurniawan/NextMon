<?php
/**
 * Offline unit tests for the payment adapters' webhook verification. Run: php tests/shop_signatures.php
 * Expected hex values were produced with `openssl dgst` (independent of the PHP code under test) from
 * known-format fixtures. These do NOT prove the gateways accept our requests - only that we verify
 * callbacks the documented way.
 */
spl_autoload_register(function ($c) {
    foreach (['/../src/', '/../src/Controllers/'] as $d) {
        $f = __DIR__ . $d . $c . '.php';
        if (is_file($f)) {
            require_once $f;
            return;
        }
    }
});

$fail = 0;
$n = 0;
function check(string $name, bool $ok): void
{
    global $fail, $n;
    $n++;
    if (!$ok) {
        $fail++;
        echo "FAIL  $name\n";
    } else {
        echo "ok    $name\n";
    }
}
function throws(callable $f): bool
{
    try {
        $f();
        return false;
    } catch (PaymentException $e) {
        return true;
    }
}

// ---- Midtrans: SHA512(order_id + status_code + gross_amount + server_key) ----
$mk = 'SB-Mid-server-TESTKEY';
$mSig = '85385ff64f633ff3f5f29175aef9ef64f54242461c5812920707a82adb14ffacc3d700f0e583990e229738a11e0d16077548ec86f9a88d9f73fd35d70cdbbc21';
check('midtrans signature formula', PaymentMidtrans::signature('KL261101-ABCDEF', '200', '2000.00', $mk) === $mSig);
$mid = new PaymentMidtrans();
$body = json_encode(['order_id' => 'KL261101-ABCDEF', 'status_code' => '200', 'gross_amount' => '2000.00', 'signature_key' => $mSig, 'transaction_status' => 'settlement', 'transaction_id' => 'tx-1', 'fraud_status' => 'accept']);
$ev = $mid->parseCallback([], $body, ['server_key' => $mk]);
check('midtrans settlement => paid, amount 2000', $ev['status'] === 'paid' && $ev['amount'] === 2000 && $ev['order_id'] === 'KL261101-ABCDEF');
check('midtrans wrong key rejected', throws(fn() => $mid->parseCallback([], $body, ['server_key' => 'other'])));
check('midtrans empty key rejected', throws(fn() => $mid->parseCallback([], $body, ['server_key' => ''])));
$tamper = str_replace('2000.00', '1.00', $body);
check('midtrans tampered amount rejected', throws(fn() => $mid->parseCallback([], $tamper, ['server_key' => $mk])));
$cap = json_decode($body, true);
$cap['transaction_status'] = 'capture';
$cap['fraud_status'] = 'challenge';
check('midtrans capture+challenge => pending', $mid->parseCallback([], json_encode($cap), ['server_key' => $mk])['status'] === 'pending');
foreach (['expire' => 'expired', 'deny' => 'failed', 'cancel' => 'failed', 'refund' => 'refunded', 'pending' => 'pending'] as $ts => $want) {
    $c = json_decode($body, true);
    $c['transaction_status'] = $ts;
    check("midtrans $ts => $want", $mid->parseCallback([], json_encode($c), ['server_key' => $mk])['status'] === $want);
}
check('midtrans uppercase hex signature accepted', $mid->parseCallback([], str_replace($mSig, strtoupper($mSig), $body), ['server_key' => $mk])['status'] === 'paid');
check('midtrans detect', $mid->detect([], $body) && !$mid->detect([], '{}'));

// ---- Tripay: callback = HMAC-SHA256(raw body, private_key); create = HMAC-SHA256(merchant_code + merchant_ref + amount) ----
$tk = 'tripay-private-test';
$tBody = '{"reference":"T0001","merchant_ref":"KL261101-ABCDEF","status":"PAID","total_amount":2000,"fee_customer":0}';
$tSig = 'a3748b77228fd1aa2d1915a474c2b8a68ebc2839db9255717678fc7d48b4a26b';
check('tripay callback signature formula', PaymentTripay::callbackSignature($tBody, $tk) === $tSig);
check('tripay create signature formula', PaymentTripay::createSignature('T1234', 'KL261101-ABCDEF', 2000, $tk) === '1344d884f77b6c8992d12caa84a5ce977688b04b5fbdd8d795b0329ee22c9a41');
$tri = new PaymentTripay();
$h = ['x-callback-signature' => $tSig, 'x-callback-event' => 'payment_status'];
$ev = $tri->parseCallback($h, $tBody, ['private_key' => $tk]);
check('tripay PAID => paid, amount 2000', $ev['status'] === 'paid' && $ev['amount'] === 2000 && $ev['order_id'] === 'KL261101-ABCDEF');
check('tripay wrong key rejected', throws(fn() => $tri->parseCallback($h, $tBody, ['private_key' => 'x'])));
check('tripay body tampered rejected', throws(fn() => $tri->parseCallback($h, str_replace('2000', '1', $tBody), ['private_key' => $tk])));
check('tripay missing header rejected', throws(fn() => $tri->parseCallback([], $tBody, ['private_key' => $tk])));
check('tripay wrong event rejected', throws(fn() => $tri->parseCallback(['x-callback-signature' => $tSig, 'x-callback-event' => 'other'], $tBody, ['private_key' => $tk])));
$fee = '{"reference":"T0001","merchant_ref":"KL261101-ABCDEF","status":"PAID","total_amount":2750,"fee_customer":750}';
$ev = $tri->parseCallback(['x-callback-signature' => PaymentTripay::callbackSignature($fee, $tk)], $fee, ['private_key' => $tk]);
check('tripay amount excludes customer fee', $ev['amount'] === 2000);
check('tripay detect', $tri->detect($h, $tBody) && !$tri->detect([], $tBody));

// ---- Xendit: x-callback-token equality ----
$xen = new PaymentXendit();
$xBody = '{"id":"inv-1","external_id":"KL261101-ABCDEF","status":"PAID","amount":2000,"paid_amount":2000}';
check('xendit token ok', PaymentXendit::tokenValid('tok123', 'tok123'));
check('xendit token wrong', !PaymentXendit::tokenValid('tok124', 'tok123'));
check('xendit empty configured token never valid', !PaymentXendit::tokenValid('', '') && !PaymentXendit::tokenValid('a', ''));
$ev = $xen->parseCallback(['x-callback-token' => 'tok123'], $xBody, ['callback_token' => 'tok123']);
check('xendit PAID => paid, amount 2000', $ev['status'] === 'paid' && $ev['amount'] === 2000 && $ev['order_id'] === 'KL261101-ABCDEF');
check('xendit bad token rejected', throws(fn() => $xen->parseCallback(['x-callback-token' => 'nope'], $xBody, ['callback_token' => 'tok123'])));
check('xendit no header rejected', throws(fn() => $xen->parseCallback([], $xBody, ['callback_token' => 'tok123'])));
check('xendit EXPIRED => expired', $xen->parseCallback(['x-callback-token' => 't'], str_replace('PAID', 'EXPIRED', $xBody), ['callback_token' => 't'])['status'] === 'expired');
check('xendit SETTLED => paid', $xen->parseCallback(['x-callback-token' => 't'], str_replace('PAID', 'SETTLED', $xBody), ['callback_token' => 't'])['status'] === 'paid');

// ---- Mock gateway ----
$mock = new PaymentMock();
check('mock signature formula', PaymentMock::sign('KL261101-ABCDEF', 'paid', 2000, 1790000000, 'mocksecret') === 'ac1c5b8302f1a667d141de09e997f7444d82aba37d023f0ec7f8025e263c26ad');
$ts = time();
$sig = PaymentMock::sign('KL261101-ABCDEF', 'paid', 2000, $ts, 'mocksecret');
$raw = http_build_query(['order_id' => 'KL261101-ABCDEF', 'status' => 'paid', 'amount' => 2000, 'ts' => $ts, 'mock_sig' => $sig]);
check('mock accepts valid', $mock->parseCallback([], $raw, ['secret' => 'mocksecret', 'env' => 'sandbox'])['status'] === 'paid');
check('mock rejects wrong secret', throws(fn() => $mock->parseCallback([], $raw, ['secret' => 'x', 'env' => 'sandbox'])));
check('mock rejects production', throws(fn() => $mock->parseCallback([], $raw, ['secret' => 'mocksecret', 'env' => 'production'])));
$old = time() - 3600;
$raw2 = http_build_query(['order_id' => 'KL261101-ABCDEF', 'status' => 'paid', 'amount' => 2000, 'ts' => $old, 'mock_sig' => PaymentMock::sign('KL261101-ABCDEF', 'paid', 2000, $old, 'mocksecret')]);
check('mock rejects stale (replay window)', throws(fn() => $mock->parseCallback([], $raw2, ['secret' => 'mocksecret', 'env' => 'sandbox'])));
check('mock rejects amount change', throws(fn() => $mock->parseCallback([], str_replace('amount=2000', 'amount=1', $raw), ['secret' => 'mocksecret', 'env' => 'sandbox'])));

// ---- IP allow-list ----
function ipcheck(string $ip, string $list): bool
{
    require_once __DIR__ . '/../src/Shop.php';
    return Shop::ipAllowed($ip, $list);
}
check('ip empty list allows', ipcheck('1.2.3.4', ''));
check('ip exact', ipcheck('203.0.113.10', "203.0.113.10\n198.51.100.1") && !ipcheck('203.0.113.11', '203.0.113.10'));
check('ip cidr /24', ipcheck('198.51.100.77', '198.51.100.0/24') && !ipcheck('198.51.101.1', '198.51.100.0/24'));
check('ip cidr /20 partial byte', ipcheck('10.0.15.9', '10.0.0.0/20') && !ipcheck('10.0.16.1', '10.0.0.0/20'));
check('ip v6 exact + cidr', ipcheck('2001:db8::1', '2001:db8::/32') && !ipcheck('2001:db9::1', '2001:db8::/32'));
check('ip v4 vs v6 rule mismatch', !ipcheck('1.2.3.4', '2001:db8::/32'));

echo "\n$n checks, $fail failed\n";
exit($fail ? 1 : 0);
