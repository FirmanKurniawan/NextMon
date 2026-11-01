/** JSON endpoints used by the dashboard (shared JS pages.js): /json/dashboard, /json/logs, /json/traffic, /json/interfaces, /json/health. */
import type { ApiRoute } from '../types.ts';
import { getSettings } from '../../lib/store.ts';
import { dashboardData } from './data.ts';
import { IFACE_RE } from '../../lib/traffic-hub.ts';

export const dashboardApi: ApiRoute = {
  async GET(ctx) {
    if (!ctx.router) return { ok: false, error: 'No router configured' };
    const s = getSettings();
    return dashboardData(ctx.driver(), { ws: ctx.workspace.id, routerId: ctx.router.id, ns: `${ctx.router.owner}:${ctx.router.id}`, tz: String(s.timezone), currency: String(s.currency) });
  },
};

export const logsApi: ApiRoute = {
  async GET(ctx) {
    const rows = await ctx.driver().print('/log', {}, ['time', 'topics', 'message']);
    const data = rows.filter((x) => (x.topics ?? '').toLowerCase().includes('hotspot')).reverse().slice(0, 20);
    return { ok: true, data };
  },
};

/** One-shot traffic sample (fallback when EventSource is unavailable). The live path is /api/stream/traffic (shared SSE hub). */
export const trafficApi: ApiRoute = {
  async GET(ctx, req) {
    const iface = new URL(req.url).searchParams.get('interface') ?? 'ether1';
    if (!IFACE_RE.test(iface)) return { ok: false, error: 'bad interface' };
    const row = (await ctx.driver().command('/interface/monitor-traffic', { interface: iface, once: true }))[0] ?? {};
    return { ok: true, t: Math.floor(Date.now() / 1000), rx: Number(row['rx-bits-per-second'] ?? 0), tx: Number(row['tx-bits-per-second'] ?? 0) };
  },
};

export const interfacesApi: ApiRoute = {
  async GET(ctx) {
    return { ok: true, data: await ctx.driver().print('/interface', {}, ['name', 'type', 'running']) };
  },
};

export const healthApi: ApiRoute = {
  async GET(ctx) {
    const g = await ctx.driver().printMany({ res: ['/system/resource'], health: ['/system/health'] });
    return { ok: true, resource: g.res?.[0] ?? {}, health: g.health?.[0] ?? {} };
  },
};
