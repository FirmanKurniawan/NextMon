/* NextMON ESC/POS builder for thermal printers (RawBT intent, Web Bluetooth). No dependencies; Node-friendly for tests.
   QR can go out three ways:
     native  GS ( k  (model 2, size, error correction, store, print): ~100 bytes per QR, the printer draws it; supported by nearly
             all 58/80 mm printers made after ~2012.
     raster  GS v 0  bitmap built from the QR matrix (needs window.QR / require('./qr.js')): works on printers without the native
             command, but is ~50x larger (slower over Bluetooth).
     off     text only.
   API: NextMONEscPos.Builder, .vouchers(items, opts) -> Uint8Array, .toBase64(bytes), .rawbtUrl(bytes), .sendBle(bytes, onProgress)
   All text is transliterated to ASCII (printers default to code page 437). */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.NextMONEscPos = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  var ESC = 0x1B, GS = 0x1D, LF = 0x0A;
  var ECC = { L: 48, M: 49, Q: 50, H: 51 };

  function ascii(s) {
    s = String(s == null ? '' : s);
    try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) { /* old engines */ }
    return s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[^ -~]/g, '?');
  }

  function Builder(opts) {
    opts = opts || {};
    this.cols = opts.cols || 32;           // characters per line, font A: 58 mm = 32, 80 mm = 48
    this.dots = opts.dots || (this.cols === 48 ? 576 : 384);
    this.b = [];
  }
  var P = Builder.prototype;
  P.raw = function () { for (var i = 0; i < arguments.length; i++) { var a = arguments[i]; if (typeof a === 'number') this.b.push(a & 255); else for (var j = 0; j < a.length; j++) this.b.push(a[j] & 255); } return this; };
  P.init = function () { return this.raw(ESC, 0x40); };
  P.align = function (n) { return this.raw(ESC, 0x61, n === 'center' || n === 1 ? 1 : n === 'right' || n === 2 ? 2 : 0); };
  P.bold = function (on) { return this.raw(ESC, 0x45, on ? 1 : 0); };
  P.size = function (w, h) { return this.raw(GS, 0x21, (((w || 1) - 1) & 7) << 4 | (((h || 1) - 1) & 7)); };
  P.text = function (s) { s = ascii(s); for (var i = 0; i < s.length; i++) this.b.push(s.charCodeAt(i)); return this; };
  P.line = function (s) { return this.text(s || '').raw(LF); };
  P.feed = function (n) { return this.raw(ESC, 0x64, Math.max(0, Math.min(255, n | 0))); };
  P.rule = function (ch) { return this.line(new Array(this.cols + 1).join(ch || '-')); };
  P.cut = function (partial) { return this.raw(GS, 0x56, partial ? 0x42 : 0x41, 0x03); };   // GS V 66/65 n: feed n then cut

  /* Native QR: GS ( k  pL pH cn fn ...   cn=49 (QR)  */
  function gsk(data) { var n = data.length; return [GS, 0x28, 0x6B, n & 255, n >> 8 & 255].concat(data); }
  P.qrNative = function (text, o) {
    o = o || {};
    var bytes = []; var t = String(text);
    for (var i = 0; i < t.length; i++) { var c = t.charCodeAt(i); if (c < 0x80) bytes.push(c); else { var u = unescape(encodeURIComponent(t.charAt(i))); for (var k = 0; k < u.length; k++) bytes.push(u.charCodeAt(k)); } }
    if (!bytes.length || bytes.length > 7000) throw new Error('QR data length');
    var size = Math.max(1, Math.min(16, o.size || 6));
    return this
      .raw(gsk([49, 65, 50, 0]))                                  // fn 65: model 2
      .raw(gsk([49, 67, size]))                                   // fn 67: module size in dots
      .raw(gsk([49, 69, ECC[o.ecc] || ECC.M]))                    // fn 69: error correction level
      .raw(gsk([49, 80, 48].concat(bytes)))                       // fn 80: store data (pL pH count includes cn fn m)
      .raw(gsk([49, 81, 48]));                                    // fn 81: print the stored symbol
  };

  /* Raster QR: GS v 0 m xL xH yL yH d...  (m=0 normal density, MSB first, 1 = black). modules[y][x] true = dark. */
  P.qrRaster = function (modules, o) {
    o = o || {};
    var n = modules.length, quiet = o.quiet == null ? 2 : o.quiet, tot = n + quiet * 2;
    var s = o.scale || Math.max(2, Math.floor(this.dots * (o.frac || .6) / tot));
    var wDots = tot * s, wBytes = Math.ceil(wDots / 8), hDots = tot * s, data = new Array(wBytes * hDots);
    for (var i = 0; i < data.length; i++) data[i] = 0;
    for (var y = 0; y < hDots; y++) {
      var my = Math.floor(y / s) - quiet; if (my < 0 || my >= n) continue;
      for (var x = 0; x < wDots; x++) {
        var mx = Math.floor(x / s) - quiet;
        if (mx >= 0 && mx < n && modules[my][mx]) data[y * wBytes + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    this.raw(GS, 0x76, 0x30, 0, wBytes & 255, wBytes >> 8 & 255, hDots & 255, hDots >> 8 & 255);
    // chunked push (avoid huge argument lists)
    for (var j = 0; j < data.length; j++) this.b.push(data[j]);
    this.rasterInfo = { scale: s, wDots: wDots, hDots: hDots, wBytes: wBytes };
    return this;
  };
  P.bytes = function () { return new Uint8Array(this.b); };

  function wrap(s, w) { var out = [], t = ascii(s); while (t.length > w) { var cut = t.lastIndexOf(' ', w); if (cut < w / 2) cut = w; out.push(t.slice(0, cut).replace(/\s+$/, '')); t = t.slice(cut).replace(/^\s+/, ''); } out.push(t); return out; }
  function pad2(l, r, w) { l = ascii(l); r = ascii(r); var gap = w - l.length - r.length; return gap >= 1 ? l + new Array(gap + 1).join(' ') + r : l + ' ' + r; }

  /* items: [{u, p, pr, price, v, qr?: string}]  opts: {cols, hotspot, labels:{code,user,pass,pkg,price,valid,scan}, qr:'native'|'raster'|'off', ecc, qrText(item), cut, QR} */
  function vouchers(items, opts) {
    opts = opts || {};
    var L = Object.assign({ code: 'Kode', user: 'User', pass: 'Pass', pkg: 'Paket', price: 'Harga', valid: 'Aktif', scan: 'Scan untuk login' }, opts.labels || {});
    var b = new Builder({ cols: opts.cols || 32, dots: opts.dots });
    var QRlib = opts.QR || root.QR, mode = opts.qr || 'native', ecc = opts.ecc || 'M';
    b.init();
    items.forEach(function (it) {
      b.align('center').bold(true).size(1, 1);
      wrap(opts.hotspot || 'WiFi', b.cols).forEach(function (l) { b.line(l); });
      b.bold(false).align('left').rule();
      if (it.pr) b.line(pad2(L.pkg, it.pr, b.cols));
      if (it.price) b.line(pad2(L.price, it.price, b.cols));
      if (it.v) b.line(pad2(L.valid, it.v, b.cols));
      if (it.pr || it.price || it.v) b.rule();
      b.align('center');
      var two = it.p && it.p !== it.u;
      function code(label, val) {
        b.line(label);
        var big = val.length * 2 <= b.cols;
        b.bold(true); if (big) b.size(2, 2); b.line(val); if (big) b.size(1, 1); b.bold(false);
      }
      if (two) { code(L.user, it.u); code(L.pass, it.p); } else code(L.code, it.u);
      var qt = mode !== 'off' && opts.qrText ? opts.qrText(it) : '';
      if (qt) {
        b.feed(1);
        try {
          if (mode === 'raster') {
            if (!QRlib) throw new Error('QR lib missing');
            b.qrRaster(QRlib.encode(qt, ecc).modules, { frac: .62 });
          } else {
            var modules = QRlib ? QRlib.encode(qt, ecc).size : 41;
            b.qrNative(qt, { ecc: ecc, size: Math.max(2, Math.min(10, Math.floor(b.dots * .62 / (modules + 4)))) });
          }
          b.line('').line(L.scan);
        } catch (e) { /* QR failed: text only */ }
      }
      b.align('left').rule().feed(3);
    });
    if (opts.cut !== false) b.cut(true); else b.feed(2);
    return b.bytes();
  }

  function toBase64(bytes) {
    var s = '', CH = 0x4000;
    for (var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, Array.prototype.slice.call(bytes, i, i + CH));
    return (typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64'));
  }
  function rawbtUrl(bytes) { return 'intent:base64,' + toBase64(bytes) + '#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;'; }

  /* Web Bluetooth: find a writable GATT characteristic and push the bytes in small chunks. */
  function sendBle(bytes, onProgress) {
    var nav = root.navigator;
    if (!nav || !nav.bluetooth) return Promise.reject(new Error('Web Bluetooth is not supported in this browser (use Chrome on Android/desktop over HTTPS).'));
    return nav.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [0xFFE0, 0xFF00, 0x18F0, '000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2'] })
      .then(function (dev) { return dev.gatt.connect(); })
      .then(function (srv) { return srv.getPrimaryServices(); })
      .then(function (services) {
        return Promise.all(services.map(function (s) { return s.getCharacteristics().catch(function () { return []; }); })).then(function (lists) {
          var all = [].concat.apply([], lists);
          var ch = all.filter(function (c) { return c.properties.write || c.properties.writeWithoutResponse; })[0];
          if (!ch) throw new Error('No writable characteristic found');
          var pos = 0, CH = 100;
          function next() {
            if (pos >= bytes.length) return Promise.resolve();
            var c = bytes.slice(pos, pos + CH); pos += CH;
            var w = ch.writeValueWithoutResponse ? ch.writeValueWithoutResponse(c) : ch.writeValue(c);
            return w.then(function () { if (onProgress) onProgress(Math.min(1, pos / bytes.length)); return new Promise(function (r) { setTimeout(r, 25); }); }).then(next);
          }
          return next();
        });
      });
  }

  return { Builder: Builder, wrap: wrap, vouchers: vouchers, toBase64: toBase64, rawbtUrl: rawbtUrl, sendBle: sendBle, ascii: ascii, ECC: ECC };
});
