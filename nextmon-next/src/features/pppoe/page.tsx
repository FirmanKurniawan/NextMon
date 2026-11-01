import type { Row } from '../../lib/driver.ts';
import { Icon } from '../../components/Icon';
import { Badge, Empty, ModalFoot, ModalHead, NetAssets, NoRouter, PageHead, Pager, RoNotice } from '../_netkit/ui';
import { access, off, paginate, search, sp } from '../_netkit/util.ts';
import type { PageProps } from '../types.ts';

export default async function PppoePage({ ctx, searchParams }: PageProps) {
  const t = ctx.t;
  if (!ctx.router) return <NoRouter t={t} />;
  const w = access(ctx);
  const r = ctx.driver();
  const q = sp(searchParams.q);
  const prof = sp(searchParams.profile);
  const status = sp(searchParams.status);
  const [secrets, active, profiles] = await Promise.all([r.print('/ppp/secret'), r.print('/ppp/active'), r.print('/ppp/profile')]);
  const online = new Map(active.map((a) => [a.name ?? '', a]));
  const isOnline = (s: Row) => online.has(s.name ?? '');
  const filtered = search(secrets, q, ['name', 'comment', 'caller-id', 'remote-address']).filter((s) => {
    if (prof !== '' && (s.profile ?? '') !== prof) return false;
    switch (status) {
      case 'online':
        return isOnline(s);
      case 'offline':
        return !isOnline(s) && !off(s);
      case 'disabled':
        return off(s);
      default:
        return true;
    }
  });
  const pg = paginate(filtered, Number(sp(searchParams.page)) || 1, 100);
  const activeRows = search(active, sp(searchParams.aq), ['name', 'address', 'caller-id']);
  const inUse = new Map<string, number>();
  for (const s of secrets) inUse.set(s.profile ?? '', (inUse.get(s.profile ?? '') ?? 0) + 1);
  const counts = { secrets: secrets.length, active: active.length, disabled: secrets.filter(off).length };
  const profNames = profiles.map((p) => p.name ?? '');
  const dis = w.dis;
  const qs: Record<string, string> = {};
  if (q) qs.q = q;
  if (prof) qs.profile = prof;
  if (status) qs.status = status;
  const tabs: [string, string][] = [
    ['secrets', 'Secrets'],
    ['active', 'Active sessions'],
    ['profiles', 'Profiles'],
  ];
  const stats: [string, string, number][] = [
    ['users', 'Secrets', counts.secrets],
    ['activity', 'Online now', counts.active],
    ['ban', 'Disabled', counts.disabled],
  ];

  return (
    <>
      <NetAssets />
      <PageHead title={t('PPPoE')} desc={t('Customer secrets, live sessions and profiles.')}>
        {w.show ? (
          <button className="btn btn-primary" type="button" data-open="#dlg-sec" data-new="" disabled={dis}>
            <Icon name="plus" size={16} />
            {t('Add secret')}
          </button>
        ) : null}
      </PageHead>
      {w.show && w.ro ? <RoNotice t={t} /> : null}

      <div className="grid" style={{ marginBottom: 'var(--s4)' }}>
        {stats.map(([ic, label, n]) => (
          <section key={label} className="card glass col-4">
            <div className="card-b">
              <div className="stat-label">
                <Icon name={ic} size={16} />
                {t(label)}
              </div>
              <div className="stat-value">{n}</div>
            </div>
          </section>
        ))}
      </div>

      <section className="card glass">
        <div className="tabs" role="tablist" data-hash-tabs="">
          {tabs.map(([k, l], i) => (
            <button key={k} type="button" role="tab" id={`tab-${k}`} aria-controls={`panel-${k}`} aria-selected={i === 0 ? 'true' : 'false'} data-tab={k}>
              {t(l)}
            </button>
          ))}
        </div>

        <div className="tabpanel" role="tabpanel" id="panel-secrets" aria-labelledby="tab-secrets">
          <form className="nm-toolbar" method="get" action="/pppoe">
            <input className="input search" type="search" name="q" defaultValue={q} placeholder={t('Search name, comment, MAC or IP')} aria-label={t('Search')} />
            <select className="select select-sm" name="profile" style={{ width: 'auto' }} aria-label={t('Profile')} data-autosubmit="" defaultValue={prof}>
              <option value="">{t('All profiles')}</option>
              {profNames.map((pn) => (
                <option key={pn}>{pn}</option>
              ))}
            </select>
            <select className="select select-sm" name="status" style={{ width: 'auto' }} aria-label={t('Status')} data-autosubmit="" defaultValue={status}>
              <option value="">{t('Any status')}</option>
              {[
                ['online', 'Online'],
                ['offline', 'Offline'],
                ['disabled', 'Disabled'],
              ].map(([k, l]) => (
                <option key={k} value={k}>
                  {t(l!)}
                </option>
              ))}
            </select>
            <button className="btn btn-sm">
              <Icon name="search" size={16} />
              {t('Search')}
            </button>
          </form>
          <form data-api="/api/json/pppoe/secret/action" data-bulk="">
            <div className="sel-bar" data-sel-bar="" hidden>
              <span data-sel-count="" />
              <span className="spacer" />
              {w.show ? (
                <>
                  <select className="select select-sm" name="profile" style={{ width: 'auto' }} aria-label={t('Profile')} disabled={dis}>
                    {profNames.map((pn) => (
                      <option key={pn}>{pn}</option>
                    ))}
                  </select>
                  <button className="btn btn-sm" name="action" value="setprofile" disabled={dis}>
                    {t('Set profile')}
                  </button>
                  <button className="btn btn-sm" name="action" value="enable" disabled={dis}>
                    {t('Enable')}
                  </button>
                  <button className="btn btn-sm" name="action" value="disable" data-confirm={t('Disable the selected secrets? Their live sessions are disconnected.')} disabled={dis}>
                    {t('Disable')}
                  </button>
                  <button className="btn btn-sm" name="action" value="kick" disabled={dis}>
                    {t('Disconnect')}
                  </button>
                  <button className="btn btn-sm btn-danger" name="action" value="remove" data-confirm={t('Delete the selected secrets? This cannot be undone.')} disabled={dis}>
                    <Icon name="trash" size={16} />
                    {t('Delete')}
                  </button>
                </>
              ) : null}
            </div>
            {pg.rows.length === 0 ? (
              <Empty icon="users" title={t('No secrets found')} />
            ) : (
              <>
                <div className="table-wrap">
                  <table className="tbl resp" id="ppp-tbl">
                    <thead>
                      <tr>
                        <th className="cell-chk">
                          <input type="checkbox" data-check-all="" aria-label={t('Select all')} />
                        </th>
                        <th data-sort="">{t('Name')}</th>
                        <th data-sort="">{t('Profile')}</th>
                        <th>{t('Status')}</th>
                        <th>IP</th>
                        <th>MAC</th>
                        <th>{t('Comment')}</th>
                        <th>
                          <span className="sr-only">{t('Actions')}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pg.rows.map((s) => {
                        const isOff = off(s);
                        return (
                          <tr key={s['.id']}>
                            <td className="cell-chk" data-label="">
                              <input type="checkbox" name="ids[]" value={s['.id']} aria-label={s.name} />
                            </td>
                            <td data-label={t('Name')} className="mono">
                              {s.name}
                            </td>
                            <td data-label={t('Profile')}>{s.profile ?? ''}</td>
                            <td data-label={t('Status')}>{isOff ? <Badge kind="err">{t('Disabled')}</Badge> : isOnline(s) ? <Badge kind="ok">{t('Online')}</Badge> : <Badge>{t('Offline')}</Badge>}</td>
                            <td data-label="IP" className="mono">
                              {(online.get(s.name ?? '')?.address ?? '') || s['remote-address'] || '-'}
                            </td>
                            <td data-label="MAC" className="mono">
                              {s['caller-id'] || '-'}
                            </td>
                            <td data-label={t('Comment')} className="wrap muted">
                              {s.comment ?? ''}
                            </td>
                            <td className="actions" data-label="">
                              {w.show ? (
                                <button
                                  className="btn btn-sm btn-ghost btn-icon"
                                  type="button"
                                  aria-label={t('Edit')}
                                  disabled={dis}
                                  data-open="#dlg-sec"
                                  data-edit={JSON.stringify({ id: s['.id'], name: s.name, service: s.service ?? 'pppoe', profile: s.profile ?? 'default', caller_id: s['caller-id'] ?? '', local_address: s['local-address'] ?? '', remote_address: s['remote-address'] ?? '', comment: s.comment ?? '' })}
                                >
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
                <Pager page={pg.page} pages={pg.pages} total={pg.total} params={qs} path="/pppoe" t={t} />
              </>
            )}
          </form>
        </div>

        <div className="tabpanel" role="tabpanel" id="panel-active" aria-labelledby="tab-active" hidden>
          <form data-api="/api/json/pppoe/active/kick" data-bulk="">
            <div className="tbl-tools">
              <input className="input search" type="search" placeholder={t('Filter this list')} data-filter="#act-tbl" aria-label={t('Filter')} />
            </div>
            <div className="sel-bar" data-sel-bar="" hidden>
              <span data-sel-count="" />
              <span className="spacer" />
              {w.show ? (
                <button className="btn btn-sm btn-danger" data-confirm={t('Disconnect the selected sessions?')} disabled={dis}>
                  {t('Disconnect')}
                </button>
              ) : null}
            </div>
            {activeRows.length === 0 ? (
              <Empty icon="activity" title={t('No active PPPoE sessions')} />
            ) : (
              <div className="table-wrap">
                <table className="tbl resp" id="act-tbl">
                  <thead>
                    <tr>
                      <th className="cell-chk">
                        <input type="checkbox" data-check-all="" aria-label={t('Select all')} />
                      </th>
                      <th data-sort="">{t('Name')}</th>
                      <th>IP</th>
                      <th>MAC</th>
                      <th>{t('Service')}</th>
                      <th data-sort="">Uptime</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeRows.map((a) => (
                      <tr key={a['.id']}>
                        <td className="cell-chk" data-label="">
                          <input type="checkbox" name="ids[]" value={a['.id']} aria-label={a.name} />
                        </td>
                        <td data-label={t('Name')} className="mono">
                          {a.name}
                        </td>
                        <td data-label="IP" className="mono">
                          {a.address ?? ''}
                        </td>
                        <td data-label="MAC" className="mono">
                          {a['caller-id'] ?? ''}
                        </td>
                        <td data-label={t('Service')}>{a.service ?? ''}</td>
                        <td data-label="Uptime" className="mono">
                          {a.uptime ?? ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </form>
        </div>

        <div className="tabpanel" role="tabpanel" id="panel-profiles" aria-labelledby="tab-profiles" hidden>
          <div className="nm-toolbar">
            {w.show ? (
              <button className="btn btn-sm btn-primary" type="button" data-open="#dlg-prof" data-new="" disabled={dis}>
                <Icon name="plus" size={16} />
                {t('Add profile')}
              </button>
            ) : null}
          </div>
          <div className="table-wrap">
            <table className="tbl resp">
              <thead>
                <tr>
                  <th>{t('Name')}</th>
                  <th>{t('Local address')}</th>
                  <th>{t('Remote address / pool')}</th>
                  <th>{t('Rate limit')}</th>
                  <th className="num">{t('Secrets')}</th>
                  <th>
                    <span className="sr-only">{t('Actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((p) => {
                  const builtin = ['default', 'default-encryption'].includes(p.name ?? '');
                  return (
                    <tr key={p['.id']}>
                      <td data-label={t('Name')}>
                        {p.name} {builtin ? <Badge>{t('built-in')}</Badge> : null}
                      </td>
                      <td data-label={t('Local address')} className="mono">
                        {p['local-address'] || '-'}
                      </td>
                      <td data-label={t('Remote address / pool')} className="mono">
                        {p['remote-address'] || '-'}
                      </td>
                      <td data-label={t('Rate limit')} className="mono">
                        {p['rate-limit'] || '-'}
                      </td>
                      <td data-label={t('Secrets')} className="num">
                        {inUse.get(p.name ?? '') ?? 0}
                      </td>
                      <td className="actions" data-label="">
                        {w.show ? (
                          <>
                            <button
                              className="btn btn-sm btn-ghost btn-icon"
                              type="button"
                              aria-label={t('Edit')}
                              disabled={dis}
                              data-open="#dlg-prof"
                              data-edit={JSON.stringify({ id: p['.id'], name: p.name, local_address: p['local-address'] ?? '', remote_address: p['remote-address'] ?? '', rate_limit: p['rate-limit'] ?? '', only_one: p['only-one'] ?? 'default' })}
                            >
                              <Icon name="edit" size={16} />
                            </button>
                            {!builtin ? (
                              <form className="inline-form" data-api="/api/json/pppoe/profile/delete" data-confirm={t('Delete this profile?')}>
                                <input type="hidden" name="id" value={p['.id']} />
                                <button className="btn btn-sm btn-ghost btn-icon" aria-label={t('Delete')} disabled={dis}>
                                  <Icon name="trash" size={16} />
                                </button>
                              </form>
                            ) : null}
                          </>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {w.show && !dis ? (
        <>
          <dialog className="modal" id="dlg-sec" aria-labelledby="dlg-sec-t">
            <form data-api="/api/json/pppoe/secret/save" autoComplete="off">
              <input type="hidden" name="id" />
              <ModalHead id="dlg-sec-t" title={t('PPPoE secret')} t={t} />
              <div className="modal-b">
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor="s-name">{t('Name')}</label>
                    <input className="input mono" id="s-name" name="name" required maxLength={64} autoCapitalize="off" />
                  </div>
                  <div className="field">
                    <label htmlFor="s-pass">{t('Password')}</label>
                    <input className="input mono" id="s-pass" name="password" maxLength={64} autoComplete="new-password" />
                    <p className="help" data-edit-only="" hidden>
                      {t('Leave blank to keep the current password.')}
                    </p>
                  </div>
                  <div className="field">
                    <label htmlFor="s-prof">{t('Profile')}</label>
                    <select className="select" id="s-prof" name="profile">
                      {profNames.map((pn) => (
                        <option key={pn}>{pn}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="s-svc">{t('Service')}</label>
                    <select className="select" id="s-svc" name="service">
                      {['pppoe', 'any', 'pptp', 'l2tp', 'sstp', 'ovpn'].map((sv) => (
                        <option key={sv}>{sv}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="s-cid">{t('Lock to MAC (caller-id)')}</label>
                    <input className="input mono" id="s-cid" name="caller_id" placeholder="AA:BB:CC:DD:EE:FF" />
                  </div>
                  <div className="field">
                    <label htmlFor="s-ra">{t('Fixed IP (remote address)')}</label>
                    <input className="input mono" id="s-ra" name="remote_address" placeholder="10.20.1.15" />
                  </div>
                  <div className="field">
                    <label htmlFor="s-la">{t('Local address')}</label>
                    <input className="input mono" id="s-la" name="local_address" />
                  </div>
                  <div className="field">
                    <label htmlFor="s-com">{t('Comment')}</label>
                    <input className="input" id="s-com" name="comment" />
                  </div>
                </div>
              </div>
              <ModalFoot t={t} />
            </form>
          </dialog>
          <dialog className="modal" id="dlg-prof" aria-labelledby="dlg-prof-t">
            <form data-api="/api/json/pppoe/profile/save">
              <input type="hidden" name="id" />
              <ModalHead id="dlg-prof-t" title={t('PPP profile')} t={t} />
              <div className="modal-b">
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor="pf-name">{t('Name')}</label>
                    <input className="input mono" id="pf-name" name="name" required maxLength={40} autoCapitalize="off" />
                  </div>
                  <div className="field">
                    <label htmlFor="pf-rate">{t('Rate limit')}</label>
                    <input className="input mono" id="pf-rate" name="rate_limit" placeholder="10M/10M" />
                  </div>
                  <div className="field">
                    <label htmlFor="pf-la">{t('Local address')}</label>
                    <input className="input mono" id="pf-la" name="local_address" placeholder="10.20.0.1" />
                  </div>
                  <div className="field">
                    <label htmlFor="pf-ra">{t('Remote address / pool')}</label>
                    <input className="input mono" id="pf-ra" name="remote_address" placeholder="pppoe-pool" />
                  </div>
                  <div className="field full">
                    <label htmlFor="pf-one">{t('Only one session per user')}</label>
                    <select className="select" id="pf-one" name="only_one">
                      <option value="default">default</option>
                      <option value="yes">yes</option>
                      <option value="no">no</option>
                    </select>
                  </div>
                </div>
              </div>
              <ModalFoot t={t} />
            </form>
          </dialog>
        </>
      ) : null}
    </>
  );
}
