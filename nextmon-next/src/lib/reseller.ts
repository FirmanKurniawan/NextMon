/**
 * Reseller wallets. Port of nextmon-php Reseller.php.
 * Config per reseller user in doc `resellers`; balances in doc `wallets`; every movement is an append-only row in the log
 * collection `wallet_ledger` carrying the running balance (`bal`) after that row. All three are PER-WORKSPACE (Store namespacing),
 * so one tenant can never see or move another tenant's money. Entry types: topup | sale | refund | commission | adjustment.
 * Amounts are signed integers (currency units). The authoritative balance is the `wallets` doc (pruning old ledger rows never
 * changes balances).
 *
 * Sale hooks for other modules (vouchers, POS): charge() before creating vouchers, rollback() if creation fails, recordBatch() after,
 * mayPrint() to keep a reseller away from other people's voucher batches (IDOR guard).
 */
import crypto from 'node:crypto';
import { Context } from './context.ts';
import { money } from './fmt.ts';
import { I18n, isLang } from './i18n.ts';
import { getSettings, Store } from './store.ts';
import { zonedParts, zonedToTs } from './sales.ts';
import { Users } from './users.ts';
import { Workspace } from './workspace.ts';
import type { Meta } from './scripts.ts';

export const TYPES = ['topup', 'sale', 'refund', 'commission', 'adjustment'] as const;
export type EntryType = (typeof TYPES)[number];
const LEDGER = 'wallet_ledger';
const BATCHES = 'reseller_batches';

export type ResellerCfg = {
  active: boolean;
  commission: number;
  adj: number;
  credit: number;
  allow_all: boolean;
  /** allowed profile => own markup/discount % (null = use the reseller default) */
  profiles: Record<string, number | null>;
  /** shop referral code (slug-safe, unique per workspace); managed by setRef() only */
  ref?: string;
};

export type LedgerRow = {
  id: string;
  ts: number;
  uid: string;
  type: EntryType;
  amount: number;
  bal: number;
  note: string;
  ref: string;
  meta: Record<string, unknown>;
  by: string;
};

export type Spec = { type: string; amount: number; note?: string; ref?: string; meta?: Record<string, unknown>; once?: boolean };
export type PostResult = { ok: boolean; error: string; entries: LedgerRow[] };
export type Ticket = { uid: string; sale: string; sid: string; cost: number; comm: number; balance: number; profile: string; qty: number };
export type Actor = { id: string; username: string; role: string };
export type Filter = { uid?: string; type?: string; from?: string; to?: string; q?: string };

const tr = (key: string, params?: Record<string, string | number>): string => {
  const l = Context.current().lang;
  return I18n.translate(isLang(l) ? l : 'id', key, params);
};
const fmtMoney = (n: number) => money(n, String(getSettings().currency ?? 'Rp'));
const tz = () => String(getSettings().timezone || 'UTC');
const rid = (n: number) => crypto.randomBytes(n).toString('hex');
const now = () => Math.floor(Date.now() / 1000);

export const isReseller = (u: { role?: string } | null | undefined): boolean => !!u && u.role === 'reseller';

// ---- config ----------------------------------------------------------------------------------------

export const defaults = (): ResellerCfg => ({ active: true, commission: 0, adj: 0, credit: 0, allow_all: true, profiles: {} });

export const all = (): Record<string, Partial<ResellerCfg>> => Store.read<Record<string, Partial<ResellerCfg>>>('resellers', {});

export function cfg(uid: string): ResellerCfg | null {
  const a = all();
  return Object.hasOwn(a, uid) ? { ...defaults(), ...a[uid]! } : null;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : 0));

export function saveCfg(uid: string, input: { active?: boolean; commission?: unknown; adj?: unknown; credit?: unknown; allow_all?: boolean; profiles?: Record<string, unknown> }): ResellerCfg {
  const profiles: Record<string, number | null> = {};
  for (const [name, adj] of Object.entries(input.profiles ?? {})) {
    profiles[name] = adj === '' || adj === null || adj === undefined ? null : clamp(Number(adj), -100, 1000);
  }
  const c: ResellerCfg = {
    active: !!input.active,
    commission: clamp(Number(input.commission ?? 0), 0, 100),
    adj: clamp(Number(input.adj ?? 0), -100, 1000),
    credit: Math.max(0, Math.trunc(Number(input.credit ?? 0)) || 0),
    allow_all: !!input.allow_all,
    profiles,
  };
  Store.update<Record<string, Partial<ResellerCfg>>>('resellers', (a) => ({ ...a, [uid]: { ...c, ref: String(a[uid]?.ref ?? '') } }), {});
  return c;
}

// ---- shop referral: ?ref=<code> only ATTRIBUTES an order to a reseller (never workspace / price / product) -----------

export const REF_RE = /^[a-z0-9][a-z0-9-]{2,23}$/;

/** Slug-safe form of a client-supplied code ('' when nothing usable is left). */
export function cleanRef(s: string): string {
  const v = Array.from(String(s)).slice(0, 60).join('').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return REF_RE.test(v) ? v : '';
}

/** Set (or clear with '') the referral code of a reseller. Unique per workspace. Returns '' on success, else an error message. */
export function setRef(uid: string, code: string): string {
  const c = code.trim().toLowerCase();
  if (c !== '' && cleanRef(c) !== c) return tr('Referral code: 3-24 characters, a-z, 0-9 and dash.');
  let err = '';
  Store.update<Record<string, Partial<ResellerCfg>>>(
    'resellers',
    (a) => {
      if (c !== '' && Object.entries(a).some(([id, x]) => id !== uid && x.ref === c)) {
        err = tr('This referral code is already used.');
        return a;
      }
      return { ...a, [uid]: { ...defaults(), ...(a[uid] ?? {}), ref: c } };
    },
    {},
  );
  return err;
}

export type RefHit = { uid: string; username: string; cfg: ResellerCfg; code: string };

/** Active reseller owning referral `code` in the CURRENT workspace, or null (unknown / inactive / not a reseller user: ignored silently). */
export function byRef(code: string): RefHit | null {
  const k = cleanRef(code);
  if (k === '') return null;
  for (const [uid, raw] of Object.entries(all())) {
    if (raw.ref !== k) continue;
    const c = { ...defaults(), ...raw };
    if (!c.active) return null;
    const u = Users.inWorkspace(Workspace.id()).find((x) => x.id === uid && x.role === 'reseller');
    return u ? { uid, username: u.username, cfg: c, code: k } : null;
  }
  return null;
}

/** Credit the shop commission of order `orderId` once (the ledger itself guards: type commission + ref = order id). */
export function creditOrder(uid: string, orderId: string, amount: number, pct: string): { credited: number; already: boolean } {
  if (amount <= 0) return { credited: 0, already: false };
  const r = post(uid, [{ type: 'commission', amount, note: `Shop ${orderId} ${pct}%`, ref: orderId, meta: { via: 'shop', order: orderId }, once: true }], false, 'system');
  return { credited: r.ok ? amount : 0, already: !r.ok };
}

/** Reverse a credited shop commission exactly once (ref "rev:<order id>"). Returns the amount reversed. */
export function reverseOrder(uid: string, orderId: string, amount: number): number {
  if (amount <= 0) return 0;
  const r = post(uid, [{ type: 'commission', amount: -amount, note: `Shop refund ${orderId}`, ref: 'rev:' + orderId, meta: { via: 'shop', order: orderId, auto: 1 }, once: true }], false, 'system');
  return r.ok ? amount : 0;
}

export const allowed = (c: ResellerCfg, profile: string): boolean => c.allow_all || Object.hasOwn(c.profiles, profile);

/** Percent adjustment that applies to `profile` (per-profile override, else the reseller default). Negative = discount. */
export function adjFor(c: ResellerCfg, profile: string): number {
  const p = Object.hasOwn(c.profiles, profile) ? c.profiles[profile] : null;
  return p === null || p === undefined ? Number(c.adj) : Number(p);
}

/** What the reseller pays for one voucher whose customer price is `base`. */
export const unitCost = (c: ResellerCfg, profile: string, base: number): number => Math.max(0, Math.round(base * (1 + adjFor(c, profile) / 100)));

export const commissionFor = (c: ResellerCfg, base: number, qty: number): number => Math.round((base * qty * Number(c.commission)) / 100);

/** Customer-facing price from a parsed on-login meta (same rule as the POS). */
export const basePrice = (meta: Meta | null | undefined): number => (meta ? Number(meta.sprice !== '' ? meta.sprice : meta.price) || 0 : 0);

// ---- batch ownership -------------------------------------------------------------------------------

/** Remember that `actor` (when a reseller) created the voucher batch tagged `comment`. */
export function recordBatch(actor: Actor | null | undefined, comment: string): void {
  if (!actor || !isReseller(actor) || comment === '') return;
  Store.update<Record<string, string>>(
    BATCHES,
    (m) => {
      m[comment] = actor.id;
      const keys = Object.keys(m);
      if (keys.length > 5000) for (const k of keys.slice(0, keys.length - 4000)) delete m[k];
      return m;
    },
    {},
  );
}

/** Non-resellers see every batch; a reseller only the ones recorded for them. */
export function mayPrint(actor: Actor | null | undefined, batchTag: string): boolean {
  if (!actor || !isReseller(actor)) return true;
  const m = Store.read<Record<string, string>>(BATCHES, {});
  return batchTag !== '' && Object.hasOwn(m, batchTag) && m[batchTag] === actor.id;
}

// ---- balances + ledger -----------------------------------------------------------------------------

export const balance = (uid: string): number => Number(Store.read<Record<string, number>>('wallets', {})[uid] ?? 0) || 0;
export const balances = (): Record<string, number> => Object.fromEntries(Object.entries(Store.read<Record<string, number>>('wallets', {})).map(([k, v]) => [k, Math.trunc(Number(v)) || 0]));

/**
 * Apply ledger rows to one wallet atomically (single SQLite transaction).
 * `enforce` refuses when the resulting balance would fall below the reseller's credit limit.
 */
export function post(uid: string, specs: Spec[], enforce: boolean, by = ''): PostResult {
  const c = cfg(uid);
  const limit = c ? Math.trunc(c.credit) : 0;
  let err = '';
  let entries: LedgerRow[] = [];
  Store.update<Record<string, number>>(
    'wallets',
    (w) => {
      let bal = Math.trunc(Number(w[uid] ?? 0)) || 0;
      const start = bal;
      const rows: LedgerRow[] = [];
      for (const s of specs) {
        if (!(TYPES as readonly string[]).includes(s.type)) {
          err = 'bad type';
          return w;
        }
        if (s.once && s.ref && Store.rows(LEDGER, 1, 0, { type: s.type, ref: s.ref, uid }).length) {
          err = tr('Already refunded.');
          return w;
        }
        const amount = Math.trunc(s.amount);
        bal += amount;
        rows.push({
          id: now().toString(16) + '-' + rid(3),
          ts: now(),
          uid,
          type: s.type as EntryType,
          amount,
          bal,
          note: (s.note ?? '').slice(0, 200),
          ref: s.ref ?? '',
          meta: s.meta ?? {},
          by,
        });
      }
      if (enforce && bal < start && bal < -limit) {
        err = tr('Insufficient balance. Needed :need, available :bal.', { ':need': fmtMoney(start - bal), ':bal': fmtMoney(start) });
        return w;
      }
      for (const r of rows) Store.append(LEDGER, r);
      entries = rows;
      return { ...w, [uid]: bal };
    },
    {},
  );
  return { ok: err === '', error: err, entries: err ? [] : entries };
}

export const topup = (uid: string, amount: number, note: string, by = ''): PostResult => post(uid, [{ type: 'topup', amount, note }], false, by);
export const adjust = (uid: string, amount: number, note: string, by = ''): PostResult => post(uid, [{ type: 'adjustment', amount, note }], amount < 0, by);

/**
 * Sale hook. Returns null when `actor` is not a reseller (nothing to do), { error } when the sale must be blocked, or a ticket
 * once the wallet has been debited (pass it to rollback() if the vouchers cannot be created).
 */
export function charge(actor: Actor | null | undefined, profile: string, base: number, qty = 1, meta: Record<string, unknown> = {}): Ticket | { error: string } | null {
  if (!actor || !isReseller(actor)) return null;
  const c = cfg(actor.id);
  if (!c || !c.active) return { error: tr('Your reseller account is not active. Ask the administrator.') };
  if (!allowed(c, profile)) return { error: tr('You are not allowed to sell the profile :p.', { ':p': profile }) };
  const q = Math.max(1, Math.trunc(qty) || 1);
  const unit = unitCost(c, profile, base);
  const cost = unit * q;
  const comm = commissionFor(c, base, q);
  const m = { ...meta, profile, qty: q, base: Math.trunc(base), unit };
  const sid = now().toString(16) + '-s' + rid(3);
  const specs: Spec[] = [{ type: 'sale', amount: -cost, note: `${q} x ${profile}`, ref: sid, meta: m }];
  if (comm > 0) specs.push({ type: 'commission', amount: comm, note: `${c.commission}% ${profile}`, ref: sid, meta: m });
  const r = post(actor.id, specs, true, actor.username);
  if (!r.ok) return { error: r.error };
  return { uid: actor.id, sale: r.entries[0]!.id, sid, cost, comm, balance: r.entries[r.entries.length - 1]!.bal, profile, qty: q };
}

export const isBlocked = (t: Ticket | { error: string } | null): t is { error: string } => !!t && 'error' in t;

/** Undo a charge() whose vouchers could not be created. */
export function rollback(t: Ticket, why = ''): void {
  const specs: Spec[] = [{ type: 'refund', amount: t.cost, note: 'rollback ' + why, ref: t.sale, meta: { profile: t.profile, qty: t.qty, auto: 1 } }];
  if (t.comm > 0) specs.push({ type: 'commission', amount: -t.comm, note: 'reversal', ref: t.sale, meta: { auto: 1 } });
  post(t.uid, specs, false, 'system');
}

/** Admin refund of a sale row (also reverses its commission). Only entries of the active workspace can be reached. */
export function refund(entryId: string, by: string): PostResult {
  const e = Store.rows<LedgerRow>(LEDGER, 1, 0, { id: entryId })[0];
  if (!e || e.type !== 'sale') return { ok: false, error: tr('Only sale rows can be refunded.'), entries: [] };
  const specs: Spec[] = [{ type: 'refund', amount: -e.amount, note: 'refund ' + e.note, ref: e.id, meta: e.meta ?? {}, once: true }];
  for (const c of Store.rows<LedgerRow>(LEDGER, 5, 0, { ref: e.ref, type: 'commission' })) {
    if (c.amount > 0 && c.uid === e.uid) specs.push({ type: 'commission', amount: -c.amount, note: 'reversal', ref: e.id, meta: { auto: 1 } });
  }
  return post(e.uid, specs, false, by);
}

// ---- reading ---------------------------------------------------------------------------------------

const ymd = /^(\d{4})-(\d{2})-(\d{2})$/;
function dayTs(s: string | undefined, end: boolean): number | null {
  const m = s ? ymd.exec(s) : null;
  if (!m) return null;
  return end ? zonedToTs(+m[1]!, +m[2]!, +m[3]!, 23, 59, 59, tz()) : zonedToTs(+m[1]!, +m[2]!, +m[3]!, 0, 0, 0, tz());
}

/** Filter ledger rows (newest first): uid, type, from/to (Y-m-d, workspace timezone), q (text in note/profile/by/type). */
export function rows(f: Filter, max = 10000): LedgerRow[] {
  const where: Record<string, string> = {};
  if (f.uid) where.uid = f.uid;
  if (f.type && (TYPES as readonly string[]).includes(f.type)) where.type = f.type;
  const from = dayTs(f.from, false) ?? 0;
  const to = dayTs(f.to, true) ?? Number.MAX_SAFE_INTEGER;
  const q = (f.q ?? '').trim().toLowerCase();
  const out: LedgerRow[] = [];
  for (const r of Store.rows<LedgerRow>(LEDGER, max, 0, where)) {
    if (r.ts < from || r.ts > to) continue;
    if (q && !`${r.note} ${String((r.meta as { profile?: string })?.profile ?? '')} ${r.by} ${r.type}`.toLowerCase().includes(q)) continue;
    out.push(r);
  }
  return out;
}

export type Summary = { today_n: number; today_amt: number; month_n: number; month_amt: number; comm_month: number; comm_total: number; topup_total: number };

/** Sales/commission totals for a reseller (refunded sales excluded). */
export function summary(uid: string): Summary {
  const z = tz();
  const key = (t: number) => {
    const p = zonedParts(t, z);
    return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  };
  const today = key(now());
  const month = today.slice(0, 7);
  const s: Summary = { today_n: 0, today_amt: 0, month_n: 0, month_amt: 0, comm_month: 0, comm_total: 0, topup_total: 0 };
  const list = rows({ uid }, 5000);
  const refunded = new Set<string>();
  for (const r of list) if (r.type === 'refund' && r.ref) refunded.add(r.ref);
  for (const r of list) {
    const d = key(r.ts);
    if (r.type === 'sale' && !refunded.has(r.id)) {
      const n = Number((r.meta as { qty?: number })?.qty ?? 1) || 1;
      if (d === today) {
        s.today_n += n;
        s.today_amt += -r.amount;
      }
      if (d.startsWith(month)) {
        s.month_n += n;
        s.month_amt += -r.amount;
      }
    } else if (r.type === 'commission') {
      s.comm_total += r.amount;
      if (d.startsWith(month)) s.comm_month += r.amount;
    } else if (r.type === 'topup') {
      s.topup_total += r.amount;
    }
  }
  return s;
}

/** Neutralise spreadsheet formula injection in text cells. */
export function cell(v: string): string {
  const numeric = v.trim() !== '' && !Number.isNaN(Number(v));
  return v !== '' && '=+-@\t\r'.includes(v[0]!) && !numeric ? "'" + v : v;
}

const csvField = (v: unknown): string => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

const pad2 = (n: number) => String(n).padStart(2, '0');
export function fmtTime(ts: number, withSeconds = false): string {
  const p = zonedParts(ts, tz());
  return `${p.y}-${pad2(p.mo)}-${pad2(p.d)} ${pad2(p.h)}:${pad2(p.mi)}` + (withSeconds ? ':' + pad2(p.s) : '');
}

export function csv(list: LedgerRow[], names: Record<string, string>): string {
  const out = [['time', 'reseller', 'type', 'amount', 'balance', 'profile', 'qty', 'note', 'by', 'id', 'ref'].join(',')];
  for (const r of list) {
    const m = r.meta as { profile?: string; qty?: number };
    out.push([fmtTime(r.ts, true), names[r.uid] ?? r.uid, r.type, r.amount, r.bal, m?.profile ?? '', m?.qty ?? '', cell(r.note), cell(r.by), r.id, r.ref].map(csvField).join(','));
  }
  return '\uFEFF' + out.join('\r\n') + '\r\n';
}

export const Reseller = {
  TYPES, defaults, all, cfg, saveCfg, cleanRef, setRef, byRef, creditOrder, reverseOrder, isReseller, allowed, adjFor, unitCost, commissionFor, basePrice, recordBatch, mayPrint, balance, balances,
  post, topup, adjust, charge, isBlocked, rollback, refund, rows, summary, cell, csv, fmtTime,
};
