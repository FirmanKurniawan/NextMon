import { Icon } from '../../components/Icon';
import { fmtBytes } from '../../lib/fmt.ts';
import { Badge, Empty, ModalFoot, ModalHead, NetAssets, NoRouter, PageHead, RoNotice } from '../_netkit/ui';
import { access, isTrue } from '../_netkit/util.ts';
import type { PageProps } from '../types.ts';

export default async function QueuesPage({ ctx }: PageProps) {
  const t = ctx.t;
  if (!ctx.router) return <NoRouter t={t} />;
  const w = access(ctx);
  const rows = await ctx.driver().print('/queue/simple');
  return (
    <>
      <NetAssets />
      <PageHead title={t('Queues')} desc={t('Simple queues: limit bandwidth per IP or network.')}>
        {w.show ? (
          <button className="btn btn-primary" type="button" data-open="#dlg-queue" data-new="" disabled={w.dis}>
            <Icon name="plus" size={16} />
            {t('Add queue')}
          </button>
        ) : null}
      </PageHead>
      {w.show && w.ro ? <RoNotice t={t} /> : null}
      <section className="card glass">
        <form data-api="/api/json/queues/action" data-bulk="">
          <div className="sel-bar" data-sel-bar="" hidden>
            <span data-sel-count="" />
            <span className="spacer" />
            {w.show ? (
              <>
                <button className="btn btn-sm" name="action" value="enable" disabled={w.dis}>
                  {t('Enable')}
                </button>
                <button className="btn btn-sm" name="action" value="disable" disabled={w.dis}>
                  {t('Disable')}
                </button>
                <button className="btn btn-sm btn-danger" name="action" value="remove" data-confirm={t('Remove the selected queues?')} disabled={w.dis}>
                  <Icon name="trash" size={16} />
                  {t('Remove')}
                </button>
              </>
            ) : null}
          </div>
          {rows.length === 0 ? (
            <Empty icon="layers" title={t('No queues')} />
          ) : (
            <div className="table-wrap">
              <table className="tbl resp">
                <thead>
                  <tr>
                    <th className="cell-chk">
                      <input type="checkbox" data-check-all="" aria-label={t('Select all')} />
                    </th>
                    <th data-sort="">{t('Name')}</th>
                    <th>{t('Target')}</th>
                    <th>{t('Max limit (up/down)')}</th>
                    <th>{t('Traffic (up/down)')}</th>
                    <th>{t('Status')}</th>
                    <th>
                      <span className="sr-only">{t('Actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((q) => {
                    const b = (q.bytes ?? '0/0').split('/');
                    return (
                      <tr key={q['.id']}>
                        <td className="cell-chk" data-label="">
                          <input type="checkbox" name="ids[]" value={q['.id']} aria-label={q.name} />
                        </td>
                        <td data-label={t('Name')}>
                          <b>{q.name}</b> {q.comment ? <span className="muted">{q.comment}</span> : null}
                        </td>
                        <td data-label={t('Target')} className="mono wrap">
                          {q.target}
                        </td>
                        <td data-label={t('Max limit (up/down)')} className="mono">
                          {q['max-limit']}
                        </td>
                        <td data-label={t('Traffic (up/down)')} className="mono nowrap">
                          {fmtBytes(b[0] ?? 0)} / {fmtBytes(b[1] ?? 0)}
                        </td>
                        <td data-label={t('Status')}>{isTrue(q.disabled) ? <Badge kind="warn">{t('Disabled')}</Badge> : <Badge kind="ok">{t('Active')}</Badge>}</td>
                        <td className="actions" data-label="">
                          {w.show ? (
                            <button className="btn btn-sm btn-ghost btn-icon" type="button" aria-label={t('Edit')} disabled={w.dis} data-open="#dlg-queue" data-edit={JSON.stringify({ id: q['.id'], name: q.name ?? '', target: q.target ?? '', max_limit: q['max-limit'] ?? '', comment: q.comment ?? '' })}>
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
      {w.show && !w.dis ? (
        <dialog className="modal" id="dlg-queue" aria-labelledby="dlg-queue-t">
          <form data-api="/api/json/queues/save">
            <input type="hidden" name="id" />
            <ModalHead id="dlg-queue-t" title={t('Simple queue')} t={t} />
            <div className="modal-b">
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="q-name">{t('Name')}</label>
                  <input className="input" id="q-name" name="name" required maxLength={40} />
                </div>
                <div className="field">
                  <label htmlFor="q-target">{t('Target')}</label>
                  <input className="input mono" id="q-target" name="target" required placeholder="10.5.50.2/32" />
                </div>
                <div className="field">
                  <label htmlFor="q-max">{t('Max limit (up/down)')}</label>
                  <input className="input mono" id="q-max" name="max_limit" required placeholder="5M/5M" defaultValue="5M/5M" />
                </div>
                <div className="field">
                  <label htmlFor="q-com">{t('Comment')}</label>
                  <input className="input" id="q-com" name="comment" />
                </div>
              </div>
            </div>
            <ModalFoot t={t} />
          </form>
        </dialog>
      ) : null}
    </>
  );
}
