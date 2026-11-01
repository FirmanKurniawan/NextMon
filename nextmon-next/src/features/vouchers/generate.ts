/**
 * POST /vouchers/generate: VoucherController::generate + the reseller wrapper of ResellerController::voucherGenerate.
 * A reseller is charged from their wallet BEFORE the users are created; when creation fails the router users that this call
 * managed to create are removed again and the wallet charge is rolled back (so nobody pays for vouchers that do not exist).
 */
import type { Driver } from '../../lib/driver.ts';
import { Notify } from '../../lib/notify.ts';
import { QuotaError } from '../../lib/quota.ts';
import { basePrice, charge, isBlocked, recordBatch, rollback } from '../../lib/reseller.ts';
import type { Ticket } from '../../lib/reseller.ts';
import { parseMeta } from '../../lib/scripts.ts';
import { getSettings } from '../../lib/store.ts';
import { batchOf, generate } from '../../lib/voucher.ts';
import type { GenOptions } from '../../lib/voucher.ts';
import { audit } from '../_kit/audit.ts';
import { str, UserError } from '../_kit/forms.ts';
import { checkTimeLimit } from '../_kit/hotspot.ts';
import type { AppContext } from '../types.ts';

const BACK = '/vouchers';

/** Create the users; on failure delete the ones this call created (new ids carrying a voucher batch tag) and rethrow. */
export async function generateTracked(r: Driver, o: GenOptions): Promise<{ comment: string; items: [string, string][] }> {
  const before = new Set((await r.print('/ip/hotspot/user', {}, ['name'])).map((u) => u['.id'] ?? ''));
  try {
    return await generate(r, o);
  } catch (e) {
    try {
      const stray = (await r.print('/ip/hotspot/user', {}, ['name', 'profile', 'comment'])).filter((u) => !before.has(u['.id'] ?? '') && u.profile === o.profile && batchOf(u.comment ?? '') !== '').map((u) => u['.id'] ?? '');
      await r.removeMany('/ip/hotspot/user', stray);
    } catch {
      /* the original error is the one worth reporting */
    }
    throw e;
  }
}

export async function generateBatch(ctx: AppContext, fd: FormData): Promise<{ to: string; msg: string }> {
  const t = ctx.t;
  const r = ctx.driver();
  const profile = str(fd, 'profile');
  if (profile === '') throw new UserError(t('Choose a profile.'), BACK);
  const limit = str(fd, 'limit_uptime').toLowerCase();
  const err = await checkTimeLimit(r, profile, limit, t);
  if (err) throw new UserError(err, BACK);
  const batch = str(fd, 'batch');
  const maxQty = Number(getSettings().max_qty) || 500;
  const qty = Math.max(1, Math.min(maxQty, Number.parseInt(str(fd, 'qty', '10'), 10) || 0));

  let ticket: Ticket | null = null;
  if (ctx.user.role === 'reseller') {
    const prof = (await r.print('/ip/hotspot/user/profile', { name: profile }, ['name', 'on-login']))[0];
    if (!prof) throw new UserError(t('Profile not found.'), BACK);
    const tk = charge(ctx.user, profile, basePrice(parseMeta(prof['on-login'] ?? '')), qty, { via: 'voucher', batch: batch.slice(0, 24) });
    if (isBlocked(tk)) {
      audit('reseller.blocked', `${profile} x${qty}: ${tk.error}`);
      throw new UserError(tk.error, BACK);
    }
    ticket = tk;
  }

  let res: { comment: string; items: [string, string][] };
  try {
    res = await generateTracked(r, {
      profile,
      qty,
      prefix: str(fd, 'prefix'),
      length: Number.parseInt(str(fd, 'length', '6'), 10) || 0,
      charset: str(fd, 'charset', 'lowernum'),
      mode: str(fd, 'mode', 'vc'),
      batch,
      limit_uptime: limit,
      limit_bytes: str(fd, 'limit_bytes'),
      server: str(fd, 'server', 'all'),
    });
  } catch (e) {
    if (ticket) rollback(ticket, 'voucher error');
    if (e instanceof QuotaError) throw new UserError(t(e.key, e.params), BACK); // daily voucher limit: nothing created, wallet refunded
    throw e;
  }
  const n = res.items.length;
  recordBatch(ctx.user, res.comment);
  audit('vouchers.generate', `${n} x ${profile} [${res.comment}]`);
  Notify.event('voucher', `Voucher batch generated: ${n} x ${profile} (${res.comment})`);
  let to = '/vouchers/print?comment=' + encodeURIComponent(res.comment);
  if (str(fd, 'tpl') !== '') to += '&tpl=' + encodeURIComponent(str(fd, 'tpl'));
  else if (/^[a-z0-9_-]{1,24}$/i.test(str(fd, 'design'))) to += '&design=' + encodeURIComponent(str(fd, 'design'));
  return { to, msg: t(':n vouchers created.', { ':n': n }) };
}
