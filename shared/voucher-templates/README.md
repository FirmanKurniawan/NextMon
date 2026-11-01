# Voucher print templates

Pure HTML/CSS. Each template contains one element with the attribute `data-voucher`; a generator repeats that element
once per voucher and replaces the placeholders.

| File | Layout |
|------|--------|
| `a4-grid.html` | A4, 3 x 9 = 27 vouchers per page, dashed cut lines, `@page` margin 8 mm |
| `glass-card.html` | 85.6 x 54 mm card, 2 x 5 per A4 page (enable "Background graphics" when printing) |
| `thermal-58.html` | 58 mm roll, one voucher per slip |
| `thermal-80.html` | 80 mm roll, code left / QR right |

Placeholders: `{{username}} {{password}} {{price}} {{validity}} {{profile}} {{qr}} {{dns}} {{brand}}`.
`{{qr}}` must be an image URL/data-URL (use as `<img src="{{qr}}">`); its content is the login link
`http://{{dns}}/login?username=U&password=P` (for single-code vouchers only `username=` is used).
Values should be HTML-escaped by the generator (`fill.js` does this for the preview).

`qr.js` is a dependency-free QR encoder (`QR.encode / toSVG / toDataURL / toCanvas`, byte mode, versions 1-40, ECC L/M/Q/H).
`fill.js` fills placeholders and repeats the card **only when `{{` is still present** in the page, so server-rendered output
is left untouched (remove the two `<script>` tags in production if you prefer).

Preview: open `preview.html` (works from `file://`), pick a template, adjust the sample data, print from the toolbar.
Direct: `a4-grid.html?count=27&price=Rp%205.000&validity=1%20Hari&brand=MyNet&dns=wifi.net&mode=userpass`.

Tests: `node qr.test.js`.

## nextmon-php card designs

`nextmon-php` ships eleven built-in designs (Glass Aurora, Glass Mini 85.6x54, Compact Strip 60x28, Dark Glass, Minimal Mono, Ticket, Wi-Fi Card 90x52, Receipt Pro 62x92,
Thermal 58, Thermal 80, Brand Banner) in `nextmon-php/public/assets/js/voucher.js` + `public/assets/css/voucher.css`.
They are mm-based, recolour from one accent (`--vc-a`, `--vc-a2`, `--vc-a3`, `--vc-tint`), and flatten to black on white with the
"ink saver" switch. Custom templates in the app use `{{user}} {{pass}} {{code}} {{creds}} {{profile}} {{price}} {{validity}} {{limit}}
{{comment}} {{serial}} {{dns}} {{login_url}} {{qr}} {{logo}} {{scan}} {{hotspot}}` plus a card size in mm.
The QR encoder is `qr.js` from this folder (plus `QR.styled()` for rounded modules and a centre logo, which forces ECC H).
Thermal output from the print view uses `nextmon-php/public/assets/js/escpos.js` (ESC/POS: native `GS ( k` QR or `GS v 0` raster fallback);
tests: `node nextmon-php/tests/js/escpos.test.js`. Extra placeholders: `{{ssid}} {{wifipass}}`.
