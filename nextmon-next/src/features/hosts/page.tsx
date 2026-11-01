import { Icon } from '../../components/Icon';
import type { PageProps } from '../types.ts';

/** Server component: runs inside ctx.run(), so ctx.driver() / Store / Audit are bound to the right workspace. */
export default async function HostsPage({ ctx }: PageProps) {
  const t = ctx.t;
  if (!ctx.router) {
    return (
      <div className="empty">
        <Icon name="router" size={32} />
        <h3>{t('No router configured')}</h3>
      </div>
    );
  }
  const hosts = await ctx.driver().print('/ip/hotspot/host');
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('Hotspot hosts')}</h1>
          <p className="page-desc">{t('Devices the hotspot has seen on the LAN side.')}</p>
        </div>
      </div>
      {hosts.length === 0 ? (
        <div className="empty">
          <Icon name="monitor" size={32} />
          <h3>{t('No hosts.')}</h3>
        </div>
      ) : (
        <section className="card glass">
          <div className="table-wrap">
            <table className="tbl resp">
              <thead>
                <tr>
                  <th>{t('Address')}</th>
                  <th>{t('MAC address')}</th>
                  <th>{t('Status')}</th>
                  <th>{t('Comment')}</th>
                </tr>
              </thead>
              <tbody>
                {hosts.map((h) => (
                  <tr key={h['.id']}>
                    <td data-label={t('Address')} className="mono">
                      {h.address}
                    </td>
                    <td data-label={t('MAC address')} className="mono">
                      {h['mac-address']}
                    </td>
                    <td data-label={t('Status')}>
                      {h.authorized === 'true' ? <span className="badge badge-ok">{t('Authorized')}</span> : h.bypassed === 'true' ? <span className="badge badge-info">{t('Bypassed')}</span> : <span className="badge badge-neutral">-</span>}
                    </td>
                    <td data-label={t('Comment')}>{h.comment || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
