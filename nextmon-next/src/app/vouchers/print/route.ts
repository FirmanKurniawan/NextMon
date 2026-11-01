import { RouterError } from '../../../lib/routers.ts';
import { RouterOSError } from '../../../lib/routeros.ts';
import { flashCookie } from '../../../features/_kit/flash.ts';
import { printItems } from '../../../features/vouchers/items.ts';
import { renderPrintHtml } from '../../../features/vouchers/print.ts';
import { getContext } from '../../../server/context.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const back = (to: string, cookie?: string) => {
  const h = new Headers({ location: to, 'cache-control': 'no-store' });
  if (cookie) h.append('set-cookie', cookie);
  return new Response(null, { status: 303, headers: h });
};

/**
 * GET /vouchers/print?comment=<batch>|user=<name>: the standalone print view (no app shell). Same guard as a page: session,
 * `sell` capability, workspace from the session; resellers only get their own batches (checked in printItems).
 */
export async function GET(req: Request): Promise<Response> {
  const ctx = await getContext();
  if (!ctx) return back('/login');
  if (!ctx.can('sell')) return new Response('Forbidden', { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  const url = new URL(req.url);
  const tag = (url.searchParams.get('comment') ?? '').trim().slice(0, 200);
  const one = (url.searchParams.get('user') ?? '').trim().slice(0, 64);
  const nonce = req.headers.get('x-nonce') ?? '';
  try {
    const html = await ctx.run(async () => renderPrintHtml(ctx, nonce, await printItems(ctx, tag, one), one !== '' ? one : tag));
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  } catch (e) {
    if (e instanceof RouterOSError || e instanceof RouterError) return back('/vouchers', flashCookie(e instanceof RouterError ? ctx.t('No router configured') : e.message, 'err', url.protocol === 'https:'));
    throw e;
  }
}
