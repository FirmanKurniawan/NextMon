import { Net } from '../../../../lib/net.ts';
import { loadOrder } from '../../../../features/shop/public.ts';
import { jsonResponse } from '../../../../server/guard.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /shop/poll?id=&t= : JSON order state for the polling script (same token rule as the order page). */
export async function GET(req: Request): Promise<Response> {
  const u = new URL(req.url);
  const ip = Net.clientIp(req.headers);
  if (Net.hit('shop-poll', ip, 600, 600)) return jsonResponse({ ok: false, error: 'rate limited' }, 429);
  const d = await loadOrder(u.searchParams.get('id') ?? '', u.searchParams.get('t') ?? '', ip);
  if (!d) return jsonResponse({ ok: false, error: 'not found' }, 404);
  return jsonResponse({ ok: true, ...d.view });
}
