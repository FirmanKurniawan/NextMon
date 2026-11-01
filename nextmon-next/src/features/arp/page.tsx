import { Icon } from '../../components/Icon';
import { Badge, Empty, ModalFoot, ModalHead, NetAssets, NoRouter, PageHead, Pager, RoNotice } from '../_netkit/ui';
import { access, ipKey, isTrue, off, paginate, search, sp } from '../_netkit/util.ts';
import type { PageProps } from '../types.ts';

export default async function ArpPage({ ctx, searchParams }: PageProps) {
  const t = ctx.t;
  if (!ctx.router) return <NoRouter t={t} />;
  const w = access(ctx);
  const r = ctx.driver();
  const q = sp(searchParams.q);
  const iface = sp(searchParams.iface);
  const type = sp(searchParams.type);
  const [all, ifs] = await Promise.all([r.print('/ip/arp'), r.print('/interface', {}, ['name'])]);
  const ifaces = [...new Set(all.map((a) => a.interface ?? ''))].sort();
  const rows = search(all, q, ['address', 'mac-address', 'comment', 'interface'])
    .filter((a) => (iface === '' || a.interface === iface) && (type === '' || (type === 'dynamic' ? isTrue(a.dynamic) : !isTrue(a.dynamic))))
    .sort((a, b) => ipKey(a.address) - ipKey(b.address));
  const pg = paginate(rows, Number(sp(searchParams.page)) || 1, 100);
  const ifList = ifs.map((i) => i.name ?? '').filter(Boolean);
  const dialogIfaces = ifList.length ? ifList : ifaces;
  const qs: Record<string, string> = {};
  if (q) qs.q = q;
  if (iface) qs.iface = iface;
  if (type) qs.type = type;

  return (
    <>
      <NetAssets />
      <PageHead title={t('ARP')} desc={t('Address resolution table. Static entries pin an IP to a MAC address.')}>
        {w.show ? (
          <button className="btn btn-primary" type="button" data-open="#dlg-arp" data-new="" disabled={w.dis}>
            <Icon name="plus" size={16} />
            {t('Add static entry')}
          </button>
        ) : null}
      </PageHead>
      {w.show && w.ro ? <RoNotice t={t} /> : null}
      <section className="card glass">
        <form className="nm-toolbar" method="get" action="/arp">
          <input className="input search" type="search" name="q" defaultValue={q} placeholder={t('Search IP, MAC or comment')} aria-label={t('Search')} />
          <select className="select select-sm" name="iface" style={{ width: 'auto' }} aria-label={t('Interface')} data-autosubmit="" defaultValue={iface}>
            <option value="">{t('All interfaces')}</option>
            {ifaces.map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
          <select className="select select-sm" name="type" style={{ width: 'auto' }} aria-label={t('Type')} data-autosubmit="" defaultValue={type}>
            <option value="">{t('Static and dynamic')}</option>
            <option value="dynamic">{t('Dynamic only')}</option>
            <option value="static">{t('Static only')}</option>
          </select>
          <button className="btn btn-sm">
            <Icon name="search" size={16} />
            {t('Search')}
          </button>
        </form>
        <form data-api="/api/json/arp/action" data-bulk="">
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
                <button className="btn btn-sm btn-danger" name="action" value="remove" data-confirm={t('Remove the selected static entries? Dynamic entries are skipped.')} disabled={w.dis}>
                  <Icon name="trash" size={16} />
                  {t('Remove')}
                </button>
              </>
            ) : null}
          </div>
          {pg.rows.length === 0 ? (
            <Empty icon="link" title={t('No ARP entries found')} />
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
                      <th>{t('Interface')}</th>
                      <th>{t('Type')}</th>
                      <th>{t('Status')}</th>
                      <th>{t('Comment')}</th>
                      <th>
                        <span className="sr-only">{t('Actions')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pg.rows.map((a) => {
                      const dyn = isTrue(a.dynamic);
                      return (
                        <tr key={a['.id']}>
                          <td className="cell-chk" data-label="">
                            <input type="checkbox" name="ids[]" value={a['.id']} aria-label={a.address} />
                          </td>
                          <td data-label={t('IP address')} className="mono">
                            {a.address}
                          </td>
                          <td data-label="MAC" className="mono">
                            {a['mac-address'] || '-'}
                          </td>
                          <td data-label={t('Interface')}>{a.interface}</td>
                          <td data-label={t('Type')}>{dyn ? <Badge>{t('dynamic')}</Badge> : <Badge kind="info">{t('static')}</Badge>}</td>
                          <td data-label={t('Status')}>{off(a) ? <Badge kind="err">{t('Disabled')}</Badge> : isTrue(a.invalid) ? <Badge kind="warn">{t('Invalid')}</Badge> : <Badge kind="ok">{t('Active')}</Badge>}</td>
                          <td data-label={t('Comment')} className="wrap muted">
                            {a.comment}
                          </td>
                          <td className="actions" data-label="">
                            {w.show && !dyn ? (
                              <button className="btn btn-sm btn-ghost btn-icon" type="button" aria-label={t('Edit')} disabled={w.dis} data-open="#dlg-arp" data-edit={JSON.stringify({ id: a['.id'], address: a.address ?? '', mac: a['mac-address'] ?? '', interface: a.interface ?? '', comment: a.comment ?? '' })}>
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
              <Pager page={pg.page} pages={pg.pages} total={pg.total} params={qs} path="/arp" t={t} />
            </>
          )}
        </form>
      </section>
      {w.show && !w.dis ? (
        <dialog className="modal" id="dlg-arp" aria-labelledby="dlg-arp-t">
          <form data-api="/api/json/arp/save">
            <input type="hidden" name="id" />
            <ModalHead id="dlg-arp-t" title={t('Static ARP entry')} t={t} />
            <div className="modal-b">
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="a-ip">{t('IP address')}</label>
                  <input className="input mono" id="a-ip" name="address" required placeholder="10.5.50.30" />
                </div>
                <div className="field">
                  <label htmlFor="a-mac">MAC</label>
                  <input className="input mono" id="a-mac" name="mac" required placeholder="AA:BB:CC:DD:EE:FF" />
                </div>
                <div className="field">
                  <label htmlFor="a-if">{t('Interface')}</label>
                  <select className="select" id="a-if" name="interface">
                    {dialogIfaces.map((i) => (
                      <option key={i}>{i}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="a-com">{t('Comment')}</label>
                  <input className="input" id="a-com" name="comment" />
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
