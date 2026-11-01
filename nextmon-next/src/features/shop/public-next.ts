/** Next.js request helpers for the public pages (client IP, CSP nonce, origin, language). Kept apart from public.ts so that stays testable. */
import { cookies, headers } from 'next/headers';
import { I18n, isLang } from '../../lib/i18n.ts';
import type { Lang, TFn } from '../../lib/i18n.ts';
import { Net } from '../../lib/net.ts';
import '../registry.ts'; // registers feature dictionaries before any t() call
import { Shop } from './config.ts';

export type ReqInfo = { h: Headers; ip: string; nonce: string; origin: string; host: string; cookieLang: string | undefined; accept: string | null };

export async function reqInfo(): Promise<ReqInfo> {
  const h = await headers();
  const c = await cookies();
  const origin = Shop.origin(h);
  return { h, ip: Net.clientIp(h), nonce: h.get('x-nonce') ?? '', origin, host: new URL(origin).host, cookieLang: c.get('klang')?.value, accept: h.get('accept-language') };
}

/** Visitor language: explicit cookie > Accept-Language > the workspace default (`wsLang`) > id. */
export function pickLang(i: ReqInfo, wsLang?: unknown): Lang {
  return I18n.pick(i.cookieLang, i.accept, isLang(wsLang) ? wsLang : 'id');
}

export const translatorFor = (i: ReqInfo, wsLang?: unknown): TFn => I18n.translator(pickLang(i, wsLang));
