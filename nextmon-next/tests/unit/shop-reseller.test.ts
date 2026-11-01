/**
 * Shop reseller referral (twin of nextmon-php/tests/unit/ShopResellerTest.php): attribution, commission credited once under replay and
 * concurrent paid callbacks (in-process and cross-process), refund reversal once, invalid / inactive ref, tenant isolation.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Orders } from '../../src/features/orders/orders.ts';
import type { Order } from '../../src/features/orders/orders.ts';
import { Shop } from '../../src/features/shop/config.ts';
import type { Package } from '../../src/features/shop/config.ts';
import { createOrder, inWorkspace, storeView } from '../../src/features/shop/public.ts';
import { Reseller } from '../../src/lib/reseller.ts';
import { Routers } from '../../src/lib/routers.ts';
import { Workspace } from '../../src/lib/workspace.ts';
import { addStaff, bootstrapPlatform, makeTenant } from '../helpers.ts';

const PKG: Package = { id: 'pabcdef', profile: '1Jam', price: 2000, label: '1 Jam', badge: '', desc: '', active: true };
let A: { ws: string };
let B: { ws: string };
let agent: string;
const inA = <T>(fn: () => T): T => inWorkspace(A.ws, '203.0.113.7', fn);
const inB = <T>(fn: () => T): T => inWorkspace(B.ws, '203.0.113.8', fn);
const attr = () => {
  const h = Reseller.byRef('agent-one');
  return h ? { uid: h.uid, code: h.code } : null;
};
const newOrder = (a: { uid: string; code: string } | null = attr(), price = 2000): Order =>
  Orders.create({ ...PKG, price }, { name: 'Cust', phone: '0811', email: '' }, 'manual', 30, Routers.list()[0]!.id, a);
const comm = (uid = agent) => inA(() => Reseller.rows({ uid }).filter((r) => r.type === 'commission'));
const bal = () => inA(() => Reseller.balance(agent));
const orderOfRow = (r: { meta: Record<string, unknown> }) => String(r.meta.order ?? '');

beforeAll(async () => {
  await bootstrapPlatform();
  A = await makeTenant('shopres-a');
  B = await makeTenant('shopres-b');
  for (const w of [A, B]) Workspace.run(w.ws, () => Shop.save({ enabled: true, gateway: 'manual', packages: [PKG], require_phone: true, order_limit: 500 }));
  const u = await addStaff(A.ws, 'agent1', 'reseller');
  agent = u.id;
  inA(() => {
    Reseller.saveCfg(agent, { active: true, commission: 10, adj: 0, credit: 0, allow_all: true });
    expect(Reseller.setRef(agent, 'agent-one')).toBe('');
  });
});

describe('referral code', () => {
  it('is slug-safe, unique per workspace, survives saveCfg, and only matches active reseller users', async () => {
    expect(Reseller.cleanRef('x')).toBe('');
    expect(Reseller.cleanRef('../../etc')).toBe('etc');
    expect(Reseller.cleanRef('..')).toBe('');
    expect(inA(() => Reseller.byRef('AGENT-ONE'))?.uid).toBe(agent);
    const u2 = await addStaff(A.ws, 'agent2', 'reseller');
    const op = await addStaff(A.ws, 'op1', 'operator');
    inA(() => {
      Reseller.saveCfg(u2.id, { active: true, commission: 5 });
      expect(Reseller.setRef(u2.id, 'agent-one')).not.toBe('');
      expect(Reseller.setRef(u2.id, 'Bad Code!')).not.toBe('');
      expect(Reseller.setRef(u2.id, 'agent-two')).toBe('');
      Reseller.saveCfg(agent, { active: true, commission: 10, allow_all: true });
      expect(Reseller.cfg(agent)!.ref).toBe('agent-one');
      Reseller.saveCfg(u2.id, { active: false });
      expect(Reseller.byRef('agent-two')).toBeNull(); // inactive: ignored silently
      expect(Reseller.byRef('nope')).toBeNull();
      expect(Reseller.setRef(op.id, 'op-code')).toBe('');
      expect(Reseller.byRef('op-code')).toBeNull(); // not a reseller user
    });
  });
});

describe('attribution and commission', () => {
  it('credits 10% once when paid and fulfilled; replays never double credit; ledger is labelled with the order id', async () => {
    const before = bal();
    const o = inA(() => newOrder());
    expect(o.attr?.uid).toBe(agent);
    expect(bal()).toBe(before);
    await inA(() => Orders.markPaid(o.id, 'test', 2000));
    const f = inA(() => Orders.get(o.id))!;
    expect(f.voucher).not.toBeNull();
    expect(f.attr?.comm).toBe(200);
    expect(bal()).toBe(before + 200);
    for (let i = 0; i < 4; i++) {
      await inA(() => Orders.markPaid(o.id, 'test', 2000));
      await inA(() => Orders.retryFulfil(o.id));
      await inA(() => Orders.applyEvent(o.id, { order_id: o.id, status: 'paid', amount: 2000, ref: 'r' + i }, 'fp' + i, 'manual'));
    }
    expect(bal()).toBe(before + 200);
    const rows = comm().filter((r) => r.ref === o.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.note).toContain(o.id);
    expect(orderOfRow(rows[0]!)).toBe(o.id);
  });

  it('mismatching amount / no payment earns nothing; no ref means no attribution', async () => {
    const before = bal();
    const o = inA(() => newOrder());
    const [ok] = await inA(() => Orders.markPaid(o.id, 'test', 1));
    expect(ok).toBe(false);
    const n = inA(() => newOrder(null));
    expect(n.attr).toBeUndefined();
    await inA(() => Orders.markPaid(n.id, 'test', 2000));
    expect(bal()).toBe(before);
  });

  it('commission follows the order total only (computed server-side)', async () => {
    const before = bal();
    const o = inA(() => newOrder(attr(), 12345));
    await inA(() => Orders.markPaid(o.id, 'test', 12345));
    expect(bal()).toBe(before + Math.round(12345 * 0.1));
  });

  it('the ledger guard alone prevents a double credit even if the order flag is lost', async () => {
    const before = bal();
    const o = inA(() => newOrder());
    await inA(() => Orders.markPaid(o.id, 'test', 2000));
    await inA(() =>
      Orders.update(o.id, (x) => {
        delete x.attr!.credited_at;
      }),
    );
    await inA(() => Orders.retryFulfil(o.id));
    await inA(() => Orders.markPaid(o.id, 'test', 2000));
    expect(bal()).toBe(before + 200);
    expect(comm().filter((r) => r.ref === o.id)).toHaveLength(1);
  });

  it('10 concurrent paid callbacks (in-process) credit exactly once', async () => {
    const before = bal();
    const o = inA(() => newOrder());
    await inA(() =>
      Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 ? Orders.markPaid(o.id, 'race', 2000) : Orders.applyEvent(o.id, { order_id: o.id, status: 'paid', amount: 2000, ref: 'x' }, 'fp-c' + i, 'manual')))),
    );
    expect(bal()).toBe(before + 200);
    expect(comm().filter((r) => r.ref === o.id)).toHaveLength(1);
  });
});

describe('refund reversal', () => {
  it('reverses the commission exactly once and a later paid event cannot re-credit', async () => {
    const before = bal();
    const o = inA(() => newOrder());
    await inA(() => Orders.markPaid(o.id, 'test', 2000));
    expect(bal()).toBe(before + 200);
    expect((await inA(() => Orders.refund(o.id, 'admin', 'money returned', false)))[0]).toBe(true);
    expect(bal()).toBe(before);
    await inA(() => Orders.refund(o.id, 'admin', 'again', false));
    await inA(() => Orders.applyEvent(o.id, { order_id: o.id, status: 'refunded', amount: 2000, ref: '' }, 'fpR', 'manual'));
    expect(bal()).toBe(before);
    await inA(() => Orders.markPaid(o.id, 'test', 2000));
    expect(bal()).toBe(before);
    const rows = comm().filter((r) => orderOfRow(r) === o.id);
    expect(rows.map((r) => r.amount).sort((a, b) => a - b)).toEqual([-200, 200]);
    expect(inA(() => Orders.get(o.id))!.attr?.reversed_at).toBeTruthy();
  });
});

describe('across processes', () => {
  const child = path.resolve('tests/fixtures/shop-reseller-child.mts');
  const run = (id: string, mode: string) =>
    new Promise<string>((resolve) => {
      const p = spawn(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--disable-warning=ExperimentalWarning', child, A.ws, id, mode], { env: { ...process.env, NEXTMON_DEMO: '1' } });
      let out = '';
      p.stdout.on('data', (d: Buffer) => (out += d));
      p.stderr.on('data', (d: Buffer) => (out += d));
      p.on('close', () => resolve(out.trim()));
    });
  it('6 concurrent paid processes credit once; 6 concurrent refunds reverse once', async () => {
    const before = bal();
    const o = inA(() => newOrder());
    await Promise.all(Array.from({ length: 6 }, () => run(o.id, 'paid')));
    expect(bal()).toBe(before + 200);
    expect(comm().filter((r) => r.ref === o.id)).toHaveLength(1);
    await Promise.all(Array.from({ length: 6 }, () => run(o.id, 'refund')));
    expect(bal()).toBe(before);
    expect(comm().filter((r) => orderOfRow(r) === o.id)).toHaveLength(2);
  }, 90000);
});

describe('public flow + tenant isolation', () => {
  const form = (ref: string) => ({ name: 'Cust', phone: '08111111111', email: '', package: PKG.id, terms: '1', website: '', ref, ip: '203.0.113.50', origin: 'http://localhost', host: 'localhost' });
  const idOf = (r: unknown) => String((r as { to: string }).to.match(/id=([^&]+)/)![1]);
  it('createOrder attributes a valid ref, ignores unknown / inactive ones silently, and never changes price or product', async () => {
    const ok = await inA(() => createOrder(form('agent-one')));
    expect(ok.ok).toBe(true);
    const o = inA(() => Orders.get(idOf(ok)))!;
    expect(o.attr?.uid).toBe(agent);
    expect([o.amount, o.package.profile]).toEqual([2000, '1Jam']);
    for (const bad of ['unknown-ref', '../../x', 'agent-two', '']) {
      const r = await inA(() => createOrder(form(bad)));
      expect(r.ok).toBe(true);
      expect(inA(() => Orders.get(idOf(r)))!.attr).toBeUndefined();
    }
  });
  it('storeView echoes only a valid code', () => {
    expect(inA(() => storeView('agent-one')).ref).toBe('agent-one');
    expect(inA(() => storeView('nope')).ref).toBe('');
  });
  it('a ref of workspace A is ignored in workspace B and credits nothing there or in A', async () => {
    const before = bal();
    expect(inB(() => Reseller.byRef('agent-one'))).toBeNull();
    const r = await inB(() => createOrder(form('agent-one')));
    expect(r.ok).toBe(true);
    const id = idOf(r);
    expect(inB(() => Orders.get(id))!.attr).toBeUndefined();
    await inB(() => Orders.markPaid(id, 'test', 2000));
    expect(bal()).toBe(before);
    // the same code may be used in another workspace by its own reseller
    const bu = await addStaff(B.ws, 'beta-agent', 'reseller');
    inB(() => {
      Reseller.saveCfg(bu.id, { active: true, commission: 50, allow_all: true });
      expect(Reseller.setRef(bu.id, 'agent-one')).toBe('');
      expect(Reseller.byRef('agent-one')?.uid).toBe(bu.id);
    });
    expect(inA(() => Reseller.byRef('agent-one'))?.uid).toBe(agent);
  });
});
