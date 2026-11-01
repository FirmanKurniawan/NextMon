/**
 * Voucher print view (port of views/voucher_print.php): a standalone HTML document without the app shell, built as a string and
 * served by src/app/vouchers/print/route.ts. (A string, not React: react-dom/server may not be imported inside the app graph.)
 * Every dynamic value goes through esc(). All behaviour (11 glass designs, QR, PNG, ESC/POS over RawBT / Web Bluetooth) is the
 * shared public/assets/js/voucher.js + qr.js + escpos.js, driven by the panel markup and the two JSON blocks below.
 */
import { getSettings } from '../../lib/store.ts';
import type { AppContext } from '../types.ts';
import { customTemplates, defaultPreset, presets } from './data.ts';
import type { PrintItem } from './items.ts';

const SWATCHES = ['#0b7285', '#1d4ed8', '#4338ca', '#6d28d9', '#0f766e', '#15803d', '#b45309', '#be123c', '#334155', '#111827'];

export const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** JSON for a <script type="application/json"> block ("<" etc. neutralised so "</script>" can never end it). */
const json = (v: unknown): string => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

// Same geometry as components/Icon.tsx (24 viewBox, stroke 1.75); only the three icons this page uses.
const ICON_PATHS: Record<string, string> = {
  printer: '<path d="M6 9V3h12v6M6 18H4v-7h16v7h-2"/><rect x="7" y="14" width="10" height="7"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
};
const icon = (name: string, size = 16): string =>
  `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON_PATHS[name] ?? ''}</svg>`;

const chk = (opt: string, label: string): string => `<label class="check"><input type="checkbox" data-opt="${esc(opt)}"> ${esc(label)}</label>`;
const rng = (opt: string, label: string, min: number, max: number, step: number, unit = ''): string =>
  `<label class="vp-range"><span>${esc(label)}</span><input type="range" data-opt="${esc(opt)}" data-unit="${esc(unit)}" min="${min}" max="${max}" step="${step}"><output></output></label>`;

export function renderPrintHtml(ctx: AppContext, nonce: string, items: PrintItem[], tag: string): string {
  const t = (k: string) => esc(ctx.t(k));
  const st = getSettings();
  const hotspot = String(ctx.router?.hotspot_name || st.hotspot_name || '');
  const loginBase = String(st.login_url ?? 'http://hotspot.local/login');
  const thermal = { hotspot, items: items.map((i) => ({ u: i.user, p: i.pass, pr: i.profile, price: i.price, v: i.validity })) };
  const tt = ctx.t;
  const vp = {
    items: items.map((i) => ({ user: i.user, pass: i.pass, profile: i.profile, price: i.price, validity: i.validity, limit: i.limit, comment: i.comment })),
    escpos: '/assets/js/escpos.js',
    hotspot,
    loginBase,
    templates: customTemplates(),
    presets: presets(),
    defaultPreset: defaultPreset(),
    base: '/hs', // voucher.js posts presets to <base>/vouchers/preset/*
    i18n: {
      code: tt('Voucher code'),
      username: tt('Username'),
      password: tt('Password'),
      scan: tt('Scan to login'),
      profile: tt('Package'),
      valid: tt('Valid'),
      price: tt('Price'),
      clipped: tt('The card is larger than the printable area at this scale. Lower the scale or change paper.'),
      perSheet: tt('per sheet'),
      sheets: tt('sheets'),
      eccH: tt('Error correction forced to H for the centre logo.'),
      notImage: tt('Choose an image file.'),
      empty: tt('No vouchers found for this batch.'),
      presetName: tt('Preset name'),
      saved: tt('Saved.'),
      confirmDel: tt('Delete this preset?'),
      presetNone: tt('No preset'),
      custom: tt('custom'),
      pngFail: tt('Could not create the PNG in this browser. Use Print instead.'),
      limit: tt('Time limit'),
      ssid: tt('Wi-Fi network'),
      wpass: tt('Wi-Fi password'),
      serial: tt('No.'),
      copied: tt('Copied.'),
      copyFail: tt('Could not copy.'),
      lookalike: tt('Some codes contain I, l or O. They are underlined on the card; a slashed zero is the digit 0. The gap inside a code is only for reading.'),
      bigJob: tt('Sending many vouchers with image QR codes is slow over Bluetooth. Continue?'),
      tooLong: tt('Too much data for the RawBT link. Use native QR or fewer vouchers.'),
      sending: tt('Sending to the printer...'),
      sent: tt('Sent to the printer.'),
      noBle: tt('Web Bluetooth is not supported in this browser (use Chrome on Android/desktop over HTTPS).'),
      scanTh: tt('Scan to login'),
    },
  };
  const canW = ctx.can('write');
  const n = esc(nonce);

  return `<!doctype html>
<html lang="${esc(ctx.lang)}" data-theme="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${t('Print vouchers')} - NextMON</title>
<link rel="stylesheet" href="/assets/css/app.css">
<link rel="stylesheet" href="/assets/css/voucher.css">
<script src="/assets/js/theme.js" nonce="${n}"></script>
<style id="vp-pagestyle" nonce="${n}">@page { size: 210mm 297mm; margin: 0 }</style>
</head>
<body data-base="" data-page="print" data-csrf="${esc(ctx.csrf)}" data-lang="${esc(ctx.lang)}">
<div class="vp-bar glass">
  <a class="btn btn-sm" href="/vouchers" aria-label="${t('Back')}">&larr;<span class="vp-hm"> ${t('Back')}</span></a>
  <b>${items.length} ${t('vouchers')}</b><span class="muted mono vp-tag">${esc(tag)}</span>
  <span class="stat" id="vp-info"></span>
  <span class="spacer"></span>
  <span class="vp-hm vp-bar-tools">
    <label class="sr-only" for="vp-zoom">${t('Zoom')}</label>
    <select class="select select-sm" id="vp-zoom" data-opt="zoom" style="width:auto"><option value="fit">${t('Fit')}</option><option value="0.5">50%</option><option value="0.75">75%</option><option value="1">100%</option><option value="1.5">150%</option><option value="2.5">250%</option></select>
    <button class="btn btn-sm" type="button" data-thermal-share title="RawBT">RawBT</button>
    <button class="btn btn-sm" type="button" data-thermal-ble>Bluetooth</button>
    <button class="btn btn-sm btn-primary" type="button" data-vp-print>${icon('printer')}${t('Print')}</button>
  </span>
</div>
<script type="application/json" id="thermal-data">${json(thermal)}</script>
<script type="application/json" id="vp-data">${json(vp)}</script>

<div class="vp vp-root" id="vp-root">
  <main class="vp-stage" id="vp-stage" aria-live="polite"></main>

  <aside class="vp-panel" aria-label="${t('Print settings')}">
    <details class="vp-sec" open>
      <summary><span>${t('Design')}</span><button class="btn btn-sm btn-ghost" type="button" data-reset>${t('Reset')}</button></summary>
      <div class="vp-thumbs" id="vp-thumbs"></div>
    </details>

    <details class="vp-sec" open>
      <summary><span>${t('Paper and layout')}</span></summary>
      <div class="vp-two">
        <div class="field"><label for="o-paper">${t('Paper')}</label>
          <select class="select select-sm" id="o-paper" data-opt="paper"><option value="a4">A4</option><option value="a5">A5</option><option value="letter">Letter</option><option value="f4">F4 / Folio</option><option value="t58">Thermal 58 mm</option><option value="t80">Thermal 80 mm</option></select></div>
        <div class="field"><label for="o-cols">${t('Columns')}</label>
          <select class="select select-sm" id="o-cols" data-opt="cols" data-num="1"><option value="0">${t('Auto (fit)')}</option>${[1, 2, 3, 4, 5, 6, 7, 8].map((c) => `<option value="${c}">${c}</option>`).join('')}</select></div>
      </div>
      <div style="margin-top:6px">${chk('land', ctx.t('Landscape'))}</div>
      ${rng('scale', ctx.t('Card scale'), 50, 150, 1, '%')}
      ${rng('gap', ctx.t('Gap'), 0, 12, 0.5, ' mm')}
      ${rng('margin', ctx.t('Margin'), 0, 20, 0.5, ' mm')}
      ${chk('guides', ctx.t('Cut guides'))}
    </details>

    <details class="vp-sec" open>
      <summary><span>${t('Fields')}</span></summary>
      <div class="vp-fields">
        ${chk('f.brand', ctx.t('Brand'))}${chk('f.logo', ctx.t('Logo'))}
        ${chk('f.profile', ctx.t('Profile'))}${chk('f.validity', ctx.t('Validity'))}
        ${chk('f.price', ctx.t('Price'))}${chk('f.pass', ctx.t('Password'))}
        ${chk('f.qr', ctx.t('QR code'))}${chk('f.dns', ctx.t('Host'))}
        ${chk('f.serial', ctx.t('Number'))}${chk('f.wifi', ctx.t('Wi-Fi network'))}
      </div>
      <div style="margin-top:4px">${chk('group', ctx.t('Group characters (abc 123)'))}</div>
      <p class="help">${t('The gap in a grouped code is only for reading. Copy, PNG and the QR always use the raw code.')}</p>
    </details>

    <details class="vp-sec" open>
      <summary><span>${t('QR code')}</span></summary>
      <div class="field"><label for="o-qrmode">${t('Content')}</label>
        <select class="select select-sm" id="o-qrmode" data-opt="qrMode"><option value="login">${t('Auto-login link (username + password)')}</option><option value="user">${t('Login link, username only')}</option><option value="code">${t('Voucher code only')}</option></select></div>
      <div class="vp-two" style="margin-top:6px">
        <div class="field"><label for="o-ecc">${t('Error correction')}</label>
          <select class="select select-sm" id="o-ecc" data-opt="ecc"><option value="L">L - 7%</option><option value="M">M - 15%</option><option value="Q">Q - 25%</option><option value="H">H - 30%</option></select></div>
        <div class="field"><label for="o-qrstyle">${t('Modules')}</label>
          <select class="select select-sm" id="o-qrstyle" data-opt="qrStyle"><option value="square">${t('Square (sharpest)')}</option><option value="round">${t('Rounded')}</option></select></div>
      </div>
      <div style="margin-top:6px">${chk('qrLogo', ctx.t('Logo in the centre of the QR'))}</div>
      <p class="help" id="vp-ecc-note"></p>
    </details>

    <details class="vp-sec" open>
      <summary><span>${t('Brand')}</span></summary>
      <div class="field"><label for="o-name">${t('Name on card')}</label><input class="input input-sm" id="o-name" data-opt="name" maxlength="60" placeholder="${esc(hotspot)}"></div>
      <div class="vp-two" style="margin-top:8px">
        <div class="field"><label for="o-ssid">${t('Wi-Fi network')}</label><input class="input input-sm" id="o-ssid" data-opt="ssid" maxlength="32" autocomplete="off" placeholder="SSID"></div>
        <div class="field"><label for="o-wpass">${t('Wi-Fi password')}</label><input class="input input-sm" id="o-wpass" data-opt="wifipass" maxlength="63" autocomplete="off"></div>
      </div>
      <p class="help">${t('Shown by the Wi-Fi Card design. The password is public by design: it is printed on the card.')}</p>
      <div class="field" style="margin-top:8px"><label>${t('Accent colour')}</label>
        <div class="vp-swatches"><input type="color" class="vp-color" id="vp-color" aria-label="${t('Accent colour')}" data-opt="accent">
          ${SWATCHES.map((sw) => `<button type="button" class="vp-sw" data-sw="${esc(sw)}" style="background:${esc(sw)}" aria-label="${esc(sw)}" aria-pressed="false"></button>`).join('')}</div></div>
      <div class="field" style="margin-top:8px"><label for="vp-logo-file">${t('Logo')}</label>
        <div class="row" style="gap:8px"><input type="file" id="vp-logo-file" accept="image/*" class="input input-sm" style="padding-top:4px"><img id="vp-logo-prev" class="vp-logo-prev" alt="" hidden><button type="button" class="btn btn-sm btn-icon btn-ghost" data-logo-clear aria-label="${t('Remove logo')}">${icon('x')}</button></div>
        <p class="help">${t('Stays in this browser. Shrunk to 220 px.')}</p></div>
      <div style="margin-top:6px">${chk('ink', ctx.t('Ink saver (black and white, no fills)'))}</div>
    </details>

    <details class="vp-sec" open>
      <summary><span>${t('Presets')}</span></summary>
      <div class="field"><select class="select select-sm" id="vp-preset" aria-label="${t('Presets')}"></select></div>
      <div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap">
        <button class="btn btn-sm" type="button" data-preset-save>${t('Save current')}</button>
        ${canW ? `<button class="btn btn-sm" type="button" data-preset-def>${t('Make default')}</button>` : ''}
        <button class="btn btn-sm btn-danger" type="button" data-preset-del>${t('Delete')}</button>
      </div>
    </details>

    <details class="vp-sec" open>
      <summary><span>${t('Output')}</span></summary>
      <div class="vp-selbar" id="vp-selbar"><span>${t('Selected')}: <b class="mono" id="vp-selname"></b></span><button type="button" class="btn btn-sm btn-ghost" data-clear-sel>${t('Clear')}</button></div>
      <div class="vp-actions">
        <button class="btn btn-primary wide" type="button" data-vp-print>${icon('printer')}${t('Print all')}</button>
        <button class="btn" type="button" data-print-sel>${t('Print selected')}</button>
        <button class="btn" type="button" data-png>${icon('download')}PNG</button>
        <button class="btn wide" type="button" data-copy>${t('Copy code')}</button>
      </div>
      <p class="help">${t('Click a card in the preview to select it. With no selection the first card is used. For a PDF choose Save as PDF in the print dialog.')}</p>
      <div class="field" style="margin-top:8px"><label for="o-tqr">${t('QR on thermal printers (RawBT / Bluetooth)')}</label>
        <select class="select select-sm" id="o-tqr" data-opt="tqr"><option value="native">${t('Native ESC/POS QR (fast)')}</option><option value="raster">${t('Image QR (older printers)')}</option><option value="off">${t('No QR, text only')}</option></select>
        <p class="help">${t('Thermal width follows the paper: 80 mm uses 48 columns, anything else 58 mm / 32 columns. Sends the selected card, or all.')}</p></div>
    </details>
  </aside>

  <nav class="vp-dock" aria-label="${t('Print')}">
    <button class="btn btn-primary" type="button" data-vp-print>${icon('printer')}${t('Print')}</button>
    <button class="btn" type="button" data-png>${icon('download')}PNG</button>
    <button class="btn" type="button" data-thermal-share>RawBT</button>
    <button class="btn" type="button" data-thermal-ble>BT</button>
  </nav>
</div>
${['/assets/js/app.js', '/assets/js/qr.js', '/assets/js/pages.js', '/assets/js/voucher.js'].map((s) => `<script src="${s}" nonce="${n}" defer></script>`).join('\n')}
</body>
</html>`;
}
