#!/usr/bin/env node
/**
 * After `next build` with output:'standalone': copy what the standalone server does NOT include (static chunks and public/) so
 * `node .next/standalone/server.js` works as-is, and stage a self-contained folder for the NextMON Server launcher.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sa = path.join(root, '.next', 'standalone');
if (!fs.existsSync(path.join(sa, 'server.js'))) {
  console.error('[postbuild] .next/standalone/server.js not found (is output:"standalone" set?)');
  process.exit(1);
}
const cp = (from, to) => {
  if (fs.existsSync(from)) fs.cpSync(from, to, { recursive: true, force: true });
};
cp(path.join(root, '.next', 'static'), path.join(sa, '.next', 'static'));
cp(path.join(root, 'public'), path.join(sa, 'public'));
console.log('[postbuild] standalone ready: node .next/standalone/server.js  (env: PORT, HOSTNAME, NEXTMON_DATA, NEXTMON_DEMO, ...)');
