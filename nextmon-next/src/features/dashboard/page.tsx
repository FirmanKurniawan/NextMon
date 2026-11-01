import { Icon } from '../../components/Icon';
import { Audit } from '../../lib/audit.ts';
import { ago } from '../../lib/fmt.ts';
import { getSettings } from '../../lib/store.ts';
import type { PageProps } from '../types.ts';

/** Dashboard shell. Same element ids / data-bind hooks as the PHP view: pages.js fills them from /json/dashboard and the SSE traffic hub. */
export default function DashboardPage({ ctx }: PageProps) {
  const t = ctx.t;
  const live = Boolean(getSettings().live_report);
  const appLog = Audit.tail(8);
  const skel = (w?: string) => <div className="skeleton line" style={w ? { width: w } : undefined} />;
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('Dashboard')}</h1>
          <p className="page-desc">{t('Router health, hotspot activity and income at a glance.')}</p>
        </div>
        <div className="page-actions">
          <button className="btn" type="button" data-dash-refresh>
            <Icon name="refresh" size={16} />
            {t('Refresh')}
          </button>
        </div>
      </div>

      <div id="dash" data-poll={live ? '8000' : '20000'}>
        <div className="bento">
          <section className="card glass stat-card lift col-3">
            <div className="card-b">
              <div className="stat-label">
                <span className="stat-ic">
                  <Icon name="activity" size={14} />
                </span>
                {t('Active sessions')}
                <span className="delta up" data-live-badge>
                  <span className="live-dot" style={{ width: 6, height: 6 }} />
                  <span className="hide-m">{t('Live')}</span>
                </span>
              </div>
              <div className="stat-value">
                <span className="skeleton" data-bind="active">
                  0000
                </span>
              </div>
              <div className="stat-sub">
                <span data-bind="users">&nbsp;</span> {t('users total')}
              </div>
              <div className="stat-spark">
                <canvas id="sp-active" role="img" aria-label={t('Active sessions')} />
              </div>
            </div>
          </section>
          <section className="card glass stat-card lift col-3">
            <div className="card-b">
              <div className="stat-label">
                <span className="stat-ic">
                  <Icon name="chart" size={14} />
                </span>
                {t('Income today')}
                <span className="delta" id="delta-today" hidden />
              </div>
              <div className="stat-value">
                <span className="skeleton" data-bind="income_today" data-money="">
                  000000
                </span>
              </div>
              <div className="stat-sub">
                <span data-bind="count_today">&nbsp;</span> {t('vouchers sold')}
              </div>
              <div className="stat-spark">
                <canvas id="sp-today" role="img" aria-label={t('Income, last 14 days')} />
              </div>
            </div>
          </section>
          <section className="card glass stat-card lift col-3">
            <div className="card-b">
              <div className="stat-label">
                <span className="stat-ic">
                  <Icon name="chart" size={14} />
                </span>
                {t('Income this month')}
              </div>
              <div className="stat-value">
                <span className="skeleton" data-bind="income_month" data-money="">
                  0000000
                </span>
              </div>
              <div className="stat-sub">
                <span data-bind="count_month">&nbsp;</span> {t('vouchers sold')}
              </div>
              <div className="stat-spark">
                <canvas id="sp-count" role="img" aria-label={t('Vouchers sold')} />
              </div>
            </div>
          </section>
          <section className="card glass stat-card lift col-3">
            <div className="card-b">
              <div className="stat-label">
                <span className="stat-ic">
                  <Icon name="layers" size={14} />
                </span>
                {t('Last 14 days')}
              </div>
              <div className="stat-value">
                <span className="skeleton" id="spark-sum">
                  000000
                </span>
              </div>
              <div className="stat-sub" id="spark-note">
                &nbsp;
              </div>
              <div className="stat-spark">
                <canvas id="spark" role="img" aria-label={t('Income, last 14 days')} />
              </div>
            </div>
          </section>

          <section className="card glass col-8" id="card-traffic">
            <div className="card-h">
              <h2>{t('Live traffic')}</h2>
              <div className="row tr-head" style={{ gap: 'var(--s4)' }}>
                <span>
                  <span className="muted">RX</span>{' '}
                  <b id="rx-now" className="mono" style={{ color: 'var(--chart-1)' }}>
                    -
                  </b>
                </span>
                <span>
                  <span className="muted">TX</span>{' '}
                  <b id="tx-now" className="mono" style={{ color: 'var(--chart-3)' }}>
                    -
                  </b>
                </span>
                <label className="sr-only" htmlFor="if-sel">
                  {t('Interface')}
                </label>
                <select id="if-sel" className="select select-sm" style={{ width: 'auto' }} suppressHydrationWarning />
              </div>
            </div>
            <div className="card-b" style={{ paddingTop: 'var(--s2)' }}>
              <div className="chart-box lg">
                <div className="skeleton" data-skel="" style={{ position: 'absolute', inset: 0, borderRadius: 'var(--r2)' }} />
                <canvas id="traffic" role="img" aria-label={t('Live interface traffic')} />
              </div>
              <div className="legend">
                <span>
                  <i style={{ background: 'var(--chart-1)' }} />
                  RX
                </span>
                <span>
                  <i style={{ background: 'var(--chart-3)' }} />
                  TX
                </span>
              </div>
            </div>
          </section>

          <section className="card glass col-4" id="card-sys">
            <div className="card-h">
              <h2>{t('System resource')}</h2>
              <span className="badge badge-ok" id="dash-state" hidden />
            </div>
            <div className="card-b">
              <div className="gauges">
                {(['cpu', 'mem', 'disk'] as const).map((g) => (
                  <div className="gauge" key={g}>
                    <div data-g={g}>
                      <div className="skeleton circle" style={{ width: 84, height: 84, margin: 'auto' }} />
                    </div>
                    <div className="gauge-l">{g === 'cpu' ? 'CPU' : g === 'mem' ? 'RAM' : t('Disk')}</div>
                    <div className="gauge-s" id={g + '-v'}>
                      &nbsp;
                    </div>
                  </div>
                ))}
              </div>
              <dl className="kv" style={{ marginTop: 'var(--s4)' }}>
                <dt>{t('Identity')}</dt>
                <dd data-bind="identity">-</dd>
                <dt>{t('Board')}</dt>
                <dd data-bind="board">-</dd>
                <dt>RouterOS</dt>
                <dd data-bind="version">-</dd>
                <dt>Uptime</dt>
                <dd data-bind="uptime">-</dd>
              </dl>
            </div>
          </section>

          <section className="card glass col-4" id="card-donut">
            <div className="card-h">
              <h2>{t('Users by profile')}</h2>
            </div>
            <div className="card-b">
              <div className="chart-box" style={{ height: 168 }}>
                <div className="skeleton circle" data-skel="" style={{ position: 'absolute', left: '50%', top: '50%', width: 140, height: 140, margin: '-70px 0 0 -70px' }} />
                <canvas id="donut" role="img" aria-label={t('Users by profile')} />
              </div>
              <div className="legend-list" id="donut-legend" />
            </div>
          </section>
          <section className="card glass col-8" id="card-heat">
            <div className="card-h">
              <h2>{t('Sales heatmap')}</h2>
              <span className="muted" id="heat-peak" style={{ fontSize: 'var(--fs-12)' }}>
                {t('Busiest hours by weekday')}
              </span>
            </div>
            <div className="card-b">
              <div id="heat">
                <div className="skeleton block" data-skel="" style={{ height: 170 }} />
              </div>
              <div className="heat-scale">
                {t('Less')} <i data-l="0" />
                <i data-l="1" />
                <i data-l="2" />
                <i data-l="3" />
                <i data-l="4" /> {t('More')}
              </div>
              <div className="ins-row" id="heat-ins" hidden />
            </div>
          </section>

          {live ? (
            <section className="card glass col-4">
              <div className="card-h">
                <h2>{t('Live report')}</h2>
                <span className="badge badge-info">{t('Latest sales')}</span>
              </div>
              <div className="card-b" id="recent-sales">
                {skel()}
                {skel('80%')}
                {skel('90%')}
                {skel('70%')}
              </div>
            </section>
          ) : null}
          <section className={'card glass ' + (live ? 'col-4' : 'col-6')}>
            <div className="card-h">
              <h2>{t('Hotspot log')}</h2>
            </div>
            <div className="card-b" id="hs-log">
              {skel()}
              {skel('85%')}
              {skel('92%')}
              {skel('60%')}
            </div>
          </section>
          <section className={'card glass ' + (live ? 'col-4' : 'col-6')}>
            <div className="card-h">
              <h2>{t('App log')}</h2>
              <span className="muted">{ctx.workspace.name}</span>
            </div>
            <div className="card-b">
              {appLog.length === 0 ? (
                <p className="muted">{t('No activity yet.')}</p>
              ) : (
                <ul className="feed">
                  {appLog.map((a, i) => (
                    <li key={i}>
                      <span className="wrap">
                        <b>{a.user}</b> {a.action} <span className="muted">{a.detail.slice(0, 40)}</span>
                      </span>
                      <span className="muted nowrap">{ago(a.ts, t)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
