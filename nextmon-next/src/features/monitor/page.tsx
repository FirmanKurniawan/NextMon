import { headers } from 'next/headers';
import { Icon } from '../../components/Icon';
import { Env } from '../../lib/env.ts';
import { ago, fmtBytes } from '../../lib/fmt.ts';
import { Net } from '../../lib/net.ts';
import { Routers } from '../../lib/routers.ts';
import { getSettings } from '../../lib/store.ts';
import { Badge, Empty, NetAssets, NoRouter, PageHead } from '../_netkit/ui';
import { sp } from '../_netkit/util.ts';
import { schedState } from '../scheduler/run.ts';
import type { PageProps } from '../types.ts';
import { Chart } from './Chart';
import { alertLog, backups, config, downsample, fmtDur, history, isDemo, ownRouters, state, token } from './logic.ts';

const RANGES: Record<string, number> = { '6h': 21600, '24h': 86400, '7d': 604800 };
const KIND: Record<string, 'ok' | 'err' | 'warn' | 'info'> = { err: 'err', warn: 'warn', ok: 'ok', info: 'info' };

function stamp(ts: number, tz: string, full: boolean): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date(ts * 1000)).map((x) => [x.type, x.value]));
  return full ? `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}` : `${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

export default async function MonitorPage({ ctx, searchParams }: PageProps) {
  const t = ctx.t;
  const tz = String(getSettings().timezone || 'UTC');
  const canAdmin = ctx.can('admin');
  const canW = ctx.can('write');
  const c = config();
  const R = c.rules;
  const routers = Routers.list();
  if (!routers.length)
    return (
      <>
        <NetAssets />
        <PageHead title={t('Monitor')} desc={t('Router status, latency history, alerts and scheduled backups.')} />
        <NoRouter t={t} />
      </>
    );
  let rid = sp(searchParams.router) || ctx.router?.id || '';
  if (!routers.some((r) => r.id === rid)) rid = routers[0]!.id;
  const rangeQ = sp(searchParams.range);
  const range = rangeQ in RANGES ? rangeQ : '24h';
  const now = Math.floor(Date.now() / 1000);
  const from = now - RANGES[range]!;
  const st = state();
  const cards = routers.map((r) => {
    const h24 = history(r.id, now - 86400);
    const good = h24.filter((p) => p.ok);
    const lats = good.map((p) => p.lat ?? 0);
    return {
      cfg: r,
      st: st[r.id],
      uptimePct: h24.length ? Math.round((10000 * good.length) / h24.length) / 100 : null,
      latAvg: lats.length ? Math.round(lats.reduce((a, b) => a + b, 0) / lats.length) : null,
      spark: downsample(h24, 72),
    };
  });
  const cur = cards.find((cd) => cd.cfg.id === rid)!;
  const curDemo = isDemo(cur.cfg);
  const simOn = c.sim_down.includes(rid);
  const hist = downsample(history(rid, from), 240);
  const afilter = sp(searchParams.arouter);
  const alerts = alertLog(300)
    .filter((a) => !afilter || a.router === afilter)
    .slice(0, 100);
  const sched = schedState();
  const lastTick = sched.last_tick ?? 0;
  const stale = lastTick === 0 || now - lastTick > Math.max(10, c.poll_min * 3) * 60;
  const stock = cur.st?.stock ?? {};
  const files = backups();
  const hdrs = await headers();
  const base = Env.baseUrl();
  const origin = base ? base.origin : `${Net.isHttps(hdrs) ? 'https' : 'http'}://${hdrs.get('host') ?? 'localhost'}`;
  const tok = canAdmin ? token() : '';
  const cronUrl = `${origin}/api/public/cron?token=${tok}`;
  const own = new Set(ownRouters().map((r) => r.id));
  const qs = (r: string, rg: string) => `/monitor?router=${encodeURIComponent(r)}&range=${rg}`;
  const tabs: [string, string][] = [
    ['alerts', 'Alerts'],
    ['rules', 'Alert rules'],
    ['stock', 'Stock'],
    ['backups', 'Backups'],
    ['scheduler', 'Scheduler'],
  ];
  const sw = (name: string, on: boolean, label: string) => (
    <label className="switch">
      <input type="checkbox" name={name} value="1" defaultChecked={on} />
      <span className="track" />
      <span>{label}</span>
    </label>
  );
  const numField = (id: string, name: string, label: string, v: number, min: number, max?: number, help?: string) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input className="input" id={id} type="number" min={min} max={max} name={name} defaultValue={v} />
      {help ? <p className="help">{help}</p> : null}
    </div>
  );

  return (
    <>
      <NetAssets />
      <PageHead title={t('Monitor')} desc={t('Router status, latency history, alerts and scheduled backups.')}>
        {canW ? (
          <form data-api="/api/json/monitor/run" className="inline-form">
            <input type="hidden" name="job" value="all" />
            <button className="btn btn-primary">
              <Icon name="refresh" size={16} />
              {t('Run checks now')}
            </button>
          </form>
        ) : null}
      </PageHead>

      {stale ? (
        <div className="alert warn" style={{ marginBottom: 'var(--s4)' }}>
          <Icon name="alert" size={18} />
          <div>{lastTick === 0 ? t('The scheduler has never run. Set up cron (Scheduler tab) or press "Run checks now".') : t('The scheduler has not run for a while (last: :t). Check your cron job.', { ':t': ago(lastTick, t) })}</div>
        </div>
      ) : null}

      <div className="nm-cards">
        {cards.map((cd) => {
          const r = cd.cfg;
          const p = cd.st?.last;
          const known = !!p;
          const on = known && (cd.st?.online ?? true);
          return (
            <section key={r.id} className={`card glass nm-card${r.id === rid ? ' is-sel' : ''}`}>
              <div className="card-b">
                <div className="nm-head">
                  <a href={qs(r.id, range)}>
                    <span className={`nm-dot ${!known ? '' : on ? 'on' : 'off'}`} />
                    {r.name}
                  </a>
                  {!known ? <Badge>{t('No data')}</Badge> : on ? <Badge kind="ok">{t('Online')}</Badge> : <Badge kind="err">{t('Offline')}</Badge>}
                </div>
                {known && p.ok ? (
                  <>
                    <div className="nm-metrics">
                      <div>
                        <b>{p.lat ?? 0} ms</b>
                        <span>{t('Latency')}</span>
                      </div>
                      <div>
                        <b>{p.act ?? 0}</b>
                        <span>{t('Active users')}</span>
                      </div>
                      <div>
                        <b>{fmtDur(p.up ?? 0)}</b>
                        <span>{t('Router uptime')}</span>
                      </div>
                    </div>
                    <div>
                      <div className="stat-label">
                        CPU <b style={{ marginLeft: 'auto' }}>{p.cpu ?? 0}%</b>
                      </div>
                      <div className={`progress${(p.cpu ?? 0) >= R.cpu_high && R.cpu_high > 0 ? ' err' : ''}`} style={{ marginTop: 'var(--s2)' }}>
                        <i style={{ width: `${p.cpu ?? 0}%` }} />
                      </div>
                    </div>
                    <div>
                      <div className="stat-label">
                        RAM <b style={{ marginLeft: 'auto' }}>{p.mem ?? 0}%</b>
                      </div>
                      <div className={`progress${(p.mem ?? 0) >= R.mem_high && R.mem_high > 0 ? ' warn' : ''}`} style={{ marginTop: 'var(--s2)' }}>
                        <i style={{ width: `${p.mem ?? 0}%` }} />
                      </div>
                    </div>
                  </>
                ) : known ? (
                  <p className="muted" style={{ margin: 0 }}>
                    {t('Unreachable')}: {cd.st?.last_err ?? ''}
                  </p>
                ) : (
                  <p className="muted" style={{ margin: 0 }}>
                    {t('Waiting for the first poll.')}
                  </p>
                )}
                <Chart pts={cd.spark} series={[{ key: 'lat', cls: 'nm-l1', label: t('Latency') }]} max={null} unit="ms" from={now - 86400} to={now} mini tz={tz} />
                <div className="stat-sub">
                  {cd.uptimePct !== null ? t('Availability 24h: :p%', { ':p': cd.uptimePct }) : ''}
                  {cd.latAvg !== null ? ` · ${t('avg :n ms', { ':n': cd.latAvg })}` : ''}
                  {known && cd.st?.last_check ? ` · ${ago(cd.st.last_check, t)}` : ''}
                </div>
              </div>
            </section>
          );
        })}
      </div>

      <section className="card glass" style={{ marginBottom: 'var(--s4)' }}>
        <div className="card-h">
          <h2>
            {t('History')}: {cur.cfg.name}
          </h2>
          <div className="row">
            {curDemo && canAdmin && own.has(rid) ? (
              <form data-api="/api/json/monitor/simulate" className="inline-form">
                <input type="hidden" name="router" value={rid} />
                <button className="btn btn-sm">{simOn ? t('Stop simulated outage') : t('Simulate outage (demo)')}</button>
              </form>
            ) : null}
            <div className="seg" role="group" aria-label={t('Range')}>
              {Object.keys(RANGES).map((rg) => (
                <a key={rg} href={qs(rid, rg)} {...(rg === range ? { 'aria-current': 'true', className: 'on' } : {})}>
                  {rg}
                </a>
              ))}
            </div>
          </div>
        </div>
        <div className="card-b">
          {hist.length < 2 ? (
            <Empty icon="activity" title={t('Not enough data yet')} text={t('History fills in as the scheduler polls the router.')} />
          ) : (
            <>
              <div className="nm-charts">
                <div>
                  <h3>
                    {t('Latency')}
                    <span className="nm-legend">
                      <span>
                        <i style={{ background: 'var(--chart-1)' }} />
                        {t('NextMON to router')}
                      </span>
                      <span>
                        <i style={{ background: 'var(--chart-3)' }} />
                        {t('Router to :h', { ':h': c.ping_target })}
                      </span>
                    </span>
                  </h3>
                  <Chart
                    pts={hist}
                    series={[
                      { key: 'lat', cls: 'nm-l1', label: t('NextMON to router') },
                      { key: 'net', cls: 'nm-l2', label: t('Router to internet') },
                    ]}
                    max={null}
                    unit="ms"
                    from={from}
                    to={now}
                    tz={tz}
                  />
                </div>
                <div>
                  <h3>
                    CPU / RAM
                    <span className="nm-legend">
                      <span>
                        <i style={{ background: 'var(--chart-1)' }} />
                        CPU %
                      </span>
                      <span>
                        <i style={{ background: 'var(--chart-3)' }} />
                        RAM %
                      </span>
                    </span>
                  </h3>
                  <Chart
                    pts={hist}
                    series={[
                      { key: 'cpu', cls: 'nm-l1', label: 'CPU' },
                      { key: 'mem', cls: 'nm-l2', label: 'RAM' },
                    ]}
                    max={100}
                    unit="%"
                    from={from}
                    to={now}
                    tz={tz}
                  />
                </div>
                <div>
                  <h3>{t('Active hotspot users')}</h3>
                  <Chart pts={hist} series={[{ key: 'act', cls: 'nm-l3', label: t('Active users') }]} max={null} unit="" from={from} to={now} tz={tz} />
                </div>
                <div>
                  <h3>
                    {t('Router uptime')} <span className="muted" style={{ fontWeight: 400 }}>{t('(drops = reboot)')}</span>
                  </h3>
                  <Chart pts={hist.map((p) => (typeof p.up === 'number' ? { ...p, up: p.up / 3600 } : p))} series={[{ key: 'up', cls: 'nm-l1', label: t('Uptime') }]} max={null} unit="h" from={from} to={now} tz={tz} />
                </div>
              </div>
              <p className="help" style={{ marginTop: 'var(--s3)' }}>
                {t('Shaded bands mark periods when the router did not answer.')}
                {curDemo ? ' ' + t('Demo router: the first 24 h of history is simulated.') : ''}
              </p>
            </>
          )}
        </div>
      </section>

      <section className="card glass">
        <div className="tabs" role="tablist" data-hash-tabs="">
          {tabs.map(([k, l], i) => (
            <button key={k} type="button" role="tab" id={`tab-${k}`} aria-controls={`panel-${k}`} aria-selected={i === 0 ? 'true' : 'false'} data-tab={k}>
              {t(l)}
            </button>
          ))}
        </div>

        <div className="tabpanel" role="tabpanel" id="panel-alerts" aria-labelledby="tab-alerts">
          <div className="nm-toolbar">
            <form className="nm-q" method="get" action="/monitor">
              <input type="hidden" name="router" value={rid} />
              <input type="hidden" name="range" value={range} />
              <label className="sr-only" htmlFor="af">
                {t('Router')}
              </label>
              <select className="select select-sm" id="af" name="arouter" data-autosubmit="" style={{ width: 'auto' }} defaultValue={afilter}>
                <option value="">{t('All routers')}</option>
                {routers.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <noscript>
                <button className="btn btn-sm">{t('Filter')}</button>
              </noscript>
            </form>
            {canAdmin ? (
              <form data-api="/api/json/monitor/test" className="inline-form">
                <input type="hidden" name="router" value={rid} />
                <button className="btn btn-sm">
                  <Icon name="bell" size={16} />
                  {t('Send test alert')}
                </button>
              </form>
            ) : null}
          </div>
          {alerts.length === 0 ? (
            <Empty icon="bell" title={t('No alerts yet')} text={t('Alerts appear here when a rule triggers.')} />
          ) : (
            <div className="table-wrap">
              <table className="tbl resp">
                <thead>
                  <tr>
                    <th>{t('Time')}</th>
                    <th>{t('Router')}</th>
                    <th>{t('Rule')}</th>
                    <th>{t('Message')}</th>
                    <th>{t('Delivery')}</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.map((a, i) => (
                    <tr key={i}>
                      <td data-label={t('Time')} className="mono nowrap">
                        {stamp(a.ts, tz, false)}
                      </td>
                      <td data-label={t('Router')}>{a.name || a.router}</td>
                      <td data-label={t('Rule')}>
                        <Badge kind={KIND[a.level] ?? 'neutral'}>{a.rule}</Badge>
                      </td>
                      <td data-label={t('Message')} className="wrap">
                        {a.text}
                      </td>
                      <td data-label={t('Delivery')} className="wrap muted">
                        {a.sent ? <Badge kind="ok">{t('Sent')}</Badge> : null} {a.result ?? ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="tabpanel" role="tabpanel" id="panel-rules" aria-labelledby="tab-rules" hidden>
          <form className="card-b stack" data-api="/api/json/monitor/save">
            <fieldset style={{ border: 0, padding: 0, margin: 0 }} disabled={!canAdmin}>
              <div className="nm-rules">
                <div className="nm-rule">
                  <h3>{t('Router offline / recovery')}</h3>
                  {sw('en[offline]', c.enabled.offline, t('Enabled'))}
                  {numField('r-off', 'offline_after', t('Offline after N failed checks'), R.offline_after, 1, 20)}
                  {numField('r-rec', 'recover_after', t('Back online after N good checks'), R.recover_after, 1, 20, t('Debounce: avoids flapping alerts.'))}
                  {numField('r-rem', 'remind_min', t('Remind every (minutes, 0 = never)'), R.remind_min, 0, 1440)}
                </div>
                <div className="nm-rule">
                  <h3>CPU</h3>
                  {sw('en[cpu]', c.enabled.cpu, t('Enabled'))}
                  {numField('r-cpu', 'cpu_high', t('Threshold (%)'), R.cpu_high, 0, 100)}
                  {numField('r-cpus', 'cpu_samples', t('Consecutive checks above threshold'), R.cpu_samples, 1, 20)}
                  <h3 style={{ marginTop: 'var(--s2)' }}>RAM</h3>
                  {sw('en[mem]', c.enabled.mem, t('Enabled'))}
                  {numField('r-mem', 'mem_high', t('Threshold (%)'), R.mem_high, 0, 100)}
                  {numField('r-mems', 'mem_samples', t('Consecutive checks above threshold'), R.mem_samples, 1, 20)}
                </div>
                <div className="nm-rule">
                  <h3>{t('Voucher stock')}</h3>
                  {sw('en[stock]', c.enabled.stock, t('Enabled'))}
                  {numField('r-st', 'stock_default', t('Minimum unused vouchers per profile'), R.stock_default, 0, undefined, t('0 = do not alert.'))}
                  <div className="field">
                    <label htmlFor="r-stp">{t('Per-profile minimum (one per line: profile = number)')}</label>
                    <textarea className="textarea mono" id="r-stp" name="stock_per" rows={3} placeholder="1Jam = 20" defaultValue={Object.entries(R.stock_per).map(([k, v]) => `${k} = ${v}`).join('\n')} />
                  </div>
                  <h3 style={{ marginTop: 'var(--s2)' }}>{t('Expiring users')}</h3>
                  {sw('en[expiring]', c.enabled.expiring, t('Enabled'))}
                  {numField('r-ex', 'expiring_hours', t('Warn when users expire within (hours)'), R.expiring_hours, 1, 720)}
                </div>
                <div className="nm-rule">
                  <h3>{t('Delivery')}</h3>
                  <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                    <legend className="label">{t('Channels')}</legend>
                    <div className="stack" style={{ gap: 'var(--s1)', marginTop: 'var(--s2)' }}>
                      <label className="check">
                        <input type="checkbox" name="channels[]" value="telegram" defaultChecked={c.channels.includes('telegram')} />
                        Telegram
                      </label>
                      <label className="check">
                        <input type="checkbox" name="channels[]" value="webhook" defaultChecked={c.channels.includes('webhook')} />
                        Webhook
                      </label>
                    </div>
                    <p className="help">{t('Credentials are set under Notifications. Alerts are always kept in the history.')}</p>
                  </fieldset>
                  {numField('r-cd', 'cooldown_min', t('Repeat the same alert at most every (minutes)'), R.cooldown_min, 1, 1440)}
                  {sw('en[backup]', c.enabled.backup, t('Alert when a scheduled backup fails'))}
                </div>
                <div className="nm-rule">
                  <h3>{t('Polling')}</h3>
                  {numField('p-int', 'poll_min', t('Poll every (minutes)'), c.poll_min, 1, 60)}
                  {numField('p-st', 'stock_min', t('Stock/expiry check every (minutes)'), c.stock_min, 5, 1440)}
                  <div className="field">
                    <label htmlFor="p-ping">{t('Internet ping target (from the router)')}</label>
                    <input className="input mono" id="p-ping" name="ping_target" defaultValue={c.ping_target} />
                    <p className="help">{t('Empty = skip.')}</p>
                  </div>
                </div>
                <div className="nm-rule">
                  <h3>{t('Scheduled backup')}</h3>
                  <div className="field">
                    <label htmlFor="b-fr">{t('Frequency')}</label>
                    <select className="select" id="b-fr" name="backup_freq" defaultValue={c.backup.freq}>
                      {[
                        ['off', 'Off'],
                        ['daily', 'Daily'],
                        ['weekly', 'Weekly'],
                      ].map(([k, l]) => (
                        <option key={k} value={k}>
                          {t(l!)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="b-at">{t('Time (HH:MM)')}</label>
                    <input className="input mono" id="b-at" name="backup_at" defaultValue={c.backup.at} pattern="[0-2]?[0-9]:[0-5][0-9]" />
                  </div>
                  <div className="field">
                    <label htmlFor="b-dow">{t('Weekday (weekly)')}</label>
                    <select className="select" id="b-dow" name="backup_dow" defaultValue={String(c.backup.dow)}>
                      {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((dn, i) => (
                        <option key={dn} value={i}>
                          {t(dn)}
                        </option>
                      ))}
                    </select>
                  </div>
                  {numField('b-keep', 'backup_keep', t('Keep the newest N backups'), c.backup.keep, 1, 60)}
                  {sw('backup_binary', c.backup.binary, t('Also create a binary .backup on the router'))}
                </div>
              </div>
            </fieldset>
            {canAdmin ? (
              <div>
                <button className="btn btn-primary">{t('Save')}</button>
              </div>
            ) : (
              <p className="help">{t('Only admins can change alert rules.')}</p>
            )}
          </form>
        </div>

        <div className="tabpanel" role="tabpanel" id="panel-stock" aria-labelledby="tab-stock" hidden>
          {Object.keys(stock).length === 0 ? (
            <Empty icon="ticket" title={t('No stock data yet')} text={t('Run the stock check from the Scheduler tab.')} />
          ) : (
            <div className="table-wrap">
              <table className="tbl resp">
                <thead>
                  <tr>
                    <th>{t('Profile')}</th>
                    <th className="num">{t('Unused vouchers')}</th>
                    <th className="num">{t('Minimum')}</th>
                    <th>{t('Status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(stock).map(([pn, n]) => {
                    const min = R.stock_per[pn] ?? R.stock_default;
                    return (
                      <tr key={pn}>
                        <td data-label={t('Profile')}>{pn}</td>
                        <td data-label={t('Unused vouchers')} className="num">
                          {n}
                        </td>
                        <td data-label={t('Minimum')} className="num">
                          {min || '-'}
                        </td>
                        <td data-label={t('Status')}>{min > 0 && n < min ? <Badge kind="warn">{t('Low')}</Badge> : <Badge kind="ok">OK</Badge>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="tabpanel" role="tabpanel" id="panel-backups" aria-labelledby="tab-backups" hidden>
          <div className="card-b stack">
            <p className="muted">{t('Scheduled /export files are stored in the NextMON database (not web accessible). The newest :n are kept.', { ':n': c.backup.keep })}</p>
            {canW ? (
              <form data-api="/api/json/monitor/run" className="inline-form">
                <input type="hidden" name="job" value="backup" />
                <button className="btn">
                  <Icon name="download" size={16} />
                  {t('Back up now')}
                </button>
              </form>
            ) : null}
          </div>
          {files.length === 0 ? (
            <Empty icon="file" title={t('No stored backups yet')} />
          ) : (
            <div className="table-wrap">
              <table className="tbl resp">
                <thead>
                  <tr>
                    <th>{t('File')}</th>
                    <th>{t('Router')}</th>
                    <th className="num">{t('Size')}</th>
                    <th>{t('Created')}</th>
                    <th>
                      <span className="sr-only">{t('Actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((b) => (
                    <tr key={b.router + b.file}>
                      <td data-label={t('File')} className="mono">
                        {b.file}
                      </td>
                      <td data-label={t('Router')}>{b.name}</td>
                      <td data-label={t('Size')} className="num">
                        {fmtBytes(b.size)}
                      </td>
                      <td data-label={t('Created')} className="mono">
                        {stamp(b.ts, tz, true)}
                      </td>
                      <td className="actions" data-label="">
                        {canAdmin ? (
                          <a className="btn btn-sm" href={`/api/json/monitor?router=${encodeURIComponent(b.router)}&file=${encodeURIComponent(b.file)}`}>
                            <Icon name="download" size={16} />
                            {t('Download')}
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="tabpanel" role="tabpanel" id="panel-scheduler" aria-labelledby="tab-scheduler" hidden>
          <div className="table-wrap">
            <table className="tbl resp">
              <thead>
                <tr>
                  <th>{t('Job')}</th>
                  <th>{t('Last run')}</th>
                  <th>{t('Result')}</th>
                  <th>{t('Runs')}</th>
                  <th>
                    <span className="sr-only">{t('Actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['poll', 'Router poll + alerts'],
                    ['stock', 'Voucher stock + expiring users'],
                    ['backup', 'Scheduled backup'],
                  ] as const
                ).map(([j, l]) => {
                  const s = sched.jobs?.[j];
                  return (
                    <tr key={j}>
                      <td data-label={t('Job')}>
                        <b>{j}</b> <span className="muted">{t(l)}</span>
                      </td>
                      <td data-label={t('Last run')} className="nowrap">
                        {s?.last ? (
                          <>
                            {stamp(s.last, tz, false)} <span className="muted">({ago(s.last, t)})</span>
                          </>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td data-label={t('Result')} className="wrap">
                        {s ? s.ok ? <Badge kind="ok">OK</Badge> : <Badge kind="err">{t('Failed')}</Badge> : null} <span className="muted">{s?.msg ?? ''}</span>
                      </td>
                      <td data-label={t('Runs')} className="num">
                        {s?.runs ?? 0}
                      </td>
                      <td className="actions" data-label="">
                        {canW ? (
                          <form data-api="/api/json/monitor/run" className="inline-form">
                            <input type="hidden" name="job" value={j} />
                            <button className="btn btn-sm">{t('Run now')}</button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {canAdmin ? (
            <div className="card-b stack">
              <h3 style={{ margin: 0 }}>{t('Cron setup')}</h3>
              <p className="muted">{t('Run the scheduler every minute (or every 5 minutes). Each job decides by itself whether it is due; a lock prevents overlapping runs.')}</p>
              <p className="help">{t('NextMON runs its own scheduler inside the server process (every minute, set NEXTMON_SCHEDULER=0 to turn it off). An external cron is only needed when the server may be asleep.')}</p>
              <div>
                <div className="label">{t('Linux / hosting with crontab')}</div>
                <pre className="nm-pre" tabIndex={0} id="cron-lin">{`* * * * * curl -fsS "${cronUrl}" >/dev/null`}</pre>
              </div>
              <div>
                <div className="label">{t('Windows Task Scheduler (run every 1 minute)')}</div>
                <pre className="nm-pre" tabIndex={0} id="cron-win">{`schtasks /Create /SC MINUTE /MO 1 /TN "NextMON cron" /TR "curl.exe -fsS \\"${cronUrl}\\""`}</pre>
              </div>
              <div>
                <div className="label">{t('Shared hosting without CLI (cPanel cron / cron-job.org, every 5 minutes)')}</div>
                <pre className="nm-pre" tabIndex={0} id="cron-web">{`curl -fsS "${cronUrl}" >/dev/null`}</pre>
                <p className="help">{t('The token is a secret: anyone with the URL can trigger the jobs (not read data). Regenerate it if it leaks.')}</p>
              </div>
              <form data-api="/api/json/monitor/token" data-confirm={t('Generate a new token? Existing cron URLs stop working.')}>
                <button className="btn btn-sm">
                  <Icon name="key" size={16} />
                  {t('Regenerate token')}
                </button>
              </form>
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}
