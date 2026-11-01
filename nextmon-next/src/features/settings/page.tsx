import { Icon } from '../../components/Icon';
import { ApiKeys } from '../../lib/apikeys.ts';
import { Env } from '../../lib/env.ts';
import { logUsage, usage as voucherUsage } from '../../lib/quota.ts';
import { Routers } from '../../lib/routers.ts';
import { ASSIGNABLE_ROLES, staffUsage } from '../../lib/staff.ts';
import { getSettings } from '../../lib/store.ts';
import { Users } from '../../lib/users.ts';
import type { Role } from '../../lib/users.ts';
import { Workspace } from '../../lib/workspace.ts';
import type { PageProps } from '../types.ts';
import ActionForm from './ActionForm';
import { changePasswordAction, deleteUserAction, saveSettingsAction, saveUserAction } from './actions.ts';
import KeysPanel from './KeysPanel';
import { agoStr, Badge, Csrf, PageHead, stamp } from './ui.tsx';

const ROLE_LABEL: Record<Role, string> = { platform: 'Platform admin', admin: 'Admin', operator: 'Operator', reseller: 'Reseller', viewer: 'Viewer' };

/** Settings: General / My account / Users and roles / API keys (the last two for owners only). Port of views/settings.php. */
export default function SettingsPage({ ctx }: PageProps) {
  const t = ctx.t;
  const admin = ctx.can('admin');
  const s = getSettings();
  const ws = ctx.workspace.id;
  const users = admin ? Users.inWorkspace(ws) : [];
  const keys = admin ? ApiKeys.list() : [];
  const lim = Workspace.limits(ws);
  const staff = staffUsage(ws);
  const vq = voucherUsage(ws);
  const lq = logUsage(ws);
  const cap = (n: number) => (n === 0 ? t('unlimited') : n);
  const routerCount = Routers.list().filter((r) => !r.shared).length;
  const tabs: [string, string][] = [['general', 'General'], ['account', 'My account'], ...(admin ? ([['users', 'Users and roles'], ['api', 'API keys']] as [string, string][]) : [])];
  const csrf = <Csrf value={ctx.csrf} />;
  const roleLabel = (r: Role) => t(ROLE_LABEL[r] ?? r);

  return (
    <>
      <PageHead title={t('Settings')} />
      <section className="card glass">
        <div className="card-b">
          <div className="tabs" role="tablist" data-hash-tabs>
            {tabs.map(([k, l], i) => (
              <button key={k} type="button" role="tab" id={`tab-${k}`} aria-controls={`panel-${k}`} aria-selected={i === 0 ? 'true' : 'false'} data-tab={k}>
                {t(l)}
              </button>
            ))}
          </div>

          <div className="tabpanel" role="tabpanel" id="panel-general" aria-labelledby="tab-general">
            {admin ? (
              <ActionForm action={saveSettingsAction} className="stack" style={{ maxWidth: 720 }}>
                {csrf}
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor="s-lang">{t('Default language')}</label>
                    <select className="select" id="s-lang" name="lang" defaultValue={s.lang === 'en' ? 'en' : 'id'}>
                      <option value="id">Bahasa Indonesia</option>
                      <option value="en">English</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="s-tz">{t('Time zone')}</label>
                    <input className="input" id="s-tz" name="timezone" defaultValue={s.timezone} list="tzlist" />
                    <datalist id="tzlist">
                      {['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura', 'Asia/Singapore', 'UTC'].map((z) => (
                        <option key={z} value={z} />
                      ))}
                    </datalist>
                  </div>
                  <div className="field">
                    <label htmlFor="s-cur">{t('Currency symbol')}</label>
                    <input className="input" id="s-cur" name="currency" defaultValue={s.currency} maxLength={6} />
                  </div>
                  <div className="field">
                    <label htmlFor="s-qty">{t('Max vouchers per batch')}</label>
                    <input className="input" id="s-qty" name="max_qty" type="number" min={1} max={2000} defaultValue={s.max_qty} />
                  </div>
                  <div className="field full">
                    <label htmlFor="s-hs">{t('Default hotspot name')}</label>
                    <input className="input" id="s-hs" name="hotspot_name" defaultValue={s.hotspot_name} />
                  </div>
                  <div className="field full">
                    <label htmlFor="s-login">{t('Hotspot login URL (used in voucher QR codes)')}</label>
                    <input className="input mono" id="s-login" name="login_url" defaultValue={s.login_url} />
                    <p className="help">{t('QR opens: URL?username=...&password=...')}</p>
                  </div>
                  <div className="field full">
                    <label htmlFor="s-cors">{t('Allowed origins for /status.json (comma separated)')}</label>
                    <input className="input mono" id="s-cors" name="status_cors" defaultValue={String(s.status_cors ?? '')} placeholder="http://hotspot.local" />
                    <p className="help">{t('Router hosts are allowed automatically. Use this for the hotspot DNS name.')}</p>
                  </div>
                  <div className="field full">
                    <label className="switch">
                      <input type="checkbox" name="live_report" value="1" defaultChecked={!!s.live_report} />
                      <span className="track" />
                      <span>{t('Show live report on the dashboard')}</span>
                    </label>
                  </div>
                </div>
                <div>
                  <button className="btn btn-primary">{t('Save')}</button>
                </div>
              </ActionForm>
            ) : (
              <p className="muted">{t('Only administrators can change global settings.')}</p>
            )}
            <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: 'var(--s5) 0' }} />
            <dl className="kv" style={{ maxWidth: 560 }}>
              <dt>{t('Demo mode')}</dt>
              <dd>{Env.demoForced() ? <Badge kind="warn">NEXTMON_DEMO=1</Badge> : <span className="muted">{t('per router')}</span>}</dd>
              <dt>{t('Plan limits')}</dt>
              <dd>
                {t('Routers')}: {routerCount}/{cap(lim.routers)} &middot; {t('Staff accounts')}: {staff.used}/{staff.max === 0 ? t('unlimited') : staff.max} &middot; {t('Vouchers today')}: {vq.used}/{cap(vq.limit)} &middot; {t('Log rows')}: {lq.used}/{cap(lq.limit)}
              </dd>
              <dt>Node.js</dt>
              <dd className="mono">{process.version}</dd>
              <dt>{t('Encryption (AES-256-GCM)')}</dt>
              <dd>
                <Badge kind="ok">{t('available')}</Badge>
              </dd>
            </dl>
            {admin ? (
              <p className="help" style={{ marginTop: 'var(--s3)' }}>
                <a href="/settings/security">{t('Security')}</a> &middot; <a href="/notifications">{t('Notifications')}</a> &middot; <a href="/audit">{t('Audit log')}</a>
              </p>
            ) : null}
          </div>

          <div className="tabpanel" role="tabpanel" id="panel-account" aria-labelledby="tab-account" hidden>
            <p className="muted" style={{ marginBottom: 'var(--s4)' }}>
              {ctx.user.username} &middot; {roleLabel(ctx.user.role)}
            </p>
            <ActionForm action={changePasswordAction} reset className="stack" style={{ maxWidth: 420 }}>
              {csrf}
              <div className="field">
                <label htmlFor="a-cur">{t('Current password')}</label>
                <input className="input" id="a-cur" type="password" name="current" autoComplete="current-password" required />
              </div>
              <div className="field">
                <label htmlFor="a-new">{t('New password')}</label>
                <input className="input" id="a-new" type="password" name="new" autoComplete="new-password" required minLength={8} />
              </div>
              <div className="field">
                <label htmlFor="a-new2">{t('Repeat new password')}</label>
                <input className="input" id="a-new2" type="password" name="new2" autoComplete="new-password" required minLength={8} />
              </div>
              <div>
                <button className="btn btn-primary">{t('Change password')}</button>
              </div>
            </ActionForm>
          </div>

          {admin ? (
            <>
              <div className="tabpanel" role="tabpanel" id="panel-users" aria-labelledby="tab-users" hidden>
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 'var(--s3)' }}>
                  <p className="muted">{t('Admin: everything. Operator: manage hotspot, no settings. Reseller: sell vouchers only. Viewer: read-only.')}</p>
                  <button className="btn btn-primary" type="button" data-open="#dlg-usr" data-new>
                    <Icon name="plus" size={16} />
                    {t('Add user')}
                  </button>
                </div>
                <p className="help" style={{ marginBottom: 'var(--s3)' }}>
                  {staff.max === 0 ? t('Staff accounts used: :u (no limit).', { ':u': staff.used }) : t('Staff accounts are limited by your plan: :u of :m used.', { ':u': staff.used, ':m': staff.max })}
                </p>
                <div className="table-wrap">
                  <table className="tbl resp">
                    <thead>
                      <tr>
                        <th>{t('Username')}</th>
                        <th>{t('Role')}</th>
                        <th>{t('Created')}</th>
                        <th>
                          <span className="sr-only">{t('Actions')}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u) => (
                        <tr key={u.id}>
                          <td data-label={t('Username')}>
                            <b>{u.username}</b>
                          </td>
                          <td data-label={t('Role')}>
                            <Badge kind={u.role === 'admin' || u.role === 'platform' ? 'info' : 'neutral'}>{roleLabel(u.role)}</Badge>
                          </td>
                          <td data-label={t('Created')} className="mono">
                            {stamp(u.created, s.timezone).slice(0, 10)}
                          </td>
                          <td className="actions" data-label="">
                            <button className="btn btn-sm" type="button" data-open="#dlg-usr" data-edit={JSON.stringify({ id: u.id, username: u.username, role: u.role === 'platform' ? 'admin' : u.role })}>
                              <Icon name="edit" size={16} />
                              <span className="hide-m">{t('Edit')}</span>
                            </button>
                            {u.id !== ctx.user.id ? (
                              <ActionForm action={deleteUserAction} className="inline-form" confirm={t('Delete user :n?', { ':n': u.username })}>
                                {csrf}
                                <input type="hidden" name="id" value={u.id} />
                                <button className="btn btn-sm btn-danger btn-icon" aria-label={t('Delete')}>
                                  <Icon name="trash" size={16} />
                                </button>
                              </ActionForm>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="tabpanel" role="tabpanel" id="panel-api" aria-labelledby="tab-api" hidden>
                <KeysPanel
                  csrf={ctx.csrf}
                  keys={keys.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, scope: k.scope, last: k.last ? agoStr(t, k.last) : '' }))}
                  labels={{
                    intro: t('Send the key as header "X-API-Key" or "Authorization: Bearer". Base URL:'),
                    newKey: t('Your new API key (shown once):'),
                    copy: t('Copy'),
                    name: t('Key name'),
                    scope: t('Scope'),
                    create: t('Create key'),
                    none: t('No API keys.'),
                    key: t('Key'),
                    lastUsed: t('Last used'),
                    revoke: t('Revoke'),
                    revokeConfirm: t('Revoke this key?'),
                    nameCol: t('Name'),
                    actions: t('Actions'),
                  }}
                />
              </div>
            </>
          ) : null}
        </div>
      </section>

      {admin ? (
        <dialog className="modal" id="dlg-usr" aria-labelledby="dlg-usr-t">
          <ActionForm action={saveUserAction} reset>
            {csrf}
            <input type="hidden" name="id" />
            <div className="modal-h">
              <h2 id="dlg-usr-t">{t('Dashboard user')}</h2>
              <button type="button" className="btn btn-ghost btn-icon" data-close aria-label={t('Close')}>
                <Icon name="x" />
              </button>
            </div>
            <div className="modal-b">
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="du-name">{t('Username')}</label>
                  <input className="input" id="du-name" name="username" required pattern="[A-Za-z0-9_.\-]{3,32}" />
                </div>
                <div className="field">
                  <label htmlFor="du-role">{t('Role')}</label>
                  <select className="select" id="du-role" name="role" defaultValue="operator">
                    {ASSIGNABLE_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {roleLabel(r)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field full">
                  <label htmlFor="du-pass">{t('Password')}</label>
                  <input className="input" id="du-pass" name="password" type="password" autoComplete="new-password" minLength={8} />
                  <p className="help">{t('8+ characters. When editing, leave blank to keep the current password.')}</p>
                </div>
              </div>
            </div>
            <div className="modal-f">
              <button type="button" className="btn" data-close>
                {t('Cancel')}
              </button>
              <button className="btn btn-primary">{t('Save')}</button>
            </div>
          </ActionForm>
        </dialog>
      ) : null}
    </>
  );
}
