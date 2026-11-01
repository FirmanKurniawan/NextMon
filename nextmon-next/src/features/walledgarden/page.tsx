import { headers } from 'next/headers';
import { Icon } from '../../components/Icon';
import { Env } from '../../lib/env.ts';
import { isRo } from '../_kit/forms.ts';
import { Badge, CsrfField, Empty, NoRouter, PageHead, RoNotice, qp, Css } from '../_kit/ui.tsx';
import type { AppContext, PageProps } from '../types.ts';
import { isOff } from './forms.ts';

type Row = Record<string, string | undefined>;

const search = (rows: Row[], q: string, fields: string[]): Row[] => {
  const n = q.toLowerCase();
  return n === '' ? rows : rows.filter((r) => fields.some((f) => (r[f] ?? '').toLowerCase().includes(n)));
};

function WgTable({ ctx, rows, kind, canW }: { ctx: AppContext; rows: Row[]; kind: 'host' | 'ip'; canW: boolean }) {
  const t = ctx.t;
  return (
    <form method="post" action="/hs/walledgarden/action" data-bulk>
      <CsrfField ctx={ctx} />
      <input type="hidden" name="kind" value={kind} />
      <div className="sel-bar" data-sel-bar hidden>
        <span data-sel-count />
        <span className="spacer" />
        {canW ? (
          <>
            <button className="btn btn-sm" name="action" value="enable">
              {t('Enable')}
            </button>
            <button className="btn btn-sm" name="action" value="disable">
              {t('Disable')}
            </button>
            <button className="btn btn-sm" name="action" value="toggle">
              {t('Toggle')}
            </button>
            <button className="btn btn-sm btn-danger" name="action" value="remove" data-confirm={t('Remove the selected entries?')}>
              <Icon name="trash" size={16} />
              {t('Remove')}
            </button>
          </>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <Empty icon="globe" title={t('No entries')} />
      ) : (
        <div className="table-wrap">
          <table className="tbl resp">
            <thead>
              <tr>
                <th className="cell-chk">
                  <input type="checkbox" data-check-all aria-label={t('Select all')} />
                </th>
                {kind === 'host' ? (
                  <>
                    <th data-sort>{t('Host')}</th>
                    <th>{t('Action')}</th>
                  </>
                ) : (
                  <>
                    <th data-sort>{t('Address')}</th>
                    <th>{t('Protocol')}</th>
                    <th>{t('Port')}</th>
                    <th>{t('Action')}</th>
                  </>
                )}
                <th>Server</th>
                <th>{t('Status')}</th>
                <th>{t('Comment')}</th>
                <th>
                  <span className="sr-only">{t('Actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => {
                const off = isOff(w);
                const dyn = ['true', 'yes'].includes(w.dynamic ?? '');
                const act = w.action ?? (kind === 'host' ? 'allow' : 'accept');
                const edit = { id: w['.id'], dst_host: w['dst-host'] ?? '', dst_address: w['dst-address'] ?? '', protocol: w.protocol ?? '', dst_port: w['dst-port'] ?? '', action: w.action ?? '', server: w.server ?? '', comment: w.comment ?? '' };
                return (
                  <tr key={w['.id']}>
                    <td className="cell-chk" data-label="">
                      <input type="checkbox" name="ids[]" value={w['.id']} aria-label={w['dst-host'] ?? w['dst-address'] ?? ''} />
                    </td>
                    {kind === 'host' ? (
                      <>
                        <td data-label={t('Host')} className="mono">
                          {w['dst-host'] || '-'}
                        </td>
                        <td data-label={t('Action')}>
                          <Badge kind={act === 'allow' ? 'ok' : 'err'}>{act}</Badge>
                        </td>
                      </>
                    ) : (
                      <>
                        <td data-label={t('Address')} className="mono">
                          {w['dst-address'] ?? w['dst-host'] ?? ''}
                        </td>
                        <td data-label={t('Protocol')}>{w.protocol || 'any'}</td>
                        <td data-label={t('Port')} className="mono">
                          {w['dst-port'] || '-'}
                        </td>
                        <td data-label={t('Action')}>
                          <Badge kind={act === 'accept' ? 'ok' : 'err'}>{act}</Badge>
                        </td>
                      </>
                    )}
                    <td data-label="Server">{w.server || 'all'}</td>
                    <td data-label={t('Status')}>{off ? <Badge kind="warn">{t('Disabled')}</Badge> : <Badge kind="ok">{t('Active')}</Badge>}</td>
                    <td data-label={t('Comment')} className="wrap muted">
                      {w.comment ?? ''}
                    </td>
                    <td className="actions" data-label="">
                      {canW && !dyn ? (
                        <button className="btn btn-sm btn-ghost btn-icon" type="button" aria-label={t('Edit')} data-open={`#dlg-wg-${kind}`} data-edit={JSON.stringify(edit)}>
                          <Icon name="edit" size={16} />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </form>
  );
}

function Dialog({ ctx, id, kind, title, children }: { ctx: AppContext; id: string; kind: 'host' | 'ip'; title: string; children: React.ReactNode }) {
  const t = ctx.t;
  return (
    <dialog className="modal" id={`dlg-wg-${id}`} aria-labelledby={`dlg-wg-${id}-t`}>
      <form method="post" action="/hs/walledgarden/save">
        <CsrfField ctx={ctx} />
        <input type="hidden" name="id" />
        <input type="hidden" name="kind" value={kind} />
        <div className="modal-h">
          <h2 id={`dlg-wg-${id}-t`}>{title}</h2>
          <button type="button" className="btn btn-ghost btn-icon" data-close aria-label={t('Close')}>
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-b">
          <div className="form-grid">{children}</div>
        </div>
        <div className="modal-f">
          <button type="button" className="btn" data-close>
            {t('Cancel')}
          </button>
          <button className="btn btn-primary">{t('Save')}</button>
        </div>
      </form>
    </dialog>
  );
}

/** Port of NetworkController::walled() + views/walledgarden.php. */
export default async function WalledGardenPage({ ctx, searchParams }: PageProps) {
  const t = ctx.t;
  if (!ctx.router) return <NoRouter t={t} />;
  const ro = isRo(ctx);
  const canW = ctx.can('write') && !ro;
  const q = qp(searchParams, 'q');
  const r = ctx.driver();
  const got = await r.printMany({ hosts: [HOSTS], ips: [IPS], servers: ['/ip/hotspot', {}, ['name']] });
  const hosts = search(got.hosts ?? [], q, ['dst-host', 'comment', 'server']);
  const ips = search(got.ips ?? [], q, ['dst-address', 'dst-host', 'comment', 'dst-port']);
  const servers = [...new Set((got.servers ?? []).map((s) => s.name ?? '').filter(Boolean))];
  const h = await headers();
  const portal = Env.baseUrl()?.hostname ?? (h.get('host') ?? '').replace(/:\d+$/, '');

  return (
    <>
      <Css href="/assets/css/mod-network.css" />
      <PageHead title={t('Walled garden')} desc={t('Hosts and addresses guests can reach without logging in (payment pages, the portal, captive-portal checks).')} />
      {ro ? <RoNotice t={t} /> : null}
      <section className="card glass">
        <div className="tabs" role="tablist" data-hash-tabs>
          <button type="button" role="tab" id="tab-host" aria-controls="panel-host" aria-selected="true" data-tab="host">
            {t('Hosts')} ({hosts.length})
          </button>
          <button type="button" role="tab" id="tab-ip" aria-controls="panel-ip" aria-selected="false" data-tab="ip">
            {t('IP addresses')} ({ips.length})
          </button>
        </div>
        <form className="nm-toolbar" method="get" action="/walledgarden">
          <input className="input search" type="search" name="q" defaultValue={q} placeholder={t('Search host, address or comment')} aria-label={t('Search')} />
          <button className="btn btn-sm">
            <Icon name="search" size={16} />
            {t('Search')}
          </button>
          <span className="spacer" />
          {canW ? (
            <>
              <button className="btn btn-sm btn-primary" type="button" data-open="#dlg-wg-host" data-new>
                <Icon name="plus" size={16} />
                {t('Add host')}
              </button>
              <button className="btn btn-sm" type="button" data-open="#dlg-wg-ip" data-new>
                <Icon name="plus" size={16} />
                {t('Add IP')}
              </button>
              <button className="btn btn-sm" type="button" data-open="#dlg-wg-def">
                <Icon name="shield" size={16} />
                {t('Apply defaults')}
              </button>
            </>
          ) : null}
        </form>
        <div className="tabpanel" role="tabpanel" id="panel-host" aria-labelledby="tab-host">
          <WgTable ctx={ctx} rows={hosts} kind="host" canW={canW} />
        </div>
        <div className="tabpanel" role="tabpanel" id="panel-ip" aria-labelledby="tab-ip" hidden>
          <WgTable ctx={ctx} rows={ips} kind="ip" canW={canW} />
        </div>
      </section>

      {canW ? (
        <>
          <Dialog ctx={ctx} id="host" kind="host" title={t('Walled garden host')}>
            <div className="field full">
              <label htmlFor="wh-host">{t('Host')}</label>
              <input className="input mono" id="wh-host" name="dst_host" required placeholder="*.midtrans.com" autoCapitalize="off" />
              <p className="help">{t('Wildcards * and ? are allowed.')}</p>
            </div>
            <div className="field">
              <label htmlFor="wh-act">{t('Action')}</label>
              <select className="select" id="wh-act" name="action">
                <option value="allow">allow</option>
                <option value="deny">deny</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="wh-srv">Server</label>
              <input className="input" id="wh-srv" name="server" list="dl-wg-srv" placeholder={t('(all)')} />
            </div>
            <div className="field full">
              <label htmlFor="wh-com">{t('Comment')}</label>
              <input className="input" id="wh-com" name="comment" />
            </div>
          </Dialog>
          <Dialog ctx={ctx} id="ip" kind="ip" title={t('Walled garden IP')}>
            <div className="field">
              <label htmlFor="wi-addr">{t('Address')}</label>
              <input className="input mono" id="wi-addr" name="dst_address" required placeholder="10.5.50.1 or 8.8.8.0/24" />
            </div>
            <div className="field">
              <label htmlFor="wi-act">{t('Action')}</label>
              <select className="select" id="wi-act" name="action">
                <option value="accept">accept</option>
                <option value="drop">drop</option>
                <option value="reject">reject</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="wi-pr">{t('Protocol')}</label>
              <select className="select" id="wi-pr" name="protocol">
                <option value="tcp">tcp</option>
                <option value="udp">udp</option>
                <option value="icmp">icmp</option>
                <option value="">{t('any')}</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="wi-port">{t('Port')}</label>
              <input className="input mono" id="wi-port" name="dst_port" placeholder="443 or 80,443" />
            </div>
            <div className="field">
              <label htmlFor="wi-srv">Server</label>
              <input className="input" id="wi-srv" name="server" list="dl-wg-srv" placeholder={t('(all)')} />
            </div>
            <div className="field">
              <label htmlFor="wi-com">{t('Comment')}</label>
              <input className="input" id="wi-com" name="comment" />
            </div>
          </Dialog>
          <datalist id="dl-wg-srv">
            {servers.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <dialog className="modal" id="dlg-wg-def" aria-labelledby="dlg-wg-def-t">
            <form method="post" action="/hs/walledgarden/defaults">
              <CsrfField ctx={ctx} />
              <div className="modal-h">
                <h2 id="dlg-wg-def-t">{t('Apply recommended defaults')}</h2>
                <button type="button" className="btn btn-ghost btn-icon" data-close aria-label={t('Close')}>
                  <Icon name="x" />
                </button>
              </div>
              <div className="modal-b stack">
                <p className="muted">{t('Adds the NextMON portal, payment gateways (Midtrans, Xendit, Tripay) and captive-portal checks for iOS/Android. Entries that already exist are skipped; nothing is removed.')}</p>
                <div className="field">
                  <label htmlFor="wd-portal">{t('NextMON portal host')}</label>
                  <input className="input mono" id="wd-portal" name="portal" defaultValue={portal} placeholder="nextmon.example.com" />
                </div>
              </div>
              <div className="modal-f">
                <button type="button" className="btn" data-close>
                  {t('Cancel')}
                </button>
                <button className="btn btn-primary">{t('Apply')}</button>
              </div>
            </form>
          </dialog>
        </>
      ) : null}
    </>
  );
}

const HOSTS = '/ip/hotspot/walled-garden';
const IPS = '/ip/hotspot/walled-garden/ip';
