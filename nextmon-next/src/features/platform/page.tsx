import { Icon } from '../../components/Icon';
import type { PageProps } from '../types.ts';
import ActionForm from '../routers/ActionForm';
import { Badge, PageHead } from '../_netkit/ui.tsx';
import { createAccountAction, deleteAccountAction, enterWorkspaceAction, resetPasswordAction, saveLimitsAction, setStatusAction } from './actions.ts';
import { accountRows, platformDefaults } from './logic.ts';

/** Platform admin: workspaces (accounts) of this installation. */
export default function PlatformAccountsPage({ ctx }: PageProps) {
  const t = ctx.t;
  const rows = accountRows();
  const defaults = platformDefaults();
  const home = ctx.user.workspace;
  const csrf = <input type="hidden" name="_csrf" value={ctx.csrf} />;

  return (
    <>
      <PageHead title={t('Accounts')} desc={t('Workspaces of this installation. Suspending an account blocks its sign-in, public pages, API keys and scheduled jobs.')} />

      <section className="card glass" style={{ marginBottom: 'var(--s4)' }}>
        <div className="card-b">
          <h2 style={{ fontSize: 'var(--fs-14)', marginBottom: 'var(--s3)' }}>{t('New account')}</h2>
          <ActionForm action={createAccountAction} className="row" resetOnOk style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
            {csrf}
            <div className="field">
              <label htmlFor="pa-name">{t('Name')}</label>
              <input className="input" id="pa-name" name="name" required maxLength={60} />
            </div>
            <div className="field">
              <label htmlFor="pa-slug">{t('Slug')}</label>
              <input className="input" id="pa-slug" name="slug" pattern="[a-z0-9][a-z0-9\-]{1,30}[a-z0-9]" placeholder="warung-budi" autoCapitalize="off" />
            </div>
            <div className="field">
              <label htmlFor="pa-owner">{t('Owner username')}</label>
              <input className="input" id="pa-owner" name="owner" required pattern="[A-Za-z0-9_.\-]{3,32}" autoComplete="off" autoCapitalize="off" />
            </div>
            <div className="field">
              <label htmlFor="pa-pw">{t('Password')}</label>
              <input className="input" id="pa-pw" name="password" type="password" required autoComplete="new-password" />
            </div>
            <div className="field">
              <label htmlFor="pa-lr">{t('Router limit')}</label>
              <input className="input" id="pa-lr" name="routers" inputMode="numeric" pattern="[0-9]*" placeholder={String(defaults.routers)} size={4} />
            </div>
            <div className="field">
              <label htmlFor="pa-ls">{t('Staff limit')}</label>
              <input className="input" id="pa-ls" name="staff" inputMode="numeric" pattern="[0-9]*" placeholder={String(defaults.staff)} size={4} />
            </div>
            <button className="btn btn-primary">
              <Icon name="plus" size={16} />
              {t('Create account')}
            </button>
          </ActionForm>
        </div>
      </section>

      <section className="card glass">
        <div className="table-wrap">
          <table className="tbl resp">
            <thead>
              <tr>
                <th>{t('Name')}</th>
                <th>{t('Slug')}</th>
                <th>{t('Status')}</th>
                <th>{t('Owner')}</th>
                <th>{t('Users')}</th>
                <th>{t('Routers')}</th>
                <th>{t('Limits')}</th>
                <th>
                  <span className="sr-only">{t('Actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => {
                const susp = w.status === 'suspended';
                return (
                  <tr key={w.id}>
                    <td data-label={t('Name')}>
                      <b>{w.name}</b>
                      {w.id === ctx.workspace.id ? <span className="muted"> ({t('current')})</span> : null}
                    </td>
                    <td data-label={t('Slug')} className="mono">
                      {w.slug} <span className="muted">({w.id})</span>
                    </td>
                    <td data-label={t('Status')}>{susp ? <Badge kind="warn">{t('Suspended')}</Badge> : <Badge kind="ok">{t('Active')}</Badge>}</td>
                    <td data-label={t('Owner')}>{w.owner_name || '-'}</td>
                    <td data-label={t('Users')}>{w.user_count}</td>
                    <td data-label={t('Routers')}>
                      {w.router_count} / {w.eff.routers > 0 ? w.eff.routers : '∞'}
                    </td>
                    <td data-label={t('Limits')}>
                      <ActionForm action={saveLimitsAction} className="inline-form row" style={{ display: 'flex', gap: 'var(--s1)', flexWrap: 'wrap' }}>
                        {csrf}
                        <input type="hidden" name="id" value={w.id} />
                        <input className="input" name="routers" size={3} inputMode="numeric" defaultValue={w.limits.routers ?? ''} placeholder={String(defaults.routers)} aria-label={t('Router limit')} />
                        <input className="input" name="staff" size={3} inputMode="numeric" defaultValue={w.limits.staff ?? ''} placeholder={String(defaults.staff)} aria-label={t('Staff limit')} />
                        <input className="input" name="vouchers_per_day" size={5} inputMode="numeric" defaultValue={w.limits.vouchers_per_day ?? ''} placeholder={String(defaults.vouchers_per_day)} aria-label={t('Vouchers per day')} />
                        <input className="input" name="log_rows" size={5} inputMode="numeric" defaultValue={w.limits.log_rows ?? ''} placeholder={String(defaults.log_rows)} aria-label={t('Log size (rows)')} />
                        <button className="btn btn-sm">{t('Save')}</button>
                      </ActionForm>
                    </td>
                    <td className="actions" data-label="">
                      {w.id !== home ? (
                        <form action={enterWorkspaceAction} className="inline-form">
                          {csrf}
                          <input type="hidden" name="workspace" value={w.id} />
                          <button className="btn btn-sm">{t('Enter')}</button>
                        </form>
                      ) : null}
                      <ActionForm action={setStatusAction} className="inline-form">
                        {csrf}
                        <input type="hidden" name="id" value={w.id} />
                        <input type="hidden" name="status" value={susp ? 'active' : 'suspended'} />
                        <button className="btn btn-sm">{susp ? t('Reactivate') : t('Suspend')}</button>
                      </ActionForm>
                      <ActionForm action={resetPasswordAction} className="inline-form row" resetOnOk style={{ display: 'flex', gap: 'var(--s1)', flexWrap: 'wrap' }}>
                        {csrf}
                        <input type="hidden" name="id" value={w.id} />
                        <input className="input" name="password" type="password" size={10} autoComplete="new-password" placeholder={t('New password')} aria-label={t('New password')} />
                        <button className="btn btn-sm">{t('Reset password')}</button>
                      </ActionForm>
                      {w.id !== home && w.slug !== 'main' ? (
                        <ActionForm action={deleteAccountAction} className="inline-form" data-confirm={t('Delete account :n and ALL its data?', { ':n': w.name })}>
                          {csrf}
                          <input type="hidden" name="id" value={w.id} />
                          <button className="btn btn-sm btn-danger btn-icon" aria-label={t('Delete')}>
                            <Icon name="trash" size={16} />
                          </button>
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
    </>
  );
}
