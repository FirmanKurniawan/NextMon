# Hotspot login theme (MikroTik)

Static HTML/CSS/JS replacement for the RouterOS hotspot `html-directory`. No CDN, no build step, no external fonts.
Single-field voucher login (with QR scan), CHAP (MD5) login preserved, light/dark theme, mobile first.

## Files to upload to the router

```
login.html  alogin.html  status.html  logout.html  error.html  rlogin.html  redirect.html  radvert.html
md5.js  favicon.svg
css/app.css
js/config.js  js/icons.js  js/app.js  js/qr-scan.js  js/qr-decode.js
img/logo.svg
```

Do **not** upload `tools/` or any `*.test.js` (development helpers only).

## 1. Brand it

Edit `js/config.js` (brand name, tagline, logo path, WhatsApp number, default login mode, QR scan on/off, language) and
replace `img/logo.svg` (any SVG/PNG/JPG; keep it square). Colours live as tokens at the top of `css/app.css`
(`--accent` is the single accent colour).

## 2. Upload to the router

Option A - WinBox/WebFig: *Files* -> drag the whole folder in (it must end up as e.g. `hotspot-nextmon/login.html`, `hotspot-nextmon/css/app.css`, ...).

Option B - FTP (enable `/ip service ftp`; disable it again afterwards):

```
ftp <router-ip>            # login with a router user
mkdir hotspot-nextmon
cd hotspot-nextmon
put login.html            # repeat for every file, keeping the css/ js/ img/ sub-folders
```

Option C - SCP/SFTP from a PC: `scp -r hotspot-nextmon admin@<router-ip>:/`

(Routers with a `flash` folder: use `flash/hotspot-nextmon` as the path.)

## 3. Activate

```
/ip hotspot profile set [find name=hsprof1] html-directory=hotspot-nextmon
# keep CHAP enabled so passwords are never sent in clear text from this page:
/ip hotspot profile set [find name=hsprof1] login-by=http-chap,cookie,mac-cookie
```

Per-profile: set `html-directory` on each hotspot server profile that should use the theme. To go back:
`/ip hotspot profile set [find name=hsprof1] html-directory=hotspot` (the default folder; `/ip hotspot reset-html` recreates it).

Changes to files take effect immediately - no restart. If a phone still shows the old page, clear the captive-portal
browser cache or forget/reconnect the WiFi.

## How it works / template variables

RouterOS substitutes `$(...)` variables in `*.html` files only. Therefore all router values are read in a small **inline,
non-strict** `<script>` in each page (`var HS = {...}`); the shared JS files never contain `$(...)`.
(Non-strict matters: `chap-id` contains octal escapes such as `\275`, which a strict-mode script rejects.)

| Page | Variables used |
|------|----------------|
| login.html | `link-login-only`, `link-orig`, `chap-id`, `chap-challenge`, `error`, `username`, `ip`, `mac`, `mac-esc`, `identity`, `trial`, `link-orig-esc` |
| alogin.html | `username`, `link-redirect`, `link-status`, `identity` |
| status.html | `username`, `uptime`, `uptime-secs`, `session-time-left`, `remain-bytes-total(-nice)`, `bytes-in-nice`, `bytes-out-nice`, `refresh-timeout(-secs)`, `link-logout`, `link-redirect`, `link-advert`, `advert-pending`, `ip`, `mac` |
| logout.html | `username`, `uptime`, `bytes-in-nice`, `bytes-out-nice`, `session-time-left`, `link-login`, `ip`, `mac` |
| error.html | `error`, `error-orig`, `link-login`, `ip`, `mac` |
| rlogin.html / redirect.html / radvert.html | `link-redirect`, `link-login` |

CHAP flow (kept from the stock template): when `chap-id` is non-empty the visible inputs have no `name`, and the hidden
`password` field is set to `hexMD5(chap-id + password + chap-challenge)` (`md5.js`, byte-exact, tested against Node `crypto`).
When `chap-id` is empty (profile has only `http-pap`) the plain password is posted, as the stock page does.

Voucher single-code mode: one field; username = password = the code (the usual Mikhmon/NextMON voucher layout). The
"Username" tab switches to the classic two-field form. The choice is remembered in `localStorage`.

Link/QR login: opening `http://<hotspot>/login?username=CODE&password=CODE` (the URL printed in the voucher QR)
pre-fills and submits automatically once (guarded to avoid loops after an error).

## QR scan - what works where

- Decoder: native `BarcodeDetector` when the browser has it, otherwise the bundled `js/qr-decode.js` (loaded on demand).
- Live camera needs a **secure context**. The captive portal is normally plain HTTP, and browsers then block
  `getUserMedia`; the dialog says so and offers **"Ambil foto QR"** (opens the phone camera / gallery via `<input capture>`),
  which works over HTTP. For live scanning, serve the login page over HTTPS: set `/ip hotspot profile ssl-certificate=...`
  and `login-by=https` (clients need to trust the certificate).
- The scanner accepts the voucher login URL, `username=..&password=..`, or a bare code.

## Local preview (no router)

```
node tools/preview-render.js <outDir> [fresh|error|chap|trial]
```
renders the pages with sample router variables (and fails on unbalanced `$(if)/$(endif)`); open `<outDir>/login.html`
in a browser. Tests: `node md5.test.js`, `node js/qr-decode.test.js`.

## Notes / limits

- Error texts from RouterOS are English; common ones are mapped to Indonesian in `js/app.js` (`friendlyError`), the
  original text is shown in small print below. Unknown messages are shown unchanged.
- The page uses `$(else)`-free templates and only `$(if x)`, `$(if x == 'y')`, `$(endif)`, which exist in RouterOS v6 and v7.
- Not tested on a real router in this repository (no device available); the HTML was rendered and exercised in headless Chrome
  with substituted variables.
