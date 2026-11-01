import { Net, PEER_HEADER } from '../../../lib/net.ts';
import { routerPool } from '../../../lib/routeros.ts';
import { TrafficHub } from '../../../lib/traffic-hub.ts';
import { getContext } from '../../../server/context.ts';
import { jsonResponse } from '../../../server/guard.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Admin diagnostics: realtime hub (one row per upstream stream), router pool, detected client IP / peer. */
export async function GET(req: Request): Promise<Response> {
  const ctx = await getContext();
  if (!ctx) return jsonResponse({ ok: false, error: 'unauthenticated' }, 401);
  if (!ctx.can('admin')) return jsonResponse({ ok: false, error: 'forbidden' }, 403);
  return jsonResponse({
    ok: true,
    streams: TrafficHub.stats(),
    pool: routerPool().stats(),
    client_ip: Net.clientIp(req.headers),
    peer: req.headers.get(PEER_HEADER),
    node: process.version,
  });
}
