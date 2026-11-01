#!/usr/bin/env node
/* NextMON asset build: minify public/assets/{css,js}/*.{css,js} -> public/assets/dist/{css,js}/<name>.<hash>.<ext> (+ .gz, .br)
 * and write dist/manifest.json, which the PHP helper asset() reads. Sources stay untouched and are served instead whenever
 * a source file is newer than the manifest entry (live editing) or NEXTMON_ASSETS_DEV=1 is set.
 *
 *   node bin/build-assets.js            build (needs esbuild)
 *   node bin/build-assets.js --check    exit 1 when dist is stale (CI)
 *
 * esbuild is resolved from ./node_modules, or from ESBUILD_DIR=<dir containing node_modules/esbuild> so it can live outside the
 * project:  mkdir /tmp/eb && cd /tmp/eb && npm i esbuild && ESBUILD_DIR=/tmp/eb node <project>/bin/build-assets.js
 * Not minified on purpose: sw.js (served by the /sw.js route with BASE prepended). */
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');
const root = path.resolve(__dirname, '..'), assets = path.join(root, 'public', 'assets'), dist = path.join(assets, 'dist');
const SKIP = new Set(['js/sw.js']);

function loadEsbuild() {
  const tries = [() => require('esbuild'), () => require(require.resolve('esbuild', { paths: [process.env.ESBUILD_DIR || '', root, process.cwd()].filter(Boolean) }))];
  for (const t of tries) { try { return t(); } catch (e) { /* next */ } }
  console.error('esbuild not found. Install it outside the project and set ESBUILD_DIR (see header comment).'); process.exit(2);
}

function sources() {
  const out = [];
  for (const kind of ['css', 'js']) {
    for (const f of fs.readdirSync(path.join(assets, kind)).sort()) {
      const key = kind + '/' + f;
      if (f.endsWith('.' + kind) && !SKIP.has(key)) out.push({ key, kind, file: path.join(assets, kind, f) });
    }
  }
  return out;
}

function main() {
  const check = process.argv.includes('--check');
  const es = check ? null : loadEsbuild();
  const old = fs.existsSync(path.join(dist, 'manifest.json')) ? JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8')) : {};
  const man = {}; let stale = false, inBytes = 0, outBytes = 0, gzBytes = 0, brBytes = 0;
  if (!check) { fs.rmSync(dist, { recursive: true, force: true }); for (const k of ['css', 'js']) fs.mkdirSync(path.join(dist, k), { recursive: true }); }
  for (const s of sources()) {
    const src = fs.readFileSync(s.file); const st = fs.statSync(s.file);
    const sha = crypto.createHash('sha1').update(src).digest('hex');
    if (check) { if (!old[s.key] || old[s.key].s !== sha) { console.error('stale: ' + s.key); stale = true; } continue; }
    const r = es.transformSync(src.toString('utf8'), { loader: s.kind, minify: true, legalComments: 'none', charset: 'utf8', target: s.kind === 'css' ? 'esnext' : 'es2018' });
    const code = Buffer.from(r.code);
    const h = crypto.createHash('sha1').update(code).digest('hex').slice(0, 10);
    const name = path.basename(s.file).replace(/\.(css|js)$/, '') + '.' + h + '.' + s.kind;
    const rel = s.kind + '/' + name;
    fs.writeFileSync(path.join(dist, rel), code);
    const gz = zlib.gzipSync(code, { level: 9 }), br = zlib.brotliCompressSync(code, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } });
    fs.writeFileSync(path.join(dist, rel + '.gz'), gz); fs.writeFileSync(path.join(dist, rel + '.br'), br);
    man[s.key] = { f: rel, m: Math.floor(st.mtimeMs / 1000), s: sha };
    inBytes += src.length; outBytes += code.length; gzBytes += gz.length; brBytes += br.length;
    console.log(s.key.padEnd(22), String(src.length).padStart(7), '->', String(code.length).padStart(7), ' gz', String(gz.length).padStart(6), ' br', String(br.length).padStart(6));
  }
  if (check) { if (stale) process.exit(1); console.log('dist is up to date'); return; }
  fs.writeFileSync(path.join(dist, 'manifest.json'), JSON.stringify(man, null, 1) + '\n');
  console.log('TOTAL'.padEnd(22), String(inBytes).padStart(7), '->', String(outBytes).padStart(7), ' gz', String(gzBytes).padStart(6), ' br', String(brBytes).padStart(6));
}
main();
