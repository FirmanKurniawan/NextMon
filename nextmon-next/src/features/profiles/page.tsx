import { Icon } from '../../components/Icon';
import { money } from '../../lib/fmt.ts';
import { parseMeta } from '../../lib/scripts.ts';
import { getSettings } from '../../lib/store.ts';
import { isRo } from '../_kit/forms.ts';
import { Badge, CsrfField, Empty, NoRouter, PageHead, RoNotice } from '../_kit/ui.tsx';
import type { PageProps } from '../types.ts';

/** Port of HotspotController::profiles() + views/profiles.php. */
export default async function ProfilesPage({ ctx }: PageProps) {
  const t = ctx.t;
  if (!ctx.router) return <NoRouter t={t} />;
  const ro = isRo(ctx);
  const canW = ctx.can('write') && !ro;
  const cur = String(getSettings().currency || 'Rp');
  const got = await ctx.driver().printMany({ profiles: ['/ip/hotspot/user/profile'], users: ['/ip/hotspot/user', {}, ['profile']] });
  const rows = (got.profiles ?? []).map((p) => ({ p, m: parseMeta(p['on-login'] ?? '') }));
  const counts: Record<string, number> = {};
  for (const u of got.users ?? []) {
    const k = u.profile || 'default';
    counts[k] = (counts[k] ?? 0) + 1;
  }

  return (
    <>
      <PageHead title={t('User profiles')} desc={t('Rate limits, price, validity and the on-login script that records sales.')}>
        {canW ? (
          <button className="btn btn-primary" type="button" data-open="#dlg-prof" data-new>
            <Icon name="plus" size={16} />
            {t('Add profile')}
          </button>
        ) : null}
      </PageHead>
      {ro ? <RoNotice t={t} /> : null}

      <section className="card glass">
        {rows.length > 0 ? (
          <div className="tbl-tools">
            <input className="input search" type="search" placeholder={t('Filter this list')} data-filter="#prof-tbl" aria-label={t('Filter')} />
            <span className="spacer" />
          </div>
        ) : null}
        {rows.length === 0 ? (
          <Empty icon="tag" title={t('No profiles yet')} />
        ) : (
          <div className="table-wrap">
            <table className="tbl resp" id="prof-tbl">
              <thead>
                <tr>
                  <th data-sort>{t('Name')}</th>
                  <th>{t('Rate limit')}</th>
                  <th className="num">{t('Price')}</th>
                  <th>{t('Validity')}</th>
                  <th>{t('Expired mode')}</th>
                  <th>{t('Locks')}</th>
                  <th className="num">{t('Users')}</th>
                  <th>
                    <span className="sr-only">{t('Actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ p, m }) => {
                  const name = p.name ?? '';
                  const edit = {
                    id: p['.id'],
                    name,
                    rate_limit: p['rate-limit'] ?? '',
                    shared: p['shared-users'] ?? '1',
                    mode: m?.mode ?? 'none',
                    price: m?.price ?? '',
                    sprice: m?.sprice ?? '',
                    validity: m?.validity ?? '',
                    lock_user: m?.lock_user ? '1' : '',
                    lock_server: m?.lock_server ? '1' : '',
                    parent_queue: (p['parent-queue'] ?? '') === 'none' ? '' : (p['parent-queue'] ?? ''),
                    pool: p['address-pool'] ?? '',
                  };
                  return (
                    <tr key={p['.id']}>
                      <td data-label={t('Name')}>
                        <b>{name}</b>
                      </td>
                      <td data-label={t('Rate limit')} className="mono">
                        {p['rate-limit'] || '-'}
                      </td>
                      <td data-label={t('Price')} className="num">
                        {m && m.sprice !== '' ? money(m.sprice, cur) : '-'}
                      </td>
                      <td data-label={t('Validity')} className="mono">
                        {m?.validity || '-'}
                      </td>
                      <td data-label={t('Expired mode')}>{m ? <Badge kind={m.mode.includes('c') ? 'info' : 'neutral'}>{m.mode}</Badge> : <span className="muted">-</span>}</td>
                      <td data-label={t('Locks')}>
                        {m?.lock_user ? <Badge>MAC</Badge> : null}
                        {m?.lock_server ? (
                          <>
                            {' '}
                            <Badge>Server</Badge>
                          </>
                        ) : null}
                        {!m || (!m.lock_user && !m.lock_server) ? <span className="muted">-</span> : null}
                      </td>
                      <td data-label={t('Users')} className="num">
                        {counts[name] ?? 0}
                      </td>
                      <td className="actions" data-label="">
                        {canW ? (
                          <>
                            <button className="btn btn-sm btn-ghost btn-icon" type="button" aria-label={t('Edit')} data-open="#dlg-prof" data-edit={JSON.stringify(edit)}>
                              <Icon name="edit" size={16} />
                            </button>
                            {name !== 'default' ? (
                              <form className="inline-form" method="post" action="/hs/hotspot/profiles/delete" data-confirm={t('Delete profile :n?', { ':n': name })}>
                                <CsrfField ctx={ctx} />
                                <input type="hidden" name="id" value={p['.id']} />
                                <input type="hidden" name="name" value={name} />
                                <button className="btn btn-sm btn-danger btn-icon" aria-label={t('Delete')}>
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
        )}
      </section>

      {canW ? (
        <dialog className="modal wide" id="dlg-prof" aria-labelledby="dlg-prof-t">
          <form method="post" action="/hs/hotspot/profiles/save" data-preview-url="/hs/hotspot/profiles/preview">
            <CsrfField ctx={ctx} />
            <input type="hidden" name="id" />
            <div className="modal-h">
              <h2 id="dlg-prof-t">{t('User profile')}</h2>
              <button type="button" className="btn btn-ghost btn-icon" data-close aria-label={t('Close')}>
                <Icon name="x" />
              </button>
            </div>
            <div className="modal-b">
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="p-name">{t('Name')}</label>
                  <input className="input" id="p-name" name="name" required maxLength={40} />
                </div>
                <div className="field">
                  <label htmlFor="p-rate">{t('Rate limit (rx/tx)')}</label>
                  <input className="input mono" id="p-rate" name="rate_limit" placeholder="2M/2M" />
                </div>
                <div className="field">
                  <label htmlFor="p-shared">{t('Shared users')}</label>
                  <input className="input" id="p-shared" name="shared" type="number" min={1} defaultValue={1} />
                </div>
                <div className="field">
                  <label htmlFor="p-valid">{t('Validity')}</label>
                  <input className="input mono" id="p-valid" name="validity" placeholder="1d" autoCapitalize="off" />
                  <p className="help">{t('Active period counted from first login, e.g. 3h, 1d, 30d.')}</p>
                </div>
                <div className="field">
                  <label htmlFor="p-price">{t('Price')}</label>
                  <input className="input" id="p-price" name="price" inputMode="numeric" placeholder="5000" />
                </div>
                <div className="field">
                  <label htmlFor="p-sprice">{t('Selling price')}</label>
                  <input className="input" id="p-sprice" name="sprice" inputMode="numeric" placeholder={t('same as price')} />
                </div>
                <div className="field full">
                  <label htmlFor="p-mode">{t('Expired mode')}</label>
                  <select className="select" id="p-mode" name="mode">
                    <option value="remc">{t('remc - remove on expiry + record sale')}</option>
                    <option value="rem">{t('rem - remove on expiry')}</option>
                    <option value="ntfc">{t('ntfc - keep user, block login + record sale')}</option>
                    <option value="ntf">{t('ntf - keep user, block login')}</option>
                    <option value="none">{t('none - no script')}</option>
                  </select>
                </div>
                <div className="field">
                  <label className="switch">
                    <input type="checkbox" name="lock_user" value="1" />
                    <span className="track" />
                    <span>{t('Lock user to first MAC')}</span>
                  </label>
                </div>
                <div className="field">
                  <label className="switch">
                    <input type="checkbox" name="lock_server" value="1" />
                    <span className="track" />
                    <span>{t('Lock to hotspot server')}</span>
                  </label>
                </div>
                <div className="field">
                  <label htmlFor="p-queue">{t('Parent queue')}</label>
                  <input className="input" id="p-queue" name="parent_queue" />
                </div>
                <div className="field">
                  <label htmlFor="p-pool">{t('Address pool')}</label>
                  <input className="input" id="p-pool" name="pool" />
                </div>
                <div className="full">
                  <button type="button" className="btn btn-sm" data-preview-script>
                    <Icon name="terminal" size={16} />
                    {t('Preview on-login script')}
                  </button>
                  <pre className="out" id="script-out" hidden style={{ marginTop: 'var(--s2)' }} />
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
