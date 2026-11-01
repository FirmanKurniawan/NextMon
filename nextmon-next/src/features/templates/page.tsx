import { Icon } from '../../components/Icon';
import { CsrfField, JsonData, PageHead, Css } from '../_kit/ui.tsx';
import type { PageProps } from '../types.ts';
import { customTemplates } from '../vouchers/data.ts';

const DEFAULT_HTML = `<div style="width:70mm;height:40mm;box-sizing:border-box;padding:3mm;border:.3mm solid #0d1b24;border-radius:2mm;display:grid;grid-template-columns:1fr 24mm;gap:3mm;font:3mm/1.25 sans-serif">
<div>
<b style="font-size:3.4mm;letter-spacing:.1em;text-transform:uppercase">{{hotspot}}</b>
{{creds}}
<div>{{profile}} - {{validity}} - {{price}}</div>
</div>
<div style="align-self:center">{{qr}}</div>
</div>`;

const DESIGNS: [string, string][] = [
  ['aurora', 'Glass Aurora'],
  ['mini', 'Glass Mini'],
  ['strip', 'Compact Strip'],
  ['dark', 'Dark Glass'],
  ['mono', 'Minimal Mono'],
  ['ticket', 'Ticket'],
  ['t58', 'Thermal 58'],
  ['t80', 'Thermal 80'],
  ['banner', 'Brand Banner'],
  ['wifi', 'Wi-Fi Card'],
  ['receipt', 'Receipt Pro'],
];

/** Port of VoucherController::templates() + views/templates.php (editor, live preview and variables are driven by shared voucher.js). */
export default function TemplatesPage({ ctx }: PageProps) {
  const t = ctx.t;
  const templates = customTemplates();
  const ph: [string, string][] = [
    ['{{hotspot}}', t('Hotspot / brand name')],
    ['{{user}}', t('Username (voucher code)')],
    ['{{pass}}', t('Password')],
    ['{{code}}', t('Username grouped for reading (abc 123)')],
    ['{{creds}}', t('Ready-made code block (one or two rows, styled)')],
    ['{{profile}}', t('Profile / package')],
    ['{{price}}', t('Selling price')],
    ['{{validity}}', t('Validity')],
    ['{{limit}}', t('Time limit')],
    ['{{ssid}}', t('Wi-Fi network name (set in the print view)')],
    ['{{wifipass}}', t('Wi-Fi password (set in the print view)')],
    ['{{comment}}', t('Batch tag')],
    ['{{serial}}', t('Number in batch (001)')],
    ['{{dns}}', t('Hotspot host name')],
    ['{{login_url}}', t('Auto-login URL')],
    ['{{qr}}', t('QR code (SVG)')],
    ['{{logo}}', t('Logo image (if set)')],
    ['{{scan}}', t('Caption: scan to login')],
  ];
  const te = {
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
  return (
    <>
      <Css href="/assets/css/voucher.css" />
      <PageHead title={t('Voucher templates')} desc={t('Start from a built-in design or write your own HTML. Scripts and event attributes are stripped on save.')}>
        <a className="btn" href="/vouchers">
          &larr; {t('Vouchers')}
        </a>
      </PageHead>
      <JsonData id="te-data" data={te} />

      <div className="te" id="te-root">
        <section className="card glass">
          <div className="card-h">
            <h2>{t('Editor')}</h2>
          </div>
          <form className="card-b stack" method="post" action="/hs/vouchers/templates/save" id="tpl-form">
            <CsrfField ctx={ctx} />
            <input type="hidden" name="id" id="te-id" />
            <div className="form-grid">
              <div className="field full">
                <label htmlFor="te-name">{t('Template name')}</label>
                <input className="input" id="te-name" name="name" required maxLength={40} />
              </div>
              <div className="field">
                <label htmlFor="te-w">{t('Card width (mm)')}</label>
                <input className="input mono" id="te-w" name="w" type="number" min={20} max={300} step={0.1} defaultValue={70} />
              </div>
              <div className="field">
                <label htmlFor="te-h">{t('Card height (mm)')}</label>
                <input className="input mono" id="te-h" name="h" type="number" min={10} max={300} step={0.1} defaultValue={40} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="te-html">HTML</label>
              <textarea className="textarea mono" id="te-html" name="html" rows={14} spellCheck={false} required style={{ fontSize: '12.5px', lineHeight: 1.45, height: 'auto', padding: 'var(--s3)' }} defaultValue={DEFAULT_HTML} />
              <div className="te-chips" aria-label={t('Placeholders')}>
                {ph.map(([k, d]) => (
                  <button type="button" className="te-chip" data-ph={k} title={d} key={k}>
                    {k}
                  </button>
                ))}
              </div>
              <p className="help">{t('Click a chip to insert it at the cursor. Millimetre units print true to size; the print view scales the card as a whole.')}</p>
            </div>
            <div className="field">
              <label>{t('Start from a design')}</label>
              <div className="te-chips">
                {DESIGNS.map(([id, nm]) => (
                  <button type="button" className="te-chip" data-start={id} style={{ fontFamily: 'var(--font)' }} key={id}>
                    {nm}
                  </button>
                ))}
              </div>
              <p className="help">{t('Copies the design markup (CSS classes included) into the editor so you can adjust it.')}</p>
            </div>
            <div className="row">
              <button className="btn btn-primary">{t('Save template')}</button>
              <button className="btn" type="button" data-tpl-new>
                {t('New')}
              </button>
            </div>
          </form>
        </section>

        <div className="stack">
          <section className="card glass">
            <div className="card-h">
              <h2>{t('Live preview')}</h2>
              <label className="check" style={{ marginLeft: 'auto' }}>
                <input type="checkbox" id="te-two" /> {t('Username + password')}
              </label>
            </div>
            <div className="card-b">
              <div className="te-stage" id="te-stage" />
            </div>
          </section>
          <section className="card glass">
            <div className="card-h">
              <h2>{t('Variables')}</h2>
            </div>
            <div className="card-b">
              <table className="te-vars">
                <tbody>
                  {ph.map(([k, d]) => (
                    <tr key={k}>
                      <td>{k}</td>
                      <td>{d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="card glass">
            <div className="card-h">
              <h2>{t('Saved templates')}</h2>
            </div>
            <div className="card-b">
              {templates.length === 0 ? (
                <p className="muted">{t('None yet. The built-in designs are always available in the print view.')}</p>
              ) : (
                <ul className="te-list">
                  {templates.map((tp) => (
                    <li key={tp.id}>
                      <span>
                        <b>{tp.name}</b>{' '}
                        <span className="muted mono">
                          {tp.w}x{tp.h} mm
                        </span>
                      </span>
                      <span className="row">
                        <button className="btn btn-sm" type="button" data-tpl-load={JSON.stringify(tp)}>
                          {t('Edit')}
                        </button>
                        <form className="inline-form" method="post" action="/hs/vouchers/templates/delete" data-confirm={t('Delete this template?')}>
                          <CsrfField ctx={ctx} />
                          <input type="hidden" name="id" value={tp.id} />
                          <button className="btn btn-sm btn-danger btn-icon" aria-label={t('Delete')}>
                            <Icon name="trash" size={16} />
                          </button>
                        </form>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
