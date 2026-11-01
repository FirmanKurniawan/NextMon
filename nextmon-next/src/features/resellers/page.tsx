import { Icon } from '../../components/Icon';
import { money } from '../../lib/fmt.ts';
import { Reseller } from '../../lib/reseller.ts';
import { Users } from '../../lib/users.ts';
import { currencyOf, profilePrices } from '../_sales/common.ts';
import ActionForm from '../_sales/ActionForm';
import Flash from '../_sales/Flash.tsx';
import { Badge, Empty, PageHead } from '../_sales/ui';
import type { PageProps } from '../types.ts';
import { Shop } from '../shop/config.ts';
import { fundReseller, saveRef, saveReseller } from './actions.ts';
import { Assets, pct } from './ui.tsx';

/** /resellers: resellers of this workspace with balance, commission and the top-up / settings dialogs. */
export default async function ResellersPage({ ctx, searchParams }: PageProps) {
  const t = ctx.t;
  const cur = currencyOf();
  const bal = Reseller.balances();
  const list = Users.inWorkspace(ctx.workspace.id)
    .filter((u) => u.role === 'reseller')
    .map((u) => ({ u, cfg: Reseller.cfg(u.id), bal: bal[u.id] ?? 0 }));
  const total = list.reduce((a, x) => a + x.bal, 0);
  const prices = ctx.router ? await profilePrices(ctx.driver()) : {};
  return (
    <>
      <Assets />
      <Flash ctx={ctx} value={searchParams.flash} />
      <PageHead title={t('Resellers')} desc={t('Agents with a prepaid balance. Their voucher and POS sales are paid from the wallet.')}>
        <a className="btn" href="/resellers/ledger">
          <Icon name="list" size={16} />
          {t('Ledger')}
        </a>
        <a className="btn" href="/settings#users">
          <Icon name="plus" size={16} />
          {t('Add reseller user')}
        </a>
      </PageHead>

      <div className="grid" style={{ marginBottom: 'var(--s4)' }}>
        <section className="card glass col-4">
          <div className="card-b">
            <div className="stat-label">{t('Resellers')}</div>
            <div className="stat-value">{list.length}</div>
          </div>
        </section>
        <section className="card glass col-4">
          <div className="card-b">
            <div className="stat-label">{t('Total wallet balance')}</div>
            <div className="stat-value rs-balance">{money(total, cur)}</div>
          </div>
        </section>
      </div>

      <section className="card glass">
        {list.length === 0 ? (
          <div className="card-b">
            <Empty icon="users" title={t('No reseller users yet')} text={t('Create a user with the Reseller role in Settings, then set up the wallet here.')}>
              <a className="btn btn-primary" href="/settings#users">
                {t('Users and roles')}
              </a>
            </Empty>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="tbl resp">
              <thead>
                <tr>
                  <th>{t('Reseller')}</th>
                  <th>{t('Status')}</th>
                  <th className="num">{t('Balance')}</th>
                  <th className="num">{t('Commission')}</th>
                  <th className="num">{t('Price adj.')}</th>
                  <th>{t('Profiles')}</th>
                  <th>{t('Shop referral')}</th>
                  <th>
                    <span className="sr-only">{t('Actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map(({ u, cfg: c, bal: b }) => {
                  const d = c ?? Reseller.defaults();
                  const edit = JSON.stringify({ id: u.id, username: u.username, active: d.active, commission: d.commission, adj: d.adj, credit: d.credit, allow_all: d.allow_all, profiles: d.profiles });
                  return (
                    <tr key={u.id}>
                      <td data-label={t('Reseller')}>
                        <b>{u.username}</b>
                      </td>
                      <td data-label={t('Status')}>{!c ? <Badge kind="warn">{t('Not set up')}</Badge> : c.active ? <Badge kind="ok">{t('Active')}</Badge> : <Badge kind="err">{t('Disabled')}</Badge>}</td>
                      <td data-label={t('Balance')} className={'num mono rs-balance' + (b < 0 ? ' rs-neg' : '')}>
                        {money(b, cur)}
                      </td>
                      <td data-label={t('Commission')} className="num">
                        {pct(d.commission)}%
                      </td>
                      <td data-label={t('Price adj.')} className="num">
                        {(d.adj > 0 ? '+' : '') + pct(d.adj)}%
                      </td>
                      <td data-label={t('Profiles')} className="wrap">
                        {d.allow_all ? <span className="muted">{t('All')}</span> : Object.keys(d.profiles).join(', ') || '-'}
                      </td>
                      <td data-label={t('Shop referral')} className="wrap">
                        <ActionForm action={saveRef} className="row">
                          <input type="hidden" name="_csrf" value={ctx.csrf} />
                          <input type="hidden" name="id" value={u.id} />
                          <input className="input input-sm mono" name="ref" defaultValue={c?.ref ?? ''} maxLength={24} pattern="[a-z0-9][a-z0-9\-]{2,23}" placeholder={t('code')} aria-label={t('Referral code')} style={{ width: '9rem' }} />
                          <button className="btn btn-sm">{t('Save')}</button>
                        </ActionForm>
                        {c?.ref ? <div className="help mono">{'/shop' + Shop.wQuery() + (Shop.wQuery() === '' ? '?' : '&') + 'ref=' + c.ref}</div> : null}
                      </td>
                      <td className="actions" data-label="">
                        <button className="btn btn-sm btn-primary" type="button" data-open="#dlg-fund" data-rs-fund={u.id} data-name={u.username}>
                          <Icon name="plus" size={16} />
                          <span className="hide-m">{t('Top up')}</span>
                        </button>
                        <button className="btn btn-sm" type="button" data-open="#dlg-rs" data-rs-edit={edit}>
                          <Icon name="edit" size={16} />
                          <span className="hide-m">{t('Edit')}</span>
                        </button>
                        <a className="btn btn-sm btn-ghost" href={'/resellers/ledger?uid=' + encodeURIComponent(u.id)}>
                          {t('Ledger')}
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <dialog className="modal" id="dlg-fund" aria-labelledby="fund-t">
        <ActionForm action={fundReseller}>
          <input type="hidden" name="_csrf" value={ctx.csrf} />
          <input type="hidden" name="id" />
          <div className="modal-h">
            <h2 id="fund-t">
              {t('Top up / adjust')}: <span data-rs-title />
            </h2>
            <button type="button" className="btn btn-ghost btn-icon" data-close aria-label={t('Close')}>
              <Icon name="x" />
            </button>
          </div>
          <div className="modal-b">
            <div className="form-grid">
              <div className="field">
                <label htmlFor="f-kind">{t('Type')}</label>
                <select className="select" id="f-kind" name="kind">
                  <option value="topup">{t('Top up (add balance)')}</option>
                  <option value="adjustment">{t('Adjustment (+ or -)')}</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="f-amt">{t('Amount')}</label>
                <input className="input mono" id="f-amt" name="amount" inputMode="numeric" required placeholder="50000" />
              </div>
              <div className="field full">
                <label htmlFor="f-note">{t('Note')}</label>
                <input className="input" id="f-note" name="note" maxLength={200} placeholder={t('e.g. bank transfer 1 Nov')} />
                <p className="help">{t('Required for adjustments. Entries cannot be edited or deleted; correct mistakes with a new adjustment.')}</p>
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

      <dialog className="modal" id="dlg-rs" aria-labelledby="rs-t">
        <ActionForm action={saveReseller}>
          <input type="hidden" name="_csrf" value={ctx.csrf} />
          <input type="hidden" name="id" />
          <div className="modal-h">
            <h2 id="rs-t">
              {t('Reseller settings')}: <span data-rs-title />
            </h2>
            <button type="button" className="btn btn-ghost btn-icon" data-close aria-label={t('Close')}>
              <Icon name="x" />
            </button>
          </div>
          <div className="modal-b">
            <div className="form-grid">
              <div className="field full">
                <label className="switch">
                  <input type="checkbox" name="active" value="1" />
                  <span className="track" />
                  <span>{t('Active (can sell)')}</span>
                </label>
              </div>
              <div className="field">
                <label htmlFor="r-com">{t('Commission (%)')}</label>
                <input className="input" id="r-com" name="commission" type="number" step="0.01" min="0" max="100" defaultValue="0" />
                <p className="help">{t('Credited to the wallet on every sale, % of the customer price.')}</p>
              </div>
              <div className="field">
                <label htmlFor="r-adj">{t('Price markup / discount (%)')}</label>
                <input className="input" id="r-adj" name="adj" type="number" step="0.01" min="-100" max="1000" defaultValue="0" />
                <p className="help">{t('What the reseller pays vs the customer price. -10 = 10% discount, +5 = 5% markup.')}</p>
              </div>
              <div className="field">
                <label htmlFor="r-cr">{t('Credit limit')}</label>
                <input className="input" id="r-cr" name="credit" type="number" min="0" step="1" defaultValue="0" />
                <p className="help">{t('How far below zero the balance may go. 0 = prepaid only.')}</p>
              </div>
              <div className="field full">
                <label className="switch">
                  <input type="checkbox" name="allow_all" value="1" defaultChecked />
                  <span className="track" />
                  <span>{t('May sell all profiles')}</span>
                </label>
              </div>
              <div className="field full">
                <label>{t('Allowed profiles (when not all) with optional own markup/discount %')}</label>
                {Object.keys(prices).length === 0 ? (
                  <p className="muted">{t('No priced profiles found (router unreachable?).')}</p>
                ) : (
                  <div className="rs-profiles">
                    {Object.entries(prices).map(([name, base]) => (
                      <label key={name} data-prof={name}>
                        <input type="checkbox" name={`prof[${name}]`} value="1" />
                        <span>
                          {name} <span className="muted">{money(base, cur)}</span>
                        </span>
                        <input className="input input-sm" type="number" step="0.01" min="-100" max="1000" name={`padj[${name}]`} placeholder="%" aria-label={`${t('Adjustment')} ${name}`} />
                      </label>
                    ))}
                  </div>
                )}
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
    </>
  );
}
