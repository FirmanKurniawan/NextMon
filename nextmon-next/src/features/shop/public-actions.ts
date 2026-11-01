'use server';
import { Csrf } from '../../lib/auth.ts';
import { Net } from '../../lib/net.ts';
import { getSettings } from '../../lib/store.ts';
import { createOrder, inWorkspace, resolveSlug } from './public.ts';
import type { Old } from './public.ts';
import { reqInfo, translatorFor } from './public-next.ts';

export type PlaceResult = { to?: string; error?: string; old?: Old };

const field = (fd: FormData, k: string, max: number): string => {
  const v = fd.get(k);
  return typeof v === 'string' ? v.slice(0, max) : '';
};

/** POST of the public order form. Public: protected by the signed pre-session token + Origin check (middleware) + honeypot + rate limits. */
export async function placeOrder(fd: FormData): Promise<PlaceResult> {
  const info = await reqInfo();
  const t0 = translatorFor(info);
  if (!Csrf.verifyPre('shop', fd.get('_csrf'))) return { error: t0('Security token invalid or expired. Reload the page and try again.') };
  const ws = resolveSlug(field(fd, 'w', 40));
  if (!('ws' in ws)) return { error: t0('Page not found.') };
  if (Net.hit('shop-order-ip', info.ip, 60, 600)) return { error: t0('Too many orders from your connection. Please wait a few minutes.') };
  return inWorkspace(ws.ws, info.ip, async () => {
    const t = translatorFor(info, getSettings().lang);
    const r = await createOrder({
      name: field(fd, 'name', 200),
      phone: field(fd, 'phone', 60),
      email: field(fd, 'email', 200),
      package: field(fd, 'package', 40),
      terms: field(fd, 'terms', 4),
      website: field(fd, 'website', 200),
      ref: field(fd, 'ref', 60),
      ip: info.ip,
      origin: info.origin,
      host: info.host,
    });
    return r.ok ? { to: r.to } : { error: t(r.error), old: r.old };
  });
}
