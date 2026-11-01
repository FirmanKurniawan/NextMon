// node tests/js/escpos.test.js   - ESC/POS byte sequences (native QR + raster fallback)
'use strict';
const assert = require('assert');
const path = require('path');
const E = require(path.join(__dirname, '../../public/assets/js/escpos.js'));
const QR = require(path.join(__dirname, '../../public/assets/js/qr.js'));
const hex = (u) => Array.from(u).map((x) => ('0' + x.toString(16)).slice(-2)).join(' ');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

t('native QR: exact GS ( k sequence (model 2, size 6, ECC M, store HELLO, print)', () => {
  const b = new E.Builder({ cols: 32 }).qrNative('HELLO', { size: 6, ecc: 'M' });
  assert.strictEqual(hex(b.bytes()), [
    '1d 28 6b 04 00 31 41 32 00',            // model 2
    '1d 28 6b 03 00 31 43 06',               // module size 6
    '1d 28 6b 03 00 31 45 31',               // ECC M = 49
    '1d 28 6b 08 00 31 50 30 48 45 4c 4c 4f', // store: pL pH = len+3 = 8
    '1d 28 6b 03 00 31 51 30'                // print
  ].join(' '));
});
t('native QR: ECC levels map to 48..51 and size is clamped to 1..16', () => {
  ['L', 'M', 'Q', 'H'].forEach((l, i) => assert.ok(hex(new E.Builder().qrNative('a', { ecc: l }).bytes()).includes('31 45 ' + (48 + i).toString(16))));
  assert.ok(hex(new E.Builder().qrNative('a', { size: 99 }).bytes()).includes('31 43 10'));
});
t('native QR: length field is little endian for long data (300 chars -> 303 = 2f 01)', () => {
  const s = hex(new E.Builder().qrNative('x'.repeat(300), {}).bytes());
  assert.ok(s.includes('1d 28 6b 2f 01 31 50 30 78'), s.slice(0, 120));
});
t('native QR: UTF-8 multi-byte text is stored as UTF-8 bytes', () => {
  const s = hex(new E.Builder().qrNative('é', {}).bytes());   // e-acute = c3 a9
  assert.ok(s.includes('1d 28 6b 05 00 31 50 30 c3 a9'), s);
});
t('native QR: empty / oversized data throws', () => {
  assert.throws(() => new E.Builder().qrNative('', {}));
  assert.throws(() => new E.Builder().qrNative('x'.repeat(7001), {}));
});
t('raster QR: GS v 0 header, dimensions and bitmap round-trip to the QR matrix', () => {
  const q = QR.encode('http://wifi.test/login?username=abc123&password=abc123', 'M');
  const b = new E.Builder({ cols: 32 }).qrRaster(q.modules, { scale: 3, quiet: 2 });
  const u = b.bytes(), info = b.rasterInfo, tot = q.size + 4;
  assert.deepStrictEqual(Array.from(u.slice(0, 8)), [0x1d, 0x76, 0x30, 0, info.wBytes & 255, info.wBytes >> 8, info.hDots & 255, info.hDots >> 8]);
  assert.strictEqual(info.wDots, tot * 3); assert.strictEqual(u.length, 8 + info.wBytes * info.hDots);
  assert.ok(info.wDots <= 384, 'fits 58 mm');
  // read it back: sample the centre of each module
  const px = (x, y) => (u[8 + y * info.wBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
  for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) {
    assert.strictEqual(px((x + 2) * 3 + 1, (y + 2) * 3 + 1), q.modules[y][x] ? 1 : 0, `module ${x},${y}`);
  }
  for (let x = 0; x < info.wDots; x++) assert.strictEqual(px(x, 0), 0, 'quiet zone is white');
});
t('raster QR: default scale fits the paper width for 58 and 80 mm', () => {
  const m = QR.encode('http://hotspot.local/login?username=k7m2pq&password=k7m2pq', 'M').modules;
  [[32, 384], [48, 576]].forEach(([cols, dots]) => { const b = new E.Builder({ cols }).qrRaster(m, {}); assert.ok(b.rasterInfo.wDots <= dots * .7, cols + ': ' + b.rasterInfo.wDots); });
});
t('vouchers(): init, text, native QR, partial cut at the end; all bytes printable or control', () => {
  const items = [{ u: 'kpgzf5', p: 'kpgzf5', pr: '1Hari', price: 'Rp 5.000', v: '1d' }, { u: 'rw8', p: 'x9z4', pr: 'Café', price: '', v: '' }];
  const u = E.vouchers(items, { cols: 32, hotspot: 'NEXTMON DEMO', qr: 'native', QR, qrText: (it) => 'http://h/login?username=' + it.u });
  const s = hex(u);
  assert.ok(s.startsWith('1b 40'), 'ESC @');
  assert.strictEqual((s.match(/1d 28 6b 03 00 31 51 30/g) || []).length, 2, 'one print command per voucher');
  assert.ok(s.endsWith('1d 56 42 03'), 'GS V 66 3 at the end');
  assert.ok(Buffer.from(u).toString('latin1').includes('NEXTMON DEMO'));
  assert.ok(Buffer.from(u).toString('latin1').includes('Cafe'), 'accents transliterated');
  assert.ok(Buffer.from(u).toString('latin1').includes('Pass'), 'two-credential voucher prints a password row');
});
t('vouchers(): raster mode uses GS v 0 and no GS ( k; off mode has no QR at all', () => {
  const it = [{ u: 'abc123', p: 'abc123' }], o = { QR, qrText: (x) => 'http://h/?u=' + x.u, hotspot: 'X' };
  const r = hex(E.vouchers(it, Object.assign({ qr: 'raster' }, o)));
  assert.ok(r.includes('1d 76 30 00') && !r.includes('1d 28 6b'));
  const f = hex(E.vouchers(it, Object.assign({ qr: 'off' }, o)));
  assert.ok(!f.includes('1d 76 30') && !f.includes('1d 28 6b'));
});
t('wrap(): long hotspot names wrap inside the column count (32 and 48 cols)', () => {
  const name = 'NEXTMON DEMO WIFI HOTSPOT CAFE RUMAH KOPI NUSANTARA 24 JAM';
  [32, 48].forEach((c) => { const l = E.wrap(name, c); assert.ok(l.length >= 2 || c === 48 && name.length <= 48); l.forEach((x) => assert.ok(x.length <= c, x)); assert.strictEqual(l.join(' ').replace(/s+/g, ' '), name); });
  assert.ok(E.wrap('ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOP', 32).every((x) => x.length <= 32), 'unbreakable word is hard-split');
});
t('framing: a full 2-voucher stream parses cleanly command by command (native and raster)', () => {
  function parse(u) {
    const cmds = []; let i = 0;
    while (i < u.length) {
      const c = u[i];
      if (c === 0x1b) { const f = u[i + 1]; const len = { 0x40: 2, 0x61: 3, 0x45: 3, 0x64: 3 }[f]; assert.ok(len, 'ESC ' + f.toString(16) + ' @' + i); cmds.push('ESC' + String.fromCharCode(f)); i += len; }
      else if (c === 0x1d) {
        const f = u[i + 1];
        if (f === 0x21) { cmds.push('GS!'); i += 3; }
        else if (f === 0x56) { cmds.push('GSV'); i += 4; }
        else if (f === 0x28) { assert.strictEqual(u[i + 2], 0x6b); const n = u[i + 3] + u[i + 4] * 256; cmds.push('GSk' + u[i + 6]); i += 5 + n; }
        else if (f === 0x76) { const w = u[i + 4] + u[i + 5] * 256, h = u[i + 6] + u[i + 7] * 256; cmds.push('GSv'); i += 8 + w * h; }
        else assert.fail('unknown GS ' + f.toString(16));
      } else if (c === 0x0a || (c >= 0x20 && c < 0x7f)) i++;
      else assert.fail('stray byte ' + c.toString(16) + ' at ' + i);
    }
    assert.strictEqual(i, u.length); return cmds;
  }
  const items = [{ u: 'kpgzf5', p: 'kpgzf5', pr: '1Hari', price: 'Rp 5.000', v: '1d' }, { u: 'rw8', p: 'x9z4' }];
  ['native', 'raster'].forEach((qr) => {
    const c = parse(E.vouchers(items, { cols: 48, hotspot: 'NextMON', qr, QR, qrText: (it) => 'http://h/login?username=' + it.u + '&password=' + it.p }));
    assert.strictEqual(c.filter((x) => x === (qr === 'native' ? 'GSk81' : 'GSv')).length, 2);
    assert.strictEqual(c[c.length - 1], 'GSV');
  });
});
t('base64 / RawBT intent url round-trip', () => {
  const u = E.vouchers([{ u: 'zz', p: 'zz' }], { qr: 'off' });
  const url = E.rawbtUrl(u);
  assert.ok(url.startsWith('intent:base64,') && url.endsWith('#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;'));
  const back = Buffer.from(url.slice(14, url.indexOf('#')), 'base64');
  assert.strictEqual(hex(back), hex(u));
});
console.log(n + ' passed');
