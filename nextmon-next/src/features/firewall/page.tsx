import { Icon } from '../../components/Icon';
import { Badge, Empty, ModalHead, NetAssets, NoRouter, PageHead, RoNotice } from '../_netkit/ui';
import { access } from '../_netkit/util.ts';
import type { PageProps } from '../types.ts';
import { BLOCK_LIST } from './api.ts';

export default async function FirewallPage({ ctx }: PageProps) {
  const t = ctx.t;
  if (!ctx.router) return <NoRouter t={t} />;
  const w = access(ctx);
  const r = ctx.driver();
  const [rows, rule] = await Promise.all([r.print('/ip/firewall/address-list'), r.print('/ip/firewall/filter', { comment: BLOCK_LIST }, ['comment'])]);
  const hasRule = rule.length > 0;
  return (
    <>
      <NetAssets />
      <PageHead title={t('Firewall address list')} desc={t('Block or allow addresses with firewall address-lists.')}>
        {w.show ? (
          <button className="btn btn-primary" type="button" data-open="#dlg-fw" data-new="" disabled={w.dis}>
            <Icon name="ban" size={16} />
            {t('Block address')}
          </button>
        ) : null}
      </PageHead>
      {w.show && w.ro ? <RoNotice t={t} /> : null}
      {!hasRule ? (
        <div className="alert warn" style={{ marginBottom: 'var(--s4)' }}>
          <Icon name="alert" size={18} />
          <div style={{ flex: 1 }}>{t('List "nextmon-block" has no drop rule yet, so blocked addresses are not enforced.')}</div>
          {ctx.can('admin') ? (
            <form data-api="/api/json/firewall/rule">
              <button className="btn btn-sm" disabled={w.dis}>
                {t('Install drop rule')}
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
      <section className="card glass">
        <form data-api="/api/json/firewall/remove" data-bulk="">
          <div className="tbl-tools">
            <input className="input search" type="search" placeholder={t('Filter this list')} data-filter="#fw-tbl" aria-label={t('Filter')} />
          </div>
          <div className="sel-bar" data-sel-bar="" hidden>
            <span data-sel-count="" />
            <span className="spacer" />
            {w.show ? (
              <button className="btn btn-sm btn-danger" data-confirm={t('Remove the selected entries?')} disabled={w.dis}>
                <Icon name="trash" size={16} />
                {t('Remove')}
              </button>
            ) : null}
          </div>
          {rows.length === 0 ? (
            <Empty icon="shield" title={t('No entries')} />
          ) : (
            <div className="table-wrap">
              <table className="tbl resp" id="fw-tbl">
                <thead>
                  <tr>
                    <th className="cell-chk">
                      <input type="checkbox" data-check-all="" aria-label={t('Select all')} />
                    </th>
                    <th data-sort="">{t('List')}</th>
                    <th data-sort="">{t('Address')}</th>
                    <th>{t('Timeout')}</th>
                    <th>{t('Comment')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={a['.id']}>
                      <td className="cell-chk" data-label="">
                        <input type="checkbox" name="ids[]" value={a['.id']} aria-label={a.address} />
                      </td>
                      <td data-label={t('List')}>
                        <Badge kind={a.list === BLOCK_LIST ? 'err' : 'neutral'}>{a.list ?? ''}</Badge>
                      </td>
                      <td data-label={t('Address')} className="mono">
                        {a.address}
                      </td>
                      <td data-label={t('Timeout')} className="mono">
                        {a.timeout || '-'}
                      </td>
                      <td data-label={t('Comment')} className="wrap muted">
                        {a.comment}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </form>
      </section>
      {w.show && !w.dis ? (
        <dialog className="modal" id="dlg-fw" aria-labelledby="dlg-fw-t">
          <form data-api="/api/json/firewall/add">
            <ModalHead id="dlg-fw-t" title={t('Add to address list')} t={t} />
            <div className="modal-b">
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="f-list">{t('List')}</label>
                  <input className="input mono" id="f-list" name="list" defaultValue={BLOCK_LIST} required />
                </div>
                <div className="field">
                  <label htmlFor="f-addr">{t('Address')}</label>
                  <input className="input mono" id="f-addr" name="address" required placeholder="10.5.50.77" />
                </div>
                <div className="field">
                  <label htmlFor="f-to">{t('Timeout')}</label>
                  <input className="input mono" id="f-to" name="timeout" placeholder="1d" autoCapitalize="off" />
                  <p className="help">{t('Empty = permanent.')}</p>
                </div>
                <div className="field">
                  <label htmlFor="f-com">{t('Comment')}</label>
                  <input className="input" id="f-com" name="comment" />
                </div>
              </div>
            </div>
            <div className="modal-f">
              <button type="button" className="btn" data-close="">
                {t('Cancel')}
              </button>
              <button className="btn btn-primary">{t('Add')}</button>
            </div>
          </form>
        </dialog>
      ) : null}
    </>
  );
}
