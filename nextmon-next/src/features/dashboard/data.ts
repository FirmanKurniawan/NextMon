/** Dashboard payload (port of DashboardController::data): one pipelined round trip to the router + cached sales parsing. */
import { Cache } from '../../lib/cache.ts';
import type { Driver } from '../../lib/driver.ts';
import { fmtBytes } from '../../lib/fmt.ts';
import { fetchSales, filter, daily, sum, zonedParts } from '../../lib/sales.ts';
import type { Sale } from '../../lib/sales.ts';

const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (ts: number, tz: string) => {
  const p = zonedParts(ts, tz);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
};

export type DashboardData = ReturnType<typeof compute> extends Promise<infer T> ? T : never;

async function compute(r: Driver, salesKey: string, tz: string, currency: string) {
  const got = await r.printMany({
    res: ['/system/resource'],
    idn: ['/system/identity'],
    act: ['/ip/hotspot/active', {}, ['user']],
    usr: ['/ip/hotspot/user', {}, ['name', 'profile']],
    if: ['/interface', {}, ['name', 'type']],
  });
  const sales: Sale[] = await fetchSales(r, salesKey, tz, 45);
  const res = got.res?.[0] ?? {};
  const now = Math.floor(Date.now() / 1000);
  const today = filter(sales, 'day', dayKey(now, tz), '', tz);
  const monthKey = dayKey(now, tz).slice(0, 7);
  const month = filter(sales, 'month', monthKey, '', tz);
  const byDay = daily(sales, tz);
  const spark: number[] = [];
  const labels: string[] = [];
  const cntByDay: Record<string, number> = {};
  const heat: number[][] = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const s of sales) {
    const k = dayKey(s.ts, tz);
    cntByDay[k] = (cntByDay[k] ?? 0) + 1;
    const p = zonedParts(s.ts, tz);
    heat[(p.dow + 6) % 7]![p.h]!++;
  }
  const sparkCount: number[] = [];
  for (let i = 13; i >= 0; i--) {
    const k = dayKey(now - i * 86400, tz);
    spark.push(byDay[k] ?? 0);
    sparkCount.push(cntByDay[k] ?? 0);
    labels.push(`${k.slice(8, 10)}/${k.slice(5, 7)}`);
  }
  const yesterday = byDay[dayKey(now - 86400, tz)] ?? 0;
  const byProfile: Record<string, number> = {};
  for (const u of got.usr ?? []) byProfile[u.profile || 'default'] = (byProfile[u.profile || 'default'] ?? 0) + 1;
  const profiles = Object.entries(byProfile)
    .sort(([, a], [, b]) => b - a)
    .map(([name, count]) => ({ name, count }));
  const hddTotal = Number(res['total-hdd-space'] ?? 0);
  const hddFree = Number(res['free-hdd-space'] ?? 0);
  const total = Number(res['total-memory'] ?? 0);
  const free = Number(res['free-memory'] ?? 0);
  const recent = sales.slice(0, 6).map((s) => {
    const p = zonedParts(s.ts, tz);
    return { time: `${pad(p.d)}/${pad(p.mo)} ${pad(p.h)}:${pad(p.mi)}`, user: s.user, profile: s.profile, price: s.price };
  });
  return {
    ok: true as const,
    demo: r.demo,
    identity: got.idn?.[0]?.name ?? '',
    resource: {
      cpu: Number(res['cpu-load'] ?? 0),
      mem_pct: total > 0 ? Math.round((100 * (total - free)) / total) : 0,
      mem_used: fmtBytes(total - free),
      mem_total: fmtBytes(total),
      uptime: res.uptime ?? '',
      version: res.version ?? '',
      board: res['board-name'] ?? '',
      disk_pct: hddTotal > 0 ? Math.round((100 * (hddTotal - hddFree)) / hddTotal) : 0,
      disk_used: fmtBytes(hddTotal - hddFree),
      disk_total: fmtBytes(hddTotal),
    },
    spark_count: sparkCount,
    yesterday,
    profiles,
    heat,
    active: (got.act ?? []).length,
    users: (got.usr ?? []).length,
    income_today: sum(today),
    income_month: sum(month),
    count_today: today.length,
    count_month: month.length,
    spark,
    spark_labels: labels,
    recent,
    interfaces: (got.if ?? []).map((i) => i.name ?? '').filter(Boolean),
    currency,
  };
}

/**
 * Cached for ~2 s per router so several tabs / pollers cost one router round trip per window. `ns` is the router's cache namespace
 * (the CachedDriver bumps it on every write, which makes the payload unusable at once). Demo data is live-jittered local state.
 */
export async function dashboardData(r: Driver, o: { ws: string; routerId: string; ns: string; tz: string; currency: string }) {
  const key = Cache.scope(o.ws, 'dash', o.routerId);
  const run = () => compute(r, Cache.scope(o.ws, 'sales', o.routerId), o.tz, o.currency);
  if (r.demo) return run();
  return Cache.remember(key, 2, run, o.ns);
}
