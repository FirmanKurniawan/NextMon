import { Icon } from '../../components/Icon';
import { MAX_BYTES, pending as pendingPreview, safetyFiles } from '../../lib/appbackup.ts';
import { fmtBytes } from '../../lib/fmt.ts';
import { Css } from '../_kit/ui.tsx';
import { Empty, NetAssets, NoRouter, PageHead, RoNotice } from '../_netkit/ui';
import { access } from '../_netkit/util.ts';
import type { PageProps } from '../types.ts';

const LABELS: Record<string, string> = {
  routers: 'Routers',
  settings: 'Settings and voucher templates',
  shop: 'Shop configuration',
  resellers: 'Resellers',
  wallets: 'Reseller wallets',
  wallet_ledger: 'Wallet ledger',
  reseller_batches: 'Reseller voucher batches',
  orders: 'Shop orders',
};

export default async function BackupPage({ ctx }: PageProps) {
  const t = ctx.t;
  const w = access(ctx);
  const admin = ctx.can('admin');
  // the app-data backup/restore is workspace level: it must work on an empty workspace (no router yet) too
  const files = ctx.router ? (await ctx.driver().print('/file', {}, ['name', 'type', 'size', 'creation-time'])).filter((f) => /\.(rsc|backup)$/i.test(f.name ?? '')) : [];
  const pend = admin ? pendingPreview(ctx.user.id) : null;
  const safety = admin ? safetyFiles() : [];
  const dl = (type: string, icon: string, label: string) => (
    <a className="btn" href={`/api/json/backup?type=${type}`}>
      <Icon name={icon} size={16} />
      {label}
    </a>
  );
  return (
    <>
      <NetAssets />
      <Css href="/assets/css/mod-security.css" />
      <PageHead title={t('Backup')} desc={t('Create files on the router and download exports.')} />
      {w.ro ? <RoNotice t={t} /> : null}
      {!ctx.router ? <NoRouter t={t} /> : null}
      <div className="grid">
        {ctx.router ? (
          <>
            <section className="card glass col-6">
              <div className="card-h">
                <h2>{t('On the router')}</h2>
              </div>
              <div className="card-b stack">
                <p className="muted">{t('The binary backup (.backup) restores everything including users; the export (.rsc) is a readable script.')}</p>
                <div className="row">
                  <form data-api="/api/json/backup/create">
                    <input type="hidden" name="type" value="backup" />
                    <button className="btn btn-primary" disabled={w.dis}>
                      <Icon name="download" size={16} />
                      {t('Create .backup')}
                    </button>
                  </form>
                  <form data-api="/api/json/backup/create">
                    <input type="hidden" name="type" value="rsc" />
                    <button className="btn" disabled={w.dis}>
                      <Icon name="file" size={16} />
                      {t('Create .rsc export')}
                    </button>
                  </form>
                </div>
              </div>
            </section>
            <section className="card glass col-6">
              <div className="card-h">
                <h2>{t('Download')}</h2>
              </div>
              <div className="card-b stack">
                <div className="row">
                  {dl('users', 'download', t('Users (CSV)'))}
                  {dl('profiles', 'download', t('Profiles (JSON)'))}
                  {dl('rsc', 'download', t('Config export (.rsc)'))}
                  {dl('app', 'download', t('NextMON settings (JSON)'))}
                </div>
                <p className="help">{t('The users CSV contains passwords: store it safely. .rsc download over the API is best effort; binary .backup files must be fetched with FTP/Winbox.')}</p>
              </div>
            </section>
            <section className="card glass col-12">
              <div className="card-h">
                <h2>{t('Files on router')}</h2>
              </div>
              {files.length === 0 ? (
                <Empty icon="file" title={t('No backup files')} text={t('Create one with the buttons above.')} />
              ) : (
                <div className="table-wrap">
                  <table className="tbl resp">
                    <thead>
                      <tr>
                        <th>{t('File')}</th>
                        <th>{t('Type')}</th>
                        <th className="num">{t('Size')}</th>
                        <th>{t('Created')}</th>
                        <th>
                          <span className="sr-only">{t('Actions')}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {files.map((f) => (
                        <tr key={f.name}>
                          <td data-label={t('File')} className="mono">
                            {f.name}
                          </td>
                          <td data-label={t('Type')}>{f.type ?? ''}</td>
                          <td data-label={t('Size')} className="num">
                            {fmtBytes(f.size ?? 0)}
                          </td>
                          <td data-label={t('Created')} className="mono">
                            {f['creation-time'] ?? ''}
                          </td>
                          <td className="actions" data-label="">
                            {/\.rsc$/i.test(f.name ?? '') ? (
                              <a className="btn btn-sm" href={`/api/json/backup?type=file&name=${encodeURIComponent(f.name ?? '')}`}>
                                <Icon name="download" size={16} />
                                {t('Download')}
                              </a>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        ) : null}
        {admin ? (
          <>
            <section className="card glass col-6">
              <div className="card-h">
                <h2>{t('NextMON data backup')}</h2>
              </div>
              <div className="card-b stack">
                <p className="muted">{t('Routers, settings, voucher templates, shop, resellers, wallets, orders and ledgers of this workspace in one file. Restorable on the PHP and Next.js editions.')}</p>
                <form method="get" action="/api/json/backup" className="stack">
                  <input type="hidden" name="type" value="appdata" />
                  <label className="switch">
                    <input type="checkbox" name="secrets" value="1" />
                    <span className="track" />
                    <span>{t('Include encrypted secrets (router passwords, gateway keys)')}</span>
                  </label>
                  <p className="help">{t('Without this, router passwords and keys are left out and must be typed again after a restore. Encrypted secrets only work on an installation that has the same secret key.')}</p>
                  <div>
                    <button className="btn btn-primary">
                      <Icon name="download" size={16} />
                      {t('Download NextMON data')}
                    </button>
                  </div>
                </form>
              </div>
            </section>
            <section className="card glass col-6">
              <div className="card-h">
                <h2>{t('Restore NextMON data')}</h2>
              </div>
              <form className="card-b stack" data-api="/api/json/backup/restore/preview" encType="multipart/form-data">
                <div className="imp-drop">
                  <input type="file" name="file" accept=".json,application/json" required aria-label={t('Backup file')} />
                  <p className="help">{t('Max :m MB. Only this workspace is affected; accounts, sessions and API keys in the file are never imported.', { ':m': MAX_BYTES / 1048576 })}</p>
                </div>
                <p className="help">{t('Nothing is written yet: the next step shows what would be replaced.')}</p>
                <div>
                  <button className="btn">
                    <Icon name="check" size={16} />
                    {t('Check file')}
                  </button>
                </div>
              </form>
            </section>
            {pend ? (
              <section className="card glass col-12" id="restore">
                <div className="card-h">
                  <h2>
                    {t('Restore preview')}: <span className="mono">{pend.file}</span>
                  </h2>
                </div>
                <div className="card-b stack">
                  <form className="stack" data-api="/api/json/backup/restore/apply">
                    <input type="hidden" name="token" value={pend.token} />
                    <p className="muted">{t('File from the :e edition, made :d. The selected items will be REPLACED by the file content.', { ':e': pend.meta.edition === 'next' ? 'Next.js' : 'PHP', ':d': pend.meta.created })}</p>
                    {pend.warnings.map((x) => (
                      <div className="alert info" role="status" key={x.key}>
                        {t(x.key, x.params)}
                      </div>
                    ))}
                    {pend.ignored.length ? <p className="help">{t('Ignored (never imported): :l', { ':l': pend.ignored.join(', ') })}</p> : null}
                    <div className="table-wrap">
                      <table className="tbl resp">
                        <thead>
                          <tr>
                            <th>{t('Restore')}</th>
                            <th>{t('Item')}</th>
                            <th className="num">{t('Now')}</th>
                            <th className="num">{t('In the file')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pend.plan.map((row) => (
                            <tr key={row.id}>
                              <td data-label={t('Restore')}>
                                <input type="checkbox" name="c[]" value={row.id} defaultChecked aria-label={t(LABELS[row.id] ?? row.id)} />
                              </td>
                              <td data-label={t('Item')}>{t(LABELS[row.id] ?? row.id)}</td>
                              <td data-label={t('Now')} className="num">
                                {row.current}
                              </td>
                              <td data-label={t('In the file')} className="num">
                                {row.incoming}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="help">{t('A safety backup of the current data is saved first, and everything is rolled back if the restore fails.')}</p>
                    <div className="field">
                      <label htmlFor="rs-confirm">{t('Type RESTORE to confirm')}</label>
                      <input className="input" id="rs-confirm" name="confirm" autoComplete="off" required pattern="[Rr][Ee][Ss][Tt][Oo][Rr][Ee]" style={{ maxWidth: 240 }} />
                    </div>
                    <div>
                      <button className="btn btn-danger" data-confirm={t('Replace the selected data of this workspace now?')}>
                        <Icon name="check" size={16} />
                        {t('Restore now')}
                      </button>
                    </div>
                  </form>
                  <form data-api="/api/json/backup/restore/cancel">
                    <button className="btn btn-ghost" type="submit">
                      {t('Cancel')}
                    </button>
                  </form>
                </div>
              </section>
            ) : null}
            {safety.length ? (
              <section className="card glass col-12">
                <div className="card-h">
                  <h2>{t('Safety backups (made before each restore)')}</h2>
                </div>
                <div className="table-wrap">
                  <table className="tbl resp">
                    <thead>
                      <tr>
                        <th>{t('File')}</th>
                        <th className="num">{t('Size')}</th>
                        <th>{t('Created')}</th>
                        <th>
                          <span className="sr-only">{t('Actions')}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {safety.map((f) => (
                        <tr key={f.name}>
                          <td data-label={t('File')} className="mono">
                            {f.name}
                          </td>
                          <td data-label={t('Size')} className="num">
                            {fmtBytes(f.size)}
                          </td>
                          <td data-label={t('Created')} className="mono">
                            {new Date(f.time * 1000).toISOString().slice(0, 16).replace('T', ' ')}
                          </td>
                          <td className="actions" data-label="">
                            <a className="btn btn-sm" href={`/api/json/backup?type=safety&name=${encodeURIComponent(f.name)}`}>
                              <Icon name="download" size={16} />
                              {t('Download')}
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </>
  );
}
