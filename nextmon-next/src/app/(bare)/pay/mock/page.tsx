import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { Icon } from '../../../../components/Icon';
import { money } from '../../../../lib/fmt.ts';
import { loadMock } from '../../../../features/shop/public.ts';
import { reqInfo, translatorFor } from '../../../../features/shop/public-next.ts';
import { PublicFrame } from '../../../../features/shop/ui.tsx';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: { absolute: 'NextMON' }, robots: { index: false, follow: false } };

type SP = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/** Fake payment page of the demo gateway (sandbox only). The buttons post a SIGNED webhook to /pay/callback, exercising the real path. */
export default async function MockPayPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const info = await reqInfo();
  const d = loadMock(first(sp.id), first(sp.t), info.ip);
  if (!d) redirect('/shop');
  const t = translatorFor(info, d.lang);
  const o = d.o;
  const action = `/pay/callback?g=mock${d.wq !== '' ? d.wq.replace('?', '&') : ''}`;
  const form = (status: string, sig: string, label: string, cls: string) => (
    <form method="post" action={action}>
      <input type="hidden" name="mock_ui" value="1" />
      <input type="hidden" name="order_id" value={o.id} />
      <input type="hidden" name="status" value={status} />
      <input type="hidden" name="amount" value={Math.trunc(o.amount)} />
      <input type="hidden" name="ts" value={d.ts} />
      <input type="hidden" name="mock_sig" value={sig} />
      <button className={`btn ${cls} btn-lg shp-wide`} type="submit">
        {label}
      </button>
    </form>
  );
  return (
    <PublicFrame title={d.title} homeHref={'/shop' + d.wq} t={t} nonce={info.nonce} qr={false}>
      <section className="shp-card glass">
        <div className="alert warn">
          <Icon name="alert" size={18} />
          <div>{t('Demo payment page. No real money is moved.')}</div>
        </div>
        <h1 className="shp-h1" style={{ marginTop: 'var(--s4)' }}>
          {t('Demo gateway')}
        </h1>
        <dl className="kv shp-kv">
          <dt>{t('Order')}</dt>
          <dd className="mono">{o.id}</dd>
          <dt>{t('Package')}</dt>
          <dd>{o.package.label}</dd>
          <dt>{t('Total')}</dt>
          <dd>
            <b>{money(o.amount, d.currency)}</b>
          </dd>
        </dl>
        <div className="stack" style={{ gap: 'var(--s2)' }}>
          {form('paid', d.sigPaid, t('Simulate successful payment'), 'btn-primary')}
          {form('failed', d.sigFail, t('Simulate failed payment'), '')}
          <a className="btn btn-ghost shp-wide" href={`/shop/order?id=${encodeURIComponent(o.id)}&t=${encodeURIComponent(o.token)}`}>
            {t('Back to order')}
          </a>
        </div>
      </section>
    </PublicFrame>
  );
}
