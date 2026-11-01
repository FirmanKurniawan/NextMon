/**
 * Flash toasts across a hard navigation. The shared app.js turns `[data-flash]` elements into toasts once per page load, so write
 * flows end with a full reload to `path?flash=<kind>.<b64 message>.<hmac>`. The HMAC key is the session CSRF token, so a crafted
 * link cannot show a forged message to someone else.
 */
import crypto from 'node:crypto';

export type FlashKind = 'ok' | 'err';

const sig = (csrf: string, kind: string, b64: string) => crypto.createHmac('sha256', csrf).update(kind + '.' + b64).digest('base64url').slice(0, 22);

export function flashParam(csrf: string, kind: FlashKind, msg: string): string {
  const b64 = Buffer.from(msg.slice(0, 300), 'utf8').toString('base64url');
  return `${kind}.${b64}.${sig(csrf, kind, b64)}`;
}

export function readFlash(csrf: string, raw: string | string[] | undefined): { kind: FlashKind; msg: string } | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return null;
  const [kind, b64, s] = v.split('.');
  if ((kind !== 'ok' && kind !== 'err') || !b64 || !s) return null;
  const want = sig(csrf, kind, b64);
  const a = Buffer.from(s);
  const b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { kind, msg: Buffer.from(b64, 'base64url').toString('utf8') };
}

/** Add/replace query params of a same-site path (`/resellers?x=1` + flash). */
export function withFlash(path: string, csrf: string, kind: FlashKind, msg: string): string {
  const u = new URL(path, 'http://x');
  u.searchParams.set('flash', flashParam(csrf, kind, msg));
  return u.pathname + u.search + u.hash;
}
