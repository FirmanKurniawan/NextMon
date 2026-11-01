import { Icon } from '../../components/Icon';
import { money } from '../../lib/fmt.ts';
import { Reseller } from '../../lib/reseller.ts';
import { Users } from '../../lib/users.ts';
import { currencyOf } from '../_sales/common.ts';
import ActionForm from '../_sales/ActionForm';
import Flash from '../_sales/Flash.tsx';
import { Badge, Empty, PageHead, Pager, paginate, qs } from '../_sales/ui';
import type { PageProps } from '../types.ts';
import { refundEntry } from './actions.ts';
import { Assets, ledgerFilters, num, signed, TypeBadge, ucfirst } from './ui.tsx';

/** /resellers/ledger: append-only record of every balance movement (filters, paging, refund of a sale row). */
export default async function LedgerPage({ ctx, searchParams }: PageProps) {
  const t = ctx.t;
  const cur = currencyOf();
  const f = ledgerFilters(searchParams);
  const users = Users.inWorkspace(ctx.workspace.id);
  const names = Object.fromEntries(users.map((u) => [u.id, u.username]));
  const resellers = users.filter((u) => u.role === 'reseller');
  const rows = Reseller.rows(f);
  let sumIn = 0;
  let sumOut = 0;
  const refunded = new Set<string>();
  for (const r of rows) {
    if (r.amount > 0) sumIn += r.amount;
    else sumOut += r.amount;
    if (r.type === 'refund' && r.ref) refunded.add(r.ref);
  }
  const { page, pg, pages } = paginate(rows, 50, searchParams.page);
  const q = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')) as Record<string, string>;
  const back = '/resellers/ledger' + qs(q);
  return (
    <>
      <Assets />
      <Flash ctx={ctx} value={searchParams.flash} />
      <PageHead title={t('Reseller ledger')} desc={t('Append-only record of every balance movement.')}>
        <a className="btn" href={'/json/resellers/ledger' + qs(q)}>
          <Icon name="download" size={16} />
          CSV
        </a>
        <a className="btn" href="/resellers">
          {t('Resellers')}
        </a>
      </PageHead>
      <section className="card glass">
        <form className="tbl-tools rs-filters" method="get" action="/resellers/ledger" role="search">
          <select className="select" name="uid" aria-label={t('Reseller')} data-autosubmit defaultValue={f.uid}>
            <option value="">{t('All resellers')}</option>
            {resellers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.username}
              </option>
            ))}
          </select>
          <select className="select" name="type" aria-label={t('Type')} data-autosubmit defaultValue={f.type}>
            <option value="">{t('All types')}</option>
            {Reseller.TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {t(ucfirst(ty))}
              </option>
            ))}
          </select>
          <input className="input" type="date" name="from" defaultValue={f.from} aria-label={t('From')} />
          <input className="input" type="date" name="to" defaultValue={f.to} aria-label={t('To')} />
          <input className="input search" type="search" name="q" defaultValue={f.q} placeholder={t('Search note or profile')} aria-label={t('Search')} />
          <button className="btn btn-sm">
            <Icon name="filter" size={16} />
            {t('Filter')}
          </button>
          <span className="spacer" />
          <span className="muted">
            {t('In')} <b className="rs-pos">{money(sumIn, cur)}</b> &middot; {t('Out')} <b className="rs-neg">{money(-sumOut, cur)}</b>
          </span>
        </form>
        {page.length === 0 ? (
          <div className="card-b">
            <Empty icon="list" title={t('No ledger entries')} text={t('Try other filters.')} />
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="tbl resp">
                <thead>
                  <tr>
                    <th>{t('Time')}</th>
                    <th>{t('Reseller')}</th>
                    <th>{t('Type')}</th>
                    <th>{t('Note')}</th>
                    <th className="num">{t('Amount')}</th>
                    <th className="num">{t('Balance')}</th>
                    <th>{t('By')}</th>
                    <th>
                      <span className="sr-only">{t('Actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {page.map((r) => (
                    <tr key={r.id}>
                      <td data-label={t('Time')} className="mono nowrap">
                        {Reseller.fmtTime(r.ts)}
                      </td>
                      <td data-label={t('Reseller')}>{names[r.uid] ?? '?'}</td>
                      <td data-label={t('Type')}>
                        <TypeBadge t={t} type={r.type} />
                      </td>
                      <td data-label={t('Note')} className="wrap">
                        {r.note}
                        {refunded.has(r.id) ? (
                          <>
                            {' '}
                            <Badge kind="warn">{t('Refunded')}</Badge>
                          </>
                        ) : null}
                      </td>
                      <td data-label={t('Amount')} className={'num mono ' + (r.amount < 0 ? 'rs-neg' : 'rs-pos')}>
                        {signed(r.amount)}
                      </td>
                      <td data-label={t('Balance')} className="num mono">
                        {num(r.bal)}
                      </td>
                      <td data-label={t('By')}>{r.by}</td>
                      <td className="actions" data-label="">
                        {r.type === 'sale' && !refunded.has(r.id) ? (
                          <ActionForm action={refundEntry} inline confirm={t('Refund this sale (and reverse its commission)?')}>
                            <input type="hidden" name="_csrf" value={ctx.csrf} />
                            <input type="hidden" name="entry" value={r.id} />
                            <input type="hidden" name="back" value={back} />
                            <button className="btn btn-sm">{t('Refund')}</button>
                          </ActionForm>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager t={t} path="/resellers/ledger" query={q} pg={pg} pages={pages} total={rows.length} />
          </>
        )}
      </section>
    </>
  );
}
