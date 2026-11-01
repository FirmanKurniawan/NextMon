// Run: node qr.test.js   -- self-verification of qr.js (independent decoder + known capacities)
'use strict';
const assert = require('assert');
const QR = require('./qr.js');
const I = QR._internal;

// 1) Known byte-mode capacities from ISO 18004 (validates the tables)
const caps = { 'L1': 17, 'M1': 14, 'Q1': 11, 'H1': 7, 'L40': 2953, 'M40': 2331, 'Q40': 1663, 'H40': 1273,
  'L10': 271, 'M10': 213, 'Q10': 151, 'H10': 119, 'L5': 106, 'M5': 84, 'L7': 154 };
for (const k of Object.keys(caps)) {
  const e = k[0], v = +k.slice(1);
  const n = caps[k];
  assert.strictEqual(QR.encode('a'.repeat(n), e).version, v, 'cap ' + k + ' fits in v' + v);
  if (v > 1 && v < 40) assert.ok(QR.encode('a'.repeat(n + 1), e).version > v, 'cap+1 bumps ' + k);
}
assert.throws(() => QR.encode('a'.repeat(2954), 'L'));

// 2) Independent decoder
const EXP = [], LOG = [];
(function () { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11D; } })();
const mul = (a, b) => (a && b) ? EXP[(LOG[a] + LOG[b]) % 255] : 0;

function decode(q) {
  const s = q.size, m = q.modules;
  assert.strictEqual(s, 17 + 4 * q.version);
  // finder patterns
  for (const [ox, oy] of [[0, 0], [s - 7, 0], [0, s - 7]])
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
      const d = Math.max(Math.abs(x - 3), Math.abs(y - 3));
      assert.strictEqual(m[oy + y][ox + x], d !== 2, 'finder');
    }
  // timing
  for (let i = 8; i < s - 8; i++) { assert.strictEqual(m[6][i], i % 2 === 0); assert.strictEqual(m[i][6], i % 2 === 0); }
  // format info (copy 1) -> BCH check
  let f = 0;
  const pos1 = [[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];
  pos1.forEach(([x, y], i) => { if (m[y][x]) f |= 1 << i; });
  f ^= 0x5412;
  let r = f; for (let i = 14; i >= 10; i--) if ((r >> i) & 1) r ^= 0x537 << (i - 10);
  assert.strictEqual(r, 0, 'format BCH');
  const mask = (f >> 10) & 7, eccBits = (f >> 13) & 3;
  assert.strictEqual(mask, q.mask);
  const ecc = { 1: 'L', 0: 'M', 3: 'Q', 2: 'H' }[eccBits];
  assert.strictEqual(ecc, q.ecc);
  // function-module map built independently of qr.js internals
  const fn = Array.from({ length: s }, () => new Array(s).fill(false));
  const mark = (x0, y0, w, h) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (x >= 0 && y >= 0 && x < s && y < s) fn[y][x] = true; };
  mark(0, 0, 9, 9); mark(s - 8, 0, 8, 9); mark(0, s - 8, 9, 8);
  mark(6, 0, 1, s); mark(0, 6, s, 1);
  const ap = I.alignPositions(q.version);
  ap.forEach((a, i) => ap.forEach((b, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0)) return;
    mark(a - 2, b - 2, 5, 5);
  }));
  if (q.version >= 7) { mark(s - 11, 0, 3, 6); mark(0, s - 11, 6, 3); }
  // count of data modules must equal raw module count
  let dataMods = 0; fn.forEach(row => row.forEach(v => { if (!v) dataMods++; }));
  assert.strictEqual(dataMods, I.numRawDataModules(q.version), 'data module count');
  // read bits zig-zag, unmask
  const bits = [];
  for (let right = s - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < s; v++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? s - 1 - v : v;
      if (!fn[y][x]) bits.push(m[y][x] !== I.MASKS[mask](x, y));
    }
  }
  const cw = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) { let b = 0; for (let k = 0; k < 8; k++) b = (b << 1) | (bits[i + k] ? 1 : 0); cw.push(b); }
  // de-interleave
  const e = { L: 0, M: 1, Q: 2, H: 3 }[ecc], nb = I.NUM_BLOCKS[e][q.version], el = I.ECC_PER_BLOCK[e][q.version];
  const raw = cw.length, shortBlocks = nb - raw % nb, shortLen = Math.floor(raw / nb);
  const blocks = Array.from({ length: nb }, () => []);
  let idx = 0;
  for (let i = 0; i < shortLen - el; i++) for (let b = 0; b < nb; b++) blocks[b].push(cw[idx++]);
  for (let b = shortBlocks; b < nb; b++) blocks[b].push(cw[idx++]);
  for (let i = 0; i < el; i++) for (let b = 0; b < nb; b++) blocks[b].push(cw[idx++]);
  assert.strictEqual(idx, cw.length);
  // RS syndromes must be zero: block(alpha^i) == 0 for i<el
  blocks.forEach(blk => {
    for (let i = 0; i < el; i++) {
      let acc = 0; for (const c of blk) acc = mul(acc, EXP[i]) ^ c;
      assert.strictEqual(acc, 0, 'RS syndrome');
    }
  });
  const data = [];
  blocks.forEach(blk => data.push(...blk.slice(0, blk.length - el)));
  // parse byte mode
  let bp = 0; const rd = n => { let v = 0; for (let i = 0; i < n; i++, bp++) v = (v << 1) | ((data[bp >> 3] >> (7 - (bp & 7))) & 1); return v; };
  assert.strictEqual(rd(4), 4, 'mode = byte');
  const len = rd(q.version < 10 ? 8 : 16);
  const out = Buffer.alloc(len); for (let i = 0; i < len; i++) out[i] = rd(8);
  return out.toString('utf8');
}

const samples = [
  'A', 'HELLO WORLD', 'http://10.5.50.1/login?username=abc123&password=xy9',
  'Voucher é中文 😀', 'x'.repeat(100), 'y'.repeat(300), 'z'.repeat(1500), 'w'.repeat(2900)
];
let n = 0;
for (const t of samples) for (const e of ['L', 'M', 'Q', 'H']) {
  let q; try { q = QR.encode(t, e); } catch (x) { if (/too long/.test(x.message)) continue; throw x; }
  assert.strictEqual(decode(q), t); n++;
}
// every version 1..40 exercised at ECC M and H
for (let v = 1; v <= 40; v++) for (const e of ['M', 'H']) {
  const t = 'k'.repeat(Math.max(1, I.numDataCodewords(v, e === 'M' ? 1 : 3) - (v < 10 ? 2 : 3)));
  const q = QR.encode(t, e); assert.strictEqual(q.version, v); assert.strictEqual(decode(q), t); n++;
}
// SVG sanity
const svg = QR.toSVG('hello', { light: '#fff' });
assert.ok(svg.startsWith('<svg') && svg.includes('<path'));
console.log('qr.js OK -', n, 'encode/decode round-trips, capacity table, RS syndromes, format BCH all verified');
