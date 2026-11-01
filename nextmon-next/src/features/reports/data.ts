import { fetchSales, filter, daily, byProfile, sum } from '../../lib/sales.ts';
import type { Sale } from '../../lib/sales.ts';
import { dayKey, salesKey, tzOf } from '../_sales/common.ts';
import { sp } from '../_sales/ui';
import type { AppContext } from '../types.ts';

export type Period = 'day' | 'month' | 'year' | 'all';
export type Filters = { period: Period; value: string; profile: string };

const RE: Record<Period, RegExp> = { day: /^\d{4}-\d{2}-\d{2}$/, month: /^\d{4}-\d{2}$/, year: /^\d{4}$/, all: /^$/ };

/** period/value/profile from the query string; invalid values fall back to "now" (same rules as ReportController::filters). */
export function reportFilters(q: Record<string, string | string[] | undefined>): Filters {
  const raw = sp(q.period);
  const period: Period = raw === 'day' || raw === 'month' || raw === 'year' || raw === 'all' ? raw : 'month';
  const today = dayKey(Math.floor(Date.now() / 1000), tzOf());
  const def: Record<Period, string> = { day: today, month: today.slice(0, 7), year: today.slice(0, 4), all: '' };
  const v = q.value === undefined ? def[period] : sp(q.value);
  return { period, value: RE[period].test(v) ? v : def[period], profile: sp(q.profile) };
}

const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** Mikhmon `owner` of a month filter ("nov2026"), '' for other periods. */
export function ownerOf(f: Filters): string {
  if (f.period !== 'month') return '';
  const m = /^(\d{4})-(\d{2})$/.exec(f.value);
  return m ? `${MON[Number(m[2]) - 1] ?? ''}${m[1]}` : '';
}

export async function loadSales(ctx: AppContext): Promise<Sale[]> {
  return fetchSales(ctx.driver(), salesKey(ctx), tzOf(), 45);
}

export function summarize(all: Sale[], f: Filters) {
  const tz = tzOf();
  const rows = filter(all, f.period, f.value, f.profile, tz);
  const total = sum(rows);
  const d = daily(rows, tz);
  const bp = byProfile(rows);
  const profiles = [...new Set(all.map((r) => r.profile))].sort();
  return {
    rows,
    total,
    count: rows.length,
    avg: rows.length ? total / rows.length : 0,
    profiles,
    chart: { labels: Object.keys(d), values: Object.values(d), plabels: Object.keys(bp), pvalues: Object.values(bp) },
  };
}
