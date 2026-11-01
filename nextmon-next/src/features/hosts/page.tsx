import { Icon } from '../../components/Icon';
import { isRo } from '../_kit/forms.ts';
import { Badge, CsrfField, Empty, NoRouter, PageHead, RoNotice } from '../_kit/ui.tsx';
import type { PageProps } from '../types.ts';

/** Port of HotspotController::hosts() + views/hosts.php (filter, sortable columns, bulk remove). */
export default async function HostsPage({ ctx }: PageProps) {
  const t = ctx.t;
  if (!ctx.router) return <NoRouter t={t} />;
  const ro = isRo(ctx);
  const canW = ctx.can('write') && !ro;
  const rows = await ctx.driver().print('/ip/hotspot/host');
  return (
    <>
      <PageHead title={t('Hosts')} desc={t('Every device seen by the hotspot, authorized or not.')} />
      {ro ? <RoNotice t={t} /> : null}
      <section className="card glass">
        <form method="post" action="/hs/hotspot/hosts/remove" data-bulk>
          <CsrfField ctx={ctx} />
          <input type="hidden" name="back" value="/hotspot/hosts" />
          <div className="tbl-tools">
            <input className="input search" type="search" placeholder={t('Filter this list')} data-filter="#host-tbl" aria-label={t('Filter')} />
            <span className="spacer" />
          </div>
          <div className="sel-bar" data-sel-bar hidden>
            <span data-sel-count />
            <span className="spacer" />
            {canW ? (
              <button className="btn btn-sm btn-danger" data-confirm={t('Remove the selected hosts?')}>
                <Icon name="trash" size={16} />
                {t('Remove')}
              </button>
            ) : null}
          </div>
          {rows.length === 0 ? (
            <Empty icon="monitor" title={t('No hosts')} />
          ) : (
            <div className="table-wrap">
              <table className="tbl resp" id="host-tbl">
                <thead>
                  <tr>
                    <th className="cell-chk">
                      <input type="checkbox" data-check-all aria-label={t('Select all')} />
                    </th>
                    <th>MAC</th>
                    <th data-sort>{t('IP address')}</th>
                    <th>{t('To address')}</th>
                    <th>Server</th>
                    <th data-chip>{t('Authorized')}</th>
                    <th>{t('Comment')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((h) => (
                    <tr key={h['.id']}>
                      <td className="cell-chk" data-label="">
                        <input type="checkbox" name="ids[]" value={h['.id']} aria-label={h['mac-address'] ?? ''} />
                      </td>
                      <td data-label="MAC" className="mono">
                        {h['mac-address'] ?? ''}
                      </td>
                      <td data-label={t('IP address')} className="mono">
                        {h.address ?? ''}
                      </td>
                      <td data-label={t('To address')} className="mono">
                        {h['to-address'] || '-'}
                      </td>
                      <td data-label="Server">{h.server ?? ''}</td>
                      <td data-label={t('Authorized')}>{h.authorized === 'true' ? <Badge kind="ok">{t('Yes')}</Badge> : <Badge>{t('No')}</Badge>}</td>
                      <td data-label={t('Comment')} className="wrap muted">
                        {h.comment ?? ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </form>
      </section>
    </>
  );
}
