import { Icon } from '../../components/Icon';
import { Env } from '../../lib/env.ts';
import { Routers } from '../../lib/routers.ts';
import type { PageProps } from '../types.ts';
import ActionForm from './ActionForm';
import { deleteRouterAction, revokeShareAction } from './actions.ts';
import { RouterDialog, ShareDialog } from './Dialogs';
import { outgoingShares, ownerName } from './logic.ts';
import Onboarding from './Onboarding';

const csrf = (c: string) => <input type="hidden" name="_csrf" value={c} />;

/** Routers: list, add / edit / delete (admin), share with other workspaces, setup checklist. */
export default function RoutersPage({ ctx }: PageProps) {
  const t = ctx.t;
  const admin = ctx.can('admin');
  const routers = Routers.list();
  const outgoing = admin ? outgoingShares() : [];
  const current = ctx.router?.id ?? '';
  const addBtn = admin ? (
    <button className="btn btn-primary" type="button" data-open="#dlg-router" data-new>
      <Icon name="plus" size={16} />
      {t('Add router')}
    </button>
  ) : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('Routers')}</h1>
          <p className="page-desc">{t('Connect one or more MikroTik devices through the RouterOS API.')}</p>
        </div>
        {routers.length > 0 && addBtn ? <div className="page-actions">{addBtn}</div> : null}
      </div>

      {Env.demoForced() ? (
        <div className="alert warn" style={{ marginBottom: 'var(--s4)' }}>
          {t('NEXTMON_DEMO=1 is set: every router is served by the built-in simulator.')}
        </div>
      ) : null}

      {routers.length === 0 ? (
        <Onboarding ctx={ctx} />
      ) : (
        <section className="card glass">
          <div className="table-wrap">
            <table className="tbl resp">
              <thead>
                <tr>
                  <th>{t('Name')}</th>
                  <th>{t('Session name')}</th>
                  <th>{t('Host')}</th>
                  <th>{t('Mode')}</th>
                  <th>{t('Status')}</th>
                  <th>
                    <span className="sr-only">{t('Actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {routers.map((r) => {
                  const demo = r.type === 'demo';
                  return (
                    <tr key={r.id}>
                      <td data-label={t('Name')}>
                        <b>{r.name}</b>
                      </td>
                      <td data-label={t('Session name')} className="mono">
                        {r.session || r.id}
                      </td>
                      <td data-label={t('Host')} className="mono">
                        {r.shared ? (
                          <>
                            {t('Shared by :n', { ':n': ownerName(r) })} <span className={`badge badge-${r.mode === 'rw' ? 'warn' : 'neutral'}`}>{r.mode === 'rw' ? t('Read/write') : t('Read-only')}</span>
                          </>
                        ) : demo ? (
                          '-'
                        ) : (
                          <>
                            {r.host}:{r.port}
                            {r.ssl ? ' (SSL)' : ''}
                          </>
                        )}
                      </td>
                      <td data-label={t('Mode')}>{demo ? <span className="badge badge-warn">Demo</span> : <span className="badge badge-info">RouterOS API</span>}</td>
                      <td data-label={t('Status')}>{r.id === current ? <span className="badge badge-ok">{t('Selected')}</span> : <span className="muted">-</span>}</td>
                      <td className="actions" data-label="">
                        {admin && !r.shared ? (
                          <>
                            <button
                              className="btn btn-sm"
                              type="button"
                              data-open="#dlg-router"
                              data-edit={JSON.stringify({ id: r.id, name: r.name, session: r.session ?? '', type: r.type, host: r.host, port: r.port, ssl: r.ssl ? '1' : '', verify_tls: r.verify_tls ? '1' : '', user: r.user, hotspot_name: r.hotspot_name })}
                            >
                              <Icon name="edit" size={16} />
                              <span className="hide-m">{t('Edit')}</span>
                            </button>
                            {!demo ? (
                              <button className="btn btn-sm" type="button" data-open="#dlg-share" data-edit={JSON.stringify({ router: r.id, router_name: r.name })}>
                                <Icon name="link" size={16} />
                                <span className="hide-m">{t('Share')}</span>
                              </button>
                            ) : null}
                            <ActionForm action={deleteRouterAction} className="inline-form" data-confirm={t('Delete router :n? Stored credentials are removed.', { ':n': r.name })}>
                              {csrf(ctx.csrf)}
                              <input type="hidden" name="id" value={r.id} />
                              <button className="btn btn-sm btn-danger btn-icon" aria-label={t('Delete')}>
                                <Icon name="trash" size={16} />
                              </button>
                            </ActionForm>
                          </>
                        ) : null}
                        {admin && r.shared ? (
                          <ActionForm action={revokeShareAction} className="inline-form" data-confirm={t('Stop using the shared router :n?', { ':n': r.name })}>
                            {csrf(ctx.csrf)}
                            <input type="hidden" name="router" value={r.id} />
                            <button className="btn btn-sm">{t('Stop using')}</button>
                          </ActionForm>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {outgoing.length > 0 ? (
        <section className="card glass" style={{ marginTop: 'var(--s4)' }}>
          <div className="card-h">
            <h2>{t('Shared with other accounts')}</h2>
          </div>
          <div className="table-wrap">
            <table className="tbl resp">
              <thead>
                <tr>
                  <th>{t('Router')}</th>
                  <th>{t('Shared with')}</th>
                  <th>{t('Access')}</th>
                  <th>
                    <span className="sr-only">{t('Actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {outgoing.map((s) => (
                  <tr key={s.id}>
                    <td data-label={t('Router')}>
                      <b>{s.routerName}</b>
                    </td>
                    <td data-label={t('Shared with')}>
                      {s.toName} <span className="muted mono">({s.toSlug})</span>
                    </td>
                    <td data-label={t('Access')}>
                      <span className={`badge badge-${s.mode === 'rw' ? 'warn' : 'neutral'}`}>{s.mode === 'rw' ? t('Read/write') : t('Read-only')}</span>
                    </td>
                    <td className="actions" data-label="">
                      <ActionForm action={revokeShareAction} className="inline-form" data-confirm={t('Stop sharing :r with :w?', { ':r': s.routerName, ':w': s.toName })}>
                        {csrf(ctx.csrf)}
                        <input type="hidden" name="share" value={s.id} />
                        <button className="btn btn-sm btn-danger">{t('Revoke')}</button>
                      </ActionForm>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="card glass" style={{ marginTop: 'var(--s4)' }}>
        <div className="card-b">
          <h2 style={{ fontSize: 'var(--fs-14)', marginBottom: 'var(--s2)' }}>{t('Router setup checklist')}</h2>
          <ol className="muted" style={{ margin: 0, paddingLeft: 'var(--s5)', display: 'flex', flexDirection: 'column', gap: 'var(--s1)' }}>
            <li>{t('Enable the API service: /ip service enable api (port 8728) or api-ssl (8729).')}</li>
            <li>{t('Create a dedicated user in a group with api, read, write, policy, test and sniff permissions.')}</li>
            <li>{t('Restrict the API service to this server IP: /ip service set api address=x.x.x.x/32.')}</li>
            <li>{t('Keep the SNTP client / NTP enabled: voucher expiry depends on accurate router time.')}</li>
          </ol>
          {admin ? (
            <p className="help" style={{ marginTop: 'var(--s3)' }}>
              <a href="/wizard">{t('Setup wizard')}</a>: {t('prepares the router for NextMON step by step.')}
            </p>
          ) : null}
        </div>
      </section>

      {admin ? (
        <>
          <RouterDialog ctx={ctx} />
          <ShareDialog ctx={ctx} />
        </>
      ) : null}
    </>
  );
}
