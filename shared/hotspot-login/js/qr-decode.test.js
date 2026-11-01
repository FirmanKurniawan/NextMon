// Run: node qr-decode.test.js  -- tests the fallback decoder against the standalone encoder
'use strict';
const assert = require('assert');
const path = require('path');
const QR = require(path.join(__dirname, '../../voucher-templates/qr.js'));
const D = require('./qr-decode.js');

// render a QR into an RGBA image with a homography-ish transform (rotation, scale, perspective), optional noise
function render(text, ecc, opt) {
  opt = opt || {};
  const q = QR.encode(text, ecc), n = q.size, quiet = 4, tot = n + quiet * 2;
  const W = opt.W || 480, H = opt.H || 480, sc = opt.scale || Math.floor(Math.min(W, H) * 0.7 / tot);
  const ang = (opt.angle || 0) * Math.PI / 180, persp = opt.persp || 0;
  const px = new Uint8ClampedArray(W * H * 4);
  let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const flips = new Set();
  for (let i = 0; i < (opt.flips || 0); i++) flips.add(Math.floor(rnd() * n) + ',' + Math.floor(rnd() * n));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    // inverse map: image -> module coords
    let dx = x - W / 2, dy = y - H / 2;
    const k = 1 + persp * dx / W; // simple perspective foreshortening along x
    dx /= k; dy /= k;
    const c = Math.cos(-ang), s = Math.sin(-ang);
    const ux = (dx * c - dy * s) / sc + tot / 2, uy = (dx * s + dy * c) / sc + tot / 2;
    let v = 255;
    const mx = Math.floor(ux - quiet), my = Math.floor(uy - quiet);
    if (mx >= 0 && my >= 0 && mx < n && my < n) {
      let dark = q.modules[my][mx];
      if (flips.has(mx + ',' + my)) dark = !dark;
      v = dark ? 30 : 225;
    }
    v += (opt.noise ? (rnd() - 0.5) * opt.noise : 0);
    if (opt.shade) v *= 0.55 + 0.45 * (x / W); // illumination gradient
    const o = (y * W + x) * 4; px[o] = px[o + 1] = px[o + 2] = Math.max(0, Math.min(255, v)); px[o + 3] = 255;
  }
  return { px, W, H };
}
let pass = 0, fail = [];
function t(name, text, ecc, opt) {
  const im = render(text, ecc, opt), r = D.decode(im.px, im.W, im.H);
  if (r === text) pass++; else fail.push(name + ' -> ' + JSON.stringify(r));
}
const url = 'http://wifi.net/login?username=ab12cd&password=ab12cd';
t('plain v3', 'ab12cd', 'M');
t('url M', url, 'M');
t('url L', url, 'L');
t('url H', url, 'H');
t('long v7+', 'z'.repeat(120) + url, 'M', { W: 700, H: 700 });
t('rot 20', url, 'M', { angle: 20 });
t('rot 90', url, 'M', { angle: 90 });
t('rot 180', url, 'M', { angle: 180 });
t('rot -37', url, 'Q', { angle: -37 });
t('noise', url, 'M', { noise: 60 });
t('shade', url, 'M', { shade: true, noise: 20 });
t('flips H', url, 'H', { flips: 12 });
t('persp', url, 'M', { persp: 0.12, angle: 8 });
t('utf8', 'Voucher é中', 'M');
assert.strictEqual(D._rsCorrect([1, 2, 3], 0), true);
console.log('decoder pass:', pass, 'fail:', fail.length);
fail.forEach(f => console.log('  FAIL', f));
process.exit(fail.length ? 1 : 0);
