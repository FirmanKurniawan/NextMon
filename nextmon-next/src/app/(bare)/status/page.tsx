import type { Metadata } from 'next';
import { BrandMark, Icon } from '../../../components/Icon';
import { fmtBytes } from '../../../lib/fmt.ts';
import { reqInfo, translatorFor } from '../../../features/shop/public-next.ts';
import { statusPage } from '../../../features/status/lookup.ts';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: { absolute: 'Voucher status' }, robots: { index: false, follow: false } };

type SP = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

const LABELS: Record<string, [string, string]> = { new: ['Unused', 'neutral'], online: ['Online now', 'ok'], used: ['Used', 'info'], expired: ['Expired', 'warn'], disabled: ['Disabled', 'err'] };

/** Public voucher status: GET /status?session=&user=[&w=slug]. The tenant comes from the router session name (+ slug when it is not unique). */
export default async function StatusPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const info = await reqInfo();
  const session = first(sp.session).slice(0, 80);
  const user = first(sp.user).slice(0, 80);
  const w = first(sp.w).slice(0, 40);
  const d = await statusPage(session, user, w, info.ip);
  const t = translatorFor(info);
  const res = d.res;
  const [label, kind] = res ? (LABELS[res.status] ?? [res.status, 'neutral']) : ['', 'neutral'];
  const limit = res && !['', '0s', '1s'].includes(res.limit_uptime) ? res.limit_uptime : '-';
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-css-tags */}
      <link rel="stylesheet" href="/assets/css/voucher.css" precedence="default" />
      <main className="st-wrap">
        <div className="st-card glass">
          <div className="st-head">
            <span className="brand-mark">
              <BrandMark size={18} />
            </span>
            <span className="st-brand">{d.brand}</span>
          </div>
          <h1>{t('Check voucher status')}</h1>
          <p className="muted" style={{ margin: '0 0 var(--s4)' }}>
            {t('Enter your voucher code to see the remaining time.')}
          </p>
          <form method="get" action="/status" className="stack">
            {session === '' || !d.known ? (
              <div className="field">
                <label htmlFor="s-sess">{t('Session name')}</label>
                <input className="input mono" id="s-sess" name="session" defaultValue={session} required />
              </div>
            ) : (
              <input type="hidden" name="session" value={session} />
            )}
            {w !== '' ? <input type="hidden" name="w" value={w} /> : null}
            <div className="field">
              <label htmlFor="s-user">{t('Voucher code')}</label>
              <input className="input mono" id="s-user" name="user" defaultValue={user} required autoCapitalize="off" autoComplete="off" autoFocus />
            </div>
            <button className="btn btn-primary btn-lg">{t('Check')}</button>
          </form>
          {d.err !== '' ? (
            <div className="alert err" role="alert" style={{ marginTop: 'var(--s4)' }}>
              <Icon name="alert" size={18} />
              <div>{t(d.err)}</div>
            </div>
          ) : null}
          {res ? (
            <div className="st-res">
              <div className="st-top">
                <b className="st-code">{res.user}</b>
                <span className={`badge badge-${kind}`}>{t(label)}</span>
              </div>
              <div className="st-grid">
                <div>
                  <small>{t('Profile')}</small>
                  <b>{res.profile}</b>
                </div>
                <div>
                  <small>{t('Time left')}</small>
                  <b>{res.time_left || '-'}</b>
                </div>
                <div>
                  <small>{t('Expires')}</small>
                  <b>{res.expires || '-'}</b>
                </div>
                <div>
                  <small>{t('Time used')}</small>
                  <b>{res.uptime}</b>
                </div>
                <div>
                  <small>{t('Time limit')}</small>
                  <b>{limit}</b>
                </div>
                <div>
                  <small>{t('Data used')}</small>
                  <b>{fmtBytes(res.bytes_in + res.bytes_out)}</b>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </main>
    </>
  );
}
