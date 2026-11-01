/*! qr.js - standalone QR Code generator (byte mode, versions 1-40, ECC L/M/Q/H).
 * MIT License. No dependencies. Works in browsers (window.QR) and Node (module.exports).
 *
 * API:
 *   QR.encode(text, ecc='M')  -> { size, version, mask, ecc, modules: boolean[][] }  (modules[y][x], true = dark)
 *   QR.toSVG(text, {ecc:'M', margin:4, dark:'#000', light:'#fff', size:null}) -> SVG string
 *   QR.toCanvas(canvas, text, {ecc, margin, scale, dark, light})
 *   QR.toDataURL(text, opts) -> 'data:image/svg+xml;...'
 */
(function (root) {
  'use strict';

  var ECC_IDX = { L: 0, M: 1, Q: 2, H: 3 };
  var ECC_FMT = { L: 1, M: 0, Q: 3, H: 2 };
  // Error-correction codewords per block, and number of blocks; indexed [ecc][version]
  var ECC_PER_BLOCK = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
  ];
  var NUM_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
  ];

  function numRawDataModules(ver) {
    var r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var na = Math.floor(ver / 7) + 2;
      r -= (25 * na - 10) * na - 55;
      if (ver >= 7) r -= 36;
    }
    return r;
  }
  function numDataCodewords(ver, e) {
    return Math.floor(numRawDataModules(ver) / 8) - ECC_PER_BLOCK[e][ver] * NUM_BLOCKS[e][ver];
  }

  function utf8Bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
        var d = str.charCodeAt(i + 1);
        if (d >= 0xDC00 && d <= 0xDFFF) { c = 0x10000 + ((c - 0xD800) << 10) + (d - 0xDC00); i++; }
      }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  // ---- Reed-Solomon over GF(256), polynomial 0x11D ----
  function gfMul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }
  function rsDivisor(degree) {
    var res = [], i, j;
    for (i = 0; i < degree - 1; i++) res.push(0);
    res.push(1);
    var root = 1;
    for (i = 0; i < degree; i++) {
      for (j = 0; j < res.length; j++) {
        res[j] = gfMul(res[j], root);
        if (j + 1 < res.length) res[j] ^= res[j + 1];
      }
      root = gfMul(root, 2);
    }
    return res;
  }
  function rsRemainder(data, divisor) {
    var res = divisor.map(function () { return 0; });
    data.forEach(function (b) {
      var f = b ^ res.shift();
      res.push(0);
      divisor.forEach(function (c, i) { res[i] ^= gfMul(c, f); });
    });
    return res;
  }

  function addEccAndInterleave(data, ver, e) {
    var nb = NUM_BLOCKS[e][ver], bl = ECC_PER_BLOCK[e][ver];
    var raw = Math.floor(numRawDataModules(ver) / 8);
    var shortBlocks = nb - raw % nb, shortLen = Math.floor(raw / nb);
    var blocks = [], div = rsDivisor(bl), k = 0, i;
    for (i = 0; i < nb; i++) {
      var dat = data.slice(k, k + shortLen - bl + (i < shortBlocks ? 0 : 1));
      k += dat.length;
      var ecc = rsRemainder(dat, div);
      if (i < shortBlocks) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    var out = [];
    for (i = 0; i < blocks[0].length; i++) {
      for (var j = 0; j < blocks.length; j++) {
        if (i !== shortLen - bl || j >= shortBlocks) out.push(blocks[j][i]);
      }
    }
    return out;
  }

  // ---- matrix construction ----
  function alignPositions(ver) {
    if (ver === 1) return [];
    var n = Math.floor(ver / 7) + 2;
    var step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    var res = [6];
    for (var pos = ver * 4 + 10; res.length < n; pos -= step) res.splice(1, 0, pos);
    return res;
  }

  function Matrix(ver, base) {
    this.ver = ver;
    this.size = ver * 4 + 17;
    this.m = []; this.f = [];
    if (base) { this.f = base.f; for (var r = 0; r < this.size; r++) this.m.push(base.m[r].slice()); return; }
    for (var y = 0; y < this.size; y++) {
      var a = [], b = [];
      for (var x = 0; x < this.size; x++) { a.push(false); b.push(false); }
      this.m.push(a); this.f.push(b);
    }
  }
  Matrix.prototype.set = function (x, y, dark) { this.m[y][x] = dark; this.f[y][x] = true; };
  Matrix.prototype.drawFunctionPatterns = function () {
    var s = this.size, i, self = this;
    for (i = 0; i < s; i++) { this.set(6, i, i % 2 === 0); this.set(i, 6, i % 2 === 0); }
    function finder(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
        if (x >= 0 && x < s && y >= 0 && y < s) self.set(x, y, d !== 2 && d !== 4);
      }
    }
    finder(3, 3); finder(s - 4, 3); finder(3, s - 4);
    var ap = alignPositions(this.ver), n = ap.length;
    for (var a = 0; a < n; a++) for (var b = 0; b < n; b++) {
      if ((a === 0 && b === 0) || (a === 0 && b === n - 1) || (a === n - 1 && b === 0)) continue;
      for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++)
        this.set(ap[a] + dx, ap[b] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    this.drawFormat('L', 0); // reserve the area
    this.drawVersion();
  };
  Matrix.prototype.drawFormat = function (ecc, mask) {
    var data = ECC_FMT[ecc] << 3 | mask, rem = data, i;
    for (i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var bits = (data << 10 | rem) ^ 0x5412, s = this.size;
    function bit(i) { return ((bits >>> i) & 1) !== 0; }
    for (i = 0; i <= 5; i++) this.set(8, i, bit(i));
    this.set(8, 7, bit(6)); this.set(8, 8, bit(7)); this.set(7, 8, bit(8));
    for (i = 9; i < 15; i++) this.set(14 - i, 8, bit(i));
    for (i = 0; i < 8; i++) this.set(s - 1 - i, 8, bit(i));
    for (i = 8; i < 15; i++) this.set(8, s - 15 + i, bit(i));
    this.set(8, s - 8, true);
  };
  Matrix.prototype.drawVersion = function () {
    if (this.ver < 7) return;
    var rem = this.ver, i;
    for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    var bits = this.ver << 12 | rem;
    for (i = 0; i < 18; i++) {
      var c = ((bits >>> i) & 1) !== 0, a = this.size - 11 + i % 3, b = Math.floor(i / 3);
      this.set(a, b, c); this.set(b, a, c);
    }
  };
  Matrix.prototype.drawCodewords = function (data) {
    var i = 0, s = this.size;
    for (var right = s - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < s; vert++) {
        for (var j = 0; j < 2; j++) {
          var x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? s - 1 - vert : vert;
          if (!this.f[y][x] && i < data.length * 8) {
            this.m[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
            i++;
          }
        }
      }
    }
  };
  var MASKS = [
    function (x, y) { return (x + y) % 2 === 0; },
    function (x, y) { return y % 2 === 0; },
    function (x, y) { return x % 3 === 0; },
    function (x, y) { return (x + y) % 3 === 0; },
    function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; },
    function (x, y) { return x * y % 2 + x * y % 3 === 0; },
    function (x, y) { return (x * y % 2 + x * y % 3) % 2 === 0; },
    function (x, y) { return ((x + y) % 2 + x * y % 3) % 2 === 0; }
  ];
  Matrix.prototype.applyMask = function (k) {
    var fn = MASKS[k], size = this.size, f = this.f, m = this.m;
    for (var y = 0; y < size; y++) { var fr = f[y], mr = m[y]; for (var x = 0; x < size; x++) if (!fr[x] && fn(x, y)) mr[x] = !mr[x]; }
  };
  // Mask-selection penalty score (ISO 18004 rules 1-4). Only affects which mask is chosen.
  Matrix.prototype.penalty = function () {
    var s = this.size, m = this.m, res = 0, x, y, a, b;
    // rows (vert=false) or columns (vert=true) of line a: run penalty + finder-like 1011101 pattern via a rolling 11-bit window
    function line(a, vert) {
      var p = 0, run = 0, last = null, w = 0;
      for (var t = -4; t < s + 4; t++) {
        var v = t >= 0 && t < s && (vert ? m[t][a] : m[a][t]);
        w = ((w << 1) | (v ? 1 : 0)) & 0x7FF;
        if (t >= 0 && t < s) {
          if (v === last) { run++; if (run === 5) p += 3; else if (run > 5) p++; }
          else { last = v; run = 1; }
        }
        if (t >= 6 && (w === 93 || w === 1488)) p += 40; // 00001011101 / 10111010000 (padded with 4 light modules each side)
      }
      return p;
    }
    for (a = 0; a < s; a++) { res += line(a, false) + line(a, true); }
    for (y = 0; y < s - 1; y++) for (x = 0; x < s - 1; x++) {
      var c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) res += 3;
    }
    var dark = 0;
    for (y = 0; y < s; y++) for (x = 0; x < s; x++) if (m[y][x]) dark++;
    var total = s * s;
    res += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return res;
  };

  function encode(text, ecc) {
    ecc = (ecc || 'M').toUpperCase();
    if (ECC_IDX[ecc] === undefined) throw new Error('Bad ECC level');
    var e = ECC_IDX[ecc];
    var bytes = utf8Bytes(String(text));
    var ver, cap;
    for (ver = 1; ; ver++) {
      if (ver > 40) throw new Error('Data too long for QR code');
      cap = numDataCodewords(ver, e) * 8;
      if (4 + (ver < 10 ? 8 : 16) + bytes.length * 8 <= cap) break;
    }
    var bits = [];
    function put(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); }
    put(4, 4); put(bytes.length, ver < 10 ? 8 : 16);
    bytes.forEach(function (b) { put(b, 8); });
    put(0, Math.min(4, cap - bits.length));
    put(0, (8 - bits.length % 8) % 8);
    for (var pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
    var data = [];
    for (var i = 0; i < bits.length; i += 8) {
      var v = 0;
      for (var j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
      data.push(v);
    }
    var all = addEccAndInterleave(data, ver, e);
    var best = -1, bestPen = Infinity, bestM = null;
    var base = new Matrix(ver); // function patterns + codewords are mask-independent: draw once, copy per mask
    base.drawFunctionPatterns();
    base.drawCodewords(all);
    for (var mk = 0; mk < 8; mk++) {
      var mx = new Matrix(ver, base);
      mx.applyMask(mk);
      mx.drawFormat(ecc, mk);
      var pen = mx.penalty();
      if (pen < bestPen) { bestPen = pen; best = mk; bestM = mx; }
    }
    return { size: bestM.size, version: ver, mask: best, ecc: ecc, modules: bestM.m };
  }

  function toSVG(text, o) {
    o = o || {};
    var q = encode(text, o.ecc), margin = o.margin == null ? 4 : o.margin;
    var dark = o.dark || '#000', light = o.light, n = q.size + margin * 2, d = [];
    for (var y = 0; y < q.size; y++) {
      var x = 0;
      while (x < q.size) {
        if (q.modules[y][x]) {
          var x0 = x;
          while (x < q.size && q.modules[y][x]) x++;
          d.push('M' + (x0 + margin) + ' ' + (y + margin) + 'h' + (x - x0) + 'v1h-' + (x - x0) + 'z');
        } else x++;
      }
    }
    var dim = o.size ? ' width="' + o.size + '" height="' + o.size + '"' : '';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + ' ' + n + '"' + dim +
      ' shape-rendering="crispEdges">' +
      (light ? '<rect width="' + n + '" height="' + n + '" fill="' + light + '"/>' : '') +
      '<path d="' + d.join('') + '" fill="' + dark + '"/></svg>';
  }
  function toDataURL(text, o) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(toSVG(text, o));
  }
  function toCanvas(canvas, text, o) {
    o = o || {};
    var q = encode(text, o.ecc), margin = o.margin == null ? 4 : o.margin, sc = o.scale || 6;
    var n = q.size + margin * 2;
    canvas.width = canvas.height = n * sc;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = o.light || '#fff'; ctx.fillRect(0, 0, n * sc, n * sc);
    ctx.fillStyle = o.dark || '#000';
    for (var y = 0; y < q.size; y++) for (var x = 0; x < q.size; x++)
      if (q.modules[y][x]) ctx.fillRect((x + margin) * sc, (y + margin) * sc, sc, sc);
  }

  var API = {
    encode: encode, toSVG: toSVG, toDataURL: toDataURL, toCanvas: toCanvas,
    _internal: { numDataCodewords: numDataCodewords, numRawDataModules: numRawDataModules, rsDivisor: rsDivisor,
      rsRemainder: rsRemainder, gfMul: gfMul, MASKS: MASKS, alignPositions: alignPositions,
      ECC_PER_BLOCK: ECC_PER_BLOCK, NUM_BLOCKS: NUM_BLOCKS }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.QR = API;
})(typeof window !== 'undefined' ? window : this);

/* ---- NextMON additions: styled SVG renderer (square / rounded modules, optional centre logo) + compat shims ---- */
(function (root) {
  'use strict';
  var QR = (typeof module !== 'undefined' && module.exports && module.exports.encode) ? module.exports : root.QR;
  if (!QR) return;

  function f(n) { return Math.round(n * 1000) / 1000; }

  /* Rounded module path: a corner is rounded only when both neighbouring sides are empty, so touching modules stay joined. */
  function roundedPath(mod, size, q, r) {
    var d = [], x, y;
    function on(i, j) { return i >= 0 && j >= 0 && i < size && j < size && mod[j][i]; }
    for (y = 0; y < size; y++) for (x = 0; x < size; x++) {
      if (!mod[y][x]) continue;
      var u = on(x, y - 1), dn = on(x, y + 1), l = on(x - 1, y), rt = on(x + 1, y);
      var tl = !u && !l ? r : 0, tr = !u && !rt ? r : 0, br = !dn && !rt ? r : 0, bl = !dn && !l ? r : 0;
      var X = x + q, Y = y + q;
      d.push('M' + f(X + tl) + ' ' + Y + 'H' + f(X + 1 - tr) + (tr ? 'A' + tr + ' ' + tr + ' 0 0 1 ' + (X + 1) + ' ' + f(Y + tr) : '') +
        'V' + f(Y + 1 - br) + (br ? 'A' + br + ' ' + br + ' 0 0 1 ' + f(X + 1 - br) + ' ' + (Y + 1) : '') +
        'H' + f(X + bl) + (bl ? 'A' + bl + ' ' + bl + ' 0 0 1 ' + X + ' ' + f(Y + 1 - bl) : '') +
        'V' + f(Y + tl) + (tl ? 'A' + tl + ' ' + tl + ' 0 0 1 ' + f(X + tl) + ' ' + Y : '') + 'z');
    }
    return d.join('');
  }

  function squarePath(mod, size, q) {
    var d = [], x, y;
    for (y = 0; y < size; y++) {
      x = 0;
      while (x < size) {
        if (mod[y][x]) { var x0 = x; while (x < size && mod[y][x]) x++; d.push('M' + (x0 + q) + ' ' + (y + q) + 'h' + (x - x0) + 'v1h-' + (x - x0) + 'z'); } else x++;
      }
    }
    return d.join('');
  }

  /* opts: ecc, margin (modules), dark, light (null = transparent), style 'square'|'round', logo (image URL), logoScale (<=0.24) */
  function styled(text, o) {
    o = o || {};
    var ecc = o.logo ? 'H' : (o.ecc || 'M');
    var q = QR.encode(String(text), ecc), n = q.size, margin = o.margin == null ? 2 : o.margin;
    var mod = q.modules.map(function (row) { return row.slice(); });
    var logoBox = null;
    if (o.logo) {
      var frac = Math.min(0.24, o.logoScale || 0.2);
      var s = Math.max(3, Math.round(n * frac)); if ((n - s) % 2) s++;     // keep centred
      var start = (n - s) / 2;
      for (var yy = start; yy < start + s; yy++) for (var xx = start; xx < start + s; xx++) mod[yy][xx] = false;
      logoBox = { x: start + margin, y: start + margin, s: s };
    }
    var dim = n + margin * 2, dark = o.dark || '#000';
    var path = o.style === 'round' ? roundedPath(mod, n, margin, 0.34) : squarePath(mod, n, margin);
    var out = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dim + ' ' + dim + '"' +
      (o.style === 'round' ? ' shape-rendering="geometricPrecision"' : ' shape-rendering="crispEdges"') + ' role="img" aria-label="QR code">' +
      (o.light ? '<rect width="' + dim + '" height="' + dim + '" fill="' + o.light + '"/>' : '') +
      '<path d="' + path + '" fill="' + dark + '"/>';
    if (logoBox) {
      var pad = 0.35;
      out += '<rect x="' + (logoBox.x - pad) + '" y="' + (logoBox.y - pad) + '" width="' + (logoBox.s + pad * 2) + '" height="' + (logoBox.s + pad * 2) + '" rx="1" fill="' + (o.light || '#fff') + '"/>' +
        '<image href="' + o.logo + '" x="' + logoBox.x + '" y="' + logoBox.y + '" width="' + logoBox.s + '" height="' + logoBox.s + '" preserveAspectRatio="xMidYMid meet"/>';
    }
    return out + '</svg>';
  }
  QR.styled = styled;

  if (typeof window !== 'undefined') {
    var K = window.NextMON = window.NextMON || {};
    window.NextMONQR = {
      svg: function (text, o) { o = o || {}; return styled(text, { ecc: 'M', margin: o.margin == null ? 2 : o.margin, dark: '#000', light: '#fff' }); },
      matrix: function (t) { return QR.encode(t, 'M').modules; }
    };
    K.renderQR = function (r) {
      (r || document).querySelectorAll('[data-qr]').forEach(function (el) {
        if (el.dataset.done) return;
        try { el.innerHTML = window.NextMONQR.svg(el.dataset.qr, { margin: 2 }); el.dataset.done = '1'; } catch (e) { el.textContent = '(QR)'; }
      });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { K.renderQR(); });
    else K.renderQR();
  }
})(typeof window !== 'undefined' ? window : this);
