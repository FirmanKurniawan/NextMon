/**
 * Guards for the three entry points feature code can add: pages (requireContext), server actions (runAction), JSON endpoints
 * (apiHandler). Each one: resolves the session, CHECKS CSRF for state-changing calls, checks the capability, then runs your code
 * inside ctx.run() so the active workspace is set by the server (never by the client).
 */
import { redirect } from 'next/navigation';
import { Audit } from '../lib/audit.ts';
import { Context } from '../lib/context.ts';
import { Csrf } from '../lib/auth.ts';
import { Net } from '../lib/net.ts';
import { RouterError } from '../lib/routers.ts';
import { RouterOSError } from '../lib/routeros.ts';
import { NoWorkspaceError } from '../lib/store.ts';
import type { Cap } from '../lib/users.ts';
import { getContext } from './context.ts';
import type { AppContext } from './context.ts';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/** Open-redirect guard: only same-site absolute paths pass. */
export function localPath(p: unknown, fallback = '/'): string {
  if (typeof p !== 'string' || p.length > 500) return fallback;
  if (!p.startsWith('/') || p.startsWith('//') || p.includes('\\') || /[\x00-\x1f]/.test(p)) return fallback;
  return p;
}

/** For pages: the logged-in context or a redirect to /login. Optionally enforce a capability (throws HttpError 403). */
export async function requireContext(cap: Cap = 'view'): Promise<AppContext> {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  if (!ctx.can(cap)) throw new HttpError(403, 'Forbidden');
  return ctx;
}

/**
 * Server action wrapper. Usage inside a 'use server' file:
 *   export async function saveThing(fd: FormData) { return runAction({ cap: 'write' }, fd, async (ctx) => { ... }); }
 * Requires the hidden field `_csrf` (render <CsrfField ctx={ctx}/>) and the capability; runs inside the workspace context.
 */
export async function runAction<R>(opts: { cap?: Cap }, fd: FormData, fn: (ctx: AppContext, fd: FormData) => Promise<R> | R): Promise<R> {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  if (!Csrf.verify(fd.get('_csrf'), ctx.csrf)) throw new HttpError(419, 'Security token invalid or expired. Reload the page and try again.');
  if (!ctx.can(opts.cap ?? 'view')) throw new HttpError(403, 'Forbidden');
  return ctx.run(() => fn(ctx, fd));
}

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });
export { json as jsonResponse };

type Handler = (ctx: AppContext, req: Request, rest: string[]) => Promise<Response | Record<string, unknown>> | Response | Record<string, unknown>;

/**
 * JSON endpoint wrapper: 401 without session, 419 on CSRF mismatch for non-GET (header X-CSRF-Token), 403 without capability,
 * per-session rate limit, router/RouterOS errors mapped to JSON { ok:false, error }.
 */
export async function runApi(opts: { cap?: Cap }, req: Request, rest: string[], fn: Handler): Promise<Response> {
  const ctx = await getContext();
  if (!ctx) return json({ ok: false, error: 'unauthenticated' }, 401);
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (unsafe && !Csrf.verify(req.headers.get('x-csrf-token'), ctx.csrf)) return json({ ok: false, error: 'csrf' }, 419);
  if (!ctx.can(opts.cap ?? 'view')) return json({ ok: false, error: 'forbidden' }, 403);
  if (ctx.run(() => Net.hit('api', ctx.session.hash, 1500, 60))) return json({ ok: false, error: 'rate limited' }, 429, { 'retry-after': '60' });
  try {
    const out = await ctx.run(() => fn(ctx, req, rest));
    if (out instanceof Response) return out;
    return json(out, out.ok === false ? 400 : 200);
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
    if (e instanceof RouterOSError) return json({ ok: false, error: e.message }, 502);
    if (e instanceof RouterError) return json({ ok: false, error: e.message }, 404);
    if (e instanceof NoWorkspaceError) return json({ ok: false, error: 'no workspace' }, 403);
    console.error('[nextmon] api error', e);
    return json({ ok: false, error: 'Server error' }, 500);
  }
}

/** Audit helper for server actions that need an explicit entry (ctx already carries actor/ip). */
export function audit(ctx: AppContext, action: string, detail = ''): void {
  ctx.run(() => Audit.log(action, detail));
}
export { Context };
