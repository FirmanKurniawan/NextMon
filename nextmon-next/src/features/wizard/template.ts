/**
 * The hotspot login template (shared/hotspot-login) that ships next to the app. Static, read-only files of the installation -
 * NOT tenant data - so reading them directly is fine (the single place in this feature that touches the file system).
 */
/* eslint-disable no-restricted-imports */
import fs from 'node:fs';
import path from 'node:path';

export const TEMPLATE_DIR_NAME = 'hotspot-nextmon';

export function templateDir(): string | null {
  const cwd = process.cwd();
  for (const d of [path.resolve(cwd, '../shared/hotspot-login'), path.resolve(cwd, 'shared/hotspot-login'), path.resolve(cwd, '../../shared/hotspot-login')]) {
    if (fs.existsSync(path.join(d, 'login.html'))) return d;
  }
  return null;
}

/** rel path => size (files that belong on the router: no tools/, tests or README). */
export function templateFiles(dir: string): Record<string, number> {
  const out: Record<string, number> = {};
  const walk = (sub: string) => {
    for (const e of fs.readdirSync(path.join(dir, sub), { withFileTypes: true })) {
      const rel = sub ? `${sub}/${e.name}` : e.name;
      if (e.isDirectory()) walk(rel);
      else if (e.isFile() && !rel.startsWith('tools/') && !rel.endsWith('.test.js') && rel.toLowerCase() !== 'readme.md') out[rel] = fs.statSync(path.join(dir, rel)).size;
    }
  };
  walk('');
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}

export function readTemplateFile(dir: string, rel: string): Buffer {
  return fs.readFileSync(path.join(dir, rel));
}
