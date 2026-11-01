/**
 * Per-workspace daily voucher quota (limit `vouchers_per_day`, 0 = unlimited; `main` is unlimited via Workspace.limits()).
 * Port of nextmon-php/src/Quota.php. Counter = doc `quota` of the workspace: { day: 'YYYY-MM-DD' in the workspace timezone, used }.
 * reserve() checks and increments inside one Store.update (BEGIN IMMEDIATE), so parallel or split requests cannot slip past the
 * limit; release() gives units back when generation fails or creates fewer vouchers than reserved.
 * Log size (`log_rows`) is enforced in Store.append (see store.ts CAPPED_LOGS), this file only reports usage.
 */
import { CAPPED_LOGS, getSettings, Store } from './store.ts';
import { Workspace } from './workspace.ts';

export const QUOTA_MSG = 'Daily voucher limit reached (:used of :limit used today, :n requested). Try again tomorrow or ask the platform admin to raise the limit.';

/** Thrown when a batch would exceed the daily voucher limit. `message` = English text with the numbers; `key` + `params` = i18n key and its placeholders (use t(e.key, e.params)). */
export class QuotaError extends Error {
  readonly used: number;
  readonly limit: number;
  readonly requested: number;
  readonly params: Record<string, string>;
  readonly key = QUOTA_MSG;
  constructor(used: number, limit: number, requested: number) {
    super(QUOTA_MSG.replace(':used', String(used)).replace(':limit', String(limit)).replace(':n', String(requested)));
    this.name = 'QuotaError';
    this.used = used;
    this.limit = limit;
    this.requested = requested;
    this.params = { ':used': String(used), ':limit': String(limit), ':n': String(requested) };
  }
}

export type Token = { day: string; n: number; ws: string };
type Doc = { day?: string; used?: number };

/** Today's date in the workspace timezone (setting `timezone`). */
export function day(now = new Date()): string {
  const tz = String(getSettings().timezone || 'UTC');
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  }
}

const limitOf = (ws: string) => Workspace.limits(ws).vouchers_per_day;

function usedHere(): number {
  const d = Store.read<Doc>('quota', {});
  return d.day === day() ? Math.max(0, Math.trunc(d.used ?? 0)) : 0;
}

/** Vouchers already created today in workspace `ws` (default: active). */
export function used(ws?: string): number {
  return ws && ws !== Workspace.idOrNull() ? Workspace.run(ws, usedHere) : usedHere();
}

/** { used, limit } of the vouchers-per-day limit (limit 0 = unlimited). */
export function usage(ws: string = Workspace.id()): { used: number; limit: number } {
  return { used: used(ws), limit: limitOf(ws) };
}

/** Rows in the fullest capped log collection vs the `log_rows` limit. */
export function logUsage(ws: string = Workspace.id()): { used: number; limit: number } {
  const max = Workspace.run(ws, () => Math.max(0, ...CAPPED_LOGS.map((l) => Store.count(l))));
  return { used: max, limit: Workspace.limits(ws).log_rows };
}

/** Same refusal as reserve() but counts nothing (dry runs, previews). */
export function check(n: number): void {
  const limit = limitOf(Workspace.id());
  if (limit > 0 && n > 0 && usedHere() + n > limit) throw new QuotaError(usedHere(), limit, n);
}

/**
 * Reserve `n` vouchers for today. Returns a token for release() (null when nothing was counted: unlimited or n <= 0).
 * Throws QuotaError with used/limit when used + n would exceed the limit (nothing is counted then).
 */
export function reserve(n: number): Token | null {
  const ws = Workspace.id();
  const limit = limitOf(ws);
  if (limit <= 0 || n <= 0) return null;
  const today = day();
  let seen = 0;
  let ok = false;
  Store.update<Doc>(
    'quota',
    (cur) => {
      const u = cur.day === today ? Math.max(0, Math.trunc(cur.used ?? 0)) : 0;
      seen = u;
      if (u + n > limit) return { day: today, used: u };
      ok = true;
      return { day: today, used: u + n };
    },
    {},
  );
  if (!ok) throw new QuotaError(seen, limit, n);
  return { day: today, n, ws };
}

/** Give back `n` (default: everything) of a reservation. Never goes below 0; a counter of another day is left alone. */
export function release(tok: Token | null | undefined, n?: number): void {
  if (!tok) return;
  const k = Math.max(0, Math.min(tok.n, n ?? tok.n));
  if (k === 0) return;
  const fn = () =>
    Store.update<Doc>(
      'quota',
      (cur) => (cur.day !== tok.day ? cur : { ...cur, used: Math.max(0, Math.trunc(cur.used ?? 0) - k) }),
      {},
    );
  if (tok.ws !== Workspace.idOrNull()) Workspace.run(tok.ws, fn);
  else fn();
}

/** Run fn after reserving n; the reservation is released if fn throws. */
export async function guard<T>(n: number, fn: () => Promise<T> | T): Promise<T> {
  const tok = reserve(n);
  try {
    return await fn();
  } catch (e) {
    release(tok);
    throw e;
  }
}

export const Quota = { day, used, usage, logUsage, check, reserve, release, guard };
