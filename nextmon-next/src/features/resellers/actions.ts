'use server';
import { money } from '../../lib/fmt.ts';
import { Reseller } from '../../lib/reseller.ts';
import { Users } from '../../lib/users.ts';
import { audit, localPath, runAction } from '../../server/guard.ts';
import { currencyOf, profilePrices } from '../_sales/common.ts';
import { withFlash } from '../_sales/flash-helpers.ts';
import type { AppContext } from '../types.ts';

type To = { to: string };

/** A reseller user of the ACTIVE workspace (never another tenant's: Users are filtered by the session workspace). */
function resellerUser(ctx: AppContext, id: string) {
  const u = Users.inWorkspace(ctx.workspace.id).find((x) => x.id === id);
  return u && u.role === 'reseller' ? u : null;
}

/** POST /resellers/save: active, commission, markup, credit limit, allowed profiles (+ own markup per profile). admin. */
export async function saveReseller(fd: FormData): Promise<To> {
  return runAction({ cap: 'admin' }, fd, async (ctx) => {
    const err = (m: string) => ({ to: withFlash('/resellers', ctx.csrf, 'err', m) });
    const u = resellerUser(ctx, String(fd.get('id') ?? ''));
    if (!u) return err(ctx.t('User not found.'));
    const prices = ctx.router ? await profilePrices(ctx.driver()) : {};
    const profiles: Record<string, string> = {};
    for (const [k, v] of fd.entries()) {
      const m = /^prof\[(.+)\]$/.exec(k);
      if (!m || !Object.hasOwn(prices, m[1]!)) continue;
      const adj = fd.get(`padj[${m[1]}]`);
      profiles[m[1]!] = typeof adj === 'string' ? adj.trim() : '';
      void v;
    }
    Reseller.saveCfg(u.id, {
      active: fd.get('active') === '1',
      commission: fd.get('commission') ?? '0',
      adj: fd.get('adj') ?? '0',
      credit: fd.get('credit') ?? '0',
      allow_all: fd.get('allow_all') === '1',
      profiles,
    });
    audit(ctx, 'reseller.save', u.username);
    return { to: withFlash('/resellers', ctx.csrf, 'ok', ctx.t('Reseller saved.')) };
  });
}

/** POST /resellers/fund: top-up (positive) or signed adjustment (note required). admin. */
export async function fundReseller(fd: FormData): Promise<To> {
  return runAction({ cap: 'admin' }, fd, async (ctx) => {
    const err = (m: string) => ({ to: withFlash('/resellers', ctx.csrf, 'err', m) });
    const u = resellerUser(ctx, String(fd.get('id') ?? ''));
    if (!u) return err(ctx.t('User not found.'));
    const amount = Number.parseInt(String(fd.get('amount') ?? '').replace(/[^\d-]/g, ''), 10) || 0;
    const kind = fd.get('kind') === 'adjustment' ? 'adjustment' : 'topup';
    const note = String(fd.get('note') ?? '').slice(0, 200);
    if (amount === 0 || (kind === 'topup' && amount < 0)) return err(ctx.t('Enter a valid amount.'));
    if (kind === 'adjustment' && note === '') return err(ctx.t('A note is required for adjustments.'));
    const r = kind === 'topup' ? Reseller.topup(u.id, amount, note, ctx.user.username) : Reseller.adjust(u.id, amount, note, ctx.user.username);
    if (!r.ok) return err(r.error);
    audit(ctx, 'reseller.' + kind, `${u.username} ${amount}`);
    return { to: withFlash('/resellers', ctx.csrf, 'ok', ctx.t(':u balance is now :b.', { ':u': u.username, ':b': money(r.entries[r.entries.length - 1]!.bal, currencyOf()) })) };
  });
}

/** POST /resellers/refund: refund one ledger sale row (reverses the commission too). admin. */
export async function refundEntry(fd: FormData): Promise<To> {
  return runAction({ cap: 'admin' }, fd, async (ctx) => {
    const back = localPath(fd.get('back'), '/resellers/ledger');
    const entry = String(fd.get('entry') ?? '');
    const r = Reseller.refund(entry, ctx.user.username);
    audit(ctx, 'reseller.refund', entry + (r.ok ? '' : ' failed'));
    return { to: withFlash(back, ctx.csrf, r.ok ? 'ok' : 'err', r.ok ? ctx.t('Sale refunded.') : r.error) };
  });
}
