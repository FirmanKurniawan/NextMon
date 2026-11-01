import { Icon } from '../../components/Icon';
import { money } from '../../lib/fmt.ts';
import { mayPrint } from '../../lib/reseller.ts';
import { parseMeta } from '../../lib/scripts.ts';
import { getSettings } from '../../lib/store.ts';
import { Voucher } from '../../lib/voucher.ts';
import { isRo } from '../_kit/forms.ts';
import { CsrfField, Empty, JsonData, NoRouter, PageHead, RoNotice, Css } from '../_kit/ui.tsx';
import type { PageProps } from '../types.ts';
import { customTemplates } from './data.ts';

const CHARSETS: [string, string][] = [
  ['safe', 'abc + 346 (no look-alikes)'],
  ['safeupper', 'ABC + 346 (no look-alikes)'],
  ['lowernum', 'abc + 234'],
  ['num', '0-9'],
  ['lower', 'abc'],
  ['upper', 'ABC'],
  ['uppernum', 'ABC + 234'],
  ['mixed', 'aBc + 234'],
];

/** Port of VoucherController::index() + views/vouchers.php (generator form, quick print, recent batches). */
export default async function VouchersPage({ ctx }: PageProps) {
  const t = ctx.t;
  if (!ctx.router) return <NoRouter t={t} />;
  const ro = isRo(ctx);
  const canW = ctx.can('write') && !ro;
  const st = getSettings();
  const cur = String(st.currency || 'Rp');
  const got = await ctx.driver().printMany({
    profiles: ['/ip/hotspot/user/profile', {}, ['name', 'on-login']],
    users: ['/ip/hotspot/user', {}, ['name', 'profile', 'comment', 'uptime']],
    servers: ['/ip/hotspot', {}, ['name']],
  });
  const profiles = (got.profiles ?? []).map((p) => p.name ?? '');
  const meta: Record<string, ReturnType<typeof parseMeta>> = {};
  for (const p of got.profiles ?? []) meta[p.name ?? ''] = parseMeta(p['on-login'] ?? '');
  const byTag = new Map<string, { tag: string; count: number; used: number; profile: string }>();
  for (const u of got.users ?? []) {
    const b = Voucher.batchOf(u.comment ?? '');
    if (b === '') continue;
    const e = byTag.get(b) ?? { tag: b, count: 0, used: 0, profile: u.profile ?? '' };
    e.count++;
    if ((u.uptime ?? '0s') !== '0s') e.used++;
    byTag.set(b, e);
  }
  const batches = [...byTag.values()].filter((b) => mayPrint(ctx.user, b.tag)).reverse();
  const servers = (got.servers ?? []).map((s) => s.name ?? '');
  const hotspot = String(ctx.router.hotspot_name || st.hotspot_name || '');
  const vg = {
    hotspot,
    loginBase: String(st.login_url ?? 'http://hotspot.local/login'),
    templates: customTemplates(),
    i18n: {
      code: t('Voucher code'),
      username: t('Username'),
      password: t('Password'),
      scan: t('Scan to login'),
      profile: t('Package'),
      valid: t('Valid'),
      price: t('Price'),
      limit: t('Time limit'),
      ssid: t('Wi-Fi network'),
      wpass: t('Wi-Fi password'),
      serial: t('No.'),
    },
  };
  const d = new Date();
  const mmdd = d.toLocaleString('en-US', { month: 'short' }) + String(d.getDate()).padStart(2, '0');

  return (
    <>
      <Css href="/assets/css/voucher.css" />
      <PageHead title={t('Vouchers')} desc={t('Generate a batch, pick a card design, then print or save it.')}>
        {ctx.can('write') ? (
          <a className="btn" href="/vouchers/templates">
            <Icon name="file" size={16} />
            {t('Templates')}
          </a>
        ) : null}
      </PageHead>
      {ro ? <RoNotice t={t} /> : null}
      <JsonData id="vg-data" data={vg} />

      <div className="grid" id="vg-root">
        <section className="card glass col-7">
          <div className="card-h">
            <h2>{t('New batch')}</h2>
          </div>
          <form className="card-b stack" method="post" action="/hs/vouchers/generate">
            <CsrfField ctx={ctx} />
            <input type="hidden" name="design" id="g-design" defaultValue="aurora" />
            <input type="hidden" name="tpl" id="g-tpl" defaultValue="" />
            <div className="vg-grid3">
              <div className="field vg-span2">
                <label htmlFor="g-prof">{t('Profile')}</label>
                <select className="select" id="g-prof" name="profile" required data-meta={JSON.stringify(meta)}>
                  {profiles.map((p) => {
                    const m = meta[p];
                    return (
                      <option key={p} value={p}>
                        {p}
                        {m && m.sprice !== '' ? ' - ' + money(m.sprice, cur) : ''}
                        {m && m.validity !== '' ? ' / ' + m.validity : ''}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div className="field">
                <label htmlFor="g-qty">{t('Quantity')}</label>
                <input className="input" id="g-qty" name="qty" type="number" min={1} max={Number(st.max_qty) || 500} defaultValue={10} required />
              </div>
              <div className="vg-span3">
                <p className="help" id="g-prof-info" style={{ margin: 0 }}>
                  &nbsp;
                </p>
              </div>
              <div className="field">
                <label htmlFor="g-batch">{t('Batch name (comment)')}</label>
                <input className="input" id="g-batch" name="batch" maxLength={24} placeholder={mmdd} />
              </div>
              <div className="field">
                <label htmlFor="g-prefix">{t('Prefix')}</label>
                <input className="input mono" id="g-prefix" name="prefix" maxLength={8} autoCapitalize="off" />
              </div>
              <div className="field">
                <label htmlFor="g-len">{t('Code length')}</label>
                <input className="input" id="g-len" name="length" type="number" min={3} max={16} defaultValue={6} />
              </div>
              <div className="field">
                <label htmlFor="g-cs">{t('Characters')}</label>
                <select className="select" id="g-cs" name="charset" defaultValue="safe">
                  {CHARSETS.map(([k, l]) => (
                    <option key={k} value={k}>
                      {t(l)}
                    </option>
                  ))}
                </select>
                <p className="help" style={{ margin: '4px 0 0' }}>
                  {t('"No look-alikes" also drops 5/s, 2/z, 8/b, 9/q and u/v, so a code can be read aloud or typed without doubt.')}
                </p>
              </div>
              <div className="field">
                <label htmlFor="g-mode">{t('Mode')}</label>
                <select className="select" id="g-mode" name="mode">
                  <option value="vc">{t('Username = password')}</option>
                  <option value="up">{t('Username + password')}</option>
                </select>
              </div>
              {servers.length > 1 ? (
                <div className="field">
                  <label htmlFor="g-srv">{t('Hotspot server')}</label>
                  <select className="select" id="g-srv" name="server">
                    <option value="all">all</option>
                    {servers.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div className="field">
                <label htmlFor="g-lim">{t('Time limit')}</label>
                <input className="input mono" id="g-lim" name="limit_uptime" placeholder="1h" autoCapitalize="off" />
              </div>
              <div className="field">
                <label htmlFor="g-bytes">{t('Data limit (bytes)')}</label>
                <input className="input mono" id="g-bytes" name="limit_bytes" inputMode="numeric" />
              </div>
              <div className="vg-span3">
                <p className="help" style={{ margin: 0 }}>
                  <b>{t('Validity')}</b> {t('runs from first login (profile). ')}
                  <b>{t('Time limit')}</b> {t('is total online time and pauses while logged out; it must not exceed validity.')}
                </p>
              </div>
            </div>
            <div className="field">
              <label>{t('Card design')}</label>
              <div className="vg-thumbs" id="vg-thumbs" />
              <p className="help">{t('Colours, paper, columns and QR options are adjusted in the print view.')}</p>
            </div>
            <button className="btn btn-primary btn-lg" style={{ width: '100%' }}>
              <Icon name="ticket" size={18} />
              {t('Generate and open print view')}
            </button>
          </form>
        </section>

        <section className="card glass col-5">
          <div className="card-h">
            <h2>{t('Quick print')}</h2>
          </div>
          <form className="card-b" method="post" action="/hs/vouchers/quick">
            <CsrfField ctx={ctx} />
            <div className="vg-quick">
              <input className="input mono" name="code" required autoCapitalize="off" autoComplete="off" placeholder={t('Voucher code')} aria-label={t('Voucher code')} />
              <button className="btn">
                <Icon name="printer" size={16} />
                {t('Print')}
              </button>
            </div>
            <p className="help" style={{ marginTop: 6 }}>
              {t('Print or re-print a single existing voucher by its username.')}
            </p>
          </form>
          <div className="card-h">
            <h2>{t('Recent batches')}</h2>
          </div>
          {batches.length === 0 ? (
            <Empty icon="ticket" title={t('No batches yet')} text={t('Generated vouchers appear here, grouped by their comment tag.')} />
          ) : (
            <div className="table-wrap" style={{ maxHeight: 520 }}>
              <table className="tbl resp">
                <thead>
                  <tr>
                    <th>{t('Batch')}</th>
                    <th>{t('Profile')}</th>
                    <th className="num">{t('Used / total')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {batches.slice(0, 40).map((b) => (
                    <tr key={b.tag}>
                      <td data-label={t('Batch')} className="mono wrap">
                        {b.tag}
                      </td>
                      <td data-label={t('Profile')}>{b.profile}</td>
                      <td data-label={t('Used / total')} className="num">
                        {b.used} / {b.count}
                      </td>
                      <td className="actions" data-label="">
                        <a className="btn btn-sm" href={'/vouchers/print?comment=' + encodeURIComponent(b.tag)} title={t('Print or re-print this batch')}>
                          <Icon name="printer" size={16} />
                          <span className="hide-m">{t('Print')}</span>
                        </a>
                        {canW ? (
                          <form className="inline-form" method="post" action="/hs/vouchers/delete" data-confirm={t('Delete all users in this batch?')}>
                            <CsrfField ctx={ctx} />
                            <input type="hidden" name="tag" value={b.tag} />
                            <button className="btn btn-sm btn-danger btn-icon" aria-label={t('Delete')}>
                              <Icon name="trash" size={16} />
                            </button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
