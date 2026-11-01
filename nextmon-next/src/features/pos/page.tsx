import { Icon } from '../../components/Icon';
import { money } from '../../lib/fmt.ts';
import { Scripts } from '../../lib/scripts.ts';
import { currencyOf, isRo, tzOf } from '../_sales/common.ts';
import { Empty, NoRouter, PageHead } from '../_sales/ui';
import { zonedParts } from '../../lib/sales.ts';
import type { PageProps } from '../types.ts';
import { todaySales } from './api.ts';

/** Quick sell: one button per priced profile; the shared pages.js (P.pos) posts to /json/pos/sell and renders the receipt. */
export default async function PosPage({ ctx }: PageProps) {
  const t = ctx.t;
  const head = (
    <PageHead title={t('Quick sell (POS)')} desc={t('Tap a package to create a voucher instantly and print the receipt.')}>
      <button className="btn" type="button" data-scan-open>
        <Icon name="camera" size={16} />
        {t('Scan voucher QR')}
      </button>
    </PageHead>
  );
  if (!ctx.router) {
    return (
      <>
        {head}
        <NoRouter t={t} />
      </>
    );
  }
  const ro = isRo(ctx);
  const cur = currencyOf();
  const items: { name: string; price: string; validity: string; rate: string }[] = [];
  for (const p of await ctx.driver().print('/ip/hotspot/user/profile', {}, ['name', 'on-login', 'rate-limit'])) {
    if (p.name === 'default') continue;
    const m = Scripts.parseMeta(p['on-login'] ?? '');
    items.push({ name: p.name ?? '', price: m ? (m.sprice !== '' ? m.sprice : m.price) : '', validity: m?.validity ?? '', rate: p['rate-limit'] ?? '' });
  }
  const today = todaySales(ctx.router.id, 200);
  const total = today.reduce((a, x) => a + x.price, 0);
  const tz = tzOf();
  const hm = (ts: number) => {
    const p = zonedParts(ts, tz);
    return String(p.h).padStart(2, '0') + ':' + String(p.mi).padStart(2, '0');
  };
  return (
    <>
      {head}
      {ro ? (
        <div className="alert warn" style={{ marginBottom: 'var(--s4)' }}>
          <Icon name="alert" size={18} />
          <div>{t('This router is shared with you as read-only.')}</div>
        </div>
      ) : null}
      <div className="grid">
        <section className="col-8">
          {items.length === 0 ? (
            <div className="card glass">
              <div className="card-b">
                <Empty icon="tag" title={t('No packages')} text={t('Create a profile with a price first.')}>
                  <a className="btn btn-primary" href="/hotspot/profiles">
                    {t('Profiles')}
                  </a>
                </Empty>
              </div>
            </div>
          ) : (
            <div className="grid" id="pos-items" data-sell-url="/json/pos/sell">
              {items.map((it) => (
                <div className="col-4" key={it.name}>
                  <button
                    className="card glass btn"
                    type="button"
                    data-sell={it.name}
                    disabled={ro}
                    style={{ width: '100%', height: 'auto', padding: 'var(--s4)', flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--s2)', textAlign: 'left', whiteSpace: 'normal' }}
                  >
                    <span style={{ fontWeight: 600, fontSize: 'var(--fs-16)' }}>{it.name}</span>
                    <span className="stat-value" style={{ fontSize: 'var(--fs-24)', margin: 0 }}>
                      {it.price !== '' ? money(it.price, cur) : '-'}
                    </span>
                    <span className="muted">
                      {it.validity || '-'} &middot; {it.rate || t('no limit')}
                    </span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="card glass col-4">
          <div className="card-h">
            <h2>{t('Today')}</h2>
            <b id="pos-total">{money(total, cur)}</b>
          </div>
          <div className="card-b" id="pos-today">
            {today.length === 0 ? (
              <p className="muted" id="pos-empty">
                {t('No sales yet today.')}
              </p>
            ) : null}
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }} id="pos-list">
              {today.slice(0, 30).map((x, i) => (
                <li className="row" style={{ justifyContent: 'space-between', fontSize: 'var(--fs-13)' }} key={x.ts + x.user + i}>
                  <span>
                    <span className="mono">{x.user}</span> <span className="muted">{x.profile}</span>
                  </span>
                  <span className="nowrap">
                    {hm(x.ts)} &middot; {money(x.price, cur)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      <dialog className="modal" id="dlg-receipt" aria-labelledby="rc-t">
        <div className="modal-h">
          <h2 id="rc-t">{t('Voucher created')}</h2>
          <button type="button" className="btn btn-ghost btn-icon" data-close aria-label={t('Close')}>
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-b">
          <div className="receipt" id="receipt" />
        </div>
        <div className="modal-f">
          <button className="btn" type="button" data-copy-voucher>
            {t('Copy')}
          </button>
          <button className="btn" type="button" data-thermal-share>
            <Icon name="printer" size={16} />
            RawBT
          </button>
          <button className="btn" type="button" data-thermal-ble>
            <Icon name="wifi" size={16} />
            Bluetooth
          </button>
          <button className="btn btn-primary" type="button" data-print-receipt>
            <Icon name="printer" size={16} />
            {t('Print')}
          </button>
        </div>
      </dialog>
      <script type="application/json" id="thermal-data" dangerouslySetInnerHTML={{ __html: '{"hotspot":"","items":[]}' }} />

      <dialog className="modal" id="dlg-scan" aria-labelledby="sc-t">
        <div className="modal-h">
          <h2 id="sc-t">{t('Scan voucher QR')}</h2>
          <button type="button" className="btn btn-ghost btn-icon" data-close aria-label={t('Close')}>
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-b">
          <video id="scan-video" playsInline muted style={{ width: '100%', borderRadius: 'var(--r2)', background: '#000', maxHeight: '50vh' }} />
          <p className="help" id="scan-msg" style={{ marginTop: 'var(--s2)' }} />
        </div>
      </dialog>
    </>
  );
}
