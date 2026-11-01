import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Icon } from '../../../../components/Icon';
import { money } from '../../../../lib/fmt.ts';
import { loadOrder, peekTitle } from '../../../../features/shop/public.ts';
import { reqInfo, translatorFor } from '../../../../features/shop/public-next.ts';
import QrKick from '../../../../features/shop/QrKick.tsx';
import { PublicFrame } from '../../../../features/shop/ui.tsx';

export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export async function generateMetadata({ searchParams }: { searchParams: SP }): Promise<Metadata> {
  const sp = await searchParams;
  const info = await reqInfo();
  return { title: { absolute: peekTitle(first(sp.id), first(sp.t), info.ip) ?? "NextMON" }, robots: { index: false, follow: false } };
}

const hhmm = (ts: number, tz: string): string => {
  try {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(new Date(ts * 1000));
  } catch {
    return new Date(ts * 1000).toISOString().slice(11, 16);
  }
};

/**
 * GET /shop/order?id=&t= : order status page. The workspace is resolved from the order id, then the TOKEN is checked; any mismatch
 * renders the neutral 404 (no branding, no workspace data). `?json=1` of the PHP edition lives at /shop/poll (a page cannot answer JSON).
 */
export default async function OrderPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const info = await reqInfo();
  const d = await loadOrder(first(sp.id), first(sp.t), info.ip);
  if (!d) notFound();
  const t = translatorFor(info, d.lang);
  const { o, view } = d;
  const st = o.status;
  const ready = view.ready;
  const q = `id=${encodeURIComponent(o.id)}&t=${encodeURIComponent(o.token)}`;
  const poll = `/shop/poll?${q}`;
  const self = `/shop/order?${q}`;
  const go = first(sp.go) === '1' && st === 'pending' && o.pay_url !== '' ? o.pay_url : '';
  const homeHref = '/shop' + d.wq;
  const m = (n: number) => money(n, d.currency);
  const v = view.voucher;
  const sameCode = !v || v.pass === v.user;
  return (
    <PublicFrame title={d.title} homeHref={homeHref} t={t} nonce={info.nonce}>
      <section
        className="shp-card glass shp-live"
        data-poll={poll}
        data-self={self}
        data-status={st}
        data-ready={ready ? '1' : '0'}
        data-expires={view.expires_in}
        {...(go ? { 'data-go': go } : {})}
      >
        {st === 'paid' && ready && v ? (
          <>
            <div className="shp-state ok">
              <span className="shp-state-ic">
                <Icon name="check" size={22} />
              </span>
              <div>
                <h1 className="shp-h1">{t('Payment received')}</h1>
                <p className="muted">{t('Your voucher is ready. Save it before you leave this page.')}</p>
              </div>
            </div>
            <div className="shp-voucher">
              <div className="shp-vlabel">{sameCode ? t('Voucher code') : t('Username')}</div>
              <div className="shp-code mono" id="v-user">
                {v.user}
              </div>
              {!sameCode ? (
                <>
                  <div className="shp-vlabel">{t('Password')}</div>
                  <div className="shp-code mono" id="v-pass">
                    {v.pass}
                  </div>
                </>
              ) : null}
              <div className="shp-actions">
                <button className="btn" type="button" data-shp-copy={sameCode ? v.user : `${v.user} / ${v.pass}`}>
                  <Icon name="file" size={16} />
                  <span data-label={t('Copy code')} data-done={t('Copied')}>
                    {t('Copy code')}
                  </span>
                </button>
                <a className="btn btn-primary" href={v.url}>
                  <Icon name="zap" size={16} />
                  {t('Connect automatically')}
                </a>
              </div>
              <p className="help shp-hint">{t('Tap "Connect automatically" while connected to the WiFi, or scan the QR code with another device.')}</p>
              <div className="shp-qr" data-qr={v.url} aria-label="QR" />
              <QrKick />
            </div>
            <dl className="kv shp-kv">
              <dt>{t('Package')}</dt>
              <dd>{o.package.label}</dd>
              <dt>{t('Amount')}</dt>
              <dd>{m(o.amount)}</dd>
              <dt>{t('Order')}</dt>
              <dd className="mono">{o.id}</dd>
            </dl>
            {d.routerSession !== '' ? (
              <a className="shp-link" href={`/status?session=${encodeURIComponent(d.routerSession)}&user=${encodeURIComponent(v.user)}&w=${encodeURIComponent(d.slug)}`}>
                {t('Check remaining time')} &rsaquo;
              </a>
            ) : null}
          </>
        ) : st === 'paid' ? (
          <>
            <div className="shp-state">
              <span className="shp-spin" aria-hidden="true" />
              <div>
                <h1 className="shp-h1">{t('Payment received')}</h1>
                <p className="muted">{t('We are preparing your voucher. This page updates by itself.')}</p>
              </div>
            </div>
            {o.fulfil === 'error' ? (
              <div className="alert warn">
                <Icon name="alert" size={18} />
                <div>{t('The hotspot router did not answer yet. We keep retrying; if it takes long, contact the staff with order :id.', { ':id': o.id })}</div>
              </div>
            ) : null}
          </>
        ) : st === 'pending' ? (
          <>
            <div className="shp-state">
              <span className="shp-spin" aria-hidden="true" />
              <div>
                <h1 className="shp-h1">{t('Waiting for payment')}</h1>
                <p className="muted">{t('Complete the payment; this page updates by itself.')}</p>
              </div>
            </div>
            <dl className="kv shp-kv">
              <dt>{t('Package')}</dt>
              <dd>{o.package.label}</dd>
              <dt>{t('Total')}</dt>
              <dd>
                <b>{m(o.amount)}</b>
              </dd>
              <dt>{t('Order')}</dt>
              <dd className="mono">{o.id}</dd>
              <dt>{t('Pay before')}</dt>
              <dd className="mono" id="shp-count" data-countdown={view.expires_in}>
                {hhmm(o.expires, d.tz)}
              </dd>
            </dl>
            {o.pay_url !== '' ? (
              <a className="btn btn-primary btn-lg shp-wide" href={o.pay_url}>
                {t('Pay now')}
              </a>
            ) : null}
            {o.gateway === 'manual' ? (
              <div className="shp-manual">
                <div className="shp-vlabel">{t('How to pay')}</div>
                <div className="shp-pre" style={{ whiteSpace: 'pre-line' }}>
                  {o.pay_info !== '' ? o.pay_info : t('Ask the staff for payment details and mention your order number.')}
                </div>
                <p className="help">{t('After you transfer, the staff confirms your payment and the voucher appears here.')}</p>
              </div>
            ) : null}
          </>
        ) : st === 'refunded' ? (
          <div className="shp-state warn">
            <span className="shp-state-ic">
              <Icon name="alert" size={22} />
            </span>
            <div>
              <h1 className="shp-h1">{t('Order refunded')}</h1>
              <p className="muted">{t('This order was refunded and the voucher is no longer valid.')}</p>
            </div>
          </div>
        ) : (
          <>
            <div className="shp-state err">
              <span className="shp-state-ic">
                <Icon name="x" size={22} />
              </span>
              <div>
                <h1 className="shp-h1">{st === 'expired' ? t('Order expired') : t('Payment failed')}</h1>
                <p className="muted">{t('Nothing was charged for this order. If you already paid, contact the staff with order :id.', { ':id': o.id })}</p>
              </div>
            </div>
            <a className="btn btn-primary btn-lg shp-wide" href={homeHref}>
              {t('Order again')}
            </a>
          </>
        )}
      </section>
    </PublicFrame>
  );
}
