/** Voucher (hotspot user batch) generation. Port of nextmon-php Voucher.php. */
import crypto from 'node:crypto';
import { getSettings } from './store.ts';
import type { Driver } from './driver.ts';

export const CHARSETS: Record<string, string> = {
  num: '0123456789',
  lower: 'abcdefghjkmnpqrstuvwxyz',
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  lowernum: 'abcdefghjkmnpqrstuvwxyz23456789',
  uppernum: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
  mixed: 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789',
  // strict: also drops look-alike pairs 5/s 2/z 8/b 9/q/g u/v (0 O 1 l I i o are already absent from every letter set)
  safe: 'acdefhjkmnprtuwxy34679',
  safeupper: 'ACDEFHJKMNPRTUWXY34679',
};

/** Characters that are easily confused when read or typed by hand. */
export const AMBIGUOUS = '0O1lIoi';

export function code(len: number, set: string): string {
  const chars = CHARSETS[set] ?? CHARSETS.lowernum!;
  let o = '';
  for (let i = 0; i < len; i++) o += chars[crypto.randomInt(0, chars.length)];
  return o;
}

export type GenOptions = {
  profile: string;
  qty?: number;
  prefix?: string;
  length?: number;
  charset?: string;
  mode?: 'vc' | 'up' | string;
  batch?: string;
  limit_uptime?: string;
  limit_bytes?: string;
  server?: string;
};

const pad = (n: number) => String(n).padStart(2, '0');

/** Generate a batch of hotspot users on the router. Returns the batch comment + [name, password] pairs. */
export async function generate(r: Driver, o: GenOptions, now = new Date()): Promise<{ comment: string; items: [string, string][] }> {
  const maxQty = Number(getSettings().max_qty) || 500;
  const qty = Math.max(1, Math.min(maxQty, Math.trunc(o.qty ?? 1) || 1));
  const len = Math.max(3, Math.min(16, Math.trunc(o.length ?? 6) || 6));
  const prefix = (o.prefix ?? '').replace(/[^A-Za-z0-9_.-]/g, '');
  const set = o.charset ?? 'lowernum';
  const mode = o.mode === 'up' ? 'up' : 'vc';
  const batch = (o.batch ?? '').replace(/[^A-Za-z0-9_. -]/g, '').trim().slice(0, 24);
  const comment = `${mode}-${crypto.randomInt(100, 1000)}-${pad(now.getMonth() + 1)}.${pad(now.getDate())}.${pad(now.getFullYear() % 100)}${batch ? '-' + batch : ''}`;

  const existing = new Set((await r.print('/ip/hotspot/user', {}, ['name'])).map((x) => x.name ?? ''));
  const items: [string, string][] = [];
  const rows: Record<string, string>[] = [];
  let guard = 0;
  while (items.length < qty && guard++ < qty * 20) {
    const name = prefix + code(len, set);
    if (existing.has(name)) continue;
    existing.add(name);
    const pass = mode === 'vc' ? name : code(len, set);
    const attrs: Record<string, string> = { name, password: pass, profile: String(o.profile), comment };
    if (o.limit_uptime) attrs['limit-uptime'] = o.limit_uptime;
    if (o.limit_bytes) attrs['limit-bytes-total'] = o.limit_bytes;
    if (o.server && o.server !== 'all') attrs.server = o.server;
    rows.push(attrs);
    items.push([name, pass]);
  }
  await r.addMany('/ip/hotspot/user', rows); // pipelined: many vouchers per round-trip
  return { comment, items };
}

/** Extract the batch tag ("vc-123-10.28.26-name") from a comment that may be prefixed with an expiry date. */
export function batchOf(comment: string): string {
  const m = /\b((?:vc|up)-\d{3}-\d\d\.\d\d\.\d\d(?:-[^\n]*)?)$/.exec(comment);
  return m ? m[1]! : '';
}

/** Expiry date stored by the on-login script at the start of the comment ("oct/12/2026 10:00:00") */
export function expiryOf(comment: string): string {
  const m = /^([a-z]{3}\/\d\d\/\d{4} \d\d:\d\d:\d\d)/i.exec(comment);
  return m ? m[1]! : '';
}

export function loginUrl(user: string, pass: string): string {
  const base = String(getSettings().login_url ?? 'http://hotspot.local/login');
  return `${base}${base.includes('?') ? '&' : '?'}username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`;
}

export const Voucher = { CHARSETS, AMBIGUOUS, code, generate, batchOf, expiryOf, loginUrl };
