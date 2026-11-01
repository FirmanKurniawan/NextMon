import { Audit } from '../../lib/audit.ts';
import { getSettings } from '../../lib/store.ts';
import type { PageProps } from '../types.ts';
import { Badge, Empty, PageHead, stamp } from '../settings/ui.tsx';

/** Audit log of the active workspace (newest 300). Port of views/audit.php; the filter box is the shared data-filter behaviour. */
export default function AuditPage({ ctx }: PageProps) {
  const t = ctx.t;
  const rows = Audit.tail(300);
  const tz = getSettings().timezone;
  return (
    <>
      <PageHead title={t('Audit log')} desc={t('Who did what. The newest 300 events are shown.')} />
      <section className="card glass">
        <div className="tbl-tools">
          <input className="input search" type="search" placeholder={t('Filter this list')} data-filter="#audit-tbl" aria-label={t('Filter')} />
        </div>
        {rows.length === 0 ? (
          <Empty icon="list" title={t('No activity yet.')} />
        ) : (
          <div className="table-wrap">
            <table className="tbl resp" id="audit-tbl">
              <thead>
                <tr>
                  <th>{t('Time')}</th>
                  <th data-sort>{t('User')}</th>
                  <th data-sort>{t('Action')}</th>
                  <th>{t('Detail')}</th>
                  <th>IP</th>
                  <th>{t('Router')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a, i) => (
                  <tr key={i}>
                    <td data-label={t('Time')} className="mono nowrap">
                      {stamp(a.ts, tz, true)}
                    </td>
                    <td data-label={t('User')}>{a.user}</td>
                    <td data-label={t('Action')}>
                      <Badge kind={a.action.includes('fail') || a.action.includes('error') ? 'err' : 'neutral'}>{a.action}</Badge>
                    </td>
                    <td data-label={t('Detail')} className="wrap">
                      {a.detail}
                    </td>
                    <td data-label="IP" className="mono">
                      {a.ip}
                    </td>
                    <td data-label={t('Router')} className="mono">
                      {a.router}
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
