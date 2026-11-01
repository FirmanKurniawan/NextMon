import { Icon } from '../../components/Icon';
import { Badge, Empty, ModalFoot, ModalHead, NetAssets, NoRouter, PageHead, Pager, RoNotice } from '../_netkit/ui';
import { access, ipKey, isTrue, off, paginate, search, sp } from '../_netkit/util.ts';
import type { PageProps } from '../types.ts';

export default async function DhcpPage({ ctx, searchParams }: PageProps) {
  const t = ctx.t;
  if (!ctx.router) return <NoRouter t={t} />;
  const w = access(ctx);
  const r = ctx.driver();
  const q = sp(searchParams.q);
  const type = sp(searchParams.type);
  const [all, srv] = await Promise.all([r.print('/ip/dhcp-server/lease'), r.print('/ip/dhcp-server', {}, ['name'])]);
  const rows = search(all, q, ['address', 'mac-address', 'host-name', 'comment', 'server'])
    .filter((l) => type === '' || (type === 'dynamic' ? isTrue(l.dynamic) : !isTrue(l.dynamic)))
    .sort((a, b) => ipKey(a.address) - ipKey(b.address));
  const pg = paginate(rows, Number(sp(searchParams.page)) || 1, 100);
  const servers = [...new Set(srv.map((s) => s.name ?? '').filter(Boolean))];
  const nDyn = all.filter((l) => isTrue(l.dynamic)).length;
  const qs: Record<string, string> = {};
  if (q) qs.q = q;
  if (type) qs.type = type;

  return (
    <>
      <NetAssets />
      <PageHead title={t('DHCP leases')} desc={t('Connected devices. Make a lease static to pin a device to its IP address.')}>
        {w.show ? (
          <button className="btn btn-primary" type="button" data-open="#dlg-lease" data-new="" disabled={w.dis}>
            <Icon name="plus" size={16} />
            {t('Add static lease')}
          </button>
        ) : null}
      </PageHead>
      {w.show && w.ro ? <RoNotice t={t} /> : null}
      <section className="card glass">
        <form className="nm-toolbar" method="get" action="/dhcp">
          <input className="input search" type="search" name="q" defaultValue={q} placeholder={t('Search IP, MAC, host name or comment')} aria-label={t('Search')} />
          <select className="select select-sm" name="type" style={{ width: 'auto' }} aria-label={t('Type')} data-autosubmit="" defaultValue={type}>
            <option value="">{t('Static and dynamic')}</option>
            <option value="dynamic">
              {t('Dynamic only')} ({nDyn})
            </option>
            <option value="static">{t('Static only')}</option>
          </select>
          <button className="btn btn-sm">
            <Icon name="search" size={16} />
            {t('Search')}
          </button>
        </form>
        <form data-api="/api/json/dhcp/action" data-bulk="">
          <div className="sel-bar" data-sel-bar="" hidden>
            <span data-sel-count="" />
            <span className="spacer" />
            {w.show ? (
              <>
                <button className="btn btn-sm btn-primary" name="action" value="static" disabled={w.dis}>
                  {t('Make static')}
                </button>
                <button className="btn btn-sm" name="action" value="enable" disabled={w.dis}>
                  {t('Enable')}
                </button>
                <button className="btn btn-sm" name="action" value="disable" disabled={w.dis}>
                  {t('Disable')}
                </button>
                <button className="btn btn-sm btn-danger" name="action" value="remove" data-confirm={t('Remove the selected leases? Devices get a new address on their next request.')} disabled={w.dis}>
                  <Icon name="trash" size={16} />
                  {t('Remove')}
                </button>
              </>
            ) : null}
          </div>
          {pg.rows.length === 0 ? (
            <Empty icon="list" title={t('No leases found')} />
          ) : (
            <>
              <div className="table-wrap">
                <table className="tbl resp">
                  <thead>
                    <tr>
                      <th className="cell-chk">
                        <input type="checkbox" data-check-all="" aria-label={t('Select all')} />
                      </th>
                      <th data-sort="">{t('IP address')}</th>
                      <th>MAC</th>
                      <th data-sort="">{t('Host name')}</th>
                      <th>Server</th>
                      <th>{t('Type')}</th>
                      <th>{t('Status')}</th>
                      <th>{t('Expires in')}</th>
                      <th>{t('Comment')}</th>
                      <th>
                        <span className="sr-only">{t('Actions')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pg.rows.map((l) => {
                      const dyn = isTrue(l.dynamic);
                      return (
                        <tr key={l['.id']}>
                          <td className="cell-chk" data-label="">
                            <input type="checkbox" name="ids[]" value={l['.id']} aria-label={l.address} />
                          </td>
                          <td data-label={t('IP address')} className="mono">
                            {l.address}
                          </td>
                          <td data-label="MAC" className="mono">
                            {l['mac-address']}
                          </td>
                          <td data-label={t('Host name')}>{l['host-name'] || '-'}</td>
                          <td data-label="Server">{l.server}</td>
                          <td data-label={t('Type')}>{dyn ? <Badge>{t('dynamic')}</Badge> : <Badge kind="info">{t('static')}</Badge>}</td>
                          <td data-label={t('Status')}>{off(l) ? <Badge kind="err">{t('Disabled')}</Badge> : l.status === 'bound' ? <Badge kind="ok">bound</Badge> : <Badge kind="warn">{l.status || 'waiting'}</Badge>}</td>
                          <td data-label={t('Expires in')} className="mono">
                            {l['expires-after'] || '-'}
                          </td>
                          <td data-label={t('Comment')} className="wrap muted">
                            {l.comment}
                          </td>
                          <td className="actions" data-label="">
                            {w.show && !dyn ? (
                              <button className="btn btn-sm btn-ghost btn-icon" type="button" aria-label={t('Edit')} disabled={w.dis} data-open="#dlg-lease" data-edit={JSON.stringify({ id: l['.id'], address: l.address ?? '', mac: l['mac-address'] ?? '', server: l.server ?? '', comment: l.comment ?? '' })}>
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
              <Pager page={pg.page} pages={pg.pages} total={pg.total} params={qs} path="/dhcp" t={t} />
            </>
          )}
        </form>
      </section>
      {w.show && !w.dis ? (
        <dialog className="modal" id="dlg-lease" aria-labelledby="dlg-lease-t">
          <form data-api="/api/json/dhcp/save">
            <input type="hidden" name="id" />
            <ModalHead id="dlg-lease-t" title={t('Static lease')} t={t} />
            <div className="modal-b">
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="l-ip">{t('IP address')}</label>
                  <input className="input mono" id="l-ip" name="address" required placeholder="10.5.50.30" />
                </div>
                <div className="field">
                  <label htmlFor="l-mac">MAC</label>
                  <input className="input mono" id="l-mac" name="mac" required placeholder="AA:BB:CC:DD:EE:FF" />
                </div>
                <div className="field">
                  <label htmlFor="l-srv">DHCP server</label>
                  <input className="input" id="l-srv" name="server" list="dl-srv" placeholder={t('(optional)')} />
                  <datalist id="dl-srv">
                    {servers.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </div>
                <div className="field">
                  <label htmlFor="l-com">{t('Comment')}</label>
                  <input className="input" id="l-com" name="comment" />
                </div>
              </div>
            </div>
            <ModalFoot t={t} />
          </form>
        </dialog>
      ) : null}
    </>
  );
}
