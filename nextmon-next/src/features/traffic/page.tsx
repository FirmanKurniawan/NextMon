import { Icon } from '../../components/Icon';
import { fmtBytes } from '../../lib/fmt.ts';
import { Badge, Empty, NetAssets, NoRouter, PageHead } from '../_netkit/ui';
import { isTrue, off, sp } from '../_netkit/util.ts';
import type { PageProps } from '../types.ts';

export default async function TrafficPage({ ctx, searchParams }: PageProps) {
  const t = ctx.t;
  if (!ctx.router) return <NoRouter t={t} />;
  const ifaces = await ctx.driver().print('/interface', {}, ['name', 'type', 'running', 'disabled', 'rx-byte', 'tx-byte', 'mtu', 'mac-address']);
  const want = sp(searchParams.interface);
  const pick = ifaces.find((i) => i.name === want) ?? ifaces.find((i) => isTrue(i.running) && !off(i)) ?? ifaces[0];
  return (
    <>
      <NetAssets />
      <PageHead title={t('Live traffic')} desc={t('Live traffic per interface (streamed from the router).')} />
      {!pick ? (
        <Empty icon="activity" title={t('No data')} />
      ) : (
        <section className="card glass" id="traffic-page" data-iface={pick.name}>
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
              <span>
                <span className="muted">{t('Peak')}</span>{' '}
                <b id="peak-now" className="mono">
                  -
                </b>
              </span>
              <label className="sr-only" htmlFor="if-sel">
                {t('Interface')}
              </label>
              <select id="if-sel" className="select select-sm" style={{ width: 'auto' }} defaultValue={pick.name}>
                {ifaces.map((i) => (
                  <option key={i.name}>{i.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="card-b" style={{ paddingTop: 'var(--s2)' }}>
            <div className="chart-box lg">
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
              <span id="tr-state" className="muted" role="status" />
            </div>
          </div>
        </section>
      )}
      <section className="card glass" style={{ marginTop: 'var(--s4)' }}>
        <div className="card-h">
          <h2>{t('Interfaces')}</h2>
        </div>
        {ifaces.length === 0 ? (
          <Empty icon="activity" title={t('No data')} />
        ) : (
          <div className="table-wrap">
            <table className="tbl resp">
              <thead>
                <tr>
                  <th data-sort="">{t('Name')}</th>
                  <th>{t('Type')}</th>
                  <th>{t('Status')}</th>
                  <th>MAC</th>
                  <th className="num">MTU</th>
                  <th className="num">RX</th>
                  <th className="num">TX</th>
                  <th>
                    <span className="sr-only">{t('Actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {ifaces.map((i) => (
                  <tr key={i.name}>
                    <td data-label={t('Name')} className="mono">
                      {i.name}
                    </td>
                    <td data-label={t('Type')}>{i.type ?? ''}</td>
                    <td data-label={t('Status')}>{off(i) ? <Badge kind="err">{t('Disabled')}</Badge> : isTrue(i.running) ? <Badge kind="ok">{t('Running')}</Badge> : <Badge kind="warn">{t('Stopped')}</Badge>}</td>
                    <td data-label="MAC" className="mono">
                      {i['mac-address'] || '-'}
                    </td>
                    <td data-label="MTU" className="num">
                      {i.mtu ?? '-'}
                    </td>
                    <td data-label="RX" className="num mono">
                      {fmtBytes(i['rx-byte'] ?? 0)}
                    </td>
                    <td data-label="TX" className="num mono">
                      {fmtBytes(i['tx-byte'] ?? 0)}
                    </td>
                    <td className="actions" data-label="">
                      <a className="btn btn-sm btn-ghost btn-icon" href={`/traffic?interface=${encodeURIComponent(i.name ?? '')}`} aria-label={t('Live traffic')}>
                        <Icon name="activity" size={16} />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
