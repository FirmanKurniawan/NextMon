import { NextResponse } from 'next/server';
import { isLang } from '../../lib/i18n.ts';
import { Sessions } from '../../lib/sessions.ts';
import { getContext } from '../../server/context.ts';
import { setLangCookie } from '../../server/cookies.ts';
import { localPath } from '../../server/guard.ts';

export const dynamic = 'force-dynamic';

/** GET /lang?l=id|en&back=/path - remembers the language in a cookie (and in the session when logged in). Same contract as the PHP edition. */
export async function GET(req: Request): Promise<Response> {
  const u = new URL(req.url);
  const l = u.searchParams.get('l');
  if (isLang(l)) {
    await setLangCookie(l);
    const ctx = await getContext();
    if (ctx) Sessions.setLang(ctx.session.hash, l);
  }
  return new NextResponse(null, { status: 303, headers: { location: localPath(u.searchParams.get('back')) } });
}
