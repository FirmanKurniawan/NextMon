#!/usr/bin/env node
/**
 * Re-runnable: copies the NextMON design system VERBATIM from the PHP edition into public/assets so both editions look identical.
 *   ../nextmon-php/public/assets/{css,js,icons,icon.svg}  ->  public/assets/...
 *   ../nextmon-php/public/offline.html                    ->  public/offline.html
 *   ../brand/{mark-tile,mark-plain,mark}.svg              ->  public/assets/brand/
 * Edit the design in nextmon-php (or the monorepo's shared copy), never in public/assets - this script overwrites it.
 *
 *   node scripts/sync-assets.mjs            copy everything
 *   node scripts/sync-assets.mjs --if-missing   only when public/assets/css/app.css does not exist yet (used by `npm run build`)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const php = path.resolve(root, '..', 'nextmon-php', 'public');
const brand = path.resolve(root, '..', 'brand');
const out = path.join(root, 'public');

if (process.argv.includes('--if-missing') && fs.existsSync(path.join(out, 'assets', 'css', 'app.css'))) {
  console.log('[sync-assets] assets already present, skipping');
  process.exit(0);
}
if (!fs.existsSync(path.join(php, 'assets'))) {
  console.error(`[sync-assets] source not found: ${php}\n  (this script needs the PHP edition next to nextmon-next in the monorepo)`);
  process.exit(1);
}

let n = 0;
function copy(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  n++;
}
function copyDir(src, dst, filter = () => true) {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    if (e.isDirectory()) continue;
    if (filter(e.name)) copy(s, path.join(dst, e.name));
  }
}

copyDir(path.join(php, 'assets', 'css'), path.join(out, 'assets', 'css'), (f) => f.endsWith('.css'));
// sources only: the PHP-side content-hashed bundle (assets/dist) is a PHP build artefact
copyDir(path.join(php, 'assets', 'js'), path.join(out, 'assets', 'js'), (f) => f.endsWith('.js'));
copyDir(path.join(php, 'assets', 'icons'), path.join(out, 'assets', 'icons'));
copy(path.join(php, 'assets', 'icon.svg'), path.join(out, 'assets', 'icon.svg'));
copy(path.join(php, 'offline.html'), path.join(out, 'offline.html'));
for (const f of ['mark-tile.svg', 'mark-plain.svg', 'mark.svg']) {
  if (fs.existsSync(path.join(brand, f))) copy(path.join(brand, f), path.join(out, 'assets', 'brand', f));
}
console.log(`[sync-assets] ${n} files copied from ${path.relative(root, php)}`);
