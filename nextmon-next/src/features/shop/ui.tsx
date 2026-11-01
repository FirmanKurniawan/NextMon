import type { ReactNode } from 'react';
import { BrandMark, Icon } from '../../components/Icon';
import type { TFn } from '../../lib/i18n.ts';

/** Public shop frame (twin of shop_top.php / shop_bottom.php). Scripts carry the CSP nonce (strict-dynamic ignores 'self'). */
export function PublicFrame({ title, homeHref, t, nonce, children, qr = true }: { title: string; homeHref: string; t: TFn; nonce: string; children: ReactNode; qr?: boolean }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-css-tags */}
      <link rel="stylesheet" href="/assets/css/mod-shop.css" precedence="default" />
      <main className="shp-wrap">
        <header className="shp-head">
          <a className="shp-brand" href={homeHref}>
            <span className="brand-mark">
              <BrandMark size={18} />
            </span>
            <span>{title}</span>
          </a>
          <button className="btn btn-ghost btn-icon btn-sm" type="button" data-shp-theme aria-label={t('Toggle theme')}>
            <Icon name="moon" size={18} />
          </button>
        </header>
        {children}
        <footer className="shp-foot">
          <a href="/status">{t('Check voucher status')}</a>
          <span aria-hidden="true">&middot;</span>
          <span className="muted">NextMON</span>
        </footer>
      </main>
      {/* plain nonce-d scripts: the shared vanilla JS of the PHP edition (CSP strict-dynamic ignores 'self') */}
      {/* eslint-disable @next/next/no-sync-scripts */}
      {qr ? <script src="/assets/js/qr.js" nonce={nonce} /> : null}
      <script src="/assets/js/mod-shop.js" nonce={nonce} />
      {/* eslint-enable @next/next/no-sync-scripts */}
    </>
  );
}

export function EmptyState({ icon, title, text, children }: { icon: string; title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={32} />
      <h3>{title}</h3>
      {text ? <p>{text}</p> : null}
      {children}
    </div>
  );
}

/** Neutral page for unknown / suspended / wrong-token requests: no workspace data, no branding. */
export function NeutralNotFound({ t, nonce, suspended = false }: { t: TFn; nonce: string; suspended?: boolean }) {
  return (
    <PublicFrame title="NextMON" homeHref="/shop" t={t} nonce={nonce} qr={false}>
      <section className="shp-card glass">
        {suspended ? (
          <EmptyState icon="alert" title={t('Service unavailable')} text={t('This workspace is suspended.')} />
        ) : (
          <EmptyState icon="alert" title={t('Order not found')} text={t('The link is wrong or the order was removed.')}>
            <a className="btn btn-primary" href="/shop">
              {t('Back to shop')}
            </a>
          </EmptyState>
        )}
      </section>
    </PublicFrame>
  );
}
