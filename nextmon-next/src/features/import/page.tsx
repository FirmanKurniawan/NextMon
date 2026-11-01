import { Icon } from '../../components/Icon';
import { isRo } from '../_kit/forms.ts';
import { CsrfField, NoRouter, PageHead, RoNotice, Css } from '../_kit/ui.tsx';
import type { PageProps } from '../types.ts';
import { COLS, MAX_BYTES, MAX_ROWS } from './data.ts';

/** Port of ImportController::index() + views/import.php. */
export default async function ImportPage({ ctx }: PageProps) {
  const t = ctx.t;
  if (!ctx.router) return <NoRouter t={t} />;
  const ro = isRo(ctx);
  const canW = ctx.can('write') && !ro;
  const profiles = (await ctx.driver().print('/ip/hotspot/user/profile', {}, ['name'])).map((p) => p.name ?? '');
  const mb = MAX_BYTES / 1048576;
  return (
    <>
      <Css href="/assets/css/mod-security.css" />
      <PageHead title={t('Import / export users')} desc={t('Move hotspot users in and out with CSV (Mikhmon-style columns).')}>
        <a className="btn" href="/hotspot/users">
          <Icon name="users" size={16} />
          {t('Hotspot users')}
        </a>
      </PageHead>
      {ro ? <RoNotice t={t} /> : null}

      <div className="grid">
        <section className="card glass col-6">
          <div className="card-h">
            <h2>{t('Export')}</h2>
          </div>
          <form className="card-b stack" method="get" action="/api/json/import/export">
            <div className="field">
              <label htmlFor="x-prof">{t('Profile')}</label>
              <select className="select" id="x-prof" name="profile">
                <option value="">{t('All profiles')}</option>
                {profiles.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="x-q">{t('Name or comment contains')}</label>
              <input className="input" id="x-q" name="q" placeholder={t('e.g. batch tag')} />
            </div>
            <div className="field">
              <label htmlFor="x-sep">{t('Separator')}</label>
              <select className="select" id="x-sep" name="sep">
                <option value="comma">, ({t('comma')})</option>
                <option value="semicolon">; ({t('semicolon, for Excel ID')})</option>
              </select>
            </div>
            <label className="switch">
              <input type="checkbox" name="stats" value="1" />
              <span className="track" />
              <span>{t('Include uptime and traffic columns (ignored on import)')}</span>
            </label>
            <div>
              <button className="btn btn-primary">
                <Icon name="download" size={16} />
                {t('Download CSV')}
              </button>
            </div>
          </form>
        </section>

        <section className="card glass col-6">
          <div className="card-h">
            <h2>{t('Import')}</h2>
          </div>
          {!canW ? (
            <div className="card-b">
              <p className="muted">{t('Your role cannot import users.')}</p>
            </div>
          ) : (
            <form className="card-b stack" method="post" action="/hs/import/preview" encType="multipart/form-data">
              <CsrfField ctx={ctx} />
              <div className="imp-drop">
                <input type="file" name="csv" accept=".csv,.txt,text/csv" required aria-label="CSV" />
                <p className="help">{t('Max :m MB and :r rows per file (server upload limit: :p). UTF-8 or Windows-1252; separators , ; or tab are detected.', { ':m': mb, ':r': MAX_ROWS, ':p': mb + 'M' })}</p>
              </div>
              <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="help" style={{ padding: 0 }}>
                  {t('If a user already exists')}
                </legend>
                <label className="switch">
                  <input type="radio" name="mode" value="skip" defaultChecked />
                  <span className="track" />
                  <span>{t('Skip it (keep the router entry)')}</span>
                </label>
                <label className="switch">
                  <input type="radio" name="mode" value="overwrite" />
                  <span className="track" />
                  <span>{t('Overwrite it with the non-empty CSV cells')}</span>
                </label>
              </fieldset>
              <p className="help">{t('Nothing is written yet: the next screen validates every row and shows what would happen.')}</p>
              <div className="row">
                <button className="btn btn-primary">
                  <Icon name="check" size={16} />
                  {t('Validate and preview')}
                </button>
                <a className="btn btn-ghost" href="/api/json/import/template">
                  {t('Download template')}
                </a>
              </div>
            </form>
          )}
        </section>

        <section className="card glass col-12">
          <div className="card-h">
            <h2>{t('Columns')}</h2>
          </div>
          <div className="card-b imp-cols">
            <p className="muted" style={{ marginBottom: 'var(--s2)' }}>
              {t('The first row must be the header. Only Name is required; column order does not matter and unknown columns are ignored.')}
            </p>
            {Object.entries(COLS).map(([key, def]) => (
              <code title={key} key={key}>
                {def[0]}
              </code>
            ))}
            <p className="help" style={{ marginTop: 'var(--s2)' }}>
              {t('Accepted header aliases include User/Username, Pass, Package, MAC, Uptime Limit, Limit Bytes. Disabled: yes/no. Time limit like 1h30m, data limit like 500M or 2G.')}
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
