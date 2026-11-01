/**
 * Mikhmon-compatible sales records kept in the router's /system script (comment=mikhmon):
 *   name = date-|-time-|-user-|-price-|-ip-|-mac-|-validity-|-profile-|-comment     date = "oct/12/2026" (or ISO "2026-10-12")
 * The router clock is the source of truth, so dates are interpreted as wall-clock time in the workspace timezone (setting `timezone`).
 */
import { Cache } from './cache.ts';
import type { Driver, Row } from './driver.ts';

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export type Sale = {
  id: string;
  date: string;
  time: string;
  ts: number;
  user: string;
  price: number;
  ip: string;
  mac: string;
  validity: string;
  profile: string;
  comment: string;
};

// ---- timezone helpers (no deps) ------------------------------------------------------------------------

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Wall-clock parts of unix `ts` in `tz`. */
export function zonedParts(ts: number, tz = 'UTC'): { y: number; mo: number; d: number; h: number; mi: number; s: number; dow: number } {
  const o: Record<string, number> = {};
  for (const p of fmt(tz).formatToParts(new Date(ts * 1000))) if (p.type !== 'literal') o[p.type] = Number(p.value);
  const dow = new Date(Date.UTC(o.year!, o.month! - 1, o.day!)).getUTCDay(); // 0=Sun
  return { y: o.year!, mo: o.month!, d: o.day!, h: o.hour!, mi: o.minute!, s: o.second!, dow };
}

/** unix ts of a wall-clock time in `tz` (mktime). */
export function zonedToTs(y: number, mo: number, d: number, h = 0, mi = 0, s = 0, tz = 'UTC'): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s) / 1000;
  let ts = guess;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(ts, tz);
    const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) / 1000;
    ts -= asUtc - guess;
  }
  return ts;
}

/** "oct/12/2026" or "2026-10-12" + "hh:mm:ss" => unix ts (0 when the date is not understood) */
export function ts(date: string, time: string, tz = 'UTC'): number {
  let y = 0;
  let m = 0;
  let d = 0;
  let x = /^([a-z]{3})\/(\d{1,2})\/(\d{4})$/i.exec(date);
  if (x) {
    m = MONTHS[x[1]!.toLowerCase()] ?? 0;
    d = Number(x[2]);
    y = Number(x[3]);
  } else if ((x = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date))) {
    y = Number(x[1]);
    m = Number(x[2]);
    d = Number(x[3]);
  }
  if (!m) return 0;
  const t = (time + ':0:0').split(':').map((n) => Number(n) || 0);
  return zonedToTs(y, m, d, t[0], t[1], t[2], tz);
}

// ---- parsing / aggregation -----------------------------------------------------------------------------

export function parse(scripts: Row[], tz = 'UTC'): Sale[] {
  const out: Sale[] = [];
  for (const s of scripts) {
    const p = (s.name ?? '').split('-|-');
    if (p.length < 8) continue;
    out.push({
      id: s['.id'] ?? '',
      date: p[0]!,
      time: p[1]!,
      ts: ts(p[0]!, p[1]!, tz),
      user: p[2]!,
      price: Number.parseFloat(p[3]!) || 0,
      ip: p[4]!,
      mac: p[5]!,
      validity: p[6]!,
      profile: p[7]!,
      comment: p[8] ?? '',
    });
  }
  return out.sort((a, b) => b.ts - a.ts);
}

export const sum = (rows: Sale[]) => rows.reduce((a, r) => a + r.price, 0);

const keyOf = (period: string, t: number, tz: string): string => {
  const p = zonedParts(t, tz);
  if (period === 'day') return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
  if (period === 'month') return `${p.y}-${pad(p.mo)}`;
  return String(p.y);
};

/** Filter by period: day (Y-m-d), month (Y-m), year (Y), all. Optional profile. */
export function filter(rows: Sale[], period: string, value: string, profile = '', tz = 'UTC'): Sale[] {
  const dated = ['day', 'month', 'year'].includes(period);
  return rows.filter((r) => (profile === '' || r.profile === profile) && (!dated || keyOf(period, r.ts, tz) === value));
}

export function daily(rows: Sale[], tz = 'UTC'): Record<string, number> {
  const o: Record<string, number> = {};
  for (const r of rows) {
    const k = keyOf('day', r.ts, tz);
    o[k] = (o[k] ?? 0) + r.price;
  }
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
}

export function byProfile(rows: Sale[]): Record<string, number> {
  const o: Record<string, number> = {};
  for (const r of rows) o[r.profile] = (o[r.profile] ?? 0) + r.price;
  return Object.fromEntries(Object.entries(o).sort(([, a], [, b]) => b - a));
}

/** Record format used by Mikhmon (for POS or tests). */
export function recordName(x: { ts: number; user: string; price: number; ip?: string; mac?: string; validity?: string; profile: string; comment?: string }, tz = 'UTC'): string {
  const p = zonedParts(x.ts, tz);
  return [`${MON[p.mo - 1]}/${pad(p.d)}/${p.y}`, `${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`, x.user, String(Math.trunc(x.price)), x.ip ?? '', x.mac ?? '', x.validity ?? '', x.profile, x.comment ?? ''].join('-|-');
}

// ---- fetching (cached per workspace+router) ------------------------------------------------------------

/** The one print that fetch() needs (so a caller can pipeline it with other reads). Only the record name is parsed. */
export function request(owner?: string): [string, Record<string, string>, string[]] {
  const q: Record<string, string> = { comment: 'mikhmon' };
  if (owner) q.owner = owner;
  return ['/system/script', q, ['name']];
}

/** Parsed sales rows, cached for ttl seconds under `cacheKey` (build it with Cache.scope(ws, 'sales', routerId)). */
export async function fetchSales(r: Driver, cacheKey: string, tz = 'UTC', ttl = 45, owner?: string): Promise<Sale[]> {
  const key = `${cacheKey}|${owner ?? 'all'}`;
  return Cache.remember(
    key,
    ttl,
    async () => {
      const [path, q, props] = request(owner);
      return parse(await r.print(path, q, props), tz);
    },
    cacheKey,
  );
}

export const Sales = { ts, parse, sum, filter, daily, byProfile, recordName, request, fetch: fetchSales, zonedParts, zonedToTs };
