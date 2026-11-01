import { Icon } from '../../components/Icon';
import { money } from '../../lib/fmt.ts';
import { currencyOf, isRo } from '../_sales/common.ts';
import ActionForm from '../_sales/ActionForm';
import Flash from '../_sales/Flash.tsx';
import { Empty, NoRouter, PageHead, Pager, paginate, qs } from '../_sales/ui';
import type { PageProps } from '../types.ts';
import { deleteMonth } from './actions.ts';
import { loadSales, ownerOf, reportFilters, summarize } from './data.ts';

/** Sales report: filters, totals, bar/doughnut charts (pages.js P.reports reads #report-data) and the paged table. */
export default async function ReportsPage({ ctx, searchParams }: PageProps) {
  const t = ctx.t;
  const f = reportFilters(searchParams);
  const q = { period: f.period, value: f.value, profile: f.profile };
  const exportHref = (format: string) => '/json/reports/export' + qs({ ...q, format });
  const head = (
    <PageHead title={t('Sales report')} desc={t('Read from the router (/system script) in Mikhmon-compatible format.')}>
      {ctx.router ? (
        <>
          <a className="btn" href={exportHref('csv')}>
            <Icon name="download" size={16} />
            CSV
          </a>
          <a className="btn" href={exportHref('xls')}>
            <Icon name="download" size={16} />
            XLS
          </a>
        </>
      ) : null}
    </PageHead>
  );
  if (!ctx.router) {
    return (
      <>
        {head}
        <NoRouter t={t} />
      </>
    );
  }
  const cur = currencyOf();
  const s = summarize(await loadSales(ctx), f);
  const { page, pg, pages } = paginate(s.rows, 100, searchParams.page);
  const owner = ownerOf(f);
  const canDelete = owner !== '' && ctx.can('admin');
  const ro = isRo(ctx);
  const inputType = { day: 'date', month: 'month', year: 'number', all: 'hidden' }[f.period] as 'date' | 'month' | 'number' | 'hidden';
  const periods: [string, string][] = [
    ['day', 'Day'],
    ['month', 'Month'],
    ['year', 'Year'],
    ['all', 'All time'],
  ];
  const back = '/reports' + qs(q);
  return (
    <>
      <Flash ctx={ctx} value={searchParams.flash} />
      {head}
      <section className="card glass" style={{ marginBottom: 'var(--s4)' }}>
        <form className="tbl-tools" method="get" action="/reports">
          <select className="select" name="period" id="rp-period" aria-label={t('Period')} data-period defaultValue={f.period}>
            {periods.map(([k, l]) => (
              <option key={k} value={k}>
                {t(l)}
              </option>
            ))}
          </select>
          <input className="input" id="rp-value" name="value" type={inputType} defaultValue={f.value} aria-label={t('Date')} {...(f.period === 'year' ? { min: 2000, max: 2100 } : {})} />
          <select className="select" name="profile" aria-label={t('Profile')} defaultValue={f.profile}>
            <option value="">{t('All profiles')}</option>
            {s.profiles.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <button className="btn btn-sm btn-primary">{t('Apply')}</button>
          <span className="spacer" />
          {canDelete ? (
            <button className="btn btn-sm btn-danger" form="rp-del" type="submit" disabled={ro} title={ro ? t('This router is shared with you as read-only.') : undefined}>
              <Icon name="trash" size={16} />
              {t('Delete this month')}
            </button>
          ) : null}
        </form>
        {canDelete ? (
          <ActionForm action={deleteMonth} id="rp-del" confirm={t('Delete all sales records of this month from the router?')}>
            <input type="hidden" name="_csrf" value={ctx.csrf} />
            <input type="hidden" name="owner" value={owner} />
            <input type="hidden" name="back" value={back} />
          </ActionForm>
        ) : null}
      </section>

      <div className="grid">
        <section className="card glass col-4">
          <div className="card-b">
            <div className="stat-label">{t('Total income')}</div>
            <div className="stat-value" data-count={Math.trunc(s.total)} data-money="">
              {money(s.total, cur)}
            </div>
          </div>
        </section>
        <section className="card glass col-4">
          <div className="card-b">
            <div className="stat-label">{t('Vouchers sold')}</div>
            <div className="stat-value" data-count={s.count}>
              {s.count}
            </div>
          </div>
        </section>
        <section className="card glass col-4">
          <div className="card-b">
            <div className="stat-label">{t('Average per sale')}</div>
            <div className="stat-value" data-count={Math.trunc(s.avg)} data-money="">
              {money(s.avg, cur)}
            </div>
          </div>
        </section>

        <section className="card glass col-8">
          <div className="card-h">
            <h2>{t('Income per day')}</h2>
          </div>
          <div className="card-b">
            <div className="chart-box">
              <canvas id="rp-bars" role="img" aria-label={t('Income per day')} />
            </div>
          </div>
        </section>
        <section className="card glass col-4">
          <div className="card-h">
            <h2>{t('By profile')}</h2>
          </div>
          <div className="card-b">
            <div className="chart-box">
              <canvas id="rp-pie" role="img" aria-label={t('Income by profile')} />
            </div>
            <div className="legend" id="rp-legend" />
          </div>
        </section>
        <script type="application/json" id="report-data" dangerouslySetInnerHTML={{ __html: JSON.stringify({ ...s.chart, currency: cur }).replace(/</g, '\\u003c').replace(/&/g, '\\u0026') }} />

        <section className="card glass col-12">
          <div className="tbl-tools">
            <input className="input search" type="search" placeholder={t('Filter this list')} data-filter="#sales-tbl" aria-label={t('Filter')} />
          </div>
          {page.length === 0 ? (
            <Empty icon="chart" title={t('No sales in this period')} text={t('Sales appear after users log in with a profile whose expired mode ends with "c" (remc / ntfc).')} />
          ) : (
            <>
              <div className="table-wrap">
                <table className="tbl resp" id="sales-tbl">
                  <thead>
                    <tr>
                      <th data-sort="">{t('Date')}</th>
                      <th>{t('Time')}</th>
                      <th data-sort="">{t('User')}</th>
                      <th data-sort="">{t('Profile')}</th>
                      <th className="num">{t('Price')}</th>
                      <th>IP</th>
                      <th>MAC</th>
                      <th>{t('Validity')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.map((r, i) => (
                      <tr key={r.id || i}>
                        <td data-label={t('Date')} className="mono">
                          {r.date}
                        </td>
                        <td data-label={t('Time')} className="mono">
                          {r.time}
                        </td>
                        <td data-label={t('User')} className="mono">
                          <b>{r.user}</b>
                        </td>
                        <td data-label={t('Profile')}>{r.profile}</td>
                        <td data-label={t('Price')} className="num">
                          {money(r.price, cur)}
                        </td>
                        <td data-label="IP" className="mono">
                          {r.ip}
                        </td>
                        <td data-label="MAC" className="mono">
                          {r.mac}
                        </td>
                        <td data-label={t('Validity')} className="mono">
                          {r.validity}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager t={t} path="/reports" query={q} pg={pg} pages={pages} total={s.count} />
            </>
          )}
        </section>
      </div>
    </>
  );
}
