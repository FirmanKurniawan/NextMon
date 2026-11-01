/**
 * Helpers shared by the network/operations features (PPPoE, DHCP, ARP, queues, firewall, ...). Port of the private helpers of
 * nextmon-php NetworkController. This folder has no feature.ts, so it is not a feature itself.
 */
import { isIP } from 'node:net';
import { Audit } from '../../lib/audit.ts';
import { RouterOSError } from '../../lib/driver.ts';
import type { Row } from '../../lib/driver.ts';
import type { AppContext } from '../types.ts';

export const isTrue = (v: unknown): boolean => v === 'true' || v === 'yes' || v === true;
export const off = (row: Row): boolean => isTrue(row.disabled);

const ID_RE = /^\*[0-9A-Fa-f]+$/;
/** RouterOS item id (*1A); empty allowed only where `empty` is true (= "create"). */
export const validId = (id: string, empty = true): boolean => (id === '' ? empty : ID_RE.test(id));
export const validIp = (v: string, empty = true): boolean => (v === '' ? empty : isIP(v) !== 0);
export const validMac = (v: string, empty = true): boolean => (v === '' ? empty : /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(v));

/** Numeric sort key of an IPv4 address (unknown = 0), like PHP ip2long. */
export function ipKey(a: string | undefined): number {
  const p = (a ?? '').split('.');
  if (p.length !== 4) return 0;
  return p.reduce((n, x) => n * 256 + (Number(x) || 0), 0);
}

/** Case-insensitive substring search over some fields. */
export function search<T extends object>(rows: T[], q: string, fields: string[]): T[] {
  const n = q.trim().toLowerCase();
  if (!n) return rows;
  return rows.filter((r) => fields.some((f) => String((r as Record<string, unknown>)[f] ?? '').toLowerCase().includes(n)));
}

export function paginate<T>(rows: T[], page: number, per = 100): { rows: T[]; page: number; pages: number; total: number } {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / per));
  const pg = Math.max(1, Math.min(pages, Math.trunc(page) || 1));
  return { rows: rows.slice((pg - 1) * per, pg * per), page: pg, pages, total };
}

/** First value of a (possibly array) search param. */
export const sp = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));

// ---- form data ------------------------------------------------------------------------------------------------

export const field = (fd: FormData, k: string, def = ''): string => {
  const v = fd.get(k);
  return typeof v === 'string' ? v.trim() : def;
};
/** Untrimmed (passwords). */
export const raw = (fd: FormData, k: string): string => {
  const v = fd.get(k);
  return typeof v === 'string' ? v : '';
};
/** RouterOS ids posted as ids[] (anything else is dropped). */
export const postedIds = (fd: FormData): string[] => fd.getAll('ids[]').map(String).filter((i) => ID_RE.test(i));

export async function formOf(req: Request): Promise<FormData> {
  try {
    return await req.formData();
  } catch {
    return new FormData();
  }
}

// ---- results ----------------------------------------------------------------------------------------------------

export type Reply = { ok: boolean; message: string; error?: string; reload?: boolean };
export const done = (message: string): Reply => ({ ok: true, message, reload: true });
export const fail = (error: string): Reply => ({ ok: false, message: error, error });

/** Run fn for every id; one failure does not abort the rest. */
export async function each(ids: string[], fn: (id: string) => Promise<unknown>): Promise<{ ok: number; bad: number; err: string }> {
  let ok = 0;
  let bad = 0;
  let err = '';
  for (const id of ids) {
    try {
      await fn(id);
      ok++;
    } catch (e) {
      if (!(e instanceof RouterOSError)) throw e;
      bad++;
      err = e.message;
    }
  }
  return { ok, bad, err };
}

/** Audit + user message for a bulk result (PHP NetworkController::report). */
export function report(ctx: AppContext, res: { ok: number; bad: number; err: string }, action: string): Reply {
  Audit.log(action, `${res.ok} ok, ${res.bad} failed`);
  if (res.ok === 0 && res.bad === 0) return fail(ctx.t('Nothing selected.'));
  const msg = ctx.t('Done: :n items.', { ':n': res.ok }) + (res.bad ? ' ' + ctx.t(':n failed: :e', { ':n': res.bad, ':e': res.err }) : '');
  return { ok: res.bad === 0, message: msg, ...(res.bad ? { error: msg } : {}), reload: true };
}

/** Which write controls to show: `show` = the role may write; `ro` = the router is shared read-only (controls rendered disabled). */
export function access(ctx: AppContext, cap: 'write' | 'admin' = 'write'): { show: boolean; ro: boolean; dis: boolean } {
  const show = ctx.can(cap);
  const ro = !!ctx.router && ctx.router.shared && ctx.router.mode === 'ro';
  return { show, ro, dis: ro };
}
