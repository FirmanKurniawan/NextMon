import { zonedToTs } from '../../lib/sales.ts';
import { getSettings } from '../../lib/store.ts';
import { Orders } from './orders.ts';
import type { Order } from './orders.ts';

export type OrderFilter = { status: string; gateway: string; q: string; from: string; to: string };

const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? '')).trim();
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function filterOf(sp: Record<string, string | string[] | undefined>): OrderFilter {
  const f: OrderFilter = { status: first(sp.status).slice(0, 12), gateway: first(sp.gateway).slice(0, 20), q: first(sp.q).slice(0, 80), from: first(sp.from).slice(0, 10), to: first(sp.to).slice(0, 10) };
  if (!DATE_RE.test(f.from)) f.from = '';
  if (!DATE_RE.test(f.to)) f.to = '';
  return f;
}

/** Filtered orders, newest first. Stale pending orders are expired first. Dates are workspace-timezone days. */
export async function filtered(f: OrderFilter): Promise<Order[]> {
  await Orders.expireStale();
  const tz = String(getSettings().timezone || 'UTC');
  const day = (s: string, end: boolean): number => {
    const m = DATE_RE.exec(s);
    return m ? zonedToTs(Number(m[1]), Number(m[2]), Number(m[3]), end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, tz) : end ? Number.MAX_SAFE_INTEGER : 0;
  };
  const from = day(f.from, false);
  const to = day(f.to, true);
  const q = f.q.toLowerCase();
  return Orders.all().filter((o) => {
    if (f.status !== '' && o.status !== f.status) return false;
    if (f.gateway !== '' && o.gateway !== f.gateway) return false;
    if (o.created < from || o.created > to) return false;
    if (q !== '') {
      const hay = `${o.id} ${o.customer.name ?? ''} ${o.customer.phone ?? ''} ${o.customer.email ?? ''} ${o.voucher?.user ?? ''} ${o.ref}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function summarize(rows: Order[]) {
  const s = { count: rows.length, paid: 0, revenue: 0, pending: 0, attention: 0 };
  for (const o of rows) {
    if (o.status === 'paid') {
      s.paid++;
      s.revenue += Math.trunc(o.amount);
      if (!o.voucher) s.attention++;
    } else if (o.status === 'pending') s.pending++;
    if (o.flag) s.attention++;
  }
  return s;
}

/** Neutralise spreadsheet formulas (CSV injection): any text cell starting with = + - @ TAB CR gets a leading quote. */
export const csvCell = (v: unknown): string => {
  const s = String(v ?? '');
  return s !== '' && '=+-@\t\r'.includes(s[0]!) ? "'" + s : s;
};
