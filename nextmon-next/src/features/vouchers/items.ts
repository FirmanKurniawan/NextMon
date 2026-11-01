/** Voucher rows for the print view (data prep of VoucherController::printView). */
import { money } from '../../lib/fmt.ts';
import { mayPrint } from '../../lib/reseller.ts';
import { parseMeta } from '../../lib/scripts.ts';
import type { Meta } from '../../lib/scripts.ts';
import { getSettings } from '../../lib/store.ts';
import { batchOf, loginUrl } from '../../lib/voucher.ts';
import type { AppContext } from '../types.ts';

export type PrintItem = { user: string; pass: string; profile: string; price: string; validity: string; limit: string; comment: string; url: string };

/** Voucher rows for ?comment=<batch tag> or ?user=<name>; resellers only get their own batches (IDOR guard). */
export async function printItems(ctx: AppContext, tag: string, one: string): Promise<PrintItem[]> {
  const cur = String(getSettings().currency || 'Rp');
  const got = await ctx.driver().printMany({
    profiles: ['/ip/hotspot/user/profile', {}, ['name', 'on-login']],
    // single-voucher print: let the router filter by name instead of shipping the whole user list
    users: ['/ip/hotspot/user', one !== '' ? { name: one } : {}, ['name', 'password', 'profile', 'comment', 'limit-uptime', 'limit-bytes-total']],
  });
  const metas: Record<string, Meta | null> = {};
  for (const p of got.profiles ?? []) metas[p.name ?? ''] = parseMeta(p['on-login'] ?? '');
  const items: PrintItem[] = [];
  for (const u of got.users ?? []) {
    const batch = batchOf(u.comment ?? '');
    if (one !== '' ? u.name !== one : tag === '' || batch !== tag) continue;
    if (!mayPrint(ctx.user, batch)) continue;
    const m = metas[u.profile ?? ''] ?? null;
    items.push({
      user: u.name ?? '',
      pass: u.password ?? '',
      profile: u.profile ?? '',
      price: m && m.sprice !== '' ? money(m.sprice, cur) : '',
      validity: m?.validity ?? '',
      limit: u['limit-uptime'] ?? '',
      comment: batch,
      url: loginUrl(u.name ?? '', u.password ?? ''),
    });
  }
  return items;
}
