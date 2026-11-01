import { Icon } from '../../components/Icon';
import { isRo } from '../_kit/forms.ts';
import { Badge, CsrfField, Empty, NoRouter, PageHead, RoNotice } from '../_kit/ui.tsx';
import type { PageProps } from '../types.ts';

const KIND: Record<string, string> = { bypassed: 'ok', blocked: 'err' };

/** Port of HotspotController::bindings() + views/bindings.php. */
export default async function BindingsPage({ ctx }: PageProps) {
  const t = ctx.t;
  if (!ctx.router) return <NoRouter t={t} />;
  const ro = isRo(ctx);
  const canW = ctx.can('write') && !ro;
  const rows = await ctx.driver().print('/ip/hotspot/ip-binding');
  return (
    <>
      <PageHead title={t('IP bindings')} desc={t('Bypass or block devices by MAC or address without a login.')}>
        {canW ? (
          <button className="btn btn-primary" type="button" data-open="#dlg-bind" data-new>
            <Icon name="plus" size={16} />
            {t('Add binding')}
          </button>
        ) : null}
      </PageHead>
      {ro ? <RoNotice t={t} /> : null}
      <section className="card glass">
        <form method="post" action="/hs/hotspot/bindings/action" data-bulk>
          <CsrfField ctx={ctx} />
          <div className="tbl-tools">
            <input className="input search" type="search" placeholder={t('Filter this list')} data-filter="#bind-tbl" aria-label={t('Filter')} />
            <span className="spacer" />
          </div>
          <div className="sel-bar" data-sel-bar hidden>
            <span data-sel-count />
            <span className="spacer" />
            {canW ? (
              <>
                <button className="btn btn-sm" name="action" value="enable">
                  {t('Enable')}
                </button>
                <button className="btn btn-sm" name="action" value="disable">
                  {t('Disable')}
                </button>
                <button className="btn btn-sm btn-danger" name="action" value="remove" data-confirm={t('Remove the selected bindings?')}>
                  <Icon name="trash" size={16} />
                  {t('Remove')}
                </button>
              </>
            ) : null}
          </div>
          {rows.length === 0 ? (
            <Empty icon="link" title={t('No bindings')} />
          ) : (
            <div className="table-wrap">
              <table className="tbl resp" id="bind-tbl">
                <thead>
                  <tr>
                    <th className="cell-chk">
                      <input type="checkbox" data-check-all aria-label={t('Select all')} />
                    </th>
                    <th>MAC</th>
                    <th>{t('IP address')}</th>
                    <th data-sort data-chip>
                      {t('Type')}
                    </th>
                    <th>Server</th>
                    <th data-sort data-chip>
                      {t('Status')}
                    </th>
                    <th>{t('Comment')}</th>
                    <th>
                      <span className="sr-only">{t('Actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((b) => {
                    const type = b.type || 'regular';
                    const edit = { id: b['.id'], mac: b['mac-address'] ?? '', address: b.address ?? '', to_address: b['to-address'] ?? '', server: b.server ?? 'all', type, comment: b.comment ?? '' };
                    return (
                      <tr key={b['.id']}>
                        <td className="cell-chk" data-label="">
                          <input type="checkbox" name="ids[]" value={b['.id']} aria-label={b.address ?? b['mac-address'] ?? ''} />
                        </td>
                        <td data-label="MAC" className="mono">
                          {b['mac-address'] || '-'}
                        </td>
                        <td data-label={t('IP address')} className="mono">
                          {b.address || '-'}
                        </td>
                        <td data-label={t('Type')}>
                          <Badge kind={KIND[type] ?? 'neutral'}>{type}</Badge>
                        </td>
                        <td data-label="Server">{b.server ?? 'all'}</td>
                        <td data-label={t('Status')}>{b.disabled === 'true' || b.disabled === 'yes' ? <Badge kind="warn">{t('Disabled')}</Badge> : <Badge kind="ok">{t('Active')}</Badge>}</td>
                        <td data-label={t('Comment')} className="wrap muted">
                          {b.comment ?? ''}
                        </td>
                        <td className="actions" data-label="">
                          {canW ? (
                            <button className="btn btn-sm btn-ghost btn-icon" type="button" aria-label={t('Edit')} data-open="#dlg-bind" data-edit={JSON.stringify(edit)}>
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
          )}
        </form>
      </section>
      {canW ? (
        <dialog className="modal" id="dlg-bind" aria-labelledby="dlg-bind-t">
          <form method="post" action="/hs/hotspot/bindings/save">
            <CsrfField ctx={ctx} />
            <input type="hidden" name="id" />
            <div className="modal-h">
              <h2 id="dlg-bind-t">{t('IP binding')}</h2>
              <button type="button" className="btn btn-ghost btn-icon" data-close aria-label={t('Close')}>
                <Icon name="x" />
              </button>
            </div>
            <div className="modal-b">
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="b-mac">MAC</label>
                  <input className="input mono" id="b-mac" name="mac" placeholder="AA:BB:CC:DD:EE:FF" />
                </div>
                <div className="field">
                  <label htmlFor="b-addr">{t('IP address')}</label>
                  <input className="input mono" id="b-addr" name="address" />
                </div>
                <div className="field">
                  <label htmlFor="b-to">{t('To address')}</label>
                  <input className="input mono" id="b-to" name="to_address" />
                </div>
                <div className="field">
                  <label htmlFor="b-srv">Server</label>
                  <input className="input" id="b-srv" name="server" defaultValue="all" />
                </div>
                <div className="field full">
                  <label htmlFor="b-type">{t('Type')}</label>
                  <select className="select" id="b-type" name="type">
                    <option value="bypassed">bypassed</option>
                    <option value="regular">regular</option>
                    <option value="blocked">blocked</option>
                  </select>
                </div>
                <div className="field full">
                  <label htmlFor="b-com">{t('Comment')}</label>
                  <input className="input" id="b-com" name="comment" />
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
