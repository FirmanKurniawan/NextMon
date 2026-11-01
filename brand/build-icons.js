// Renders the NextMON logo into the PWA/favicons. Usage: NODE_PATH=<dir with @resvg/resvg-js>/node_modules node brand/build-icons.js
const { Resvg } = require('@resvg/resvg-js'); const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'nextmon-php/public/assets/icons');
const tile = fs.readFileSync(path.join(__dirname, 'mark-tile.svg'), 'utf8');
const plain = fs.readFileSync(path.join(__dirname, 'mark-plain.svg'), 'utf8');
const glyph = '<g color="#fff">' + plain.match(/<\/title>([\s\S]*)<\/svg>/)[1] + '</g>';
const defs = tile.match(/<defs>[\s\S]*?<\/defs>/)[0];
const full = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${defs}<rect width="64" height="64" fill="url(#nm-g)"/><rect width="64" height="34" fill="url(#nm-s)"/><g transform="translate(32 32) scale(${scale}) translate(-32 -32)">${glyph}</g></svg>`;
const png = (svg, w) => new Resvg(svg, { fitTo: { mode: 'width', value: w } }).render().asPng();
const w = (n, b) => fs.writeFileSync(path.join(out, n), b);
fs.mkdirSync(out, { recursive: true });
w('icon-192.png', png(tile, 192)); w('icon-512.png', png(tile, 512));
w('icon-maskable-512.png', png(full(0.78), 512));   // glyph inside the 80% safe zone
w('apple-touch-icon.png', png(full(0.9), 180));    // iOS rounds the corners itself
const f16 = png(tile, 16), f32 = png(tile, 32), f48 = png(tile, 48);
w('favicon-16.png', f16); w('favicon-32.png', f32);
const imgs = [[16, f16], [32, f32], [48, f48]]; const hdr = Buffer.alloc(6); hdr.writeUInt16LE(1, 2); hdr.writeUInt16LE(imgs.length, 4);
let off = 6 + 16 * imgs.length; const ents = [], bodies = [];
for (const [s, b] of imgs) { const e = Buffer.alloc(16); e[0] = s; e[1] = s; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(b.length, 8); e.writeUInt32LE(off, 12); off += b.length; ents.push(e); bodies.push(b); }
w('favicon.ico', Buffer.concat([hdr, ...ents, ...bodies]));
for (const dst of [path.join(out, 'icon.svg'), path.join(root, 'nextmon-php/public/assets/icon.svg'), path.join(root, 'shared/hotspot-login/img/logo.svg')]) fs.writeFileSync(dst, tile);
console.log('icons written to', out);
