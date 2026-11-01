import { Icon } from '../../components/Icon';
import { fmtBytes } from '../../lib/fmt.ts';
import { isRo } from '../_kit/forms.ts';
import { CsrfField, Empty, NoRouter, PageHead, RoNotice } from '../_kit/ui.tsx';
import type { PageProps } from '../types.ts';

/** Port of HotspotController::active() + views/active.php. */
export default async function ActivePage({ ctx }: PageProps) {
  const t = ctx.t;
  if (!ctx.router) return <NoRouter t={t} />;
  const ro = isRo(ctx);
  const canW = ctx.can('write') && !ro;
  const rows = await ctx.driver().print('/ip/hotspot/active');
  return (
    <>
      <PageHead title={t('Active sessions')} desc={t('Users currently logged in to the hotspot.')}>
        <label className="switch">
          <input type="checkbox" data-autoreload="10" />
          <span className="track" />
          <span>{t('Auto refresh')}</span>
        </label>
      </PageHead>
      {ro ? <RoNotice t={t} /> : null}
      <section className="card glass">
        <form method="post" action="/hs/hotspot/active/kick" data-bulk>
          <CsrfField ctx={ctx} />
          <input type="hidden" name="back" value="/hotspot/active" />
          <div className="tbl-tools">
            <input className="input search" type="search" placeholder={t('Filter this list')} data-filter="#act-tbl" aria-label={t('Filter')} />
            <span className="spacer" />
          </div>
          <div className="sel-bar" data-sel-bar hidden>
            <span data-sel-count />
            <span className="spacer" />
            {canW ? (
              <button className="btn btn-sm btn-danger" data-confirm={t('Disconnect the selected sessions?')}>
                <Icon name="logout" size={16} />
                {t('Kick')}
              </button>
            ) : null}
          </div>
          {rows.length === 0 ? (
            <Empty icon="activity" title={t('Nobody is online right now')} />
          ) : (
            <div className="table-wrap">
              <table className="tbl resp" id="act-tbl">
                <thead>
                  <tr>
                    <th className="cell-chk">
                      <input type="checkbox" data-check-all aria-label={t('Select all')} />
                    </th>
                    <th data-sort>{t('User')}</th>
                    <th data-sort>{t('IP address')}</th>
                    <th>MAC</th>
                    <th data-sort>{t('Uptime')}</th>
                    <th>{t('Time left')}</th>
                    <th className="num">{t('Data in / out')}</th>
                    <th data-chip>{t('Login by')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={a['.id']}>
                      <td className="cell-chk" data-label="">
                        <input type="checkbox" name="ids[]" value={a['.id']} aria-label={a.user ?? ''} />
                      </td>
                      <td data-label={t('User')} className="mono">
                        <b>{a.user ?? ''}</b>
                      </td>
                      <td data-label={t('IP address')} className="mono">
                        {a.address ?? ''}
                      </td>
                      <td data-label="MAC" className="mono">
                        {a['mac-address'] ?? ''}
                      </td>
                      <td data-label={t('Uptime')} className="mono">
                        {a.uptime ?? ''}
                      </td>
                      <td data-label={t('Time left')} className="mono">
                        {a['session-time-left'] || '-'}
                      </td>
                      <td data-label={t('Data in / out')} className="num mono nowrap">
                        {fmtBytes(a['bytes-in'] ?? 0)} / {fmtBytes(a['bytes-out'] ?? 0)}
                      </td>
                      <td data-label={t('Login by')} className="wrap muted">
                        {a['login-by'] ?? ''}
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
