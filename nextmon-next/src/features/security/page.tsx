import { Icon } from '../../components/Icon';
import { Security } from '../../lib/security.ts';
import { getSettings } from '../../lib/store.ts';
import { Users } from '../../lib/users.ts';
import type { PageProps } from '../types.ts';
import ActionForm from '../settings/ActionForm';
import { agoStr, Badge, Csrf, PageHead, stamp } from '../settings/ui.tsx';
import { revokeOthersAction, revokeSessionAction, savePolicyAction } from './actions.ts';
import { visibleSessions } from './data.ts';

// eslint-disable-next-line @next/next/no-css-tags
const CSS = <link rel="stylesheet" href="/assets/css/mod-security.css" precedence="default" />;

/** Settings > Security: signed-in sessions, login history, password policy (owners). Port of views/security.php. */
export default function SecurityPage({ ctx }: PageProps) {
  const t = ctx.t;
  const admin = ctx.can('admin');
  const tz = getSettings().timezone;
  const policy = Security.policy();
  const ws = ctx.workspace.id;
  const sessions = visibleSessions(ws, ctx.user.id, admin);
  const names = Object.fromEntries(Users.inWorkspace(ws).map((u) => [u.id, u.username]));
  const history = Security.loginHistory(admin ? null : ctx.user.username, 60);
  const tabs: [string, string][] = [['sessions', 'Sessions'], ['history', 'Login history'], ...(admin ? ([['policy', 'Policy']] as [string, string][]) : [])];
  const csrf = <Csrf value={ctx.csrf} />;

  return (
    <>
      {CSS}
      <PageHead
        title={t('Security')}
        desc={t('Password policy, session timeout, signed-in devices and sign-in history.')}
        actions={
          <a className="btn" href="/settings">
            <Icon name="settings" size={16} />
            {t('Settings')}
          </a>
        }
      />
      <section className="card glass">
        <div className="card-b">
          <div className="tabs" role="tablist" data-hash-tabs>
            {tabs.map(([k, l], i) => (
              <button key={k} type="button" role="tab" id={`tab-${k}`} aria-controls={`panel-${k}`} aria-selected={i === 0 ? 'true' : 'false'} data-tab={k}>
                {t(l)}
              </button>
            ))}
          </div>

          <div className="tabpanel" role="tabpanel" id="panel-sessions" aria-labelledby="tab-sessions">
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 'var(--s3)' }}>
              <p className="muted">{admin ? t('All signed-in devices. Signing one out ends it on its next request.') : t('Devices signed in to your account.')}</p>
              <ActionForm action={revokeOthersAction} confirm={t('Sign out all your other devices?')}>
                {csrf}
                <button className="btn btn-sm">
                  <Icon name="logout" size={16} />
                  {t('Sign out other devices')}
                </button>
              </ActionForm>
            </div>
            {sessions.length === 0 ? (
              <p className="muted">{t('No tracked sessions yet.')}</p>
            ) : (
              <div className="table-wrap">
                <table className="tbl resp">
                  <thead>
                    <tr>
                      {admin ? <th>{t('User')}</th> : null}
                      <th>{t('Device')}</th>
                      <th>IP</th>
                      <th>{t('Signed in')}</th>
                      <th>{t('Last active')}</th>
                      <th>
                        <span className="sr-only">{t('Actions')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((s) => {
                      const cur = s.hash === ctx.session.hash;
                      return (
                        <tr key={s.hash}>
                          {admin ? (
                            <td data-label={t('User')}>
                              <b>{names[s.uid] ?? '?'}</b>
                            </td>
                          ) : null}
                          <td data-label={t('Device')} title={s.ua}>
                            {Security.uaLabel(s.ua)} {cur ? <Badge kind="info">{t('This device')}</Badge> : null}
                          </td>
                          <td data-label="IP" className="mono">
                            {s.ip}
                          </td>
                          <td data-label={t('Signed in')} className="mono nowrap">
                            {stamp(s.created, tz)}
                          </td>
                          <td data-label={t('Last active')}>{agoStr(t, s.last)}</td>
                          <td className="actions" data-label="">
                            {!cur ? (
                              <ActionForm action={revokeSessionAction} className="inline-form">
                                {csrf}
                                <input type="hidden" name="sid" value={s.hash} />
                                <button className="btn btn-sm btn-danger">{t('Sign out')}</button>
                              </ActionForm>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="tabpanel" role="tabpanel" id="panel-history" aria-labelledby="tab-history" hidden>
            <p className="muted" style={{ marginBottom: 'var(--s3)' }}>
              {admin ? t('Sign-in, sign-out and password events for all users (from the audit log).') : t('Sign-in events for your account.')}
            </p>
            {history.length === 0 ? (
              <p className="muted">{t('No activity yet.')}</p>
            ) : (
              <div className="table-wrap">
                <table className="tbl resp">
                  <thead>
                    <tr>
                      <th>{t('Time')}</th>
                      <th>{t('User')}</th>
                      <th>{t('Event')}</th>
                      <th>{t('Detail')}</th>
                      <th>IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((a, i) => (
                      <tr key={i}>
                        <td data-label={t('Time')} className="mono nowrap">
                          {stamp(Number(a.ts), tz, true)}
                        </td>
                        <td data-label={t('User')}>{String(a.user ?? '')}</td>
                        <td data-label={t('Event')}>
                          <Badge kind={String(a.action).includes('fail') ? 'err' : 'neutral'}>{String(a.action)}</Badge>
                        </td>
                        <td data-label={t('Detail')} className="wrap">
                          {String(a.detail ?? '')}
                        </td>
                        <td data-label="IP" className="mono">
                          {String(a.ip ?? '')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {admin ? (
            <div className="tabpanel" role="tabpanel" id="panel-policy" aria-labelledby="tab-policy" hidden>
              <ActionForm action={savePolicyAction} className="stack" style={{ maxWidth: 560 }}>
                {csrf}
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor="p-min">{t('Minimum password length')}</label>
                    <input className="input" id="p-min" name="pw_min" type="number" min={8} max={64} defaultValue={policy.pw_min} />
                  </div>
                  <div className="field">
                    <label htmlFor="p-to">{t('Idle session timeout (minutes)')}</label>
                    <input className="input" id="p-to" name="timeout_min" type="number" min={0} max={43200} defaultValue={policy.timeout_min} />
                    <p className="help">{t('0 = never (until the browser closes).')}</p>
                  </div>
                </div>
                {(
                  [
                    ['pw_upper', 'Require upper and lower case letters', policy.pw_upper],
                    ['pw_digit', 'Require a digit', policy.pw_digit],
                    ['pw_symbol', 'Require a symbol', policy.pw_symbol],
                    ['pw_no_username', 'Password must not contain the username', policy.pw_no_username],
                  ] as const
                ).map(([k, l, v]) => (
                  <label className="switch" key={k}>
                    <input type="checkbox" name={k} value="1" defaultChecked={v} />
                    <span className="track" />
                    <span>{t(l)}</span>
                  </label>
                ))}
                <p className="help">{t('Applies to new and changed passwords. Existing passwords keep working.')}</p>
                <div>
                  <button className="btn btn-primary">{t('Save')}</button>
                </div>
              </ActionForm>
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}
