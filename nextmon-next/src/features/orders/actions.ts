'use server';
import { Notify } from '../../lib/notify.ts';
import { audit, runAction } from '../../server/guard.ts';
import { withFlash } from '../_sales/flash-helpers.ts';
import { Orders } from './orders.ts';

const str = (fd: FormData, k: string, max = 500): string => String(fd.get(k) ?? '').trim().slice(0, max);

/** POST of every button on the order detail page. cap write; refunds need admin. Returns the URL to load next (with a signed flash). */
export async function orderAction(fd: FormData): Promise<{ to: string }> {
  return runAction({ cap: 'write' }, fd, async (ctx) => {
    const id = str(fd, 'id', 40);
    const o = Orders.get(id);
    if (!o) return { to: withFlash('/orders', ctx.csrf, 'err', ctx.t('Order not found.')) };
    const by = ctx.user.username;
    const to = '/orders/view?id=' + encodeURIComponent(id);
    const go = (kind: 'ok' | 'err', msg: string) => ({ to: withFlash(to, ctx.csrf, kind, msg) });
    switch (str(fd, 'do', 20)) {
      case 'markpaid': {
        if (o.status === 'refunded') return go('err', ctx.t('A refunded order cannot be marked paid.'));
        const [ok, msg] = await Orders.markPaid(id, 'admin:' + by, null);
        await Orders.update(id, (x) => Orders.note(x, by, 'Marked paid manually'));
        audit(ctx, 'shop.markpaid', id);
        return go(ok ? 'ok' : 'err', ok ? ctx.t('Order marked as paid.') : ctx.t('Could not mark as paid: :m', { ':m': msg }));
      }
      case 'retry': {
        await Orders.markPaid(id, 'admin:' + by, null);
        const n = await Orders.retryFulfil(id);
        audit(ctx, 'shop.retry', id);
        return n?.voucher ? go('ok', ctx.t('Voucher created.')) : go('err', ctx.t('Router still unreachable: :m', { ':m': n?.fulfil_err ?? '' }));
      }
      case 'refund': {
        if (!ctx.can('admin')) return go('err', ctx.t('Your role cannot access this page.'));
        const note = str(fd, 'note');
        if (Array.from(note).length < 3) return go('err', ctx.t('Write a refund note (how/when the money was returned).'));
        const [ok, msg] = await Orders.refund(id, by, note, fd.get('disable') === '1');
        audit(ctx, 'shop.refund', `${id} ${note}`);
        return go(ok ? 'ok' : 'err', ok ? ctx.t('Order marked as refunded. Money is NOT returned automatically; do that in your gateway/bank.') : msg);
      }
      case 'resend': {
        if (o.status !== 'paid' || !o.voucher) return go('err', ctx.t('Only paid orders with a voucher can be resent.'));
        const v = o.voucher;
        const text = `Voucher ${o.id}\n${ctx.t('Customer')}: ${o.customer.name ?? ''} ${o.customer.phone ?? ''}\n${o.package.label}\n${ctx.t('Code')}: ${v.user}${v.pass !== v.user ? ' / ' + v.pass : ''}\n${v.url}`;
        const r = await Notify.send(text, 'voucher');
        await Orders.update(id, (x) => Orders.note(x, by, 'Voucher resent to notification channel: ' + (r.ok ? 'ok' : 'failed')));
        audit(ctx, 'shop.resend', id);
        return go(r.ok ? 'ok' : 'err', r.ok ? ctx.t('Voucher sent to your notification channel.') : ctx.t('Not sent: :m', { ':m': r.msg }));
      }
      case 'note': {
        const text = str(fd, 'note');
        if (text !== '') await Orders.update(id, (x) => Orders.note(x, by, text));
        return go('ok', ctx.t('Note added.'));
      }
      default:
        return go('err', ctx.t('Unknown action.'));
    }
  });
}
