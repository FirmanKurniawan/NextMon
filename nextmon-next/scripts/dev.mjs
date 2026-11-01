#!/usr/bin/env node
// `npm run dev`: generate the feature registry, make sure the shared assets exist, watch src/features, start `next dev`.
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from './gen-features.mjs';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
spawnSync(process.execPath, ['scripts/sync-assets.mjs', '--if-missing'], { stdio: 'inherit' });
generate();
let t;
fs.watch(path.join(root, 'src', 'features'), { recursive: true }, (_e, f) => {
  if (f && f.endsWith('_generated.ts')) return;
  clearTimeout(t);
  t = setTimeout(generate, 150);
});
const bin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
const child = spawn(process.execPath, [bin, 'dev', ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
child.on('exit', (c) => process.exit(c ?? 0));
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => child.kill(s));
