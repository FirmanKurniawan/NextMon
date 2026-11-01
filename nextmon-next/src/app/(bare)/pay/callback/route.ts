import { Net } from '../../../../lib/net.ts';
import { handleCallback, loadMock } from '../../../../features/shop/public.ts';
import type { Hdrs } from '../../../../features/shop/gateways.ts';
import { jsonResponse } from '../../../../server/guard.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BODY = 1024 * 1024;

const redirect = (to: string) => new Response(null, { status: 303, headers: { location: to, 'cache-control': 'no-store' } });

/** GET /pay/callback?mock=ID&t=TOKEN : the demo gateway's pay page (lives at /pay/mock); anything else bounces to the shop. */
export function GET(req: Request): Response {
  const u = new URL(req.url);
  const id = u.searchParams.get('mock') ?? '';
  const t = u.searchParams.get('t') ?? '';
  if (id !== '' && loadMock(id, t, Net.clientIp(req.headers))) return redirect(`/pay/mock?id=${encodeURIComponent(id)}&t=${encodeURIComponent(t)}`);
  return redirect('/shop' + (u.searchParams.get('w') ? '?w=' + encodeURIComponent(u.searchParams.get('w')!) : ''));
}

/**
 * POST /pay/callback : payment webhook. Authenticity = gateway signature/token (never a session), so it is exempt from CSRF by
 * design. The workspace comes from `?w=slug` (the webhook URL we hand out) or from the order id inside the payload.
 */
export async function POST(req: Request): Promise<Response> {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY) return jsonResponse({ ok: false, error: 'too large' }, 413);
  const raw = await req.text();
  if (raw.length > MAX_BODY) return jsonResponse({ ok: false, error: 'too large' }, 413);
  const headers: Hdrs = {};
  req.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });
  const u = new URL(req.url);
  const out = await handleCallback({
    slug: u.searchParams.get('w') ?? '',
    mock: u.searchParams.get('mock') ?? '',
    g: u.searchParams.get('g') ?? '',
    ip: Net.clientIp(req.headers),
    headers,
    raw,
  });
  if (out.redirect) return redirect(out.redirect);
  return jsonResponse(out.body, out.status);
}
