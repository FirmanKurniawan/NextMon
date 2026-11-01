/**
 * Shop orders (port of nextmon-php Orders.php). One document per order (`order.<id>`, per workspace); states
 * pending | paid | expired | failed | refunded. Every mutation runs under a per-order exclusive lock (in-process queue + a lease row
 * in the global `locks` document, so it also holds across processes). Fulfilment (the voucher on the router) is idempotent:
 *  - the voucher code is chosen and persisted BEFORE the router is touched (voucher_pre),
 *  - a retry first looks the user up on the router and re-uses it, so a crash between "router add" and "order saved"
 *    can never produce a second voucher,
 *  - once order.voucher is set nothing ever provisions again, however many callbacks arrive.
 * No Next.js imports: webhooks, the CLI and tests share this module.
 */
import { Audit } from '../../lib/audit.ts';
import { Context } from '../../lib/context.ts';
import { randomHex } from '../../lib/crypto.ts';
import { money } from '../../lib/fmt.ts';
import { Notify } from '../../lib/notify.ts';
import { guard } from '../../lib/quota.ts';
import { Reseller } from '../../lib/reseller.ts';
import { Routers } from '../../lib/routers.ts';
import { singleton } from '../../lib/singleton.ts';
import { getSettings, Store } from '../../lib/store.ts';
import { code as voucherCode, loginUrl } from '../../lib/voucher.ts';
import { Workspace } from '../../lib/workspace.ts';
import type { CbEvent } from '../shop/gateways.ts';
import { Shop } from '../shop/config.ts';
import type { Package } from '../shop/config.ts';

export const STATES = ['pending', 'paid', 'expired', 'failed', 'refunded'] as const;
export type OrderStatus = (typeof STATES)[number];

export type OrderEvent = { ts: number; type: string; detail: string; fp: string };
export type OrderNote = { ts: number; by: string; text: string };
export type VoucherRec = { user: string; pass: string; url: string; comment: string; created: number };
export type Order = {
  id: string;
  token: string;
  created: number;
  updated: number;
  expires: number;
  status: OrderStatus;
  package: { id: string; profile: string; price: number; label: string };
  amount: number;
  customer: { name?: string; phone?: string; email?: string };
  gateway: string;
  router: string;
  ref: string;
  pay_url: string;
  pay_info: string;
  voucher: VoucherRec | null;
  voucher_pre?: { user: string; pass: string; comment: string };
  fulfil: '' | 'done' | 'error';
  fulfil_err?: string;
  notes: OrderNote[];
  events: OrderEvent[];
  ip: string;
  paid_at?: number;
  paid_by?: string;
  refunded_at?: number;
  flag?: string;
  retry_at?: number;
  /** reseller attribution from the shop referral link; commission is computed server-side at fulfilment */
  attr?: { uid: string; code: string; at: number; credited_at?: number; comm?: number; pct?: number; reversed_at?: number; skipped?: string };
};

/** [ok, message, order] */
export type Result = [boolean, string, Order | null];
type Inner = [boolean, string, Order | null, boolean];

const ID_RE = /^KL\d{6}-[A-F0-9]{6}-[A-F0-9]{8}$/;
const FIND_RE = /KL\d{6}-[A-F0-9]{6}-([A-F0-9]{8})(?![A-Za-z0-9])/;
const now = () => Math.floor(Date.now() / 1000);
const cut = (s: string, n: number) => Array.from(s).slice(0, n).join('');
const p2 = (n: number) => String(n).padStart(2, '0');
const docName = (id: string) => 'order.' + id;

// ---- locking ---------------------------------------------------------------------------------------

const LEASE_MS = 90_000;
type Lease = Record<string, { until: number; owner: string }>;
const tails = singleton('orders.tails', () => new Map<string, Promise<unknown>>());
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function withLease<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const owner = randomHex(6);
  const locks = Store.global('locks');
  const started = Date.now();
  for (;;) {
    let got = false;
    locks.update<Lease>((m) => {
      const t = Date.now();
      for (const k of Object.keys(m)) if (k.startsWith('order:') && (m[k]!.until ?? 0) < t) delete m[k];
      if (!m[key]) {
        m[key] = { until: t + LEASE_MS, owner };
        got = true;
      }
      return m;
    }, {});
    if (got) break;
    if (Date.now() - started > LEASE_MS) throw new Error('order is busy');
    await sleep(15 + Math.floor(Math.random() * 25));
  }
  try {
    return await fn();
  } finally {
    locks.update<Lease>((m) => {
      if (m[key]?.owner === owner) delete m[key];
      return m;
    }, {});
  }
}

function locked<T>(id: string, fn: () => Promise<T> | T): Promise<T> {
  const key = `order:${Workspace.id()}:${id}`;
  const prev = tails.get(key) ?? Promise.resolve();
  const run = prev.then(() => withLease(key, async () => await fn()));
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}

// ---- storage ---------------------------------------------------------------------------------------

function event(o: Order, type: string, detail: string, fp = ''): void {
  o.events.push({ ts: now(), type, detail: cut(detail, 200), fp });
  o.events = o.events.slice(-40);
}

function put(o: Order): void {
  o.updated = now();
  Store.write(docName(o.id), o);
}

const normalise = (o: Order): Order => ({ ...o, notes: o.notes ?? [], events: o.events ?? [], voucher: o.voucher ?? null, fulfil: o.fulfil ?? '' });

export const Orders = {
  STATES,

  /** Order ids carry their workspace: `KL<yymmdd>-<6 hex>-<8 hex>` (the hex part of the workspace id `w_xxxxxxxx`, upper case). */
  valid: (id: string): boolean => ID_RE.test(id),

  /** Workspace id encoded in (the first order id found in) `text`, or null. Does not check that it exists. */
  workspaceOf(text: string): string | null {
    const m = FIND_RE.exec(text);
    return m ? 'w_' + m[1]!.toLowerCase() : null;
  },

  get(id: string): Order | null {
    if (!Orders.valid(id)) return null;
    const o = Store.read<Order | null>(docName(id), null);
    return o && typeof o === 'object' && o.id === id ? normalise(o) : null;
  },

  /** Newest first. */
  all(): Order[] {
    const out: Order[] = [];
    for (const n of Store.names()) {
      if (!n.startsWith('order.')) continue;
      const o = Store.read<Order | null>(n, null);
      if (o && typeof o === 'object' && o.id) out.push(normalise(o));
    }
    return out.sort((a, b) => b.created - a.created);
  },

  countPending(): number {
    let n = 0;
    for (const x of Store.names()) if (x.startsWith('order.') && Store.read<Order | null>(x, null)?.status === 'pending') n++;
    return n;
  },

  create(pkg: Package, customer: Order['customer'], gateway: string, expiryMin: number, routerId: string, attr?: { uid: string; code: string } | null): Order {
    const ws = Workspace.id();
    for (let i = 0; i < 5; i++) {
      const d = new Date();
      const id = `KL${p2(d.getFullYear() % 100)}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${randomHex(3).toUpperCase()}-${ws.slice(2).toUpperCase()}`;
      if (Store.has(docName(id))) continue;
      const o: Order = {
        id,
        token: randomHex(12),
        created: now(),
        updated: now(),
        expires: now() + 60 * Math.max(5, expiryMin),
        status: 'pending',
        package: { id: pkg.id, profile: pkg.profile, price: Math.trunc(Number(pkg.price)), label: pkg.label !== '' ? pkg.label : pkg.profile },
        amount: Math.trunc(Number(pkg.price)),
        customer,
        gateway,
        router: routerId,
        ref: '',
        pay_url: '',
        pay_info: '',
        voucher: null,
        fulfil: '',
        notes: [],
        events: [],
        ip: Context.current().ip ?? '',
      };
      if (attr) o.attr = { uid: attr.uid, code: attr.code, at: now() };
      put(o);
      return o;
    }
    throw new Error('Could not allocate an order id');
  },

  /** Locked read-modify-write of simple fields. */
  update(id: string, fn: (o: Order) => Order | void): Promise<Order | null> {
    return locked(id, () => {
      const cur = Orders.get(id);
      if (!cur) return null;
      const o = fn(cur) ?? cur;
      put(o);
      return o;
    });
  },

  note(o: Order, by: string, text: string): void {
    o.notes.push({ ts: now(), by, text: cut(text, 500) });
  },

  /** Pending orders past their deadline become expired (a late verified payment is still honoured). */
  async expireStale(): Promise<void> {
    for (const o of Orders.all()) {
      if (o.status === 'pending' && o.expires < now()) {
        await Orders.update(o.id, (x) => {
          if (x.status === 'pending' && x.expires < now()) {
            x.status = 'expired';
            event(x, 'expired', 'deadline passed');
          }
        });
      }
    }
  },

  // ---- payment results ----------------------------------------------------------------------------

  /** Admin or system says: paid. `amount` = verified amount from the gateway, null for a manual confirmation. */
  async markPaid(id: string, source: string, amount: number | null = null): Promise<Result> {
    const res = await locked<Inner>(id, async () => {
      const o = Orders.get(id);
      return o ? await paidLocked(o, source, amount) : [false, 'not found', null, false];
    });
    announce(res);
    return [res[0], res[1], res[2]];
  },

  /** Paid but the router was unreachable earlier: try again (throttled by the caller via retry_at). */
  async retryFulfil(id: string): Promise<Order | null> {
    const res = await locked<Inner>(id, async () => {
      const o = Orders.get(id);
      if (!o || o.status !== 'paid' || o.voucher) return [true, 'nothing to do', o, false];
      o.retry_at = now();
      const n = attribLocked(await provision(o));
      return [true, 'retried', n, !!n.voucher];
    });
    announce(res);
    return res[2];
  },

  /** Apply a verified gateway webhook. `fp` = fingerprint of the raw body (replay protection). */
  async applyEvent(id: string, ev: CbEvent, fp: string, gateway: string): Promise<Result> {
    const res = await locked<Inner>(id, async (): Promise<Inner> => {
      const o = Orders.get(id);
      if (!o) return [false, 'not found', null, false];
      if (o.gateway !== gateway) return [false, 'gateway mismatch', o, false];
      if (fp !== '' && o.events.some((e) => e.fp === fp)) return [true, 'duplicate', o, false];
      event(o, 'callback', `${ev.status} amount=${ev.amount} ref=${ev.ref}`, fp);
      if (ev.ref !== '' && (o.ref === '' || o.gateway === 'mock')) o.ref = ev.ref;
      switch (ev.status) {
        case 'paid':
          return await paidLocked(o, 'gateway:' + gateway, ev.amount);
        case 'failed':
        case 'expired':
          if (o.status === 'pending') o.status = ev.status;
          put(o);
          return [true, o.status, o, false];
        case 'refunded':
          if (o.status === 'paid') return await refundLocked(o, 'gateway:' + gateway, 'Refund reported by gateway', true);
          put(o);
          return [true, 'ignored', o, false];
        default:
          put(o);
          return [true, 'pending', o, false];
      }
    });
    announce(res);
    return [res[0], res[1], res[2]];
  },

  async refund(id: string, by: string, note: string, disable: boolean): Promise<Result> {
    const res = await locked<Inner>(id, async () => {
      const o = Orders.get(id);
      if (!o) return [false, 'not found', null, false];
      if (o.status !== 'paid') return [false, 'only paid orders can be refunded', o, false];
      return await refundLocked(o, by, note, disable);
    });
    return [res[0], res[1], res[2]];
  },

  /** Fields safe to show the customer. The voucher is included only for paid orders. */
  publicView(o: Order) {
    const ready = o.status === 'paid' && !!o.voucher;
    return {
      id: o.id,
      status: o.status,
      label: o.package.label,
      amount: o.amount,
      expires_in: Math.max(0, o.expires - now()),
      fulfil: o.fulfil ?? '',
      ready,
      ...(ready ? { voucher: { user: o.voucher!.user, pass: o.voucher!.pass, url: o.voucher!.url } } : {}),
    };
  },
};

/** MUST run under the order lock. */
async function paidLocked(o: Order, source: string, amount: number | null): Promise<Inner> {
  if (o.status === 'refunded') {
    event(o, 'ignored', 'paid event on refunded order');
    put(o);
    return [false, 'order is refunded', o, false];
  }
  if (amount !== null && amount !== Math.trunc(o.amount)) {
    o.flag = 'amount_mismatch';
    event(o, 'amount_mismatch', `got ${amount} expected ${o.amount}`);
    put(o);
    return [false, 'amount mismatch', o, false];
  }
  const was = o.status;
  delete o.flag;
  o.status = 'paid';
  if (!o.paid_at) {
    o.paid_at = now();
    o.paid_by = source;
    event(o, 'paid', source + (was !== 'pending' ? ` (late, was ${was})` : ''));
  }
  put(o); // persist "paid" before the router is touched
  let fresh = false;
  if (!o.voucher) {
    o = await provision(o);
    fresh = !!o.voucher;
  }
  o = attribLocked(o);
  return [true, o.voucher ? 'ok' : 'paid, voucher pending', o, fresh];
}

/** MUST run under the order lock. Creates (or re-finds) the hotspot user, always saves. */
async function provision(o: Order): Promise<Order> {
  try {
    const cfg = Shop.config();
    const rv = Shop.routerOf(cfg, o.router);
    if (!rv) throw new Error('No router configured');
    if (!o.voucher_pre) {
      const name = voucherCode(6, 'lowernum');
      const d = new Date();
      o.voucher_pre = { user: name, pass: name, comment: `vc-${100 + Math.floor(Math.random() * 900)}-${p2(d.getMonth() + 1)}.${p2(d.getDate())}.${p2(d.getFullYear() % 100)}-SHOP-${o.id}` };
      put(o);
    }
    const r = Routers.driver(rv.id);
    for (let i = 0; i < 6; i++) {
      const pre: NonNullable<Order['voucher_pre']> = o.voucher_pre!;
      const ex = await r.print('/ip/hotspot/user', { name: pre.user });
      if (!ex.length) {
        // daily voucher limit: a refused fulfilment is recorded as fulfil_err and can be retried (order stays paid)
        await guard(1, () => r.add('/ip/hotspot/user', { name: pre.user, password: pre.pass, profile: o.package.profile, comment: pre.comment }));
        break;
      }
      if (String(ex[0]!.comment ?? '').includes(o.id)) break; // our own user from an interrupted attempt
      const n = voucherCode(6, 'lowernum'); // somebody else's user: pick another code
      o.voucher_pre = { user: n, pass: n, comment: pre.comment };
      put(o);
      if (i === 5) throw new Error('Could not find a free voucher code');
    }
    const pre: NonNullable<Order['voucher_pre']> = o.voucher_pre!;
    o.voucher = { user: pre.user, pass: pre.pass, url: loginUrl(pre.user, pre.pass), comment: pre.comment, created: now() };
    o.fulfil = 'done';
    delete o.fulfil_err;
    event(o, 'fulfilled', pre.user);
  } catch (e) {
    o.fulfil = 'error';
    o.fulfil_err = cut((e as Error).message, 200);
    event(o, 'fulfil_error', o.fulfil_err);
  }
  put(o);
  return o;
}

/**
 * MUST run under the order lock. Reseller commission for an attributed order: only when PAID and fulfilled, computed on the server from
 * the order total with the reseller's commission %, credited once (order flag + ledger guard), saved.
 */
function attribLocked(o: Order): Order {
  const a = o.attr;
  if (!a || o.status !== 'paid' || !o.voucher || a.credited_at || a.skipped) return o;
  const cfg = Reseller.cfg(a.uid);
  if (!cfg || !cfg.active) {
    a.skipped = 'inactive';
    event(o, 'commission_skipped', 'reseller inactive');
    put(o);
    return o;
  }
  const amt = Reseller.commissionFor(cfg, Number(o.amount), 1);
  const r = Reseller.creditOrder(a.uid, o.id, amt, String(Number(cfg.commission)));
  a.credited_at = now();
  a.comm = r.already ? amt : r.credited;
  a.pct = Number(cfg.commission);
  event(o, 'commission', (r.already ? 'already credited ' : 'credited ') + a.comm);
  put(o);
  return o;
}

function announce(res: Inner): void {
  const o = res[2];
  if (!res[3] || !o) return;
  Audit.log('shop.paid', `${o.id} ${o.package.label} ${o.amount}`);
  Notify.event('sale', `Shop sale ${o.id}: ${o.package.label} ${money(o.amount, String(getSettings().currency || 'Rp'))} - ${o.customer.name ?? ''}`);
}

async function refundLocked(o: Order, by: string, note: string, disable: boolean): Promise<Inner> {
  o.status = 'refunded';
  o.refunded_at = now();
  Orders.note(o, by, 'REFUND: ' + note);
  event(o, 'refunded', by);
  let msg = 'refunded';
  if (o.attr?.credited_at && !o.attr.reversed_at) {
    Reseller.reverseOrder(o.attr.uid, o.id, Number(o.attr.comm ?? 0));
    o.attr.reversed_at = now();
    event(o, 'commission_reversed', String(o.attr.comm ?? 0));
  }
  if (disable && o.voucher) {
    try {
      const rv = Shop.routerOf(Shop.config(), o.router);
      if (!rv) throw new Error('No router configured');
      const r = Routers.driver(rv.id);
      const u = await r.print('/ip/hotspot/user', { name: o.voucher.user });
      if (u.length) {
        await r.set('/ip/hotspot/user', String(u[0]!['.id']), { disabled: 'yes' });
        msg += ', voucher disabled';
        event(o, 'voucher_disabled', o.voucher.user);
      }
    } catch (e) {
      msg += ', could not disable voucher: ' + (e as Error).message;
      Orders.note(o, 'system', 'Could not disable voucher: ' + (e as Error).message);
    }
  }
  put(o);
  return [true, msg, o, false];
}
