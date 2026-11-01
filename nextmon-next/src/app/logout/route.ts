import { NextResponse } from 'next/server';
import { Audit } from '../../lib/audit.ts';
import { Csrf } from '../../lib/auth.ts';
import { Sessions } from '../../lib/sessions.ts';
import { getContext, sessionToken } from '../../server/context.ts';
import { clearSessionCookie } from '../../server/cookies.ts';

export const dynamic = 'force-dynamic';

const go = (to: string) => new NextResponse(null, { status: 303, headers: { location: to } });

/** POST /logout (form field `_csrf`, or header X-CSRF-Token) - for non-React clients; the UI uses the logout server action. */
export async function POST(req: Request): Promise<Response> {
  const ctx = await getContext();
  if (ctx) {
    const given = req.headers.get('x-csrf-token') ?? String((await req.formData().catch(() => null))?.get('_csrf') ?? '');
    if (!Csrf.verify(given, ctx.csrf)) return new NextResponse('Invalid CSRF token', { status: 419 });
    ctx.run(() => Audit.log('logout', ctx.user.username));
    const token = await sessionToken();
    if (token) Sessions.destroy(token);
  }
  await clearSessionCookie();
  return go('/login');
}

/** GET never changes state: just go home (a GET logout would be a CSRF/prefetch hazard). */
export function GET(): Response {
  return go('/');
}
