'use server';
import { Cache } from '../../lib/cache.ts';
import { audit, localPath, runAction } from '../../server/guard.ts';
import { isRo, salesKey } from '../_sales/common.ts';
import { withFlash } from '../_sales/flash-helpers.ts';

/** Delete one month of Mikhmon sales records (owner = "nov2026") from the router. admin only. Returns the URL to load next. */
export async function deleteMonth(fd: FormData): Promise<{ to: string }> {
  return runAction({ cap: 'admin' }, fd, async (ctx) => {
    const back = localPath(fd.get('back'), '/reports');
    const fail = (m: string) => ({ to: withFlash(back, ctx.csrf, 'err', m) });
    const owner = String(fd.get('owner') ?? '')
      .replace(/[^A-Za-z0-9]/g, '')
      .toLowerCase();
    if (!/^[a-z]{3}\d{4}$/.test(owner)) return fail(ctx.t('Invalid month.'));
    if (!ctx.router) return fail(ctx.t('No router configured'));
    if (isRo(ctx)) return fail(ctx.t('This router is shared with you as read-only.'));
    const r = ctx.driver();
    const rows = await r.print('/system/script', { comment: 'mikhmon', owner }, ['name']);
    await r.removeMany(
      '/system/script',
      rows.map((s) => s['.id'] ?? '').filter(Boolean),
    );
    Cache.bump(salesKey(ctx));
    audit(ctx, 'report.delete', `${owner} (${rows.length})`);
    return { to: withFlash('/reports', ctx.csrf, 'ok', ctx.t('Deleted :n sales records.', { ':n': rows.length })) };
  });
}
