import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Csrf } from '../../../lib/auth.ts';
import { money } from '../../../lib/fmt.ts';
import { placeOrder } from '../../../features/shop/public-actions.ts';
import { inWorkspace, resolveSlug, storeView } from '../../../features/shop/public.ts';
import { reqInfo, translatorFor } from '../../../features/shop/public-next.ts';
import OrderForm from '../../../features/shop/OrderForm.tsx';
import { EmptyState, NeutralNotFound, PublicFrame } from '../../../features/shop/ui.tsx';

export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export async function generateMetadata({ searchParams }: { searchParams: SP }): Promise<Metadata> {
  const info = await reqInfo();
  const r = resolveSlug(first((await searchParams).w));
  const title = 'ws' in r ? inWorkspace(r.ws, info.ip, () => storeView().title) : 'NextMON';
  return { title: { absolute: title }, robots: { index: false, follow: false } };
}

/** Public storefront: GET /shop[?w=slug]. The workspace comes ONLY from the slug (default `main`). */
export default async function ShopPage({ searchParams }: { searchParams: SP }) {
  const info = await reqInfo();
  const sp = await searchParams;
  const r = resolveSlug(first(sp.w));
  if (!('ws' in r)) {
    if (r.why === 'suspended') return <NeutralNotFound t={translatorFor(info)} nonce={info.nonce} suspended />;
    notFound();
  }
  const v = inWorkspace(r.ws, info.ip, () => storeView(first(sp.ref)));
  const t = translatorFor(info, v.lang);
  const c = v.c;
  const homeHref = '/shop' + v.wq;
  return (
    <PublicFrame title={v.title} homeHref={homeHref} t={t} nonce={info.nonce}>
      <section className="shp-card glass">
        <h1 className="shp-h1">{c.tagline !== '' ? c.tagline : t('Buy WiFi access')}</h1>
        <p className="muted shp-lead">{t('Choose a package, pay, and get your voucher instantly.')}</p>
        {!c.enabled ? (
          <EmptyState icon="wifi" title={t('The shop is currently closed.')} text={t('Please ask the staff for a voucher.')} />
        ) : !v.packages.length ? (
          <EmptyState icon="tag" title={t('No packages available')} text={t('Please check back later.')} />
        ) : (
          <OrderForm
            action={placeOrder}
            csrf={Csrf.pre('shop')}
            slug={v.slug}
            refCode={v.ref}
            packs={v.packages.map((p) => ({ id: p.id, label: p.label !== '' ? p.label : p.profile, badge: p.badge, desc: p.desc, price: money(p.price, v.currency) }))}
            labels={{
              package: t('Package'),
              name: t('Name'),
              phone: t('Phone / WhatsApp'),
              optional: t('optional'),
              email: t('Email'),
              terms: t('Terms and conditions'),
              agree: t('I agree to the terms'),
              total: t('Total'),
              pay: t('Pay now'),
            }}
            requirePhone={c.require_phone}
            terms={c.terms}
          />
        )}
      </section>
    </PublicFrame>
  );
}
