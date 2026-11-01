/* NextMON voucher designs + print workspace + template editor + generator preview.
   Needs qr.js (window.QR). No dependencies, no CDN.
   Public API: window.NextMONVoucher = { DESIGNS, PLACEHOLDERS, card(design, item, ctx), derive(hex) } */
(function () {
  'use strict';
  var doc = document, MM = 96 / 25.4;
  var $ = function (s, r) { return (r || doc).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); };
  var K = window.NextMON = window.NextMON || {};

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(msg, kind) { if (K.toast) K.toast(msg, kind); }
  function jsonOf(id, def) { var el = $(id); if (!el) return def; try { return JSON.parse(el.textContent); } catch (e) { return def; } }

  var L = { code: 'Voucher code', username: 'Username', password: 'Password', scan: 'Scan to login', profile: 'Package', valid: 'Valid', price: 'Price',
    limit: 'Time limit', ssid: 'Wi-Fi network', wpass: 'Wi-Fi password', serial: 'No.' };
  function setLabels(o) { if (o) for (var k in o) L[k] = o[k]; }

  /* ---------------------------------------------------------------- colour helpers */
  function hex2rgb(h) {
    h = String(h || '').replace('#', '');
    if (h.length === 3) h = h.replace(/./g, '$&$&');
    if (!/^[0-9a-f]{6}$/i.test(h)) h = '0b7285';
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function rgb2hsl(c) {
    var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), h = 0, s = 0, l = (mx + mn) / 2;
    if (mx !== mn) {
      var d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60;
    }
    return [h, s, l];
  }
  function hsl2rgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    var q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    var f = function (t) { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    if (s === 0) return [l * 255, l * 255, l * 255].map(Math.round);
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map(function (x) { return Math.round(x * 255); });
  }
  function hx(c) { return '#' + c.map(function (x) { return ('0' + Math.max(0, Math.min(255, x)).toString(16)).slice(-2); }).join(''); }
  /* One brand colour -> accent, lighter neighbour (hue nudged 14deg, no rainbow), deep shade, page tint, text-on-accent. */
  function derive(hex) {
    var rgb = hex2rgb(hex), h = rgb2hsl(rgb), a = rgb;
    var a2 = hsl2rgb(h[0] + 14, Math.min(.85, h[1] * .95), Math.min(.7, h[2] + .17));
    var a3 = hsl2rgb(h[0], Math.min(.9, h[1] * 1.05), Math.max(.12, h[2] * .42));
    var tint = hsl2rgb(h[0], Math.min(.5, h[1] * .55), .94);
    var lum = (0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]) / 255;
    return { '--vc-a': hx(a), '--vc-a2': hx(a2), '--vc-a3': hx(a3), '--vc-tint': hx(tint), '--vc-on': lum > .62 ? '#0d1b24' : '#ffffff',
      '--vc-ar': a.join(','), '--vc-a2r': a2.join(','), '--vc-a3r': a3.join(',') };
  }
  function applyVars(el, hex) { var v = derive(hex); for (var k in v) el.style.setProperty(k, v[k]); }

  /* ---------------------------------------------------------------- designs */
  var BRAND = '<div class="vc-brand" data-f="brand">{{logo}}<span>{{hotspot}}</span></div>';
  var QRB = '<div class="vc-side" data-f="qr"><div class="vc-qrbox"><div class="vc-qr">{{qr}}</div></div><span class="vc-cap">{{scan}}</span></div>';
  var DESIGNS = [
    { id: 'aurora', name: 'Glass Aurora', w: 64, h: 38, paper: 'a4', html:
      '<i class="vc-mesh"></i><div class="vc-pane"><div class="vc-main"><div class="vc-head">' + BRAND + '<span class="vc-chip" data-f="profile">{{profile}}</span></div>{{creds}}' +
      '<div class="vc-pills"><span class="vc-pill" data-f="validity">{{validity}}</span><span class="vc-pill s" data-f="price">{{price}}</span></div></div>' + QRB + '</div>' },
    { id: 'mini', name: 'Glass Mini', w: 85.6, h: 54, paper: 'a4', html:
      '<i class="vc-mesh"></i><div class="vc-pane"><div class="vc-head">' + BRAND + '<span class="vc-pill" data-f="price">{{price}}</span></div>{{creds}}' + QRB +
      '<div class="vc-foot"><div><b data-f="profile">{{profile}}</b><span class="vd" data-f="validity">{{validity}}</span></div><span class="vd" data-f="dns">{{dns}}</span></div></div>' },
    { id: 'strip', name: 'Compact Strip', w: 60, h: 28, paper: 'a4', html:
      '<i class="vc-bar"></i><div class="vc-main">' + BRAND + '{{creds}}<div class="vc-meta"><b data-f="profile">{{profile}}</b><span data-f="validity"><i></i>{{validity}}</span><span data-f="price"><i></i><b>{{price}}</b></span></div></div>' +
      '<div class="vc-side" data-f="qr"><div class="vc-qr">{{qr}}</div><span class="vc-cap">{{scan}}</span></div>' },
    { id: 'dark', name: 'Dark Glass', w: 64, h: 38, paper: 'a4', html:
      '<i class="vc-mesh"></i><div class="vc-pane">' + QRB + '<div class="vc-main"><div class="vc-head">' + BRAND + '<span class="vc-chip" data-f="profile">{{profile}}</span></div>{{creds}}' +
      '<div class="vc-pills"><span class="vc-pill" data-f="validity">{{validity}}</span><span class="vc-pill s" data-f="price">{{price}}</span></div></div></div>' },
    { id: 'mono', name: 'Minimal Mono', note: 'B/W safe', w: 60, h: 32, paper: 'a4', html:
      '<div class="vc-head">' + BRAND + '<span class="vc-pill" data-f="price">{{price}}</span></div>{{creds}}<div class="vc-side" data-f="qr"><div class="vc-qr">{{qr}}</div></div>' +
      '<div class="vc-foot"><span data-f="profile"><b>{{profile}}</b></span><span data-f="validity">{{validity}}</span><span data-f="dns">{{dns}}</span></div>' },
    { id: 'ticket', name: 'Ticket', w: 96, h: 36, paper: 'a4', html:
      '<div class="vc-main"><div class="vc-head">' + BRAND + '<span class="vc-chip" data-f="profile">{{profile}}</span></div>{{creds}}' +
      '<div class="vc-meta"><span data-f="validity">' + '{{lblValid}} <b>{{validity}}</b></span><span data-f="price"><b>{{price}}</b></span><span data-f="dns">{{dns}}</span></div></div>' +
      '<div class="vc-stub" data-f="qr"><div class="vc-qr">{{qr}}</div><span class="vc-serial" data-f="serial">{{serial}}</span></div>' },
    { id: 't58', name: 'Thermal 58', note: '58 mm roll', w: 58, h: 84, auto: true, thermal: true, paper: 't58', cls: 'vc-thermal', html:
      BRAND + '<div class="vc-sep"></div>{{creds}}<div data-f="qr"><div class="vc-qr">{{qr}}</div><span class="vc-cap">{{scan}}</span></div><div class="vc-sep"></div>' +
      '<div class="vc-rows"><div data-f="profile"><span>{{lblProfile}}</span><b>{{profile}}</b></div><div data-f="validity"><span>{{lblValid}}</span><b>{{validity}}</b></div><div data-f="price"><span>{{lblPrice}}</span><b>{{price}}</b></div></div>' +
      '<div class="vc-dns" data-f="dns">{{dns}}</div>' },
    { id: 't80', name: 'Thermal 80', note: '80 mm roll', w: 80, h: 60, auto: true, thermal: true, paper: 't80', cls: 'vc-thermal vc-t80', html:
      BRAND + '<div class="vc-sep"></div><div class="vc-body">{{creds}}<div class="vc-side" data-f="qr"><div class="vc-qr">{{qr}}</div></div></div><div class="vc-sep"></div>' +
      '<div class="vc-rows"><div data-f="profile"><span>{{lblProfile}}</span><b>{{profile}}</b></div><div data-f="validity"><span>{{lblValid}}</span><b>{{validity}}</b></div><div data-f="price"><span>{{lblPrice}}</span><b>{{price}}</b></div></div>' +
      '<div class="vc-dns" data-f="dns">{{dns}}</div>' },
    { id: 'banner', name: 'Brand Banner', w: 96, h: 44, paper: 'a4', html:
      '<div class="vc-band">' + BRAND + '<span class="vc-pill" data-f="price">{{price}}</span></div><div class="vc-body">{{creds}}<div class="vc-side" data-f="qr"><div class="vc-qr">{{qr}}</div></div></div>' +
      '<div class="vc-foot"><span><b data-f="profile">{{profile}}</b> <span data-f="validity">&nbsp;{{validity}}</span></span><span data-f="dns">{{dns}}</span></div>' },
    { id: 'wifi', name: 'Wi-Fi Card', note: 'network + login', w: 90, h: 52, paper: 'a4', html:
      '<div class="vc-head">' + BRAND + '<span class="vc-pill" data-f="price">{{price}}</span></div>' +
      '<div class="vc-body"><div class="vc-step" data-f="wifi"><i class="vc-n"></i><div class="vc-kv"><span class="vc-lbl">{{lblSsid}}</span><b>{{ssid}}</b>' +
      '<span class="vc-lbl" data-f="wpass">{{lblWpass}}</span><b data-f="wpass">{{wifipass}}</b></div></div>' +
      '<div class="vc-step"><i class="vc-n"></i>{{creds}}</div></div>' +
      '<div class="vc-side" data-f="qr"><div class="vc-qrbox"><div class="vc-qr">{{qr}}</div></div><span class="vc-cap">{{scan}}</span></div>' +
      '<div class="vc-foot"><span><b data-f="profile">{{profile}}</b> <span data-f="validity">&nbsp;{{validity}}</span></span><span data-f="dns">{{dns}}</span></div>' },
    { id: 'receipt', name: 'Receipt Pro', note: 'price table', w: 62, h: 92, paper: 'a4', html:
      '<div class="vc-head">' + BRAND + '</div>' +
      '<table class="vc-tbl"><tbody><tr data-f="profile"><td>{{lblProfile}}</td><td>{{profile}}</td></tr><tr data-f="validity"><td>{{lblValid}}</td><td>{{validity}}</td></tr>' +
      '<tr data-f="limit"><td>{{lblLimit}}</td><td>{{limit}}</td></tr><tr class="tot" data-f="price"><td>{{lblPrice}}</td><td>{{price}}</td></tr></tbody></table>' +
      '<div class="vc-credbox">{{creds}}</div>' +
      '<div class="vc-side" data-f="qr"><div class="vc-qr">{{qr}}</div><span class="vc-cap">{{scan}}</span></div>' +
      '<div class="vc-foot"><span data-f="serial">{{lblSerial}} {{serial}}</span><span data-f="dns">{{dns}}</span></div>' }
  ];
  var DMAP = {}; DESIGNS.forEach(function (d) { DMAP[d.id] = d; });

  var PLACEHOLDERS = [
    ['{{hotspot}}', 'Hotspot / brand name'], ['{{user}}', 'Username (voucher code)'], ['{{pass}}', 'Password'], ['{{code}}', 'Username (grouped only if grouping is enabled)'],
    ['{{creds}}', 'Ready-made code block (one or two rows, styled)'], ['{{profile}}', 'Profile / package'], ['{{price}}', 'Selling price'], ['{{validity}}', 'Validity'],
    ['{{limit}}', 'Time limit'], ['{{ssid}}', 'Wi-Fi network name (print view, Brand)'], ['{{wifipass}}', 'Wi-Fi password (print view, Brand)'], ['{{comment}}', 'Batch tag'], ['{{serial}}', 'Number in batch (001)'], ['{{dns}}', 'Hotspot host name'], ['{{login_url}}', 'Auto-login URL'],
    ['{{qr}}', 'QR code (SVG)'], ['{{logo}}', 'Logo image (if set)'], ['{{scan}}', 'Caption: scan to login']
  ];

  /* ---------------------------------------------------------------- QR + fill */
  var qrCache = {};
  function qrSvg(text, o) {
    var key = [text, o.ecc, o.style, o.logo ? o.logo.length : 0, o.dark].join('|');
    if (qrCache[key]) return qrCache[key];
    var s;
    try { s = window.QR.styled(text, { ecc: o.ecc, style: o.style, logo: o.logo || null, dark: o.dark, light: null, margin: 1 }); } catch (e) { s = '<span class="vc-ph">QR?</span>'; }
    var keys = Object.keys(qrCache); if (keys.length > 1500) delete qrCache[keys[0]];
    return (qrCache[key] = s);
  }
  function hostOf(u) { var m = /^[a-z]+:\/\/([^\/?#]+)/i.exec(u || ''); return m ? m[1] : ''; }
  function qrText(it, ctx) {
    var base = ctx.base || 'http://hotspot.local/login', sep = base.indexOf('?') < 0 ? '?' : '&';
    if (ctx.qrMode === 'code') return it.user;
    if (ctx.qrMode === 'user') return base + sep + 'username=' + encodeURIComponent(it.user);
    return base + sep + 'username=' + encodeURIComponent(it.user) + '&password=' + encodeURIComponent(it.pass == null || it.pass === '' ? it.user : it.pass);
  }
  function groupCode(s, on) {
    var n = s.length, g = 0;
    if (on === false || n <= 5) return [s];
    g = n % 3 === 0 && n <= 9 ? 3 : n % 4 === 0 ? 4 : n <= 7 ? 3 : 4;
    var out = []; for (var i = 0; i < n; i += g) out.push(s.slice(i, i + g));
    if (out.length > 1 && out[out.length - 1].length === 1) { out[out.length - 2] += out.pop(); }
    return out;
  }
  /* Look-alike characters. The digit 0 gets a slashed zero (font feature), the letters I l O are underlined so they cannot be taken for 1 / 1 / 0. */
  var AMB = /[IlO]/;
  function hasAmbiguous(s) { return AMB.test(String(s)); }
  function markChars(p) { return Array.prototype.map.call(p, function (ch) { return AMB.test(ch) ? '<u>' + esc(ch) + '</u>' : esc(ch); }).join(''); }
  function codeHtml(s, ctx) {
    s = String(s);
    var parts = groupCode(s, !!(ctx && ctx.group === true)), eff = s.length + (parts.length - 1) * .45, k = Math.min(1, 8.6 / eff);
    return '<b class="vc-code" data-raw="' + esc(s) + '" style="--k:' + (Math.round(k * 100) / 100) + ';--n:' + (Math.round(eff * 100) / 100) + '">' + parts.map(function (p) { return '<i>' + markChars(p) + '</i>'; }).join('') + '</b>';
  }
  function credsHtml(it, ctx) {
    var two = it.pass && it.pass !== it.user;
    if (!two) return '<div class="vc-creds" data-f="creds"><div><span class="vc-lbl">' + esc(L.code) + '</span>' + codeHtml(it.user, ctx) + '</div></div>';
    return '<div class="vc-creds two" data-f="creds"><div><span class="vc-lbl">' + esc(L.username) + '</span>' + codeHtml(it.user, ctx) + '</div>' +
      '<div data-f="pass"><span class="vc-lbl">' + esc(L.password) + '</span>' + codeHtml(it.pass, ctx) + '</div></div>';
  }
  /* placeholders -> escaped values. Custom templates and built-in designs share this. */
  function fillHtml(html, it, ctx) {
    var qr = '<span class="qr">' + qrSvg(qrText(it, ctx), ctx.qr) + '</span>';
    var map = {
      hotspot: esc(ctx.name), brand: esc(ctx.name), user: esc(it.user), username: esc(it.user), pass: esc(it.pass), password: esc(it.pass),
      code: groupCode(String(it.user), ctx.group === true).map(esc).join(' '), creds: credsHtml(it, ctx), profile: esc(it.profile), price: esc(it.price), validity: esc(it.validity),
      limit: esc(it.limit), comment: esc(it.comment), serial: esc(it.serial), dns: esc(ctx.dns), login_url: esc(qrText(it, { base: ctx.base, qrMode: 'login' })),
      qr: qr, logo: ctx.logo ? '<img class="vc-logo" alt="" src="' + esc(ctx.logo) + '">' : '', scan: esc(ctx.qrMode === 'code' ? L.code : L.scan),
      lblvalid: esc(L.valid), lblprofile: esc(L.profile), lblprice: esc(L.price), lbllimit: esc(L.limit), lblssid: esc(L.ssid), lblwpass: esc(L.wpass), lblserial: esc(L.serial),
      ssid: esc(ctx.ssid || ''), wifipass: esc(ctx.wifipass || '')
    };
    return html.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, function (m, k) { return Object.prototype.hasOwnProperty.call(map, k.toLowerCase()) ? map[k.toLowerCase()] : m; });
  }
  /* returns an element .vc (unscaled) */
  function card(design, it, ctx) {
    var el = doc.createElement('div');
    var cust = !!design.custom;
    el.className = 'vc ' + (cust ? 'vc-custom' : 'vc-' + design.id + (design.cls ? ' ' + design.cls : '') + (design.auto ? ' vc-auto' : ''));
    el.style.setProperty('--w', design.w); el.style.setProperty('--h', design.h);
    el.setAttribute('data-user', it.user);
    el.innerHTML = fillHtml(design.html, it, ctx);
    var f = ctx.fields || {}, nm = String(ctx.name || '').length;
    el.style.setProperty('--bk', nm <= 16 ? 1 : nm <= 28 ? .92 : nm <= 40 ? .82 : .72); if (nm > 16) el.className += ' vc-longname';
    $$('[data-f]', el).forEach(function (n) {
      var k = n.getAttribute('data-f');
      var empty = (k === 'profile' || k === 'validity' || k === 'price' || k === 'limit') && !String(it[k] == null ? '' : it[k]).trim();
      if (k === 'wifi' && !String(ctx.ssid || '').trim()) empty = true;
      if (k === 'wpass' && !String(ctx.wifipass || '').trim()) empty = true;
      if ((f[k] === false || empty) && n.parentNode) n.parentNode.removeChild(n);
    });
    if (cust) { el.style.width = design.w + 'mm'; el.style.height = design.h + 'mm'; }
    return el;
  }

  /* ---------------------------------------------------------------- state + papers */
  var PAPERS = {
    a4: { n: 'A4', w: 210, h: 297 }, a5: { n: 'A5', w: 148, h: 210 }, letter: { n: 'Letter', w: 215.9, h: 279.4 }, f4: { n: 'F4 / Folio', w: 215, h: 330 },
    t58: { n: 'Thermal 58', w: 58, h: 0, roll: true }, t80: { n: 'Thermal 80', w: 80, h: 0, roll: true }
  };
  var DEFAULTS = {
    design: 'aurora', paper: 'a4', land: false, cols: 0, gap: 3, margin: 6, scale: 100,
    f: { brand: true, logo: true, profile: true, validity: true, price: true, pass: true, qr: true, dns: true, serial: true, wifi: true },
    qrMode: 'login', ecc: 'M', qrStyle: 'square', qrLogo: false, ink: false, guides: true, accent: '#0b7285', name: '', logo: '', zoom: 'fit',
    group: false, ssid: '', wifipass: '', tqr: 'native'
  };
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function merge(base, extra) {
    var o = clone(base); if (!extra) return o;
    Object.keys(extra).forEach(function (k) {
      if (k === 'f' && extra.f && typeof extra.f === 'object') { Object.keys(extra.f).forEach(function (x) { o.f[x] = !!extra.f[x]; }); }
      else if (k in DEFAULTS && typeof extra[k] === typeof DEFAULTS[k]) o[k] = extra[k];
    });
    var cl = function (v, lo, hi) { return Math.max(lo, Math.min(hi, +v || 0)); };
    o.scale = cl(o.scale, 50, 150); o.gap = cl(o.gap, 0, 12); o.margin = cl(o.margin, 0, 20); o.cols = Math.round(cl(o.cols, 0, 8));
    return o;
  }

  /* ---------------------------------------------------------------- print workspace */
  function initPrint() {
    var root = $('#vp-root'); if (!root) return;
    var data = jsonOf('#vp-data', {}); setLabels(data.i18n);
    var items = (data.items || []).map(function (x, i) { x.serial = ('00' + (i + 1)).slice(-3); return x; });
    var customs = (data.templates || []).map(function (t) { return { id: 'c:' + t.id, tid: t.id, name: t.name, w: +t.w || 70, h: +t.h || 40, html: t.html, custom: true, paper: 'a4' }; });
    var presets = data.presets || [];
    var KEY = 'nextmon.vp.v3', st = clone(DEFAULTS), saved = null;
    var q = new URLSearchParams(location.search);
    try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { saved = null; }
    if (saved) st = merge(DEFAULTS, saved);
    else if (data.defaultPreset) { var dp = presets.filter(function (p) { return p.id === data.defaultPreset; })[0]; if (dp) st = merge(DEFAULTS, dp.opts); }
    if (q.get('design') && (DMAP[q.get('design')] || false)) st.design = q.get('design');
    if (q.get('tpl')) { var cc = customs.filter(function (c) { return c.tid === q.get('tpl'); })[0]; if (cc) st.design = cc.id; }
    if (q.get('cols') && +q.get('cols') > 0) st.cols = Math.min(8, +q.get('cols'));
    if (!designOf(st.design)) st.design = 'aurora';
    var sel = null, only = null, token = 0;
    var ambig = items.some(function (i) { return hasAmbiguous(i.user) || hasAmbiguous(i.pass); });

    var stage = $('#vp-stage'), pageStyle = $('#vp-pagestyle'), thumbsBox = $('#vp-thumbs');

    function designOf(id) { return DMAP[id] || customs.filter(function (c) { return c.id === id; })[0] || null; }
    function persist() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* quota: ignore */ } }
    function ctxOf() {
      var logoOn = st.f.logo && st.logo;
      return {
        name: st.name || data.hotspot || 'WiFi', dns: hostOf(data.loginBase) || '', base: data.loginBase, qrMode: st.qrMode, group: st.group === true,
        ssid: st.ssid, wifipass: st.wifipass,
        logo: logoOn ? st.logo : '', fields: Object.assign({}, st.f, { creds: true }),
        qr: { ecc: st.qrLogo && logoOn ? 'H' : st.ecc, style: st.qrStyle, logo: st.qrLogo && logoOn ? st.logo : null, dark: st.ink ? '#000' : '#0b1620' }
      };
    }
    function paperDims() {
      var P = PAPERS[st.paper] || PAPERS.a4, w = P.w, h = P.h;
      if (!P.roll && st.land) { var t = w; w = h; h = t; }
      return { w: w, h: h, roll: !!P.roll };
    }
    var heightCache = {};
    function measureAuto(des, ctx, sc) {
      var key = [des.id, JSON.stringify(st.f), st.qrMode, st.qrLogo, !!ctx.logo, items.length ? items[0].user.length : 0].join('|');
      if (heightCache[key]) return heightCache[key];
      var probe = doc.createElement('div');
      probe.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden';
      probe.className = 'vp-root'; applyVars(probe, st.accent);
      var it = items[0] || sampleItem();
      var c = card(des, it, ctx); c.style.height = 'auto'; probe.appendChild(c); doc.body.appendChild(probe);
      var h = Math.ceil(c.getBoundingClientRect().height / MM * 10) / 10;
      doc.body.removeChild(probe);
      return (heightCache[key] = Math.max(20, h));
    }
    function geometry() {
      var des = designOf(st.design), P = paperDims(), ctx = ctxOf();
      var cw0 = des.w, ch0 = des.auto ? measureAuto(des, ctx) : des.h;
      var m = P.roll ? 0 : Math.max(st.margin, st.gap / 2), g = st.gap, sc = st.scale / 100, clipped = false;
      var uw = P.w - 2 * m;
      if (cw0 * sc > uw + 0.01) { sc = uw / cw0; clipped = true; }
      var cw = cw0 * sc, ch = ch0 * sc;
      var fit = Math.max(1, Math.floor((uw + g) / (cw + g) + 1e-6)), cols = st.cols ? Math.min(st.cols, fit) : fit, rows, H = P.h;
      if (P.roll) { cols = 1; rows = 1; H = ch + 2 * m; }
      else rows = Math.max(1, Math.floor((P.h - 2 * m + g) / (ch + g) + 1e-6));
      if (!P.roll && ch > P.h - 2 * m) clipped = true;
      return { des: des, P: P, W: P.w, H: H, m: m, g: g, sc: sc, cw: cw, ch: ch, cols: cols, rows: rows, per: cols * rows, clipped: clipped, ctx: ctx, ch0: ch0 };
    }

    /* ---- render the paged preview ---- */
    function render(sync, cb) {
      if (renderRaf) { cancelAnimationFrame(renderRaf); renderRaf = 0; }
      var mine = ++token, geo = geometry(), list = only ? items.filter(function (i) { return i.user === only; }) : items;
      applyVars(root, st.accent);
      root.classList.toggle('vp-ink', !!st.ink); root.classList.toggle('vp-guides', !!st.guides && !geo.P.roll);
      pageStyle.textContent = '@page{size:' + geo.W + 'mm ' + geo.H + 'mm;margin:0}';
      var pages = Math.max(1, Math.ceil(list.length / geo.per));
      stage.innerHTML = '';
      var avail = stage.clientWidth - 40, z = st.zoom === 'fit' ? Math.min(1.25, Math.max(.25, avail / (geo.W * MM))) : (+st.zoom || 1);
      if (geo.clipped) { var n = doc.createElement('div'); n.className = 'vp-notice'; n.textContent = data.i18n.clipped; stage.appendChild(n); }
      if (ambig) { var am = doc.createElement('div'); am.className = 'vp-notice vp-note-info'; am.textContent = data.i18n.lookalike; stage.appendChild(am); }
      var info = $('#vp-info');
      if (info) info.textContent = list.length + ' / ' + geo.per + ' ' + (data.i18n.perSheet) + ' x ' + pages + ' ' + (data.i18n.sheets) + ' - ' + geo.cols + 'x' + geo.rows;
      if (!list.length) { var em = doc.createElement('div'); em.className = 'vp-notice'; em.textContent = data.i18n.empty; stage.appendChild(em); return; }
      var gridW = geo.cols * geo.cw + (geo.cols - 1) * geo.g, left = (geo.W - gridW) / 2, p = 0;
      function one() {
        if (mine !== token) return;
        var frame = doc.createElement('div'); frame.className = 'pv-frame';
        frame.style.width = geo.W * MM * z + 'px'; frame.style.height = geo.H * MM * z + 'px';
        var sheet = doc.createElement('div'); sheet.className = 'pv-sheet';
        sheet.style.width = geo.W + 'mm'; sheet.style.height = 'calc(' + geo.H + 'mm - .5mm)'; sheet.style.transform = 'scale(' + z + ')';
        var grid = doc.createElement('div'); grid.className = 'pv-grid';
        grid.style.cssText = 'position:absolute;left:' + left + 'mm;top:' + geo.m + 'mm;grid-template-columns:repeat(' + geo.cols + ',' + geo.cw + 'mm);gap:' + geo.g + 'mm;--gap:' + geo.g;
        var from = p * geo.per, to = Math.min(list.length, from + geo.per);
        for (var i = from; i < to; i++) {
          var cell = doc.createElement('div'); cell.className = 'vc-cell' + (list[i].user === sel ? ' sel' : '');
          cell.style.width = geo.cw + 'mm'; cell.style.height = geo.ch + 'mm'; cell.setAttribute('data-user', list[i].user);
          var c = card(geo.des, list[i], geo.ctx); if (geo.des.auto) c.style.height = geo.ch0 + 'mm';
          c.style.transform = 'scale(' + geo.sc + ')'; cell.appendChild(c); grid.appendChild(cell);
        }
        sheet.appendChild(grid);
        var no = doc.createElement('span'); no.className = 'pv-sheet-no'; no.textContent = (p + 1) + '/' + pages; sheet.appendChild(no);
        frame.appendChild(sheet); stage.appendChild(frame);
        p++;
        if (p < pages) { if (sync) one(); else requestAnimationFrame(one); } else if (cb) cb();
      }
      one();
    }

    /* ---- controls <-> state ---- */
    function reflect() {
      $$('[data-opt]').forEach(function (el) {
        var k = el.dataset.opt, v = k.indexOf('f.') === 0 ? st.f[k.slice(2)] : st[k];
        if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
        var out = el.parentNode && $('output', el.parentNode); if (out) out.textContent = v + (el.dataset.unit || '');
      });
      $$('[data-design]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.design === st.design ? 'true' : 'false'); });
      $$('[data-sw]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.sw.toLowerCase() === st.accent.toLowerCase() ? 'true' : 'false'); });
      var lp = $('#vp-logo-prev'); if (lp) { lp.hidden = !st.logo; if (st.logo) lp.src = st.logo; }
      var qrl = $('[data-opt="qrLogo"]'); if (qrl) { qrl.disabled = !st.logo; if (!st.logo) qrl.checked = false; }
      var eccSel = $('[data-opt="ecc"]'); if (eccSel) eccSel.disabled = !!(st.qrLogo && st.logo);
      var land = $('[data-opt="land"]'); if (land) land.disabled = !!(PAPERS[st.paper] || {}).roll;
      var pill = $('#vp-ecc-note'); if (pill) pill.textContent = st.qrLogo && st.logo ? data.i18n.eccH : '';
    }
    var persistT = 0, renderRaf = 0;
    function persistSoon() { clearTimeout(persistT); persistT = setTimeout(persist, 200); }
    window.addEventListener('pagehide', function () { clearTimeout(persistT); persist(); });
    /* slider drags fire many input events per frame: rebuild the preview once per frame, newest state wins */
    function renderSoon() { if (renderRaf) return; renderRaf = requestAnimationFrame(function () { renderRaf = 0; render(false); }); }
    function change() { persistSoon(); reflect(); renderSoon(); }
    doc.addEventListener('input', function (e) {
      var el = e.target.closest('[data-opt]'); if (!el) return;
      var k = el.dataset.opt, v = el.type === 'checkbox' ? el.checked : el.value;
      if (el.type === 'range' || el.dataset.num) v = parseFloat(v);
      if (el.dataset.num && isNaN(v)) v = 0;
      if (k.indexOf('f.') === 0) st.f[k.slice(2)] = !!v; else st[k] = v;
      if (k === 'paper') { var d = designOf(st.design); if (d && d.thermal && !PAPERS[v].roll) st.design = 'aurora'; }
      if (k === 'accent') { change(); return; }
      change();
    });
    doc.addEventListener('click', function (e) {
      var b;
      if ((b = e.target.closest('[data-design]'))) {
        st.design = b.dataset.design; var d = designOf(st.design);
        if (d.thermal) st.paper = d.paper; else if ((PAPERS[st.paper] || {}).roll) st.paper = 'a4';
        sel = null; change(); selbar(); return;
      }
      if ((b = e.target.closest('[data-sw]'))) { st.accent = b.dataset.sw; change(); return; }
      if (e.target.closest('[data-logo-clear]')) { st.logo = ''; st.qrLogo = false; change(); return; }
      if (e.target.closest('[data-reset]')) { var keepLogo = st.logo; st = clone(DEFAULTS); st.logo = keepLogo; sel = null; change(); selbar(); return; }
      if (e.target.closest('[data-vp-print]')) { only = null; render(true, function () { window.print(); }); return; }
      if (e.target.closest('[data-print-sel]')) { printSelected(); return; }
      if (e.target.closest('[data-png]')) { downloadPng(); return; }
      if (e.target.closest('[data-copy]')) { copyCode(); return; }
      if (e.target.closest('[data-clear-sel]')) { sel = null; selbar(); render(false); return; }
      if (e.target.closest('[data-preset-save]')) { savePreset(); return; }
      if (e.target.closest('[data-preset-del]')) { delPreset(); return; }
      if (e.target.closest('[data-preset-def]')) { defPreset(); return; }
      if ((b = e.target.closest('.vc-cell'))) {
        var u = b.getAttribute('data-user'); sel = sel === u ? null : u;
        $$('.vc-cell', stage).forEach(function (c) { c.classList.toggle('sel', c.getAttribute('data-user') === sel); }); selbar();
      }
    });
    var presetSel = $('#vp-preset');
    if (presetSel) presetSel.addEventListener('change', function () {
      var p = presets.filter(function (x) { return x.id === presetSel.value; })[0];
      if (p) { var logo = st.logo; st = merge(DEFAULTS, p.opts); if (!st.logo) st.logo = logo; change(); }
    });
    var pn = $('#vp-color'); if (pn) pn.addEventListener('input', function () { st.accent = pn.value; change(); });
    var lf = $('#vp-logo-file');
    if (lf) lf.addEventListener('change', function () {
      var f = lf.files && lf.files[0]; if (!f) return;
      if (!/^image\//.test(f.type)) { toast(data.i18n.notImage, 'err'); return; }
      var fr = new FileReader();
      fr.onload = function () {
        var img = new Image();
        img.onload = function () {
          var s = Math.min(1, 220 / Math.max(img.width, img.height)), cv = doc.createElement('canvas');
          cv.width = Math.max(1, Math.round(img.width * s)); cv.height = Math.max(1, Math.round(img.height * s));
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          st.logo = cv.toDataURL('image/png'); st.f.logo = true; lf.value = ''; change();
        };
        img.onerror = function () { toast(data.i18n.notImage, 'err'); };
        img.src = fr.result;
      };
      fr.readAsDataURL(f);
    });

    function selbar() {
      var b = $('#vp-selbar'); if (!b) return;
      b.classList.toggle('on', !!sel); var s = $('#vp-selname'); if (s) s.textContent = sel || '';
    }
    function printSelected() {
      var u = sel || (items[0] && items[0].user); if (!u) return;
      only = u; render(true, function () { window.print(); });
    }
    window.addEventListener('afterprint', function () { if (only) { only = null; render(false); } });

    /* ---- copy: the raw code, never the visual groups ---- */
    function copyText(txt) {
      var done = function () { toast(data.i18n.copied); }, fail = function () { toast(data.i18n.copyFail, 'err'); };
      if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(txt).then(done, fail); return; }
      var ta = doc.createElement('textarea'); ta.value = txt; ta.style.cssText = 'position:fixed;left:-9999px;top:0'; doc.body.appendChild(ta); ta.select();
      try { doc.execCommand('copy') ? done() : fail(); } catch (e) { fail(); } ta.remove();
    }
    function copyCode() {
      var u = sel || (items[0] && items[0].user); if (!u) return;
      var it = items.filter(function (i) { return i.user === u; })[0]; if (!it) return;
      copyText(it.pass && it.pass !== it.user ? it.user + String.fromCharCode(10) + it.pass : it.user);
    }
    doc.addEventListener('copy', function (e) {
      var s = window.getSelection && window.getSelection(); if (!s || s.isCollapsed || !e.clipboardData) return;
      var raws = $$('.vc-code[data-raw]', stage).filter(function (c) { return s.containsNode(c, true); }).map(function (c) { return c.getAttribute('data-raw'); });
      if (raws.length) { e.clipboardData.setData('text/plain', raws.join(String.fromCharCode(10))); e.preventDefault(); }
    });

    /* ---- thermal printers: ESC/POS with native or raster QR (replaces the text-only handlers in pages.js) ---- */
    function thermalBytes(kind) {
      var E = window.NextMONEscPos; if (!E) return null;
      var list = sel ? items.filter(function (i) { return i.user === sel; }) : items; if (!list.length) return null;
      var wide = st.paper === 't80', ctx = ctxOf(), I = data.i18n;
      if (kind === 'ble' && st.tqr === 'raster' && list.length > 20 && !confirm(I.bigJob)) return null;
      return E.vouchers(list.map(function (it) { return { u: it.user, p: it.pass, pr: it.profile, price: it.price, v: it.validity, _src: it }; }), {
        cols: wide ? 48 : 32, dots: wide ? 576 : 384, hotspot: ctx.name, qr: st.tqr, ecc: 'M', QR: window.QR,
        labels: { code: I.code, user: I.username, pass: I.password, pkg: I.profile, price: I.price, valid: I.valid, scan: I.scanTh || I.scan },
        qrText: function (x) { return qrText(x._src, ctx); }
      });
    }
    var escLoad = null; /* escpos.js is only fetched the first time a thermal button is used */
    function withEscPos(fn) {
      if (window.NextMONEscPos) { fn(); return; }
      if (!escLoad) escLoad = new Promise(function (ok, bad) { var s = doc.createElement('script'); s.src = data.escpos; s.onload = ok; s.onerror = function () { escLoad = null; bad(); }; doc.head.appendChild(s); });
      escLoad.then(fn, function () { toast(data.i18n.pngFail, 'err'); });
    }
    window.addEventListener('click', function (e) {
      var b = e.target.closest('[data-thermal-share],[data-thermal-ble]'); if (!b) return;
      e.stopImmediatePropagation(); e.preventDefault();
      withEscPos(function () { thermalGo(b); });
    }, true);
    function thermalGo(b) {
      var ble = b.hasAttribute('data-thermal-ble'), bytes = thermalBytes(ble ? 'ble' : 'share'); if (!bytes) return;
      if (!ble) {
        var url = window.NextMONEscPos.rawbtUrl(bytes);
        if (url.length > 1500000) { toast(data.i18n.tooLong, 'err'); return; }
        window.location.href = url; return;
      }
      if (!navigator.bluetooth) { toast(data.i18n.noBle, 'err'); return; }
      toast(data.i18n.sending, 'info');
      window.NextMONEscPos.sendBle(bytes).then(function () { toast(data.i18n.sent); }).catch(function (err) { if (err && err.name !== 'NotFoundError') toast(String(err.message || err), 'err'); });
    }

    /* ---- narrow screens: only the design section stays open ---- */
    var narrow = window.matchMedia && window.matchMedia('(max-width: 960px)');
    if (narrow && narrow.matches) $$('.vp-sec').forEach(function (d, i) { if (i > 0) d.removeAttribute('open'); });

    /* ---- presets (server side) ---- */
    function post(path, body) {
      var fd = new URLSearchParams(); fd.set('_csrf', doc.body.dataset.csrf || '');
      Object.keys(body).forEach(function (k) { fd.set(k, body[k]); });
      return fetch(data.base + path, { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } }).then(function (r) { return r.json(); });
    }
    function optsForSave() { var o = clone(st); delete o.zoom; if (o.logo && o.logo.length > 120000) o.logo = ''; return o; }
    function savePreset() {
      var name = prompt(data.i18n.presetName, ''); if (!name) return;
      post('/vouchers/preset/save', { name: name, opts: JSON.stringify(optsForSave()) }).then(function (r) {
        if (r && r.ok) { presets = r.presets; fillPresets(r.id); toast(data.i18n.saved); } else toast((r && r.error) || 'Error', 'err');
      }).catch(function () { toast('Error', 'err'); });
    }
    function delPreset() {
      if (!presetSel || !presetSel.value || !confirm(data.i18n.confirmDel)) return;
      post('/vouchers/preset/delete', { id: presetSel.value }).then(function (r) { if (r && r.ok) { presets = r.presets; fillPresets(''); } });
    }
    function defPreset() {
      if (!presetSel || !presetSel.value) return;
      post('/vouchers/preset/default', { id: presetSel.value }).then(function (r) { if (r && r.ok) toast(data.i18n.saved); });
    }
    function fillPresets(selId) {
      if (!presetSel) return;
      presetSel.innerHTML = '<option value="">' + esc(data.i18n.presetNone) + '</option>' + presets.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>'; }).join('');
      presetSel.value = selId || '';
    }

    /* ---- PNG of one card (SVG foreignObject -> canvas, no external requests) ---- */
    function cssText() {
      var out = '';
      for (var i = 0; i < doc.styleSheets.length; i++) {
        var ss = doc.styleSheets[i]; if (!ss.href || ss.href.indexOf('voucher.css') < 0) continue;
        try { for (var j = 0; j < ss.cssRules.length; j++) { var r = ss.cssRules[j]; if (r.type === 1 || r.type === 5) out += r.cssText + '\n'; } } catch (e) { /* cross-origin */ }
      }
      return out;
    }
    function downloadPng() {
      var u = sel || (items[0] && items[0].user); if (!u) return;
      var it = items.filter(function (i) { return i.user === u; })[0], geo = geometry();
      var c = card(geo.des, it, geo.ctx); if (geo.des.auto) c.style.height = geo.ch0 + 'mm';
      var wpx = Math.ceil(geo.des.w * MM), hpx = Math.ceil(geo.ch0 * MM), S = 4;
      var wrap = doc.createElement('div'); wrap.className = (st.ink ? 'vp-ink ' : '') + 'vp-root'; wrap.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
      wrap.style.cssText = 'width:' + wpx + 'px;height:' + hpx + 'px;overflow:hidden;background:transparent';
      applyVars(wrap, st.accent); wrap.appendChild(c);
      var xml = new XMLSerializer().serializeToString(wrap);
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + wpx + '" height="' + hpx + '"><style>' + cssText().replace(/</g, '&lt;') + '</style><foreignObject width="100%" height="100%">' + xml + '</foreignObject></svg>';
      var img = new Image();
      img.onload = function () {
        var cv = doc.createElement('canvas'); cv.width = wpx * S; cv.height = hpx * S;
        var ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(img, 0, 0, cv.width, cv.height);
        try {
          cv.toBlob(function (b) {
            if (!b) { toast(data.i18n.pngFail, 'err'); return; }
            var a = doc.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'voucher-' + u + '.png'; doc.body.appendChild(a); a.click();
            setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
          }, 'image/png');
        } catch (e) { toast(data.i18n.pngFail, 'err'); }
      };
      img.onerror = function () { toast(data.i18n.pngFail, 'err'); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    }

    /* ---- thumbnails ---- */
    function sampleItem() { return { user: 'k7m2pq', pass: 'k7m2pq', profile: '1Hari', price: 'Rp 5.000', validity: '1d', limit: '', comment: 'vc-123', serial: '001' }; }
    function thumbs() {
      if (!thumbsBox) return;
      var list = DESIGNS.concat(customs), html = '';
      list.forEach(function (d) { html += '<button type="button" class="vp-thumb" data-design="' + esc(d.id) + '" aria-pressed="false"><span class="st" data-th="' + esc(d.id) + '"></span><b>' + esc(d.name) + (d.custom ? ' <span class="vp-tpl-badge">' + esc(data.i18n.custom) + '</span>' : '') + '</b><small>' + (d.thermal ? esc(d.note) : d.w + 'x' + (d.auto ? '' : d.h)) + (d.note && !d.thermal ? ' - ' + esc(d.note) : '') + '</small></button>'; });
      thumbsBox.innerHTML = html;
      redrawThumbs();
    }
    var thumbTok = 0, idle = window.requestIdleCallback || function (fn) { return setTimeout(function () { fn({ timeRemaining: function () { return 8; } }); }, 16); };
    /* thumbnails are drawn in idle time, a few per slice, so they never compete with the first sheet of the preview */
    function redrawThumbs() {
      var ctx = ctxOf(); ctx.fields = { creds: true }; ctx.qr.dark = st.ink ? '#000' : '#0b1620';
      var it = items[0] ? Object.assign({}, items[0]) : sampleItem();
      var boxes = $$('[data-th]', thumbsBox), tok = ++thumbTok, k = 0;
      function slice(dl) {
        if (tok !== thumbTok) return;
        do { drawThumb(boxes[k++], ctx, it); } while (k < boxes.length && dl.timeRemaining() > 4);
        if (k < boxes.length) idle(slice);
      }
      if (boxes.length) idle(slice);
    }
    function drawThumb(box, ctx, it) {
      {
        var d = designOf(box.dataset.th), c = card(d, it, ctx);
        if (d.auto) c.style.height = (d.h) + 'mm';
        var h = d.h, s = Math.min((box.clientWidth || 96) / (d.w * MM), 58 / (h * MM)) * .96;
        var holder = doc.createElement('div'); holder.style.width = d.w * MM + 'px'; holder.style.height = h * MM + 'px';
        holder.style.transform = 'translate(-50%,-50%) scale(' + s + ')'; holder.style.transformOrigin = 'center'; holder.style.left = '50%'; holder.style.top = '50%';
        holder.appendChild(c); box.innerHTML = ''; box.appendChild(holder);
      }
    }
    var lastAcc = '';
    var redrawT = 0;
    function maybeThumbs() { var key = st.accent + st.ink + st.logo.length + st.name + st.qrMode; if (key === lastAcc) return; lastAcc = key; clearTimeout(redrawT); redrawT = setTimeout(redrawThumbs, 120); }

    var origChange = change;
    change = function () { origChange(); maybeThumbs(); };

    fillPresets('');
    thumbs(); reflect(); render(false); selbar(); lastAcc = st.accent + st.ink + st.logo.length + st.name + st.qrMode;
    var rt = 0;
    window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { if (st.zoom === 'fit') render(false); redrawThumbs(); }, 150); });
    doc.addEventListener('nextmon:resize', function () { if (st.zoom === 'fit') render(false); });
    window.NextMONVoucher.print = { state: function () { return st; }, geometry: geometry, render: render };
  }

  /* ---------------------------------------------------------------- template editor */
  function initEditor() {
    var root = $('#te-root'); if (!root) return;
    var data = jsonOf('#te-data', {}); setLabels(data.i18n);
    var ta = $('#te-html'), stage = $('#te-stage'), wIn = $('#te-w'), hIn = $('#te-h'), idIn = $('#te-id'), nameIn = $('#te-name');
    var ctx = {
      name: 'NextMON WiFi', dns: 'wifi.nextmon.id', base: 'http://wifi.nextmon.id/login', qrMode: 'login', logo: '', fields: { creds: true },
      qr: { ecc: 'M', style: 'square', logo: null, dark: '#0b1620' }
    };
    var item = { user: 'k7m2pq', pass: 'k7m2pq', profile: '1Hari', price: 'Rp 5.000', validity: '1 Hari', limit: '1h', comment: 'vc-123-batch', serial: '001' };
    var two = $('#te-two');
    function draw() {
      var it = Object.assign({}, item); if (two && two.checked) it.pass = 'x9z4ta';
      var html = ta.value.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
      var d = { custom: true, w: +wIn.value || 70, h: +hIn.value || 40, html: html };
      stage.innerHTML = ''; var wrap = doc.createElement('div'); wrap.className = 'vp-root'; applyVars(wrap, '#0b7285');
      var c = card(d, it, ctx);
      var avail = stage.clientWidth - 48, s = Math.min(2.2, avail / (d.w * MM)); if (s < 1) s = Math.max(.3, s); else s = Math.min(s, 2);
      c.style.transform = 'scale(' + s + ')'; c.style.transformOrigin = 'top left';
      wrap.style.width = d.w * MM * s + 'px'; wrap.style.height = d.h * MM * s + 'px'; wrap.style.background = '#fff'; wrap.style.boxShadow = '0 0 0 1px rgba(0,0,0,.12), 0 8px 24px rgba(0,0,0,.14)';
      wrap.appendChild(c); stage.appendChild(wrap);
    }
    ta.addEventListener('input', draw); wIn.addEventListener('input', draw); hIn.addEventListener('input', draw); if (two) two.addEventListener('change', draw);
    root.addEventListener('click', function (e) {
      var chip = e.target.closest('[data-ph]');
      if (chip) {
        var s = ta.selectionStart, v = ta.value; ta.value = v.slice(0, s) + chip.dataset.ph + v.slice(ta.selectionEnd);
        ta.focus(); ta.selectionStart = ta.selectionEnd = s + chip.dataset.ph.length; draw(); return;
      }
      var st = e.target.closest('[data-start]');
      if (st) {
        var d = DMAP[st.dataset.start]; if (!d) return;
        ta.value = '<div class="vc vc-' + d.id + (d.cls ? ' ' + d.cls : '') + '" style="--w:' + d.w + ';--h:' + d.h + '">\n' + d.html.replace(/></g, '>\n<') + '\n</div>';
        wIn.value = d.w; hIn.value = d.h; draw();
        if (!nameIn.value) nameIn.value = d.name + ' (copy)'; return;
      }
      var ld = e.target.closest('[data-tpl-load]');
      if (ld) { var t = JSON.parse(ld.dataset.tplLoad); idIn.value = t.id; nameIn.value = t.name; ta.value = t.html; wIn.value = t.w || 70; hIn.value = t.h || 40; draw(); nameIn.focus(); return; }
      if (e.target.closest('[data-tpl-new]')) { idIn.value = ''; nameIn.value = ''; draw(); }
    });
    draw();
    window.addEventListener('resize', draw);
  }

  /* ---------------------------------------------------------------- generator page: design thumbnails */
  function initGenerator() {
    var root = $('#vg-root'); if (!root) return;
    var data = jsonOf('#vg-data', {}); setLabels(data.i18n);
    var box = $('#vg-thumbs'), inp = $('#g-design'), tplIn = $('#g-tpl');
    var saved = null; try { saved = JSON.parse(localStorage.getItem('nextmon.vp.v3') || 'null'); } catch (e) { saved = null; }
    var acc = (saved && saved.accent) || '#0b7285';
    var cur = (saved && saved.design) || 'aurora';
    applyVars(box, acc);
    var ctx = { name: data.hotspot || 'WiFi', dns: hostOf(data.loginBase), base: data.loginBase, qrMode: 'login', logo: (saved && saved.logo) || '', fields: { creds: true }, qr: { ecc: 'M', style: 'square', logo: null, dark: '#0b1620' } };
    var it = { user: 'k7m2pq', pass: 'k7m2pq', profile: '1Hari', price: 'Rp 5.000', validity: '1d', limit: '', comment: 'vc-123', serial: '001' };
    var customs = (data.templates || []).map(function (t) { return { id: 'c:' + t.id, tid: t.id, name: t.name, w: +t.w || 70, h: +t.h || 40, html: t.html, custom: true }; });
    var list = DESIGNS.concat(customs), cursel = cur;
    box.innerHTML = list.map(function (d) { return '<button type="button" class="vp-thumb" data-pick="' + esc(d.id) + '" aria-pressed="' + (d.id === cur) + '"><span class="st"></span><b>' + esc(d.name) + '</b></button>'; }).join('');
    $$('.vp-thumb', box).forEach(function (b, i) {
      var d = list[i], st = $('.st', b), c = card(d, it, ctx); if (d.auto) c.style.height = d.h + 'mm';
      var s = Math.min(78 / (d.w * MM), 58 / (d.h * MM)) * .96, h = doc.createElement('div');
      h.style.cssText = 'position:absolute;left:50%;top:50%;transform-origin:center;width:' + d.w * MM + 'px;height:' + d.h * MM + 'px;transform:translate(-50%,-50%) scale(' + s + ')';
      h.appendChild(c); st.appendChild(h);
    });
    function setVal(id) { cursel = id; inp.value = /^c:/.test(id) ? '' : id; tplIn.value = /^c:/.test(id) ? id.slice(2) : ''; $$('.vp-thumb', box).forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.pick === id ? 'true' : 'false'); }); }
    box.addEventListener('click', function (e) { var b = e.target.closest('[data-pick]'); if (b) setVal(b.dataset.pick); });
    setVal(cur);
  }

  window.NextMONVoucher = { DESIGNS: DESIGNS, PLACEHOLDERS: PLACEHOLDERS, card: card, derive: derive, fill: fillHtml };
  function boot() { initPrint(); initEditor(); initGenerator(); }
  if (doc.readyState !== 'complete') doc.addEventListener('DOMContentLoaded', boot); else boot();
})();
