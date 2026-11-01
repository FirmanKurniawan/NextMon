import { Icon } from '../../components/Icon';
import type { TFn } from '../../lib/i18n.ts';
import { PageHead, qp, Css } from '../_kit/ui.tsx';
import type { PageProps } from '../types.ts';
import { loadResult } from './data.ts';

/** Shown when a token is unknown, expired or belongs to another session (the PHP edition redirected with a flash). */
export function Expired({ t }: { t: TFn }) {
  return (
    <>
      <PageHead title={t('Import / export users')} />
      <div className="alert err" style={{ marginBottom: 'var(--s4)' }}>
        <Icon name="alert" size={18} />
        <div>{t('Import session expired. Upload the file again.')}</div>
      </div>
      <a className="btn btn-primary" href="/import">
        {t('Import another file')}
      </a>
    </>
  );
}

const fmtTs = (ts: number) => {
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

/** Port of ImportController::result() + views/import_result.php. */
export default function ImportResultPage({ ctx, searchParams }: PageProps) {
  const t = ctx.t;
  const token = qp(searchParams, 't');
  const res = loadResult(token, ctx.session.hash);
  if (!res) return <Expired t={t} />;
  const stat = (label: string, value: number, cls = '') => (
    <section className="card glass col-3">
      <div className="card-b">
        <div className="stat-label">{label}</div>
        <div className={'stat-value ' + cls}>{value}</div>
      </div>
    </section>
  );
  return (
    <>
      <Css href="/assets/css/mod-security.css" />
      <PageHead title={res.dry ? t('Dry run finished') : t('Import finished')} desc={res.file + ' - ' + fmtTs(res.ts)}>
        <a className="btn" href="/hotspot/users">
          <Icon name="users" size={16} />
          {t('Hotspot users')}
        </a>
        <a className="btn" href="/import">
          {t('Import another file')}
        </a>
        {res.dry ? (
          <a className="btn btn-primary" href={'/import/preview?t=' + token}>
            {t('Back to preview')}
          </a>
        ) : null}
      </PageHead>
      {res.dry ? (
        <div className="alert info" style={{ marginBottom: 'var(--s4)' }}>
          <Icon name="alert" size={18} />
          <div>{t('Dry run: nothing was written to the router. Run the import again without the dry-run option to apply.')}</div>
        </div>
      ) : null}
      <div className="grid" style={{ marginBottom: 'var(--s4)' }}>
        {stat(res.dry ? t('Would add') : t('Added'), res.added, 'rs-pos')}
        {stat(res.dry ? t('Would update') : t('Updated'), res.updated)}
        {stat(t('Skipped'), res.skipped)}
        {stat(t('Errors'), res.errors, res.errors ? 'rs-neg' : '')}
      </div>
      {res.rowErrors.length > 0 ? (
        <section className="card glass">
          <div className="card-h">
            <h2>{t('Row errors')}</h2>
            <a className="btn btn-sm" href={'/api/json/import/errors?t=' + token}>
              <Icon name="download" size={16} />
              CSV
            </a>
          </div>
          <div className="table-wrap">
            <table className="tbl resp compact">
              <thead>
                <tr>
                  <th>{t('Line')}</th>
                  <th>{t('Name')}</th>
                  <th>{t('Error')}</th>
                </tr>
              </thead>
              <tbody>
                {res.rowErrors.slice(0, 300).map((e, i) => (
                  <tr key={i}>
                    <td data-label={t('Line')} className="mono">
                      {e.line}
                    </td>
                    <td data-label={t('Name')} className="mono">
                      {e.name}
                    </td>
                    <td data-label={t('Error')} className="wrap">
                      {e.error}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
