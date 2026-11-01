import { Icon } from '../../components/Icon';
import { Badge, CsrfField, PageHead, qp, Css } from '../_kit/ui.tsx';
import type { PageProps } from '../types.ts';
import { SHOW, load } from './data.ts';
import type { RowState } from './data.ts';
import { Expired } from './result.tsx';

const ST: Record<RowState, [string, string]> = { new: ['New', 'ok'], update: ['Update', 'info'], skip: ['Skip (exists)', 'warn'], error: ['Error', 'err'] };

/** Port of ImportController::previewPage() + views/import_preview.php. */
export default function ImportPreviewPage({ ctx, searchParams }: PageProps) {
  const t = ctx.t;
  const token = qp(searchParams, 't');
  const j = load(token, ctx.session.hash);
  if (!j) return <Expired t={t} />;
  const only = qp(searchParams, 'show') === 'errors';
  const all = only ? j.rows.filter((r) => r.st === 'error') : j.rows;
  const rows = all.slice(0, SHOW);
  const c = j.counts;
  const total = c.new + c.update + c.skip + c.error;
  return (
    <>
      <Css href="/assets/css/mod-security.css" />
      <PageHead title={t('Import preview')} desc={j.file + ' - ' + t('nothing has been written yet')}>
        <a className="btn" href={'/api/json/import/errors?t=' + token}>
          <Icon name="download" size={16} />
          {t('Error report')}
        </a>
      </PageHead>

      <section className="card glass" style={{ marginBottom: 'var(--s4)' }}>
        <div className="card-b">
          <div className="imp-sum">
            <Badge kind="neutral">{t(':n rows', { ':n': total })}</Badge>
            <Badge kind="ok">{t(':n new', { ':n': c.new })}</Badge>
            <Badge kind="info">{t(':n to update', { ':n': c.update })}</Badge>
            <Badge kind="warn">{t(':n skipped', { ':n': c.skip })}</Badge>
            <Badge kind={c.error ? 'err' : 'neutral'}>{t(':n with errors', { ':n': c.error })}</Badge>
          </div>
          {c.error ? (
            <div className="alert warn" style={{ marginBottom: 'var(--s3)' }}>
              <Icon name="alert" size={18} />
              <div>{t('Rows with errors are left out. Fix them in the CSV and upload again, or import the valid rows now.')}</div>
            </div>
          ) : null}
          <form method="post" action="/hs/import/commit" className="stack">
            <CsrfField ctx={ctx} />
            <input type="hidden" name="t" value={token} />
            <div className="row">
              <label className="switch">
                <input type="radio" name="mode" value="skip" defaultChecked={j.mode === 'skip'} />
                <span className="track" />
                <span>{t('Skip existing users')}</span>
              </label>
              <label className="switch">
                <input type="radio" name="mode" value="overwrite" defaultChecked={j.mode === 'overwrite'} />
                <span className="track" />
                <span>{t('Overwrite existing users')}</span>
              </label>
            </div>
            <label className="switch">
              <input type="checkbox" name="dry" value="1" />
              <span className="track" />
              <span>{t('Dry run: count what would change, write nothing')}</span>
            </label>
            <div className="row">
              <button className="btn btn-primary" disabled={c.new + c.update + c.skip === 0}>
                <Icon name="check" size={16} />
                {t('Run import')}
              </button>
              <button className="btn btn-ghost" formAction="/hs/import/cancel">
                {t('Cancel')}
              </button>
            </div>
            <p className="help">{t('The new/update/skip counts above follow the choice made at upload; the final choice here is applied against the router as it is now.')}</p>
          </form>
        </div>
      </section>

      <section className="card glass">
        <div className="tbl-tools">
          <a className={'btn btn-sm' + (only ? '' : ' btn-primary')} href={'/import/preview?t=' + token}>
            {t('All rows')}
          </a>
          <a className={'btn btn-sm' + (only ? ' btn-primary' : '')} href={'/import/preview?t=' + token + '&show=errors'}>
            {t('Errors only')}
          </a>
          <span className="spacer" />
          <span className="muted">{t('Showing :a of :b', { ':a': Math.min(all.length, SHOW), ':b': all.length })}</span>
        </div>
        <div className="table-wrap">
          <table className="tbl resp compact">
            <thead>
              <tr>
                <th>{t('Line')}</th>
                <th>{t('Result')}</th>
                <th>{t('Name')}</th>
                <th>{t('Password')}</th>
                <th>{t('Profile')}</th>
                <th>{t('Time Limit')}</th>
                <th>{t('Data Limit')}</th>
                <th>{t('Comment')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const [l, k] = ST[r.st];
                return (
                  <tr key={r.line} className={r.st === 'error' ? 'imp-row-err' : r.st === 'skip' ? 'imp-row-dup' : ''}>
                    <td data-label={t('Line')} className="mono">
                      {r.line}
                    </td>
                    <td data-label={t('Result')}>
                      <Badge kind={k}>{t(l)}</Badge>
                      {r.err.map((m) => (
                        <div className="help" key={m}>
                          {m}
                        </div>
                      ))}
                    </td>
                    <td data-label={t('Name')} className="mono">
                      {r.d.name ?? ''}
                    </td>
                    <td data-label={t('Password')} className="mono">
                      {r.d.password ? '••••' : <span className="muted">-</span>}
                    </td>
                    <td data-label={t('Profile')}>{r.d.profile ?? ''}</td>
                    <td data-label={t('Time Limit')} className="mono">
                      {r.d['limit-uptime'] ?? ''}
                    </td>
                    <td data-label={t('Data Limit')} className="mono">
                      {r.d['limit-bytes-total'] ?? ''}
                    </td>
                    <td data-label={t('Comment')} className="wrap">
                      {r.d.comment ?? ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
