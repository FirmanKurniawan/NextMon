/**
 * Edge of the app (runs on the Node.js runtime so it can use the same Net/Env helpers as the rest of the server):
 *   1. Host header validation (Host-header injection guard; NEXTMON_BASE_URL / NEXTMON_ALLOWED_HOSTS)
 *   2. Origin / Sec-Fetch-Site check on every state-changing request (CSRF layer 1; layer 2 = per-session token in guard.ts)
 *   3. Auth gate: no session cookie => /login (pages) or 401 (api). The cookie is only checked for PRESENCE here; the real
 *      validation (server-side session, workspace, suspension) is getContext() in the page/handler - the client-supplied
 *      workspace never exists anywhere.
 *   4. CSP with a per-request nonce + security headers (see server/csp.ts); the nonce is forwarded to Next via request headers.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { Env } from './lib/env.ts';
import { Net } from './lib/net.ts';
import { buildCsp, securityHeaders } from './server/csp.ts';

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
  runtime: 'nodejs',
};

const PUBLIC_EXACT = new Set(['/login', '/setup', '/lang', '/manifest.webmanifest', '/sw.js', '/offline.html', '/offline', '/api/health', '/robots.txt']);
const PUBLIC_PREFIX = ['/assets/', '/p/', '/api/public/', '/api/v1/']; // /api/v1/: API-key clients (no session cookie; the key is checked in lib/api-v1.ts)
// public pages of feature modules that the PHP edition exposes without login (shop, voucher status, payment callbacks)
const PUBLIC_FEATURE_EXACT = new Set(['/shop', '/shop/order', '/shop/poll', '/status', '/status.json', '/pay/callback', '/pay/mock']);

const isPublic = (p: string) => PUBLIC_EXACT.has(p) || PUBLIC_PREFIX.some((x) => p.startsWith(x)) || PUBLIC_FEATURE_EXACT.has(p);

const deny = (status: number, msg: string) => new NextResponse(msg, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });

export function middleware(req: NextRequest) {
  const h = req.headers;
  const path = req.nextUrl.pathname;
  const host = (Net.fromTrustedProxy(h) ? h.get('x-forwarded-host')?.split(',')[0]?.trim() : '') || h.get('host') || '';
  if (!Net.hostAllowed(host)) return deny(400, 'Bad Host header');

  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (unsafe) {
    const site = h.get('sec-fetch-site');
    if (site === 'cross-site') return deny(403, 'Cross-site request blocked');
    if (!Net.originAllowed(h.get('origin'), host)) return deny(403, 'Cross-origin request blocked');
  }

  const https = Net.isHttps(h);
  const hasSession = !!(req.cookies.get('__Host-nm_sid') ?? req.cookies.get('nm_sid'));
  if (!hasSession && !isPublic(path)) {
    if (path.startsWith('/api/') || path.startsWith('/json/')) {
      return new NextResponse(JSON.stringify({ ok: false, error: 'unauthenticated' }), { status: 401, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    }
    const next = path === '/' ? '' : '?next=' + encodeURIComponent(path + req.nextUrl.search);
    // Next's middleware adapter needs an absolute Location; the origin is the pinned BASE_URL or the already-validated Host
    const origin = Env.baseUrl()?.origin ?? `${https ? 'https' : 'http'}://${host}`;
    return new NextResponse(null, { status: 307, headers: { location: new URL('/login' + next, origin).toString(), 'cache-control': 'no-store' } });
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp(nonce, { dev: !Env.isProd(), https });
  const rh = new Headers(h);
  rh.set('x-nonce', nonce);
  rh.set('content-security-policy', csp);
  rh.set('x-nextmon-path', path + req.nextUrl.search);
  const res = NextResponse.next({ request: { headers: rh } });
  res.headers.set('content-security-policy', csp);
  for (const [k, v] of Object.entries(securityHeaders(https))) res.headers.set(k, v);
  return res;
}
