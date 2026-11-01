import { Net } from '../../../lib/net.ts';
import { statusJson } from '../../../features/status/lookup.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /status.json?session=&user=[&w=slug] : machine-readable voucher status; CORS only for the workspace's router hosts + `status_cors`. */
export async function GET(req: Request): Promise<Response> {
  const u = new URL(req.url);
  const out = await statusJson(
    (u.searchParams.get('session') ?? '').slice(0, 80),
    (u.searchParams.get('user') ?? '').slice(0, 80),
    (u.searchParams.get('w') ?? '').slice(0, 40),
    Net.clientIp(req.headers),
    req.headers.get('origin') ?? '',
  );
  const h = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', vary: 'Origin', 'x-robots-tag': 'noindex' });
  if (out.cors !== '') h.set('access-control-allow-origin', out.cors);
  return new Response(JSON.stringify(out.body), { status: out.status, headers: h });
}
