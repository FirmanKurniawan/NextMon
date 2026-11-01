import { Icon } from '../../components/Icon';
import { money } from '../../lib/fmt.ts';
import { zonedParts } from '../../lib/sales.ts';
import { getSettings } from '../../lib/store.ts';
import Flash from '../_sales/Flash.tsx';
import { Badge, Empty, PageHead, Pager, paginate, qs } from '../_sales/ui';
import { Payments } from '../shop/gateways.ts';
import type { PageProps } from '../types.ts';
import { filtered, filterOf, summarize } from './filter.ts';
import { Orders } from './orders.ts';

export const KINDS: Record<string, string> = { pending: 'warn', paid: 'ok', expired: 'neutral', failed: 'err', refunded: 'info' };
const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Online orders list (twin of views/orders.php). */
export default async function OrdersPage({ ctx, searchParams }: PageProps) {
  const t = ctx.t;
  const f = filterOf(searchParams);
  const rows = await filtered(f);
  const sum = summarize(rows);
  const { page, pg, pages } = paginate(rows, 50, searchParams.page);
  const cur = String(getSettings().currency || 'Rp');
  const tz = String(getSettings().timezone || 'UTC');
  const m = (n: number) => money(n, cur);
  const active = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ''));
  const when = (ts: number) => {
    const p = zonedParts(ts, tz);
    const p2 = (n: number) => String(n).padStart(2, '0');
    return `${p2(p.mo)}-${p2(p.d)} ${p2(p.h)}:${p2(p.mi)}`;
  };
  return (
    <>
      <Flash ctx={ctx} value={searchParams.flash} />
      <PageHead title={t('Online orders')} desc={t('Orders from the public shop. A voucher is created on the router once, when payment is verified.')}>
        <a className="btn" href={'/json/orders/export' + qs(active)}>
          <Icon name="download" size={16} />
          CSV
        </a>
        {ctx.can('admin') ? (
          <a className="btn" href="/shop/settings">
            <Icon name="settings" size={16} />
            {t('Shop settings')}
          </a>
        ) : null}
        <a className="btn" href={'/shop' + shopQuery(ctx.workspace.slug)} target="_blank" rel="noopener">
          <Icon name="globe" size={16} />
          {t('Open shop')}
        </a>
      </PageHead>

      <div className="grid" style={{ marginBottom: 'var(--s4)' }}>
        <section className="card glass col-3">
          <div className="card-b">
            <div className="stat-label">{t('Orders')}</div>
            <div className="stat-value">{sum.count}</div>
          </div>
        </section>
        <section className="card glass col-3">
          <div className="card-b">
            <div className="stat-label">{t('Paid')}</div>
            <div className="stat-value">{sum.paid}</div>
          </div>
        </section>
        <section className="card glass col-3">
          <div className="card-b">
            <div className="stat-label">{t('Revenue (paid)')}</div>
            <div className="stat-value">{m(sum.revenue)}</div>
          </div>
        </section>
        <section className="card glass col-3">
          <div className="card-b">
            <div className="stat-label">{t('Waiting / need attention')}</div>
            <div className="stat-value">
              {sum.pending} / {sum.attention}
            </div>
          </div>
        </section>
      </div>

      <section className="card glass">
        <form className="tbl-tools" method="get" action="/orders">
          <input className="input search" type="search" name="q" defaultValue={f.q} placeholder={t('Order, name, phone, voucher')} aria-label={t('Search')} />
          <select className="select" name="status" defaultValue={f.status} aria-label={t('Status')}>
            <option value="">{t('All statuses')}</option>
            {Orders.STATES.map((s) => (
              <option key={s} value={s}>
                {t(cap1(s))}
              </option>
            ))}
          </select>
          <select className="select" name="gateway" defaultValue={f.gateway} aria-label={t('Gateway')}>
            <option value="">{t('All gateways')}</option>
            {Payments.all().map((g) => (
              <option key={g.id} value={g.id}>
                {t(g.label)}
              </option>
            ))}
          </select>
          <input className="input" type="date" name="from" defaultValue={f.from} aria-label={t('From')} />
          <input className="input" type="date" name="to" defaultValue={f.to} aria-label={t('To')} />
          <button className="btn btn-sm btn-primary">{t('Apply')}</button>
          {Object.keys(active).length ? (
            <a className="btn btn-sm btn-ghost" href="/orders">
              {t('Reset')}
            </a>
          ) : null}
        </form>
        {!page.length ? (
          <Empty icon="list" title={t('No orders')} text={t('Orders appear here when customers buy from the shop.')} />
        ) : (
          <>
            <div className="table-wrap">
              <table className="tbl resp">
                <thead>
                  <tr>
                    <th>{t('Order')}</th>
                    <th>{t('Time')}</th>
                    <th>{t('Customer')}</th>
                    <th>{t('Package')}</th>
                    <th className="num">{t('Amount')}</th>
                    <th>{t('Gateway')}</th>
                    <th>{t('Status')}</th>
                    <th>{t('Voucher')}</th>
                  </tr>
                </thead>
                <tbody>
                  {page.map((o) => (
                    <tr key={o.id}>
                      <td data-label={t('Order')}>
                        <a className="mono" href={'/orders/view?id=' + encodeURIComponent(o.id)}>
                          {o.id}
                        </a>
                      </td>
                      <td data-label={t('Time')} className="mono nowrap">
                        {when(o.created)}
                      </td>
                      <td data-label={t('Customer')}>
                        {o.customer.name ?? ''}
                        <div className="muted mono">{o.customer.phone ?? ''}</div>
                      </td>
                      <td data-label={t('Package')}>{o.package.label}</td>
                      <td data-label={t('Amount')} className="num nowrap">
                        {m(o.amount)}
                      </td>
                      <td data-label={t('Gateway')}>{o.gateway}</td>
                      <td data-label={t('Status')}>
                        <Badge kind={KINDS[o.status] ?? 'neutral'}>{t(cap1(o.status))}</Badge>
                        {o.flag ? (
                          <>
                            {' '}
                            <Badge kind="err">{t('Amount mismatch')}</Badge>
                          </>
                        ) : null}
                      </td>
                      <td data-label={t('Voucher')} className="mono">
                        {o.voucher ? o.voucher.user : o.status === 'paid' ? <Badge kind="warn">{t('Pending')}</Badge> : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager t={t} path="/orders" query={active} pg={pg} pages={pages} total={rows.length} />
          </>
        )}
      </section>
    </>
  );
}

/** `?w=slug` for the public shop link (the workspace slug `main` keeps the bare link). */
function shopQuery(slug: string): string {
  return slug === '' || slug === 'main' ? '' : '?w=' + encodeURIComponent(slug);
}
