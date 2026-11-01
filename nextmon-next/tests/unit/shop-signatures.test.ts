/**
 * Offline tests for the payment adapters' webhook verification (port of nextmon-php/tests/shop_signatures.php, same fixtures; the
 * expected hex values were produced with `openssl dgst` independently of the code under test). These do NOT prove the live gateways
 * accept our `create` requests (never run against the real services) - only that callbacks are verified the documented way.
 */
import { describe, expect, it } from 'vitest';
import { Shop } from '../../src/features/shop/config.ts';
import { Midtrans, mockSign, Mock, midtransSignature, PaymentError, Tripay, tripayCallbackSignature, tripayCreateSignature, Xendit, xenditTokenValid } from '../../src/features/shop/gateways.ts';

const throwsPay = (f: () => unknown) => expect(f).toThrow(PaymentError);

describe('Midtrans: SHA512(order_id + status_code + gross_amount + server_key)', () => {
  const mk = 'SB-Mid-server-TESTKEY';
  const sig = '85385ff64f633ff3f5f29175aef9ef64f54242461c5812920707a82adb14ffacc3d700f0e583990e229738a11e0d16077548ec86f9a88d9f73fd35d70cdbbc21';
  const base = { order_id: 'KL261101-ABCDEF-12345678', status_code: '200', gross_amount: '2000.00', transaction_status: 'settlement', transaction_id: 'tx-1', fraud_status: 'accept' };
  // the PHP fixture signs the legacy id without workspace suffix; keep that vector for the formula check
  it('signature formula matches the independent openssl vector', () => {
    expect(midtransSignature('KL261101-ABCDEF', '200', '2000.00', mk)).toBe(sig);
  });
  const body = (over: Record<string, unknown> = {}, key = mk) => {
    const o = { ...base, ...over } as Record<string, string>;
    return JSON.stringify({ ...o, signature_key: midtransSignature(o.order_id!, o.status_code!, o.gross_amount!, key) });
  };
  const parse = (raw: string, key = mk) => Midtrans.parseCallback({}, raw, { env: 'sandbox', server_key: key });
  it('settlement => paid with the verified amount', () => {
    const ev = parse(body());
    expect(ev).toMatchObject({ status: 'paid', amount: 2000, order_id: base.order_id, ref: 'tx-1' });
  });
  it('wrong or empty key, tampered amount rejected', () => {
    throwsPay(() => parse(body(), 'other'));
    throwsPay(() => parse(body(), ''));
    throwsPay(() => parse(body().replace('2000.00', '1.00')));
  });
  it('capture+challenge => pending; status mapping', () => {
    expect(parse(body({ transaction_status: 'capture', fraud_status: 'challenge' })).status).toBe('pending');
    expect(parse(body({ transaction_status: 'capture' })).status).toBe('paid');
    for (const [ts, want] of Object.entries({ expire: 'expired', deny: 'failed', cancel: 'failed', refund: 'refunded', pending: 'pending' })) expect(parse(body({ transaction_status: ts })).status).toBe(want);
  });
  it('uppercase hex signature accepted; detect()', () => {
    const b = JSON.parse(body());
    b.signature_key = String(b.signature_key).toUpperCase();
    expect(parse(JSON.stringify(b)).status).toBe('paid');
    expect(Midtrans.detect({}, body())).toBe(true);
    expect(Midtrans.detect({}, '{}')).toBe(false);
  });
});

describe('Tripay: callback = HMAC-SHA256(raw body, private_key)', () => {
  const tk = 'tripay-private-test';
  const tBody = '{"reference":"T0001","merchant_ref":"KL261101-ABCDEF","status":"PAID","total_amount":2000,"fee_customer":0}';
  const tSig = 'a3748b77228fd1aa2d1915a474c2b8a68ebc2839db9255717678fc7d48b4a26b';
  const h = { 'x-callback-signature': tSig, 'x-callback-event': 'payment_status' };
  const cfg = { env: 'sandbox' as const, private_key: tk };
  it('formulas match the independent openssl vectors', () => {
    expect(tripayCallbackSignature(tBody, tk)).toBe(tSig);
    expect(tripayCreateSignature('T1234', 'KL261101-ABCDEF', 2000, tk)).toBe('1344d884f77b6c8992d12caa84a5ce977688b04b5fbdd8d795b0329ee22c9a41');
  });
  it('PAID => paid amount 2000; rejects wrong key / tampered body / missing header / wrong event', () => {
    expect(Tripay.parseCallback(h, tBody, cfg)).toMatchObject({ status: 'paid', amount: 2000, order_id: 'KL261101-ABCDEF' });
    throwsPay(() => Tripay.parseCallback(h, tBody, { ...cfg, private_key: 'x' }));
    throwsPay(() => Tripay.parseCallback(h, tBody.replace('2000', '1'), cfg));
    throwsPay(() => Tripay.parseCallback({}, tBody, cfg));
    throwsPay(() => Tripay.parseCallback({ ...h, 'x-callback-event': 'other' }, tBody, cfg));
  });
  it('amount excludes the fee the customer paid on top; detect()', () => {
    const fee = '{"reference":"T0001","merchant_ref":"KL261101-ABCDEF","status":"PAID","total_amount":2750,"fee_customer":750}';
    expect(Tripay.parseCallback({ 'x-callback-signature': tripayCallbackSignature(fee, tk) }, fee, cfg).amount).toBe(2000);
    expect(Tripay.detect(h, tBody)).toBe(true);
    expect(Tripay.detect({}, tBody)).toBe(false);
  });
});

describe('Xendit: x-callback-token equality', () => {
  const body = '{"id":"inv-1","external_id":"KL261101-ABCDEF","status":"PAID","amount":2000,"paid_amount":2000}';
  const cfg = { env: 'sandbox' as const, callback_token: 'tok123' };
  it('token comparison; an empty configured token is never valid', () => {
    expect(xenditTokenValid('tok123', 'tok123')).toBe(true);
    expect(xenditTokenValid('tok124', 'tok123')).toBe(false);
    expect(xenditTokenValid('', '')).toBe(false);
    expect(xenditTokenValid('a', '')).toBe(false);
  });
  it('PAID / SETTLED => paid, EXPIRED => expired; bad or missing token rejected', () => {
    expect(Xendit.parseCallback({ 'x-callback-token': 'tok123' }, body, cfg)).toMatchObject({ status: 'paid', amount: 2000, order_id: 'KL261101-ABCDEF' });
    expect(Xendit.parseCallback({ 'x-callback-token': 'tok123' }, body.replace('PAID', 'SETTLED'), cfg).status).toBe('paid');
    expect(Xendit.parseCallback({ 'x-callback-token': 'tok123' }, body.replace('PAID', 'EXPIRED'), cfg).status).toBe('expired');
    throwsPay(() => Xendit.parseCallback({ 'x-callback-token': 'nope' }, body, cfg));
    throwsPay(() => Xendit.parseCallback({}, body, cfg));
  });
});

describe('Mock gateway', () => {
  const secret = 'mocksecret';
  const mk = (status = 'paid', amount = 2000, ts = Math.floor(Date.now() / 1000), sec = secret) =>
    new URLSearchParams({ order_id: 'KL261101-ABCDEF', status, amount: String(amount), ts: String(ts), mock_sig: mockSign('KL261101-ABCDEF', status, amount, ts, sec) }).toString();
  it('signature formula matches the independent vector', () => {
    expect(mockSign('KL261101-ABCDEF', 'paid', 2000, 1790000000, secret)).toBe('ac1c5b8302f1a667d141de09e997f7444d82aba37d023f0ec7f8025e263c26ad');
  });
  it('accepts a valid callback; rejects wrong secret, production, stale (replay window), changed amount', () => {
    expect(Mock.parseCallback({}, mk(), { env: 'sandbox', secret }).status).toBe('paid');
    throwsPay(() => Mock.parseCallback({}, mk(), { env: 'sandbox', secret: 'x' }));
    throwsPay(() => Mock.parseCallback({}, mk(), { env: 'production', secret }));
    throwsPay(() => Mock.parseCallback({}, mk('paid', 2000, Math.floor(Date.now() / 1000) - 3600), { env: 'sandbox', secret }));
    throwsPay(() => Mock.parseCallback({}, mk().replace('amount=2000', 'amount=1'), { env: 'sandbox', secret }));
  });
  it('an unconfigured (empty) secret never validates', () => {
    throwsPay(() => Mock.parseCallback({}, mk('paid', 2000, undefined, ''), { env: 'sandbox', secret: '' }));
  });
});

describe('callback IP allow-list', () => {
  it('empty list allows; exact, CIDR /24, partial-byte /20, IPv6', () => {
    expect(Shop.ipAllowed('1.2.3.4', '')).toBe(true);
    expect(Shop.ipAllowed('203.0.113.10', '203.0.113.10\n198.51.100.1')).toBe(true);
    expect(Shop.ipAllowed('203.0.113.11', '203.0.113.10')).toBe(false);
    expect(Shop.ipAllowed('198.51.100.77', '198.51.100.0/24')).toBe(true);
    expect(Shop.ipAllowed('198.51.101.1', '198.51.100.0/24')).toBe(false);
    expect(Shop.ipAllowed('10.0.15.9', '10.0.0.0/20')).toBe(true);
    expect(Shop.ipAllowed('10.0.16.1', '10.0.0.0/20')).toBe(false);
    expect(Shop.ipAllowed('2001:db8::1', '2001:db8::/32')).toBe(true);
    expect(Shop.ipAllowed('2001:db9::1', '2001:db8::/32')).toBe(false);
    expect(Shop.ipAllowed('1.2.3.4', '2001:db8::/32')).toBe(false);
  });
});
