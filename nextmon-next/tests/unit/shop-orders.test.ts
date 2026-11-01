/**
 * Shop orders: idempotent fulfilment under concurrency (port of nextmon-php/tests/shop_race.php), webhook application
 * (replay, amount mismatch, late payment, refund) and the public flow's tenant isolation (wrong slug, wrong token, suspended
 * workspace, cross-tenant order ids and callbacks).
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Orders } from '../../src/features/orders/orders.ts';
import type { Order } from '../../src/features/orders/orders.ts';
import { Shop } from '../../src/features/shop/config.ts';
import type { Package } from '../../src/features/shop/config.ts';
import { mockSign } from '../../src/features/shop/gateways.ts';
import { Http } from '../../src/features/shop/http.ts';
import { createOrder, handleCallback, inWorkspace, loadMock, loadOrder, peekTitle, resolveId, resolveSlug } from '../../src/features/shop/public.ts';
import { Crypto } from '../../src/lib/crypto.ts';
import { Net } from '../../src/lib/net.ts';
import { Routers } from '../../src/lib/routers.ts';
import { Store } from '../../src/lib/store.ts';
import { Workspace } from '../../src/lib/workspace.ts';
import { bootstrapPlatform, makeTenant } from '../helpers.ts';

const PKG: Package = { id: 'pabcdef', profile: '1Jam', price: 2000, label: '1 Jam', badge: '', desc: '', active: true };
let A: { ws: string };
let B: { ws: string };
const inA = <T>(fn: () => T): T => inWorkspace(A.ws, '203.0.113.7', fn);
const inB = <T>(fn: () => T): T => inWorkspace(B.ws, '203.0.113.8', fn);
const users = async (id: string) => (await Routers.driver(Routers.list()[0]!.id).print('/ip/hotspot/user')).filter((u) => String(u.comment ?? '').includes(id));

const newOrder = (gateway = 'manual'): Order => Orders.create(PKG, { name: 'Race', phone: '0811', email: '' }, gateway, 30, Routers.list()[0]!.id);

beforeAll(async () => {
  await bootstrapPlatform();
  A = await makeTenant('shop-a');
  B = await makeTenant('shop-b');
  for (const w of [A, B]) {
    Workspace.run(w.ws, () => Shop.save({ enabled: true, gateway: 'manual', packages: [PKG], require_phone: true, order_limit: 50 }));
  }
});

describe('order ids carry their workspace', () => {
  it('KL<date>-<6 hex>-<8 hex of the workspace>; workspaceOf() finds it in a payload', () => {
    const o = inA(() => newOrder());
    expect(o.id).toMatch(/^KL\d{6}-[A-F0-9]{6}-[A-F0-9]{8}$/);
    expect(Orders.workspaceOf(`xx ${o.id} yy`)).toBe(A.ws);
    expect(Orders.workspaceOf('no id here')).toBeNull();
    expect(Orders.valid('KL261101-ABCDEF')).toBe(false); // legacy ids without workspace are not accepted
    expect(Orders.valid(o.id + 'x')).toBe(false);
  });
  it('an order of A does not exist in B (storage is per workspace)', () => {
    const o = inA(() => newOrder());
    expect(inB(() => Orders.get(o.id))).toBeNull();
    expect(inB(() => Orders.all().some((x) => x.id === o.id))).toBe(false);
  });
});

describe('idempotent fulfilment', () => {
  it('10 concurrent markPaid on one order create exactly ONE voucher (race test)', async () => {
    const o = inA(() => newOrder());
    const results = await inA(() => Promise.all(Array.from({ length: 10 }, () => Orders.markPaid(o.id, 'race-test', null))));
    expect(results.every((r) => r[0])).toBe(true);
    const fin = inA(() => Orders.get(o.id))!;
    expect(fin.status).toBe('paid');
    expect(fin.fulfil).toBe('done');
    expect(fin.events.filter((e) => e.type === 'fulfilled')).toHaveLength(1);
    const rows = await inA(() => users(o.id));
    expect(rows).toHaveLength(1);
    expect(new Set(results.map((r) => r[2]?.voucher?.user)).size).toBe(1);
  });

  it('mixed concurrent webhook + admin markPaid + retry still yield one voucher', async () => {
    const o = inA(() => newOrder('mock'));
    const ev = { order_id: o.id, status: 'paid' as const, amount: 2000, ref: 'MOCK-' + o.id };
    await inA(() => Promise.all([Orders.applyEvent(o.id, ev, 'fp1', 'mock'), Orders.markPaid(o.id, 'admin:x'), Orders.retryFulfil(o.id), Orders.applyEvent(o.id, ev, 'fp2', 'mock'), Orders.markPaid(o.id, 'admin:y')]));
    const fin = inA(() => Orders.get(o.id))!;
    expect(fin.events.filter((e) => e.type === 'fulfilled')).toHaveLength(1);
    expect(await inA(() => users(o.id))).toHaveLength(1);
  });

  it('a crash between "router add" and "order saved" reuses the existing user (no second voucher)', async () => {
    const o = inA(() => newOrder());
    await inA(async () => {
      const pre = { user: 'crashuser', pass: 'crashuser', comment: `vc-111-01.01.26-SHOP-${o.id}` };
      Store.write('order.' + o.id, { ...Orders.get(o.id)!, voucher_pre: pre });
      await Routers.driver(Routers.list()[0]!.id).add('/ip/hotspot/user', { name: pre.user, password: pre.pass, profile: '1Jam', comment: pre.comment });
    });
    const [ok, , after] = await inA(() => Orders.markPaid(o.id, 'admin:t'));
    expect(ok).toBe(true);
    expect(after?.voucher?.user).toBe('crashuser');
    expect(await inA(() => users(o.id))).toHaveLength(1);
  });

  it('works across PROCESSES: 6 child processes on one order -> one fulfilment event, same voucher everywhere', async () => {
    const o = inA(() => newOrder());
    const child = path.resolve('tests/fixtures/order-race-child.mts');
    const run = () =>
      new Promise<string>((resolve) => {
        const p = spawn(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--disable-warning=ExperimentalWarning', child, A.ws, o.id], { env: { ...process.env, NEXTMON_DEMO: '1' } });
        let out = '';
        p.stdout.on('data', (d: Buffer) => (out += d));
        p.stderr.on('data', (d: Buffer) => (out += d));
        p.on('close', () => resolve(out.trim()));
      });
    const outs = await Promise.all(Array.from({ length: 6 }, run));
    const parsed = outs.map((s) => JSON.parse(s.split('\n').pop()!) as [boolean, string, string]);
    expect(parsed.every((r) => r[0])).toBe(true);
    expect(new Set(parsed.map((r) => r[2])).size).toBe(1);
    const fin = inA(() => Orders.get(o.id))!;
    expect(fin.events.filter((e) => e.type === 'fulfilled')).toHaveLength(1);
    expect(fin.events.filter((e) => e.type === 'paid')).toHaveLength(1);
  }, 60000);
});

describe('applying webhooks', () => {
  it('duplicate (replayed) webhook is a no-op', async () => {
    const o = inA(() => newOrder('mock'));
    const ev = { order_id: o.id, status: 'paid' as const, amount: 2000, ref: 'R1' };
    const r1 = await inA(() => Orders.applyEvent(o.id, ev, 'same-fp', 'mock'));
    const r2 = await inA(() => Orders.applyEvent(o.id, ev, 'same-fp', 'mock'));
    expect(r1[1]).toBe('ok');
    expect(r2[1]).toBe('duplicate');
    expect(inA(() => Orders.get(o.id))!.events.filter((e) => e.type === 'callback')).toHaveLength(1);
  });
  it('amount mismatch is flagged and no voucher is created; a manual confirm then fulfils it', async () => {
    const o = inA(() => newOrder('mock'));
    const [ok, msg, after] = await inA(() => Orders.applyEvent(o.id, { order_id: o.id, status: 'paid', amount: 1, ref: '' }, 'fp-m', 'mock'));
    expect(ok).toBe(false);
    expect(msg).toBe('amount mismatch');
    expect(after?.flag).toBe('amount_mismatch');
    expect(after?.voucher).toBeNull();
    const [ok2, , fixed] = await inA(() => Orders.markPaid(o.id, 'admin:t', null));
    expect(ok2).toBe(true);
    expect(fixed?.voucher).not.toBeNull();
    expect(fixed?.flag).toBeUndefined();
  });
  it('gateway mismatch is rejected (a mock event cannot pay a manual order)', async () => {
    const o = inA(() => newOrder('manual'));
    const [ok, msg] = await inA(() => Orders.applyEvent(o.id, { order_id: o.id, status: 'paid', amount: 2000, ref: '' }, 'fp-g', 'mock'));
    expect([ok, msg]).toEqual([false, 'gateway mismatch']);
  });
  it('failed/expired only move a pending order; late paid on expired is honoured; paid on refunded is refused', async () => {
    const o = inA(() => newOrder('mock'));
    await inA(() => Orders.applyEvent(o.id, { order_id: o.id, status: 'expired', amount: 0, ref: '' }, 'e1', 'mock'));
    expect(inA(() => Orders.get(o.id))!.status).toBe('expired');
    const late = await inA(() => Orders.applyEvent(o.id, { order_id: o.id, status: 'paid', amount: 2000, ref: '' }, 'e2', 'mock'));
    expect(late[0]).toBe(true);
    expect(late[2]?.status).toBe('paid');
    const rf = await inA(() => Orders.refund(o.id, 'admin', 'money returned', true));
    expect(rf[0]).toBe(true);
    expect(rf[1]).toContain('voucher disabled');
    const again = await inA(() => Orders.applyEvent(o.id, { order_id: o.id, status: 'paid', amount: 2000, ref: '' }, 'e3', 'mock'));
    expect(again[0]).toBe(false);
    expect(inA(() => Orders.get(o.id))!.status).toBe('refunded');
    const disabled = await inA(() => Routers.driver(Routers.list()[0]!.id).print('/ip/hotspot/user', { name: late[2]!.voucher!.user }));
    expect(disabled[0]?.disabled).toBe('true');
  });
  it('only paid orders can be refunded', async () => {
    const o = inA(() => newOrder());
    expect((await inA(() => Orders.refund(o.id, 'a', 'note', false)))[0]).toBe(false);
  });
  it('expireStale expires pending orders past their deadline only', async () => {
    const o = inA(() => newOrder());
    inA(() => Store.write('order.' + o.id, { ...Orders.get(o.id)!, expires: 1 }));
    const fresh = inA(() => newOrder());
    await inA(() => Orders.expireStale());
    expect(inA(() => Orders.get(o.id))!.status).toBe('expired');
    expect(inA(() => Orders.get(fresh.id))!.status).toBe('pending');
  });
});

describe('public flow: creating orders', () => {
  const base = { name: 'Budi', phone: '081234567890', email: '', package: PKG.id, terms: '', website: '', ip: '198.51.100.9', origin: 'https://wifi.example', host: 'wifi.example' };
  it('creates a pending order priced from the SERVER package (never the request) and hands over to the order page', async () => {
    const r = await inA(() => createOrder({ ...base }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const id = new URL(r.to, 'http://x').searchParams.get('id')!;
      const o = inA(() => Orders.get(id))!;
      expect(o.amount).toBe(2000);
      expect(o.status).toBe('pending');
      expect(o.customer.name).toBe('Budi');
    }
  });
  it('validation: unknown package, short name, bad phone, bad email, terms, disabled shop, honeypot', async () => {
    const err = async (over: Partial<typeof base>) => {
      const r = await inA(() => createOrder({ ...base, ...over }));
      return r.ok ? 'OK' : r.error;
    };
    expect(await err({ package: 'pzzzzzz' })).toBe('Please choose a package.');
    expect(await err({ name: 'B' })).toBe('Please enter your name.');
    expect(await err({ phone: '12' })).toBe('Please enter a valid phone number.');
    expect(await err({ email: 'nope' })).toBe('The email address looks invalid.');
    inA(() => Shop.save({ terms: 'Be nice' }));
    expect(await err({ terms: '' })).toBe('Please accept the terms to continue.');
    expect(await err({ terms: '1' })).toBe('OK');
    inA(() => Shop.save({ terms: '' }));
    const hp = await inA(() => createOrder({ ...base, website: 'http://spam' }));
    expect(hp.ok && hp.to).toBe('/shop' + inA(() => Shop.wQuery()));
    inA(() => Shop.save({ enabled: false }));
    expect(await err({})).toBe('The shop is currently closed.');
    inA(() => Shop.save({ enabled: true }));
  });
  it('the demo gateway refuses production mode', async () => {
    inA(() => Shop.save({ gateway: 'mock', env: 'production' }));
    const r = await inA(() => createOrder({ ...base }));
    expect(r.ok).toBe(false);
    inA(() => Shop.save({ gateway: 'manual', env: 'sandbox' }));
  });
  it('a gateway failure marks the order failed and tells the customer nothing about it', async () => {
    inA(() => Shop.save({ gateway: 'midtrans', gw: { midtrans: { server_key: Crypto.encrypt('SB-Mid-server-x') } } }));
    const real = Http.request;
    Http.request = async () => {
      throw new Error('boom secret detail');
    };
    try {
      const before = inA(() => Orders.all().length);
      const r = await inA(() => createOrder({ ...base }));
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.error).toBe('Could not start the payment. Please try again later.');
      const latest = inA(() => Orders.all().find((x) => x.notes.some((n) => n.text.includes('Gateway create failed')))!);
      expect(inA(() => Orders.all().length)).toBe(before + 1);
      expect(latest.status).toBe('failed');
    } finally {
      Http.request = real;
      inA(() => Shop.save({ gateway: 'manual' }));
    }
  });
  it('per-IP order limit', async () => {
    inA(() => Shop.save({ order_limit: 2 }));
    const ip = '192.0.2.200';
    const out: boolean[] = [];
    for (let i = 0; i < 4; i++) out.push((await inA(() => createOrder({ ...base, ip }))).ok);
    expect(out).toEqual([true, true, false, false]);
    inA(() => Shop.save({ order_limit: 50 }));
  });
});

describe('public pages: tenant isolation', () => {
  it('slug resolution: default main, unknown slug, case-insensitive, suspended', () => {
    expect(resolveSlug('')).toEqual({ ws: Workspace.bySlug('main')!.id });
    expect(resolveSlug('SHOP-A')).toEqual({ ws: A.ws });
    expect(resolveSlug('nope-nope')).toEqual({ why: 'unknown' });
    expect(resolveSlug('../etc')).toEqual({ why: 'unknown' });
    expect(resolveId('w_deadbeef')).toEqual({ why: 'unknown' });
  });
  it('order page: wrong id / wrong token / other tenant\'s token => null (neutral 404), right token => the order', async () => {
    const oa = inA(() => newOrder());
    const ob = inB(() => newOrder());
    expect((await loadOrder(oa.id, oa.token, '198.51.100.1'))?.o.id).toBe(oa.id);
    expect(await loadOrder(oa.id, 'wrongtoken', '198.51.100.1')).toBeNull();
    expect(await loadOrder(oa.id, '', '198.51.100.1')).toBeNull();
    expect(await loadOrder(oa.id, ob.token, '198.51.100.1')).toBeNull(); // B's token never opens A's order
    expect(await loadOrder('KL000000-AAAAAA-DEADBEEF', oa.token, '198.51.100.1')).toBeNull();
    expect(await loadOrder('garbage', oa.token, '198.51.100.1')).toBeNull();
    expect(peekTitle(oa.id, 'wrongtoken', '198.51.100.1')).toBeNull(); // the page <title> does not leak the shop name either
    expect(peekTitle(oa.id, oa.token, '198.51.100.1')).not.toBeNull();
  });
  it('the order page never exposes the voucher before payment, and exposes it once paid', async () => {
    const o = inA(() => newOrder());
    expect((await loadOrder(o.id, o.token, '198.51.100.1'))?.view.ready).toBe(false);
    expect(JSON.stringify((await loadOrder(o.id, o.token, '198.51.100.1'))?.view)).not.toContain('"voucher"');
    await inA(() => Orders.markPaid(o.id, 'admin:t'));
    const v = (await loadOrder(o.id, o.token, '198.51.100.1'))?.view;
    expect(v?.ready).toBe(true);
    expect(v?.voucher?.user).toBeTruthy();
  });
  it('suspended workspace: order page, demo pay page and webhook are all refused', async () => {
    const o = inB(() => newOrder('mock'));
    expect(await loadOrder(o.id, o.token, '198.51.100.1')).not.toBeNull();
    Workspace.setStatus(B.ws, 'suspended');
    try {
      expect(await loadOrder(o.id, o.token, '198.51.100.1')).toBeNull();
      expect(loadMock(o.id, o.token, '198.51.100.1')).toBeNull();
      expect(resolveSlug('shop-b')).toEqual({ why: 'suspended' });
      const ts = Math.floor(Date.now() / 1000);
      const raw = new URLSearchParams({ order_id: o.id, status: 'paid', amount: '2000', ts: String(ts), mock_sig: 'x' }).toString();
      const cb = await handleCallback({ slug: 'shop-b', mock: '', g: 'mock', ip: '198.51.100.1', headers: {}, raw });
      expect(cb.status).toBe(503);
      const cb2 = await handleCallback({ slug: '', mock: '', g: 'mock', ip: '198.51.100.1', headers: {}, raw });
      expect(cb2.status).toBe(503); // found through the order id inside the payload
    } finally {
      Workspace.setStatus(B.ws, 'active');
    }
  });
});

describe('payment webhook (signed demo gateway) and tenancy', () => {
  const signed = (o: Order, status: 'paid' | 'failed', secret: string, amount = o.amount, ts = Math.floor(Date.now() / 1000)) =>
    new URLSearchParams({ order_id: o.id, status, amount: String(amount), ts: String(ts), mock_sig: mockSign(o.id, status, amount, ts, secret) }).toString();
  const secretOf = (w: { ws: string }) => Workspace.run(w.ws, () => Shop.mockSecret());
  const call = (slug: string, raw: string, extra: Record<string, string> = {}) => handleCallback({ slug, mock: '', g: 'mock', ip: '198.51.100.20', headers: {}, raw, ...extra });

  it('a valid signed callback pays the order once; a replay is a duplicate', async () => {
    inA(() => Shop.save({ gateway: 'mock', env: 'sandbox' }));
    const o = inA(() => newOrder('mock'));
    const raw = signed(o, 'paid', secretOf(A));
    const r1 = await call('shop-a', raw);
    expect([r1.status, r1.body.ok, r1.body.message]).toEqual([200, true, 'ok']);
    const r2 = await call('shop-a', raw);
    expect(r2.body.message).toBe('duplicate');
    expect(inA(() => Orders.get(o.id))!.events.filter((e) => e.type === 'fulfilled')).toHaveLength(1);
  });
  it('signature made with ANOTHER workspace\'s secret is rejected (secrets are per tenant)', async () => {
    inB(() => Shop.save({ gateway: 'mock', env: 'sandbox' }));
    const o = inA(() => newOrder('mock'));
    const r = await call('shop-a', signed(o, 'paid', secretOf(B)));
    expect(r.status).toBe(403);
    expect(inA(() => Orders.get(o.id))!.status).toBe('pending');
  });
  it('callback addressed to workspace B with an order id of A: the order is not found in B (no cross-tenant payment)', async () => {
    const o = inA(() => newOrder('mock'));
    const r = await call('shop-b', signed(o, 'paid', secretOf(B)));
    expect(r.status).toBe(404);
    expect(inA(() => Orders.get(o.id))!.status).toBe('pending');
  });
  it('no slug: the workspace comes from the order id in the payload (fallback), unknown slug + no id => 404', async () => {
    const o = inA(() => newOrder('mock'));
    const r = await call('', signed(o, 'paid', secretOf(A)));
    expect(r.status).toBe(200);
    expect(inA(() => Orders.get(o.id))!.status).toBe('paid');
    expect((await call('ghost-ws', 'nothing=here')).status).toBe(404);
  });
  it('tampered amount, unknown gateway, garbage body', async () => {
    const o = inA(() => newOrder('mock'));
    expect((await call('shop-a', signed(o, 'paid', secretOf(A), 1).replace('amount=1', 'amount=2000'))).status).toBe(403);
    expect((await call('shop-a', signed(o, 'paid', secretOf(A)), { g: 'nope' })).status).toBe(400);
    expect((await call('shop-a', 'garbage')).status).toBe(403);
    expect(inA(() => Orders.get(o.id))!.status).toBe('pending');
  });
  it('callback IP allow-list rejects other addresses before anything else', async () => {
    inA(() => Shop.save({ callback_ips: '203.0.113.99' }));
    const o = inA(() => newOrder('mock'));
    expect((await call('shop-a', signed(o, 'paid', secretOf(A)))).status).toBe(403);
    inA(() => Shop.save({ callback_ips: '' }));
  });
  it('the demo pay page needs the right token and sandbox', () => {
    inA(() => Shop.save({ gateway: 'mock', env: 'sandbox' }));
    const o = inA(() => newOrder('mock'));
    expect(loadMock(o.id, o.token, '198.51.100.1')?.sigPaid).toBeTruthy();
    expect(loadMock(o.id, 'bad', '198.51.100.1')).toBeNull();
    inA(() => Shop.save({ env: 'production' }));
    expect(loadMock(o.id, o.token, '198.51.100.1')).toBeNull();
    inA(() => Shop.save({ env: 'sandbox' }));
  });
});

describe('outbound calls are SSRF-guarded', () => {
  it('Http.request refuses internal addresses before connecting', async () => {
    for (const u of ['http://127.0.0.1:1/x', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/x', 'http://10.0.0.5/x']) {
      await expect(Http.request('POST', u, {})).rejects.toThrow(/Blocked outbound URL/);
    }
    expect((await Net.checkOutboundUrl('http://192.168.1.1/')).ok).toBe(false);
  });
});
