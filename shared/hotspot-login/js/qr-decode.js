/*! qr-decode.js - compact standalone QR Code reader (versions 1-40, numeric/alphanumeric/byte modes,
 * Reed-Solomon error correction, affine + alignment-pattern perspective sampling). MIT License.
 * No dependencies. window.QRDecode / module.exports.
 *
 *   QRDecode.decode(rgbaUint8Array, width, height)  -> string | null
 *   QRDecode.decodeCanvas(canvas)                   -> string | null
 *
 * Intended as a fallback when the native BarcodeDetector API is missing. It copes with moderate rotation,
 * perspective and a few damaged modules; it is not a replacement for a full-strength decoder in bad light.
 */
(function (root) {
  'use strict';

  // ---------- GF(256) ----------
  var EXP = new Uint8Array(512), LOG = new Uint8Array(256), i0;
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11D; }
    for (i0 = 255; i0 < 512; i0++) EXP[i0] = EXP[i0 - 255];
  })();
  function gmul(a, b) { return a && b ? EXP[LOG[a] + LOG[b]] : 0; }
  function ginv(a) { return EXP[255 - LOG[a]]; }

  // Reed-Solomon correct in place; blk = data+ecc bytes (highest power first). Returns true on success.
  function rsCorrect(blk, nsym) {
    var n = blk.length, S = [], i, j, bad = false;
    for (i = 0; i < nsym; i++) {
      var acc = 0;
      for (j = 0; j < n; j++) acc = gmul(acc, EXP[i]) ^ blk[j];
      S.push(acc); if (acc) bad = true;
    }
    if (!bad) return true;
    // Berlekamp-Massey
    var C = [1], B = [1], L = 0, m = 1, b = 1;
    for (var k = 0; k < nsym; k++) {
      var d = S[k];
      for (i = 1; i <= L; i++) d ^= gmul(C[i] || 0, S[k - i]);
      if (d === 0) { m++; continue; }
      var T = C.slice(), coef = gmul(d, ginv(b));
      while (C.length < B.length + m) C.push(0);
      for (i = 0; i < B.length; i++) C[i + m] ^= gmul(coef, B[i]);
      if (2 * L <= k) { L = k + 1 - L; B = T; b = d; m = 1; } else m++;
    }
    while (C.length && C[C.length - 1] === 0) C.pop();
    if (L === 0 || C.length - 1 !== L || L * 2 > nsym) return false;
    // Omega = S * Lambda mod x^nsym
    var Om = [];
    for (i = 0; i < nsym; i++) {
      var v = 0;
      for (j = 0; j <= i && j < C.length; j++) v ^= gmul(C[j], S[i - j]);
      Om.push(v);
    }
    var found = 0;
    for (var pos = 0; pos < n; pos++) {
      var p = n - 1 - pos, xinv = EXP[(255 - p) % 255], sum = 0, x = 1;
      for (i = 0; i < C.length; i++) { sum ^= gmul(C[i], x); x = gmul(x, xinv); }
      if (sum !== 0) continue;
      var num = 0; x = 1;
      for (i = 0; i < Om.length; i++) { num ^= gmul(Om[i], x); x = gmul(x, xinv); }
      var den = 0; x = 1; // derivative: odd terms
      for (i = 1; i < C.length; i += 2) { den ^= gmul(C[i], x); x = gmul(x, gmul(xinv, xinv)); }
      if (den === 0) return false;
      blk[pos] ^= gmul(gmul(EXP[p % 255], num), ginv(den));
      found++;
    }
    if (found !== L) return false;
    for (i = 0; i < nsym; i++) {
      var a2 = 0;
      for (j = 0; j < n; j++) a2 = gmul(a2, EXP[i]) ^ blk[j];
      if (a2) return false;
    }
    return true;
  }

  // ---------- tables (same ISO 18004 data as the encoder) ----------
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
  var FMT_ECC_TO_IDX = { 1: 0, 0: 1, 3: 2, 2: 3 }; // format bits -> L,M,Q,H index
  function rawModules(ver) {
    var r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) { var na = Math.floor(ver / 7) + 2; r -= (25 * na - 10) * na - 55; if (ver >= 7) r -= 36; }
    return r;
  }
  function alignPos(ver) {
    if (ver === 1) return [];
    var n = Math.floor(ver / 7) + 2, step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2, res = [6];
    for (var p = ver * 4 + 10; res.length < n; p -= step) res.splice(1, 0, p);
    return res;
  }
  var FORMATS = (function () {
    var out = [];
    for (var d = 0; d < 32; d++) {
      var r = d;
      for (var i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      out.push({ data: d, bits: ((d << 10) | r) ^ 0x5412 });
    }
    return out;
  })();
  function popcount(x) { var c = 0; while (x) { c += x & 1; x >>>= 1; } return c; }
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

  // ---------- matrix -> text ----------
  function decodeMatrix(m, ver) {
    var s = ver * 4 + 17, x, y, i, j;
    function bitAt(list) { var v = 0; list.forEach(function (p, k) { if (m[p[1]][p[0]]) v |= 1 << k; }); return v; }
    var c1 = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
    var c2 = [];
    for (i = 0; i < 8; i++) c2.push([s - 1 - i, 8]);
    for (i = 8; i < 15; i++) c2.push([8, s - 15 + i]);
    var cand = [bitAt(c1), bitAt(c2)], best = null, bd = 99;
    cand.forEach(function (bits) {
      FORMATS.forEach(function (f) { var d = popcount(bits ^ f.bits); if (d < bd) { bd = d; best = f.data; } });
    });
    if (bd > 3) return null;
    var e = FMT_ECC_TO_IDX[best >> 3], mask = best & 7;
    // function module map
    var fn = [];
    for (y = 0; y < s; y++) fn.push(new Uint8Array(s));
    function mark(x0, y0, w, h) { for (var yy = y0; yy < y0 + h; yy++) for (var xx = x0; xx < x0 + w; xx++) if (xx >= 0 && yy >= 0 && xx < s && yy < s) fn[yy][xx] = 1; }
    mark(0, 0, 9, 9); mark(s - 8, 0, 8, 9); mark(0, s - 8, 9, 8); mark(6, 0, 1, s); mark(0, 6, s, 1);
    var ap = alignPos(ver);
    for (i = 0; i < ap.length; i++) for (j = 0; j < ap.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0)) continue;
      mark(ap[i] - 2, ap[j] - 2, 5, 5);
    }
    if (ver >= 7) { mark(s - 11, 0, 3, 6); mark(0, s - 11, 6, 3); }
    var bits = [];
    for (var right = s - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var v = 0; v < s; v++) for (var k = 0; k < 2; k++) {
        x = right - k; var up = ((right + 1) & 2) === 0; y = up ? s - 1 - v : v;
        if (!fn[y][x]) bits.push((m[y][x] ? 1 : 0) ^ (MASKS[mask](x, y) ? 1 : 0));
      }
    }
    var cw = [];
    for (i = 0; i + 8 <= bits.length; i += 8) { var b = 0; for (k = 0; k < 8; k++) b = (b << 1) | bits[i + k]; cw.push(b); }
    var nb = NUM_BLOCKS[e][ver], el = ECC_PER_BLOCK[e][ver], raw = cw.length;
    if (raw !== Math.floor(rawModules(ver) / 8)) return null;
    var shortBlocks = nb - raw % nb, shortLen = Math.floor(raw / nb), blocks = [], idx = 0;
    for (i = 0; i < nb; i++) blocks.push([]);
    for (i = 0; i < shortLen - el; i++) for (j = 0; j < nb; j++) blocks[j].push(cw[idx++]);
    for (j = shortBlocks; j < nb; j++) blocks[j].push(cw[idx++]);
    for (i = 0; i < el; i++) for (j = 0; j < nb; j++) blocks[j].push(cw[idx++]);
    var data = [];
    for (j = 0; j < nb; j++) {
      if (!rsCorrect(blocks[j], el)) return null;
      for (i = 0; i < blocks[j].length - el; i++) data.push(blocks[j][i]);
    }
    return parseData(data, ver);
  }

  var ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
  function parseData(data, ver) {
    var bp = 0, total = data.length * 8, out = [];
    function rd(n) { var v = 0; for (var i = 0; i < n; i++, bp++) v = (v << 1) | ((data[bp >> 3] >> (7 - (bp & 7))) & 1); return v; }
    while (bp + 4 <= total) {
      var mode = rd(4);
      if (mode === 0) break;
      if (mode === 4) {
        var n = rd(ver < 10 ? 8 : 16);
        if (bp + n * 8 > total) return null;
        for (var i = 0; i < n; i++) out.push(rd(8));
      } else if (mode === 2) {
        var cnt = rd(ver < 10 ? 9 : ver < 27 ? 11 : 13), str = '';
        if (bp + Math.floor(cnt / 2) * 11 + (cnt % 2) * 6 > total) return null;
        for (; cnt >= 2; cnt -= 2) { var v = rd(11); str += ALNUM[Math.floor(v / 45)] + ALNUM[v % 45]; }
        if (cnt === 1) str += ALNUM[rd(6)];
        for (i = 0; i < str.length; i++) out.push(str.charCodeAt(i));
      } else if (mode === 1) {
        var nc = rd(ver < 10 ? 10 : ver < 27 ? 12 : 14), s2 = '';
        for (; nc >= 3; nc -= 3) s2 += ('00' + rd(10)).slice(-3);
        if (nc === 2) s2 += ('0' + rd(7)).slice(-2);
        if (nc === 1) s2 += rd(4);
        for (i = 0; i < s2.length; i++) out.push(s2.charCodeAt(i));
      } else if (mode === 7) { rd(8); } // ECI designator (ignored)
      else return null; // kanji / structured append / FNC1 unsupported
    }
    return utf8(out);
  }
  function utf8(b) {
    try { return decodeURIComponent(b.map(function (x) { return '%' + (x < 16 ? '0' : '') + x.toString(16); }).join('')); }
    catch (e) { return String.fromCharCode.apply(null, b); }
  }

  // ---------- image -> binary ----------
  function toGray(rgba, w, h) {
    var g = new Uint8Array(w * h);
    for (var i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
    return g;
  }
  function binAdaptive(g, w, h) {
    var win = Math.max(15, (Math.round(Math.min(w, h) / 6)) | 1), half = win >> 1;
    var I = new Float64Array((w + 1) * (h + 1)), x, y;
    for (y = 0; y < h; y++) {
      var row = 0;
      for (x = 0; x < w; x++) { row += g[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; }
    }
    var bw = new Uint8Array(w * h);
    for (y = 0; y < h; y++) {
      var y0 = Math.max(0, y - half), y1 = Math.min(h, y + half + 1);
      for (x = 0; x < w; x++) {
        var x0 = Math.max(0, x - half), x1 = Math.min(w, x + half + 1);
        var sum = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
        var mean = sum / ((x1 - x0) * (y1 - y0));
        bw[y * w + x] = g[y * w + x] < mean * 0.92 - 2 ? 1 : 0;
      }
    }
    return bw;
  }
  function binOtsu(g, w, h) {
    var hist = new Array(256).fill(0), i, total = g.length;
    for (i = 0; i < total; i++) hist[g[i]]++;
    var sum = 0; for (i = 0; i < 256; i++) sum += i * hist[i];
    var sB = 0, wB = 0, best = 0, th = 128;
    for (i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue;
      var wF = total - wB; if (!wF) break;
      sB += i * hist[i];
      var mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; th = i; }
    }
    var bw = new Uint8Array(total);
    for (i = 0; i < total; i++) bw[i] = g[i] <= th ? 1 : 0;
    return bw;
  }

  // ---------- finder patterns ----------
  function findFinders(bw, w, h) {
    var cands = [];
    function check(r, tot) { // r = 5 runs
      var ms = tot / 7, tol = ms * 0.65;
      return Math.abs(r[0] - ms) < tol && Math.abs(r[1] - ms) < tol && Math.abs(r[2] - 3 * ms) < 3 * tol &&
        Math.abs(r[3] - ms) < tol && Math.abs(r[4] - ms) < tol;
    }
    function vertical(cx, cy, ms) { // returns refined {y, ms} or null
      var lim = Math.ceil(ms * 5), r = [0, 0, 0, 0, 0], y = cy;
      while (y >= 0 && bw[y * w + cx] && cy - y < lim) { r[2]++; y--; }
      while (y >= 0 && !bw[y * w + cx] && cy - y < lim) { r[1]++; y--; }
      while (y >= 0 && bw[y * w + cx] && cy - y < lim) { r[0]++; y--; }
      y = cy + 1;
      while (y < h && bw[y * w + cx] && y - cy < lim) { r[2]++; y++; }
      while (y < h && !bw[y * w + cx] && y - cy < lim) { r[3]++; y++; }
      while (y < h && bw[y * w + cx] && y - cy < lim) { r[4]++; y++; }
      var tot = r[0] + r[1] + r[2] + r[3] + r[4];
      if (!check(r, tot)) return null;
      return { y: y - r[4] - r[3] - r[2] / 2, ms: tot / 7 };
    }
    for (var y = 0; y < h; y++) {
      var runs = [], cur = bw[y * w], start = 0, x;
      for (x = 1; x <= w; x++) {
        var v = x < w ? bw[y * w + x] : -1;
        if (v !== cur) { runs.push({ c: cur, s: start, n: x - start }); cur = v; start = x; }
      }
      for (var k = 0; k + 4 < runs.length; k++) {
        if (runs[k].c !== 1) continue;
        var r = [runs[k].n, runs[k + 1].n, runs[k + 2].n, runs[k + 3].n, runs[k + 4].n];
        var tot = r[0] + r[1] + r[2] + r[3] + r[4];
        if (!check(r, tot)) continue;
        var cx = Math.round(runs[k + 2].s + runs[k + 2].n / 2 - 0.5);
        var vr = vertical(cx, y, tot / 7);
        if (!vr) continue;
        var fx = runs[k + 2].s + runs[k + 2].n / 2, fy = vr.y, fms = (tot / 7 + vr.ms) / 2, found = false;
        for (var q = 0; q < cands.length; q++) {
          var c = cands[q];
          if (Math.abs(c.x - fx) < fms * 2 && Math.abs(c.y - fy) < fms * 2 && Math.abs(c.ms - fms) < fms * 0.5) {
            c.x = (c.x * c.n + fx) / (c.n + 1); c.y = (c.y * c.n + fy) / (c.n + 1); c.ms = (c.ms * c.n + fms) / (c.n + 1); c.n++;
            found = true; break;
          }
        }
        if (!found) cands.push({ x: fx, y: fy, ms: fms, n: 1 });
      }
    }
    cands = cands.filter(function (c) { return c.n >= 2; });
    cands.sort(function (a, b) { return b.n - a.n; });
    return cands.slice(0, 12);
  }
  function dist(a, b) { return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)); }
  function triples(c) {
    var out = [];
    for (var i = 0; i < c.length; i++) for (var j = i + 1; j < c.length; j++) for (var k = j + 1; k < c.length; k++) {
      var P = [c[i], c[j], c[k]];
      for (var a = 0; a < 3; a++) {
        var A = P[a], B = P[(a + 1) % 3], C = P[(a + 2) % 3];
        var ab = dist(A, B), ac = dist(A, C), bc = dist(B, C);
        var mx = Math.max(ab, ac);
        if (Math.abs(ab - ac) / mx > 0.3) continue;
        if (Math.abs(bc / ((ab + ac) / 2) - 1.4142) > 0.4) continue;
        var msr = Math.max(A.ms, B.ms, C.ms) / Math.min(A.ms, B.ms, C.ms);
        if (msr > 1.6) continue;
        var cross = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x);
        var TL = A, TR = B, BL = C;
        if (cross < 0) { TR = C; BL = B; }
        out.push({ TL: TL, TR: TR, BL: BL, score: Math.abs(ab - ac) / mx + Math.abs(bc / ((ab + ac) / 2) - 1.4142) + (msr - 1) });
      }
    }
    out.sort(function (a, b) { return a.score - b.score; });
    return out.slice(0, 6);
  }

  // ---------- sampling ----------
  function homography(src, dst) { // 4 point pairs -> 8 coefficients
    var A = [], i, j, k;
    for (i = 0; i < 4; i++) {
      var u = src[i][0], v = src[i][1], x = dst[i][0], y = dst[i][1];
      A.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x]);
      A.push([0, 0, 0, u, v, 1, -u * y, -v * y, y]);
    }
    for (i = 0; i < 8; i++) {
      var p = i;
      for (j = i + 1; j < 8; j++) if (Math.abs(A[j][i]) > Math.abs(A[p][i])) p = j;
      var t = A[i]; A[i] = A[p]; A[p] = t;
      if (Math.abs(A[i][i]) < 1e-12) return null;
      for (j = 0; j < 8; j++) {
        if (j === i) continue;
        var f = A[j][i] / A[i][i];
        for (k = i; k < 9; k++) A[j][k] -= f * A[i][k];
      }
    }
    var h = []; for (i = 0; i < 8; i++) h.push(A[i][8] / A[i][i]);
    return h;
  }
  function mapper(h) {
    return function (u, v) {
      var d = h[6] * u + h[7] * v + 1;
      return [(h[0] * u + h[1] * v + h[2]) / d, (h[3] * u + h[4] * v + h[5]) / d];
    };
  }
  function findAlignment(bw, w, h, map, dim) {
    var p0 = map(dim - 6.5, dim - 6.5), px = map(dim - 5.5, dim - 6.5), py = map(dim - 6.5, dim - 5.5);
    var ex = [px[0] - p0[0], px[1] - p0[1]], ey = [py[0] - p0[0], py[1] - p0[1]];
    var ms = Math.sqrt(ex[0] * ex[0] + ex[1] * ex[1]), rad = Math.ceil(ms * 4), best = -1, bx = 0, by = 0, i, j;
    function px_(x, y) { x = Math.round(x); y = Math.round(y); return x >= 0 && y >= 0 && x < w && y < h ? bw[y * w + x] : 0; }
    for (var dy = -rad; dy <= rad; dy++) for (var dx = -rad; dx <= rad; dx++) {
      var cx = p0[0] + dx, cy = p0[1] + dy, sc = 0;
      for (i = -2; i <= 2; i++) for (j = -2; j <= 2; j++) {
        var ring = Math.max(Math.abs(i), Math.abs(j)), want = ring === 1 ? 0 : 1;
        if (px_(cx + i * ex[0] + j * ey[0], cy + i * ex[1] + j * ey[1]) === want) sc += ring === 0 ? 3 : 1;
      }
      if (sc > best) { best = sc; bx = cx; by = cy; }
    }
    return best >= 24 + 2 ? [bx, by] : null; // max 24 + 3 = 27
  }
  function sample(bw, w, h, map, dim) {
    var m = [], y, x;
    function at(p) { var xx = Math.round(p[0]), yy = Math.round(p[1]); return xx >= 0 && yy >= 0 && xx < w && yy < h ? bw[yy * w + xx] : 0; }
    for (y = 0; y < dim; y++) {
      var row = [];
      for (x = 0; x < dim; x++) {
        var n = at(map(x + 0.5, y + 0.5)) + at(map(x + 0.25, y + 0.5)) + at(map(x + 0.75, y + 0.5)) +
          at(map(x + 0.5, y + 0.25)) + at(map(x + 0.5, y + 0.75));
        row.push(n >= 3);
      }
      m.push(row);
    }
    return m;
  }
  function tryTriple(bw, w, h, t) {
    var TL = t.TL, TR = t.TR, BL = t.BL, ms = (TL.ms + TR.ms + BL.ms) / 3;
    var d = (dist(TL, TR) + dist(TL, BL)) / 2;
    var vEst = Math.round(((d / ms + 7) - 17) / 4);
    var tried = {}, offs = [0, 1, -1, 2, -2];
    for (var oi = 0; oi < offs.length; oi++) {
      var ver = vEst + offs[oi];
      if (ver < 1 || ver > 40 || tried[ver]) continue;
      tried[ver] = 1;
      var dim = 17 + 4 * ver, sc = dim - 7;
      // affine through the three finder centres
      var ax = [(TR.x - TL.x) / sc, (TR.y - TL.y) / sc], ay = [(BL.x - TL.x) / sc, (BL.y - TL.y) / sc];
      var affine = function (u, v) {
        return [TL.x + (u - 3.5) * ax[0] + (v - 3.5) * ay[0], TL.y + (u - 3.5) * ax[1] + (v - 3.5) * ay[1]];
      };
      var maps = [affine];
      if (ver >= 2) {
        var al = findAlignment(bw, w, h, affine, dim);
        if (al) {
          var hm = homography([[3.5, 3.5], [dim - 3.5, 3.5], [3.5, dim - 3.5], [dim - 6.5, dim - 6.5]],
            [[TL.x, TL.y], [TR.x, TR.y], [BL.x, BL.y], al]);
          if (hm) maps.unshift(mapper(hm));
        }
      }
      for (var mi = 0; mi < maps.length; mi++) {
        var res = decodeMatrix(sample(bw, w, h, maps[mi], dim), ver);
        if (res !== null) return res;
      }
    }
    return null;
  }

  function decodeBW(bw, w, h) {
    var f = findFinders(bw, w, h);
    if (f.length < 3) return null;
    var ts = triples(f);
    for (var i = 0; i < ts.length; i++) {
      var r = tryTriple(bw, w, h, ts[i]);
      if (r !== null) return r;
    }
    return null;
  }
  function decode(rgba, w, h) {
    var g = toGray(rgba, w, h), r = decodeBW(binAdaptive(g, w, h), w, h);
    if (r === null) r = decodeBW(binOtsu(g, w, h), w, h);
    if (r === null) { // inverted (light-on-dark) codes
      var inv = new Uint8Array(g.length); for (var i = 0; i < g.length; i++) inv[i] = 255 - g[i];
      r = decodeBW(binAdaptive(inv, w, h), w, h);
    }
    return r;
  }
  function decodeCanvas(canvas) {
    var ctx = canvas.getContext('2d'), id = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return decode(id.data, id.width, id.height);
  }

  var API = { decode: decode, decodeCanvas: decodeCanvas, _rsCorrect: rsCorrect };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.QRDecode = API;
})(typeof window !== 'undefined' ? window : this);
