/** POST /api/json/tools (form: tool=ping|traceroute|torch|health|logs ...) - port of ToolsController::run. */
import { Audit } from '../../lib/audit.ts';
import type { Row } from '../../lib/driver.ts';
import { within } from '../monitor/logic.ts';
import { fail, formOf } from '../_netkit/util.ts';
import type { ApiRoute } from '../types.ts';

const ADDR_RE = /^[A-Za-z0-9.\-:]{1,100}$/;
const clamp = (v: unknown, min: number, max: number, d: number) => Math.max(min, Math.min(max, Math.trunc(Number(v)) || d));

/** Keep the last row for each key (streaming commands repeat rows while they update). */
function lastBy(rows: Row[], key: (r: Row, i: number) => string): Row[] {
  const o = new Map<string, Row>();
  rows.forEach((r, i) => o.set(key(r, i), r));
  return [...o.values()];
}

export const toolsApi: ApiRoute = {
  cap: 'view',
  async POST(ctx, req) {
    const fd = await formOf(req);
    const str = (k: string, d = '') => {
      const v = fd.get(k);
      return typeof v === 'string' ? v.trim() : d;
    };
    const tool = str('tool');
    // read-only roles may look (health, logs) but not make the router send packets / sniff traffic
    if (['ping', 'traceroute', 'torch'].includes(tool) && !ctx.can('write')) return new Response(JSON.stringify({ ok: false, error: ctx.t('Your role cannot access this page.') }), { status: 403, headers: { 'content-type': 'application/json' } });
    if (!ctx.router) return fail(ctx.t('No router configured'));
    const r = ctx.driver();
    switch (tool) {
      case 'ping':
      case 'traceroute': {
        const address = str('address');
        if (!ADDR_RE.test(address)) return { ok: false, error: ctx.t('Invalid address.') };
        const rows =
          tool === 'ping'
            ? await within(r.command('/tool/ping', { address, count: String(clamp(str('count', '4'), 1, 10, 4)) }), 25000)
            : lastBy(await within(r.command('/tool/traceroute', { address, count: '2' }), 25000), (x, i) => (x['.section'] ?? '') + (x.address ?? `#${i}`));
        Audit.log('tools.' + tool, address);
        return { ok: true, rows };
      }
      case 'torch': {
        const iface = str('interface').replace(/[^A-Za-z0-9_.-]/g, '');
        const rows = lastBy(
          await within(r.command('/tool/torch', { interface: iface, duration: String(clamp(str('duration', '3'), 1, 10, 3)), 'src-address': '0.0.0.0/0', 'dst-address': '0.0.0.0/0', 'ip-protocol': 'any' }), 25000),
          (x) => `${x['src-address'] ?? ''}>${x['dst-address'] ?? ''}${x['ip-protocol'] ?? ''}${x['dst-port'] ?? ''}`,
        );
        rows.sort((a, b) => Number(b.rx ?? 0) - Number(a.rx ?? 0));
        return { ok: true, rows: rows.slice(0, 40) };
      }
      case 'health': {
        const g = await r.printMany({ res: ['/system/resource'], health: ['/system/health'], idn: ['/system/identity'] });
        return { ok: true, resource: g.res?.[0] ?? {}, health: g.health?.[0] ?? {}, identity: g.idn?.[0]?.name ?? '' };
      }
      case 'logs': {
        const topic = str('topic').toLowerCase();
        let rows = await r.print('/log', {}, ['time', 'topics', 'message']);
        if (topic !== '') rows = rows.filter((x) => (x.topics ?? '').toLowerCase().includes(topic));
        return { ok: true, rows: rows.slice(-150).reverse() };
      }
    }
    return { ok: false, error: 'unknown tool' };
  },
};
