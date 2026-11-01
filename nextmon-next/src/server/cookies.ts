/** Session cookie helpers (server actions / route handlers). HttpOnly, SameSite=Lax, Secure when served over HTTPS, __Host- prefixed then. */
import { cookies, headers } from 'next/headers';
import { Net } from '../lib/net.ts';
import { COOKIE_HOST, COOKIE_PLAIN, LANG_COOKIE } from './context.ts';

export async function setSessionCookie(token: string): Promise<void> {
  const h = await headers();
  const secure = Net.isHttps(h);
  const c = await cookies();
  if (secure) c.delete(COOKIE_PLAIN); // never keep both flavours around
  c.set(secure ? COOKIE_HOST : COOKIE_PLAIN, token, { httpOnly: true, sameSite: 'lax', secure, path: '/' });
}

export async function clearSessionCookie(): Promise<void> {
  const c = await cookies();
  // a __Host- cookie is only accepted/overwritten by a Set-Cookie that carries Secure, so expire it the same way it was set
  c.set(COOKIE_HOST, '', { httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 0 });
  c.delete(COOKIE_PLAIN);
}

export async function setLangCookie(lang: string): Promise<void> {
  const h = await headers();
  const c = await cookies();
  c.set(LANG_COOKIE, lang, { httpOnly: false, sameSite: 'lax', secure: Net.isHttps(h), path: '/', maxAge: 31536000 });
}
