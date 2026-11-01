import { Icon } from '../../components/Icon';
import { money } from '../../lib/fmt.ts';
import { zonedParts } from '../../lib/sales.ts';
import { getSettings } from '../../lib/store.ts';
import ActionForm from '../_sales/ActionForm';
import Flash from '../_sales/Flash.tsx';
import { Badge, PageHead } from '../_sales/ui';
import { Payments } from '../shop/gateways.ts';
import type { PageProps } from '../types.ts';
import { orderAction } from './actions.ts';
import { Orders } from './orders.ts';

const KINDS: Record<string, string> = { pending: 'warn', paid: 'ok', expired: 'neutral', failed: 'err', refunded: 'info' };
const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const p2 = (n: number) => String(n).padStart(2, '0');

/** One order: details, customer, voucher, actions, notes, event log (twin of views/orders_view.php). */
export default async function OrderViewPage({ ctx, searchParams }: PageProps) {
  const t = ctx.t;
  const raw = searchParams.id;
  const id = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');
  const o = Orders.get(id);
  if (!o) {
    return (
      <>
        <Flash ctx={ctx} value={searchParams.flash} />
        <PageHead title={t('Online orders')} desc={t('Order not found.')}>
          <a className="btn" href="/orders">
            &lsaquo; {t('Online orders')}
          </a>
        </PageHead>
      </>
    );
  }
  const tz = String(getSettings().timezone || 'UTC');
  const m = (n: number) => money(n, String(getSettings().currency || 'Rp'));
  const at = (ts: number, short = false) => {
    const p = zonedParts(ts, tz);
    return short ? `${p2(p.mo)}-${p2(p.d)} ${p2(p.h)}:${p2(p.mi)}` : `${p.y}-${p2(p.mo)}-${p2(p.d)} ${p2(p.h)}:${p2(p.mi)}:${p2(p.s)}`;
  };
  const gateway = Payments.get(o.gateway);
  const hid = (
    <>
      <input type="hidden" name="_csrf" value={ctx.csrf} />
      <input type="hidden" name="id" value={o.id} />
    </>
  );
  const act = (doAct: string, label: string, cls = '', confirm?: string) => (
    <ActionForm action={orderAction} className="row" confirm={confirm}>
      {hid}
      <input type="hidden" name="do" value={doAct} />
      <button className={`btn ${cls}`}>{label}</button>
    </ActionForm>
  );
  const showMarkPaid = ['pending', 'expired', 'failed'].includes(o.status) || !!o.flag;
  return (
    <>
      <Flash ctx={ctx} value={searchParams.flash} />
      <PageHead title={o.id} desc={t('Order details')}>
        <a className="btn" href="/orders">
          &lsaquo; {t('Online orders')}
        </a>
      </PageHead>

      {o.flag ? (
        <div className="alert err" style={{ marginBottom: 'var(--s4)' }}>
          <Icon name="alert" size={18} />
          <div>{t('The gateway reported a different amount than the order. The voucher was NOT created. Check the payment, then mark it paid manually if it is correct.')}</div>
        </div>
      ) : null}
      {o.status === 'paid' && !o.voucher ? (
        <div className="alert warn" style={{ marginBottom: 'var(--s4)' }}>
          <Icon name="alert" size={18} />
          <div>
            {t('Paid, but the voucher could not be created on the router:')} <span className="mono">{o.fulfil_err ?? ''}</span>
          </div>
        </div>
      ) : null}

      <div className="grid">
        <section className="card glass col-6">
          <div className="card-h">
            <h2>{t('Order')}</h2>
            <Badge kind={KINDS[o.status] ?? 'neutral'}>{t(cap1(o.status))}</Badge>
          </div>
          <div className="card-b">
            <dl className="kv">
              <dt>{t('Package')}</dt>
              <dd>
                {o.package.label} <span className="muted mono">({o.package.profile})</span>
              </dd>
              <dt>{t('Amount')}</dt>
              <dd>
                <b>{m(o.amount)}</b>
              </dd>
              <dt>{t('Created')}</dt>
              <dd className="mono">{at(o.created)}</dd>
              <dt>{t('Expires')}</dt>
              <dd className="mono">{at(o.expires)}</dd>
              <dt>{t('Paid')}</dt>
              <dd className="mono">{o.paid_at ? `${at(o.paid_at)} · ${o.paid_by ?? ''}` : '-'}</dd>
              <dt>{t('Gateway')}</dt>
              <dd>{gateway ? t(gateway.label) : o.gateway}</dd>
              <dt>{t('Gateway reference')}</dt>
              <dd className="mono">{o.ref || '-'}</dd>
              <dt>IP</dt>
              <dd className="mono">{o.ip}</dd>
            </dl>
          </div>
        </section>
        <section className="card glass col-6">
          <div className="card-h">
            <h2>{t('Customer')}</h2>
          </div>
          <div className="card-b">
            <dl className="kv">
              <dt>{t('Name')}</dt>
              <dd>{o.customer.name ?? ''}</dd>
              <dt>{t('Phone')}</dt>
              <dd className="mono">{o.customer.phone || '-'}</dd>
              <dt>{t('Email')}</dt>
              <dd>{o.customer.email || '-'}</dd>
            </dl>
          </div>
          <div className="card-h">
            <h2>{t('Voucher')}</h2>
          </div>
          <div className="card-b">
            {o.voucher ? (
              <dl className="kv">
                <dt>{t('Code')}</dt>
                <dd className="mono">
                  {o.voucher.user}
                  {o.voucher.pass !== o.voucher.user ? ` / ${o.voucher.pass}` : ''}
                </dd>
                <dt>{t('Batch comment')}</dt>
                <dd className="mono">{o.voucher.comment}</dd>
              </dl>
            ) : (
              <p className="muted">{t('Not created.')}</p>
            )}
          </div>
        </section>

        <section className="card glass col-12">
          <div className="card-h">
            <h2>{t('Actions')}</h2>
          </div>
          <div className="card-b row" style={{ gap: 'var(--s3)', alignItems: 'flex-start' }}>
            {showMarkPaid ? act('markpaid', t('Mark as paid'), 'btn-primary', t('Confirm that the money for this order was received?')) : null}
            {o.status === 'paid' && !o.voucher ? act('retry', t('Retry voucher creation'), 'btn-primary') : null}
            {o.status === 'paid' && o.voucher ? act('resend', t('Resend voucher to notification channel')) : null}
            {o.status === 'paid' && ctx.can('admin') ? (
              <ActionForm action={orderAction} className="row" confirm={t('Mark this order as refunded?')}>
                {hid}
                <input type="hidden" name="do" value="refund" />
                <input className="input" name="note" placeholder={t('Refund note (required)')} style={{ width: 'min(280px,100%)' }} required minLength={3} />
                <label className="check">
                  <input type="checkbox" name="disable" value="1" defaultChecked />
                  {t('Disable voucher on router')}
                </label>
                <button className="btn btn-danger">{t('Refund')}</button>
              </ActionForm>
            ) : null}
          </div>
          <p className="help" style={{ padding: '0 var(--s4) var(--s4)' }}>
            {t('Marking a refund only records it. Return the money in your gateway or bank yourself.')}
          </p>
        </section>

        <section className="card glass col-6">
          <div className="card-h">
            <h2>{t('Notes')}</h2>
          </div>
          <div className="card-b stack">
            {[...o.notes].reverse().map((n, i) => (
              <div key={i}>
                <span className="muted mono">
                  {at(n.ts, true)} &middot; {n.by}
                </span>
                <div>{n.text}</div>
              </div>
            ))}
            {!o.notes.length ? <p className="muted">-</p> : null}
            <ActionForm action={orderAction} className="row">
              {hid}
              <input type="hidden" name="do" value="note" />
              <input className="input" name="note" placeholder={t('Add a note')} style={{ flex: 1, minWidth: 160 }} maxLength={500} />
              <button className="btn">{t('Add')}</button>
            </ActionForm>
          </div>
        </section>
        <section className="card glass col-6">
          <div className="card-h">
            <h2>{t('Event log')}</h2>
          </div>
          <div className="table-wrap" style={{ maxHeight: 320 }}>
            <table className="tbl compact">
              <tbody>
                {[...o.events].reverse().map((ev, i) => (
                  <tr key={i}>
                    <td className="mono nowrap">{at(ev.ts, true)}</td>
                    <td>
                      <Badge>{ev.type}</Badge>
                    </td>
                    <td className="wrap">{ev.detail}</td>
                  </tr>
                ))}
                {!o.events.length ? (
                  <tr>
                    <td className="muted">-</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
