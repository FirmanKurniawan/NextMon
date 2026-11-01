import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Features } from '../../src/features/registry.ts';
import { I18n } from '../../src/lib/i18n.ts';

// Every literal t('...') in the app must have an Indonesian translation (the PHP edition guarantees the same via tests/i18n_audit.php).
const SRC = path.resolve(__dirname, '../../src');
function walk(d: string, out: string[] = []): string[] {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f.name)) out.push(p);
  }
  return out;
}

// not real keys: JS short-key map in shellStrings.ts and the doc example in lib/i18n.ts
const IGNORE = new Set(['copied', 'Deleted :n users']);

describe('i18n coverage', () => {
  it('has an id translation for every literal t() key', () => {
    void Features.all();
    const dict = I18n.dict('id');
    const re = /\bt\(\s*(['"`])((?:\.|(?!\1).)*?)\1/g;
    const missing = new Map<string, Set<string>>();
    for (const f of walk(SRC)) {
      const s = fs.readFileSync(f, 'utf8');
      let m: RegExpExecArray | null;
      while ((m = re.exec(s))) {
        const k = m[2]!.split("\\'").join("'").split('\\"').join('"').split('\\n').join('\n');
        if (m[1] === '`' && k.includes('${')) continue;
        if (!/[A-Za-z]/.test(k) || k in dict || IGNORE.has(k)) continue;
        if (!missing.has(k)) missing.set(k, new Set());
        missing.get(k)!.add(path.relative(SRC, f).split(path.sep).join('/'));
      }
    }
    // nav labels/groups and page titles are translated at render time with t(label)
    for (const f of Features.all()) {
      const add = (k: string) => {
        if (!/[A-Za-z]/.test(k) || k in dict) return;
        if (!missing.has(k)) missing.set(k, new Set());
        missing.get(k)!.add('features/' + f.id + '/feature.ts');
      };
      for (const n of f.nav ?? []) {
        add(n.label);
        add(n.group);
      }
      for (const p of f.pages ?? []) add(p.title);
    }
    const lines = [...missing].map(([k, v]) => `${JSON.stringify(k)} <- ${[...v].join(',')}`);
    if (process.env.I18N_REPORT) fs.writeFileSync(process.env.I18N_REPORT, lines.join('\n'));
    expect(lines.length, lines.slice(0, 30).join('\n')).toBe(0);
  });
});
