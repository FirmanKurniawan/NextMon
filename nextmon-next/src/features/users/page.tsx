import { Icon } from '../../components/Icon';
import { fmtBytes } from '../../lib/fmt.ts';
import { isRo } from '../_kit/forms.ts';
import { CsrfField, Empty, NoRouter, PageHead, Pager, RoNotice, UserStatusBadge, paginate, qp } from '../_kit/ui.tsx';
import type { PageProps } from '../types.ts';
import { listUsers } from './data.ts';

const STATUSES: [string, string][] = [
  ['new', 'Unused'],
  ['online', 'Online'],
  ['used', 'Used'],
  ['expired', 'Expired'],
  ['disabled', 'Disabled'],
];

/** Port of HotspotController::users() + views/users.php. */
export default async function UsersPage({ ctx, searchParams }: PageProps) {
  const t = ctx.t;
  if (!ctx.router) return <NoRouter t={t} />;
  const ro = isRo(ctx);
  const canW = ctx.can('write') && !ro;
  const q = qp(searchParams, 'q');
  const prof = qp(searchParams, 'profile');
  const batch = qp(searchParams, 'batch');
  const status = qp(searchParams, 'status');
  const d = await listUsers(ctx, { q, profile: prof, batch, status });
  const total = d.rows.length;
  const { rows, pg, pages } = paginate(d.rows, searchParams.page, 100);
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) if (typeof v === 'string' && v !== '') qs.set(k, v);
  const back = '/hotspot/users' + (qs.toString() ? '?' + qs.toString() : '');

  return (
    <>
      <PageHead title={t('Hotspot users')} desc={t('Create, filter and manage hotspot accounts.')}>
        {canW ? (
          <button className="btn btn-primary" type="button" data-open="#dlg-user" data-new>
            <Icon name="plus" size={16} />
            {t('Add user')}
          </button>
        ) : null}
        {ctx.can('sell') ? (
          <a className="btn" href="/vouchers">
            <Icon name="ticket" size={16} />
            {t('Generate vouchers')}
          </a>
        ) : null}
      </PageHead>
      {ro ? <RoNotice t={t} /> : null}

      <section className="card glass">
        <form className="tbl-tools" method="get" action="/hotspot/users" role="search">
          <input className="input search" type="search" name="q" defaultValue={q} placeholder={t('Search name or comment')} aria-label={t('Search')} />
          <select className="select" name="profile" aria-label={t('Profile')} data-autosubmit defaultValue={prof}>
            <option value="">{t('All profiles')}</option>
            {d.profiles.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <select className="select" name="batch" aria-label={t('Batch')} data-autosubmit defaultValue={batch}>
            <option value="">{t('All batches')}</option>
            {d.batches.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
          <select className="select" name="status" aria-label={t('Status')} data-autosubmit defaultValue={status}>
            <option value="">{t('Any status')}</option>
            {STATUSES.map(([k, l]) => (
              <option key={k} value={k}>
                {t(l)}
              </option>
            ))}
          </select>
          <button className="btn btn-sm">
            <Icon name="filter" size={16} />
            {t('Filter')}
          </button>
          <span className="spacer" />
          <button className="btn btn-sm btn-ghost hide-m" type="button" data-density>
            {t('Density')}
          </button>
        </form>

        <form method="post" action="/hs/hotspot/users/action" id="bulk" data-bulk>
          <CsrfField ctx={ctx} />
          <input type="hidden" name="back" value={back} />
          <div className="sel-bar" data-sel-bar hidden>
            <span data-sel-count />
            <span className="spacer" />
            {canW ? (
              <>
                <button className="btn btn-sm" name="action" value="disable">
                  <Icon name="ban" size={16} />
                  {t('Disable')}
                </button>
                <button className="btn btn-sm" name="action" value="enable">
                  <Icon name="check" size={16} />
                  {t('Enable')}
                </button>
                <button className="btn btn-sm" name="action" value="kick">
                  <Icon name="logout" size={16} />
                  {t('Kick')}
                </button>
                <button className="btn btn-sm btn-danger" name="action" value="delete" data-confirm={t('Delete the selected users? This cannot be undone.')}>
                  <Icon name="trash" size={16} />
                  {t('Delete')}
                </button>
              </>
            ) : null}
          </div>
          {rows.length === 0 ? (
            <Empty icon="users" title={t('No users found')} text={t('Try different filters, or generate a batch of vouchers.')}>
              {ctx.can('sell') ? (
                <a className="btn btn-primary" href="/vouchers">
                  {t('Generate vouchers')}
                </a>
              ) : null}
            </Empty>
          ) : (
            <>
              <div className="table-wrap">
                <table className="tbl resp" id="users-tbl">
                  <thead>
                    <tr>
                      <th className="cell-chk">
                        <input type="checkbox" data-check-all aria-label={t('Select all')} />
                      </th>
                      <th data-sort>{t('User')}</th>
                      <th data-sort data-chip>
                        {t('Profile')}
                      </th>
                      <th data-sort data-chip>
                        {t('Status')}
                      </th>
                      <th data-sort>{t('Uptime')}</th>
                      <th className="num">{t('Data in / out')}</th>
                      <th>{t('Comment / expiry')}</th>
                      <th>
                        <span className="sr-only">{t('Actions')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((u) => {
                      const lim = u['limit-uptime'] ?? '';
                      const bytes = u['limit-bytes-total'] ?? '0';
                      const mac = u['mac-address'] ?? '';
                      const edit = {
                        id: u['.id'],
                        name: u.name,
                        password: u.password ?? '',
                        profile: u.profile ?? '',
                        comment: u.comment ?? '',
                        limit_uptime: lim === '0s' || lim === '1s' ? '' : lim,
                        limit_bytes: bytes === '0' ? '' : bytes,
                        mac: mac === '00:00:00:00:00:00' ? '' : mac,
                        disabled: u.disabled === 'true' || u.disabled === 'yes' ? '1' : '0',
                      };
                      return (
                        <tr key={u['.id']}>
                          <td className="cell-chk" data-label="">
                            <input type="checkbox" name="ids[]" value={u['.id']} aria-label={u.name} />
                          </td>
                          <td data-label={t('User')}>
                            <span className="mono">
                              <b>{u.name}</b>
                            </span>
                            {ctx.can('write') && (u.password ?? '') !== '' && u.password !== u.name ? <span className="muted mono"> / {u.password}</span> : null}
                          </td>
                          <td data-label={t('Profile')}>{u.profile ?? ''}</td>
                          <td data-label={t('Status')}>
                            <UserStatusBadge st={u._status} t={t} />
                          </td>
                          <td data-label={t('Uptime')} className="mono">
                            {u.uptime ?? '0s'}
                          </td>
                          <td data-label={t('Data in / out')} className="num mono nowrap">
                            {fmtBytes(u['bytes-in'] ?? 0)} / {fmtBytes(u['bytes-out'] ?? 0)}
                          </td>
                          <td data-label={t('Comment')} className="wrap">
                            {u._exp ? (
                              <>
                                <span className="badge badge-warn" title={t('Expires')}>
                                  {u._exp}
                                </span>{' '}
                              </>
                            ) : null}
                            <span className="muted">{(u.comment ?? '').replace(/^[a-z]{3}\/\d\d\/\d{4} \d\d:\d\d:\d\d/i, '').trim()}</span>
                          </td>
                          <td className="actions" data-label="">
                            {canW ? (
                              <button className="btn btn-sm btn-ghost btn-icon" type="button" aria-label={t('Edit')} data-open="#dlg-user" data-edit={JSON.stringify(edit)}>
                                <Icon name="edit" size={16} />
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pager pg={pg} pages={pages} total={total} params={{ q, profile: prof, batch, status }} t={t} />
            </>
          )}
        </form>
      </section>

      {canW ? (
        <dialog className="modal" id="dlg-user" aria-labelledby="dlg-user-t">
          <form method="post" action="/hs/hotspot/users/save">
            <CsrfField ctx={ctx} />
            <input type="hidden" name="id" />
            <input type="hidden" name="back" value={back} />
            <div className="modal-h">
              <h2 id="dlg-user-t">{t('Hotspot user')}</h2>
              <button type="button" className="btn btn-ghost btn-icon" data-close aria-label={t('Close')}>
                <Icon name="x" />
              </button>
            </div>
            <div className="modal-b">
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="u-name">{t('Username')}</label>
                  <input className="input mono" id="u-name" name="name" required maxLength={64} autoCapitalize="off" autoComplete="off" />
                </div>
                <div className="field">
                  <label htmlFor="u-pass">{t('Password')}</label>
                  <input className="input mono" id="u-pass" name="password" autoComplete="off" />
                </div>
                <div className="field">
                  <label htmlFor="u-prof">{t('Profile')}</label>
                  <select className="select" id="u-prof" name="profile">
                    {d.profiles.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="u-mac">{t('MAC address (lock)')}</label>
                  <input className="input mono" id="u-mac" name="mac" placeholder="AA:BB:CC:DD:EE:FF" />
                </div>
                <div className="field">
                  <label htmlFor="u-lim">{t('Time limit')}</label>
                  <input className="input mono" id="u-lim" name="limit_uptime" placeholder="1h30m" autoCapitalize="off" />
                </div>
                <div className="field">
                  <label htmlFor="u-bytes">{t('Data limit (bytes)')}</label>
                  <input className="input mono" id="u-bytes" name="limit_bytes" inputMode="numeric" placeholder="1073741824" />
                </div>
                <div className="full">
                  <p className="help">
                    <b>{t('Validity')}</b> {t('is the active period counted from first login (set per profile). ')}
                    <b>{t('Time limit')}</b> {t('is the total online time and stops counting while logged out. Time limit must not exceed validity.')}
                  </p>
                </div>
                <div className="field full">
                  <label htmlFor="u-com">{t('Comment')}</label>
                  <input className="input" id="u-com" name="comment" maxLength={120} />
                </div>
                <div className="field full" data-edit-only>
                  <label className="switch">
                    <input type="checkbox" name="disabled" value="1" />
                    <span className="track" />
                    <span>{t('Disabled')}</span>
                  </label>
                </div>
              </div>
            </div>
            <div className="modal-f">
              <button type="button" className="btn" data-close>
                {t('Cancel')}
              </button>
              <button className="btn btn-primary">{t('Save')}</button>
            </div>
          </form>
        </dialog>
      ) : null}
    </>
  );
}
