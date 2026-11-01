import { Csrf } from '../../../lib/auth.ts';
import { Net } from '../../../lib/net.ts';
import { RouterError } from '../../../lib/routers.ts';
import { RouterOSError } from '../../../lib/routeros.ts';
import { NoWorkspaceError } from '../../../lib/store.ts';
import { flashCookie } from '../../../features/_kit/flash.ts';
import { UserError } from '../../../features/_kit/forms.ts';
import type { FormResult } from '../../../features/_kit/forms.ts';
import { FORMS } from '../../../features/_kit/registry.ts';
import { getContext } from '../../../server/context.ts';
import { jsonResponse, localPath } from '../../../server/guard.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /hs/<key>: plain-form endpoints of the hotspot feature family (see features/_kit/forms.ts). Session, CSRF (`_csrf` field or
 * X-CSRF-Token), capability, rate limit and workspace context are enforced here; handlers only do the work and name the redirect.
 */
export async function POST(req: Request, { params }: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const key = (await params).path.join('/');
  const route = Object.hasOwn(FORMS, key) ? FORMS[key]! : null;
  if (!route) return jsonResponse({ ok: false, error: 'not found' }, 404);
  const ctx = await getContext();
  if (!ctx) return route.json ? jsonResponse({ ok: false, error: 'unauthenticated' }, 401) : redirectTo('/login');
  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    return jsonResponse({ ok: false, error: 'bad request' }, 400);
  }
  if (!Csrf.verify(fd.get('_csrf') ?? req.headers.get('x-csrf-token'), ctx.csrf)) return jsonResponse({ ok: false, error: 'Security token invalid or expired. Reload the page and try again.' }, 419);
  if (!ctx.can(route.cap)) return jsonResponse({ ok: false, error: 'forbidden' }, 403);
  if (ctx.run(() => Net.hit('form', ctx.session.hash, 600, 60))) return jsonResponse({ ok: false, error: 'rate limited' }, 429, { 'retry-after': '60' });

  const secure = new URL(req.url).protocol === 'https:' || Net.isHttps(req.headers);
  const back = localPath(typeof fd.get('back') === 'string' ? (fd.get('back') as string) : '', route.back);
  const fail = (msg: string, to?: string) => (route.json ? jsonResponse({ ok: false, error: msg }, 422) : redirectTo(to ?? back, flashCookie(msg, 'err', secure)));
  try {
    const out: FormResult = await ctx.run(() => route.run({ ctx, fd, req }));
    if ('json' in out) return jsonResponse(out.json, out.status ?? 200);
    return redirectTo(localPath(out.to, back), out.msg ? flashCookie(out.msg, out.type ?? 'ok', secure) : undefined);
  } catch (e) {
    if (e instanceof UserError) return fail(e.message, e.to ? localPath(e.to, back) : undefined);
    if (e instanceof RouterOSError) return fail(e.message);
    if (e instanceof RouterError) return fail(ctx.t('No router configured'));
    if (e instanceof NoWorkspaceError) return jsonResponse({ ok: false, error: 'no workspace' }, 403);
    console.error('[nextmon] form error', key, e);
    return fail(ctx.t('Something went wrong'));
  }
}

function redirectTo(to: string, cookie?: string): Response {
  const h = new Headers({ location: to, 'cache-control': 'no-store' });
  if (cookie) h.append('set-cookie', cookie);
  return new Response(null, { status: 303, headers: h });
}
