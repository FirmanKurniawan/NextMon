import { Notify } from '../../lib/notify.ts';
import { QuotaError } from '../../lib/quota.ts';
import { Reseller } from '../../lib/reseller.ts';
import { Scripts } from '../../lib/scripts.ts';
import { getSettings, Store } from '../../lib/store.ts';
import { generate, loginUrl } from '../../lib/voucher.ts';
import { audit, jsonResponse } from '../../server/guard.ts';
import { currencyOf, dayKey, isRo, receiptTime, tzOf } from '../_sales/common.ts';
import { money } from '../../lib/fmt.ts';
import type { ApiRoute } from '../types.ts';

export const posLog = (routerId: string) => 'pos-' + routerId.replace(/\W/g, '') + '.log';

export type PosSale = { ts: number; user: string; profile: string; price: number; by: string };

/** Today's POS sales (workspace timezone), newest first. */
export function todaySales(routerId: string, n = 300): PosSale[] {
  const tz = tzOf();
  const today = dayKey(Math.floor(Date.now() / 1000), tz);
  return Store.tail<PosSale>(posLog(routerId), n).filter((x) => dayKey(x.ts, tz) === today);
}

export const posApi: ApiRoute = {
  cap: 'sell',
  async POST(ctx, req, rest) {
    if (rest[0] !== 'sell') return jsonResponse({ ok: false, error: 'not found' }, 404);
    if (!ctx.router) return jsonResponse({ ok: false, error: ctx.t('No router configured') }, 400);
    if (isRo(ctx)) return jsonResponse({ ok: false, error: ctx.t('This router is shared with you as read-only.') }, 403);
    const fd = await req.formData().catch(() => null);
    const profile = String(fd?.get('profile') ?? '');
    const r = ctx.driver();
    const found = profile ? (await r.print('/ip/hotspot/user/profile', { name: profile }, ['name', 'on-login']))[0] : undefined;
    if (!found) return jsonResponse({ ok: false, error: ctx.t('Profile not found.') }, 404);
    const meta = Scripts.parseMeta(found['on-login'] ?? '');
    const price = Reseller.basePrice(meta);
    const actor = { id: ctx.user.id, username: ctx.user.username, role: ctx.user.role };
    // reseller users pay from their wallet before the voucher exists; blocked when the balance is too low
    const tk = Reseller.charge(actor, profile, price, 1, { via: 'pos' });
    if (Reseller.isBlocked(tk)) return jsonResponse({ ok: false, error: tk.error }, 402);
    let res;
    try {
      res = await generate(r, { profile, qty: 1, length: 6, charset: 'lowernum', mode: 'vc', batch: 'POS' });
    } catch (e) {
      if (tk) Reseller.rollback(tk, 'pos error');
      if (e instanceof QuotaError) return jsonResponse({ ok: false, error: ctx.t(e.key, e.params), used: e.used, limit: e.limit }, 429); // daily voucher limit
      throw e;
    }
    Reseller.recordBatch(actor, res.comment);
    const [user, pass] = res.items[0]!;
    const now = Math.floor(Date.now() / 1000);
    Store.append(posLog(ctx.router.id), { ts: now, user, profile, price, by: ctx.user.username });
    audit(ctx, 'pos.sell', `${user} / ${profile} / ${price}`);
    const cur = currencyOf();
    Notify.event('sale', `POS sale: ${profile} ${money(price, cur)} by ${ctx.user.username}`);
    return {
      ok: true,
      user,
      pass,
      profile,
      price: money(price, cur),
      validity: meta?.validity ?? '',
      url: loginUrl(user, pass),
      hotspot: ctx.router.hotspot_name || String(getSettings().hotspot_name ?? ''),
      time: receiptTime(now),
      total: money(todaySales(ctx.router.id).reduce((a, x) => a + x.price, 0), cur),
    };
  },
};
