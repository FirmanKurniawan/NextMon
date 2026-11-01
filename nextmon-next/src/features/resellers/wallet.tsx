import { Icon } from '../../components/Icon';
import { money } from '../../lib/fmt.ts';
import { Reseller } from '../../lib/reseller.ts';
import { currencyOf, profilePrices } from '../_sales/common.ts';
import { Empty, PageHead, Pager, paginate, qs } from '../_sales/ui';
import type { PageProps } from '../types.ts';
import { Assets, ledgerFilters, num, signed, TypeBadge, ucfirst } from './ui.tsx';

/** /me/wallet: the reseller's own balance, price list and transactions. The uid filter is forced from the session. */
export default async function WalletPage({ ctx, searchParams }: PageProps) {
  const t = ctx.t;
  const cur = currencyOf();
  const head = <PageHead title={t('My wallet')} desc={t('Your balance, prices and sales as a reseller.')} />;
  if (!Reseller.isReseller(ctx.user)) {
    return (
      <>
        <Assets />
        {head}
        <div className="card glass">
          <div className="card-b">
            <Empty icon="user" title={t('This page is for reseller accounts')} text={t('Your role does not use a wallet.')} />
          </div>
        </div>
      </>
    );
  }
  const me = ctx.user.id;
  const f = ledgerFilters(searchParams, me);
  const rows = Reseller.rows(f);
  const { page, pg, pages } = paginate(rows, 30, searchParams.page);
  const cfg = Reseller.cfg(me);
  const bal = Reseller.balance(me);
  const sum = Reseller.summary(me);
  const plist: { name: string; base: number; cost: number; comm: number }[] = [];
  if (cfg && ctx.router) {
    for (const [name, base] of Object.entries(await profilePrices(ctx.driver()))) {
      if (Reseller.allowed(cfg, name)) plist.push({ name, base, cost: Reseller.unitCost(cfg, name, base), comm: Reseller.commissionFor(cfg, base, 1) });
    }
  }
  const q = Object.fromEntries(Object.entries({ type: f.type, from: f.from, to: f.to, q: f.q }).filter(([, v]) => v)) as Record<string, string>;
  return (
    <>
      <Assets />
      {head}
      {!cfg ? (
        <div className="alert warn" style={{ marginBottom: 'var(--s4)' }}>
          <Icon name="alert" size={18} />
          <div>{t('Your reseller account is not set up yet. Ask the administrator to configure it and add balance.')}</div>
        </div>
      ) : !cfg.active ? (
        <div className="alert err" style={{ marginBottom: 'var(--s4)' }}>
          <Icon name="alert" size={18} />
          <div>{t('Your reseller account is disabled.')}</div>
        </div>
      ) : null}

      <div className="grid" style={{ marginBottom: 'var(--s4)' }}>
        <section className="card glass col-3">
          <div className="card-b">
            <div className="stat-label">{t('My balance')}</div>
            <div className={'stat-value rs-balance' + (bal < 0 ? ' rs-neg' : '')}>{money(bal, cur)}</div>
            {cfg && cfg.credit > 0 ? <div className="stat-sub">{t('Credit limit :c', { ':c': money(cfg.credit, cur) })}</div> : null}
          </div>
        </section>
        <section className="card glass col-3">
          <div className="card-b">
            <div className="stat-label">{t('Sold today')}</div>
            <div className="stat-value">{sum.today_n}</div>
            <div className="stat-sub">{money(sum.today_amt, cur)}</div>
          </div>
        </section>
        <section className="card glass col-3">
          <div className="card-b">
            <div className="stat-label">{t('Sold this month')}</div>
            <div className="stat-value">{sum.month_n}</div>
            <div className="stat-sub">{money(sum.month_amt, cur)}</div>
          </div>
        </section>
        <section className="card glass col-3">
          <div className="card-b">
            <div className="stat-label">{t('Commission this month')}</div>
            <div className="stat-value rs-pos">{money(sum.comm_month, cur)}</div>
            <div className="stat-sub">{t('Total :c', { ':c': money(sum.comm_total, cur) })}</div>
          </div>
        </section>
      </div>

      {plist.length > 0 ? (
        <section className="card glass" style={{ marginBottom: 'var(--s4)' }}>
          <div className="card-h">
            <h2>{t('My price list')}</h2>
            <a className="btn btn-sm btn-primary" href="/pos">
              <Icon name="cart" size={16} />
              {t('Quick sell (POS)')}
            </a>
          </div>
          <div className="table-wrap">
            <table className="tbl resp">
              <thead>
                <tr>
                  <th>{t('Profile')}</th>
                  <th className="num">{t('Customer price')}</th>
                  <th className="num">{t('I pay')}</th>
                  <th className="num">{t('Commission')}</th>
                  <th className="num">{t('Net margin')}</th>
                </tr>
              </thead>
              <tbody>
                {plist.map((p) => (
                  <tr key={p.name}>
                    <td data-label={t('Profile')}>
                      <b>{p.name}</b>
                    </td>
                    <td data-label={t('Customer price')} className="num mono">
                      {money(p.base, cur)}
                    </td>
                    <td data-label={t('I pay')} className="num mono">
                      {money(p.cost, cur)}
                    </td>
                    <td data-label={t('Commission')} className="num mono">
                      {money(p.comm, cur)}
                    </td>
                    <td data-label={t('Net margin')} className="num mono rs-pos">
                      {money(p.base - p.cost + p.comm, cur)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="card glass">
        <div className="card-h">
          <h2>{t('My transactions')}</h2>
          <a className="btn btn-sm" href={'/json/resellers/wallet' + qs(q)}>
            <Icon name="download" size={16} />
            CSV
          </a>
        </div>
        <form className="tbl-tools rs-filters" method="get" action="/me/wallet" role="search">
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
          <button className="btn btn-sm">
            <Icon name="filter" size={16} />
            {t('Filter')}
          </button>
        </form>
        {page.length === 0 ? (
          <div className="card-b">
            <Empty icon="list" title={t('No transactions yet')} />
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="tbl resp">
                <thead>
                  <tr>
                    <th>{t('Time')}</th>
                    <th>{t('Type')}</th>
                    <th>{t('Note')}</th>
                    <th className="num">{t('Amount')}</th>
                    <th className="num">{t('Balance')}</th>
                  </tr>
                </thead>
                <tbody>
                  {page.map((r) => (
                    <tr key={r.id}>
                      <td data-label={t('Time')} className="mono nowrap">
                        {Reseller.fmtTime(r.ts)}
                      </td>
                      <td data-label={t('Type')}>
                        <TypeBadge t={t} type={r.type} />
                      </td>
                      <td data-label={t('Note')} className="wrap">
                        {r.note}
                      </td>
                      <td data-label={t('Amount')} className={'num mono ' + (r.amount < 0 ? 'rs-neg' : 'rs-pos')}>
                        {signed(r.amount)}
                      </td>
                      <td data-label={t('Balance')} className="num mono">
                        {num(r.bal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager t={t} path="/me/wallet" query={q} pg={pg} pages={pages} total={rows.length} />
          </>
        )}
      </section>
    </>
  );
}
