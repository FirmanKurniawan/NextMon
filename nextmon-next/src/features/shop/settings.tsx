import { headers } from 'next/headers';
import { Icon } from '../../components/Icon';
import { Routers } from '../../lib/routers.ts';
import { getSettings } from '../../lib/store.ts';
import ActionForm from '../_sales/ActionForm';
import Flash from '../_sales/Flash.tsx';
import { PageHead } from '../_sales/ui';
import type { PageProps } from '../types.ts';
import { saveShopSettings } from './actions.ts';
import { Shop } from './config.ts';
import type { Package } from './config.ts';
import { Payments } from './gateways.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

type Row = { id: string; profile: string; price: number | ''; label: string; badge: string; desc: string; active: boolean };
const blank = (): Row => ({ id: '', profile: '', price: '', label: '', badge: '', desc: '', active: true });

/** Static HTML of one package row for the "Add row" template (the shared mod-shop.js clones it and renumbers [9999]). */
function rowHtml(i: number, p: Row, t: (k: string) => string): string {
  const inp = (key: string, label: string, extra = '', cls = '') =>
    `<td data-label="${esc(label)}"><input class="input input-sm${cls}" aria-label="${esc(label)}" name="pkg[${i}][${key}]" value="${esc(String((p as Record<string, unknown>)[key] ?? ''))}" ${extra}></td>`;
  return (
    `<tr class="shp-prow"><td data-label="${esc(t('Profile'))}"><input type="hidden" name="pkg[${i}][id]" value="${esc(p.id)}">` +
    `<input class="input input-sm" aria-label="${esc(t('Profile'))}" name="pkg[${i}][profile]" list="shp-profiles" value="${esc(p.profile)}" placeholder="${esc(t('Hotspot profile'))}"></td>` +
    inp('price', t('Price'), 'inputmode="numeric" placeholder="5000" style="min-width:90px"', ' mono') +
    inp('label', t('Label'), `maxlength="40" placeholder="1 Jam"`) +
    inp('badge', t('Badge'), `maxlength="16" placeholder="${esc(t('Popular'))}"`) +
    inp('desc', t('Description'), 'maxlength="100"') +
    `<td data-label="${esc(t('Active'))}"><label class="check"><input type="checkbox" name="pkg[${i}][active]" value="1"${p.active ? ' checked' : ''}><span class="sr-only">${esc(t('Active'))}</span></label></td></tr>`
  );
}

/** /shop/settings (admin): general, payment, gateway credentials (encrypted), packages. */
export default async function ShopSettingsPage({ ctx, searchParams }: PageProps) {
  const t = ctx.t;
  const c = Shop.config();
  const routers = Routers.list().filter((r) => !r.shared || r.mode === 'rw');
  const active = Shop.router(c);
  const profiles: string[] = [];
  if (active) {
    try {
      for (const p of await Routers.driver(active.id).print('/ip/hotspot/user/profile', {}, ['name'])) if (p.name && p.name !== 'default') profiles.push(p.name);
    } catch {
      // router offline: the field falls back to free text
    }
  }
  const origin = Shop.origin(await headers());
  const rows: Row[] = [...c.packages.map((p: Package) => ({ ...p })), blank(), blank(), blank()];
  const home = Shop.homePath();
  const hotspotName = String(getSettings().hotspot_name || 'NextMON WiFi');
  const gws = Payments.all();
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-css-tags */}
      <link rel="stylesheet" href="/assets/css/mod-shop.css" precedence="default" />
      <Flash ctx={ctx} value={searchParams.flash} />
      <PageHead title={t('Shop settings')} desc={t('Configure the public shop at /shop: packages, payment gateway, branding.')}>
        <a className="btn" href={home} target="_blank" rel="noopener">
          <Icon name="globe" size={16} />
          {t('Open shop')}
        </a>
        <a className="btn" href="/orders">
          <Icon name="list" size={16} />
          {t('Online orders')}
        </a>
      </PageHead>

      <ActionForm action={saveShopSettings} className="stack">
        <input type="hidden" name="_csrf" value={ctx.csrf} />
        <div className="grid">
          <section className="card glass col-6">
            <div className="card-h">
              <h2>{t('General')}</h2>
            </div>
            <div className="card-b stack">
              <label className="switch">
                <input type="checkbox" name="enabled" value="1" defaultChecked={c.enabled} />
                <span className="track" />
                <span>{t('Shop is open to the public')}</span>
              </label>
              <div className="field">
                <label htmlFor="s-title">{t('Shop name')}</label>
                <input className="input" id="s-title" name="title" defaultValue={c.title} maxLength={60} placeholder={hotspotName} />
              </div>
              <div className="field">
                <label htmlFor="s-tag">{t('Headline')}</label>
                <input className="input" id="s-tag" name="tagline" defaultValue={c.tagline} maxLength={160} placeholder={t('Buy WiFi access')} />
              </div>
              <div className="field">
                <label htmlFor="s-router">{t('Create vouchers on router')}</label>
                <select className="select" id="s-router" name="router" defaultValue={active?.id ?? ''}>
                  {routers.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="s-exp">{t('Order expires after (minutes)')}</label>
                  <input className="input mono" id="s-exp" name="expiry_minutes" type="number" min={5} max={1440} defaultValue={Math.trunc(c.expiry_minutes)} />
                </div>
                <div className="field">
                  <label htmlFor="s-lim">{t('Max orders per IP / 10 min')}</label>
                  <input className="input mono" id="s-lim" name="order_limit" type="number" min={1} max={50} defaultValue={Math.trunc(c.order_limit)} />
                </div>
              </div>
              <label className="switch">
                <input type="checkbox" name="require_phone" value="1" defaultChecked={c.require_phone} />
                <span className="track" />
                <span>{t('Require phone number')}</span>
              </label>
              <div className="field">
                <label htmlFor="s-terms">{t('Terms and conditions')}</label>
                <textarea className="textarea" id="s-terms" name="terms" rows={5} maxLength={3000} style={{ height: 'auto' }} defaultValue={c.terms} />
                <p className="help">{t('Leave empty to hide the terms checkbox.')}</p>
              </div>
            </div>
          </section>

          <section className="card glass col-6">
            <div className="card-h">
              <h2>{t('Payment')}</h2>
            </div>
            <div className="card-b stack">
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="s-gw">{t('Gateway')}</label>
                  <select className="select" id="s-gw" name="gateway" defaultValue={c.gateway}>
                    {gws.map((g) => (
                      <option key={g.id} value={g.id}>
                        {t(g.label)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="s-env">{t('Mode')}</label>
                  <select className="select" id="s-env" name="env" defaultValue={c.env}>
                    <option value="sandbox">Sandbox</option>
                    <option value="production">Production</option>
                  </select>
                </div>
              </div>
              {c.gateway === 'mock' ? (
                <div className="alert warn">
                  <Icon name="alert" size={18} />
                  <div>{t('The demo gateway lets anyone with a link "pay" for free. Use it only on a private test install, never on a public server.')}</div>
                </div>
              ) : null}
              <div className="field">
                <label htmlFor="s-ins">{t('Manual transfer instructions')}</label>
                <textarea className="textarea" id="s-ins" name="instructions" rows={4} maxLength={1000} style={{ height: 'auto' }} placeholder="BCA 123456789 a.n. ..." defaultValue={c.instructions} />
                <p className="help">{t('Shown to the customer when the gateway is manual transfer.')}</p>
              </div>
              <div className="field">
                <label htmlFor="s-ips">{t('Allowed callback IPs (optional)')}</label>
                <textarea className="textarea mono" id="s-ips" name="callback_ips" rows={2} style={{ height: 'auto' }} placeholder="203.0.113.10, 198.51.100.0/24" defaultValue={c.callback_ips} />
                <p className="help">{t('If set, webhooks from other addresses are rejected. Signatures are always checked as well. Behind a proxy this sees the proxy address.')}</p>
              </div>
            </div>
          </section>

          <section className="card glass col-12">
            <div className="card-h">
              <h2>{t('Gateway credentials')}</h2>
              <span className="muted">{t('Stored encrypted. Leave a secret blank to keep the saved one.')}</span>
            </div>
            <div className="card-b grid">
              {gws
                .filter((g) => g.fields.length > 0)
                .map((g) => (
                  <div className="col-4 stack" style={{ gap: 'var(--s3)' }} key={g.id}>
                    <b>{t(g.label)}</b>
                    {g.fields.map((f) => {
                      const saved = String(c.gw[g.id]?.[f.key] ?? '') !== '';
                      return (
                        <div className="field" key={f.key}>
                          <label htmlFor={`g-${g.id}${f.key}`}>{t(f.label)}</label>
                          {f.secret ? (
                            <input className="input mono" id={`g-${g.id}${f.key}`} name={`gw[${g.id}][${f.key}]`} autoComplete="off" type="password" placeholder={saved ? t('(saved - leave blank to keep)') : ''} />
                          ) : (
                            <input className="input mono" id={`g-${g.id}${f.key}`} name={`gw[${g.id}][${f.key}]`} autoComplete="off" type="text" defaultValue={c.gw[g.id]?.[f.key] ?? ''} />
                          )}
                          {f.help ? <p className="help">{t(f.help)}</p> : null}
                        </div>
                      );
                    })}
                    <div className="field">
                      <label htmlFor={`cb-${g.id}`}>{t('Callback (webhook) URL')}</label>
                      <input className="input mono" id={`cb-${g.id}`} readOnly value={Shop.callbackUrl(origin, g.id)} data-autoselect />
                    </div>
                  </div>
                ))}
            </div>
            <p className="help" style={{ padding: '0 var(--s4) var(--s4)' }}>
              {t('Gateways call your server, so the URL must be reachable from the internet (HTTPS recommended). Live gateway calls have not been tested against the real services.')}
            </p>
          </section>

          <section className="card glass col-12">
            <div className="card-h">
              <h2>{t('Packages')}</h2>
              <button className="btn btn-sm" type="button" data-shp-addrow>
                <Icon name="plus" size={16} />
                {t('Add row')}
              </button>
            </div>
            <datalist id="shp-profiles">
              {profiles.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
            <div className="table-wrap">
              <table className="tbl resp" id="shp-ptable">
                <thead>
                  <tr>
                    <th>{t('Profile')}</th>
                    <th>{t('Price')}</th>
                    <th>{t('Label')}</th>
                    <th>{t('Badge')}</th>
                    <th>{t('Description')}</th>
                    <th>{t('Active')}</th>
                  </tr>
                </thead>
                <tbody dangerouslySetInnerHTML={{ __html: rows.map((p, i) => rowHtml(i, p, t)).join('') }} />
              </table>
            </div>
            <p className="help" style={{ padding: 'var(--s3) var(--s4) var(--s4)' }}>
              {t('Customers only choose among these packages; the price is always read from here. Clear the profile to remove a row.')}
            </p>
            <template id="shp-prow-tpl" dangerouslySetInnerHTML={{ __html: rowHtml(9999, blank(), t) }} />
          </section>
        </div>
        <div>
          <button className="btn btn-primary btn-lg">{t('Save')}</button>
        </div>
      </ActionForm>
    </>
  );
}
