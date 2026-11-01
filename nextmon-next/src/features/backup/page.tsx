import { Icon } from '../../components/Icon';
import { fmtBytes } from '../../lib/fmt.ts';
import { Empty, NetAssets, NoRouter, PageHead, RoNotice } from '../_netkit/ui';
import { access } from '../_netkit/util.ts';
import type { PageProps } from '../types.ts';

export default async function BackupPage({ ctx }: PageProps) {
  const t = ctx.t;
  if (!ctx.router) return <NoRouter t={t} />;
  const w = access(ctx);
  const files = (await ctx.driver().print('/file', {}, ['name', 'type', 'size', 'creation-time'])).filter((f) => /\.(rsc|backup)$/i.test(f.name ?? ''));
  const dl = (type: string, icon: string, label: string) => (
    <a className="btn" href={`/api/json/backup?type=${type}`}>
      <Icon name={icon} size={16} />
      {label}
    </a>
  );
  return (
    <>
      <NetAssets />
      <PageHead title={t('Backup')} desc={t('Create files on the router and download exports.')} />
      {w.ro ? <RoNotice t={t} /> : null}
      <div className="grid">
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
      </div>
    </>
  );
}
