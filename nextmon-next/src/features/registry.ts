/**
 * Feature registry: the single place that knows every feature module (via the generated barrel). Shared code asks the registry;
 * feature authors never edit this file.
 */
import { I18n } from '../lib/i18n.ts';
import { generated } from './_generated.ts';
import type { ApiRoute, Feature, FeaturePage } from './types.ts';

for (const f of generated) {
  if (f.i18n?.id) I18n.register('id', f.i18n.id);
  if (f.i18n?.en) I18n.register('en', f.i18n.en);
}

export type PageMatch = { feature: Feature; page: FeaturePage; params: Record<string, string> };

const clean = (p: string) => '/' + p.split('/').filter(Boolean).join('/');

function matchPattern(pattern: string, path: string): Record<string, string> | null {
  const a = clean(pattern).split('/');
  const b = clean(path).split('/');
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.startsWith(':')) {
      if (!b[i]) return null;
      params[a[i]!.slice(1)] = decodeURIComponent(b[i]!);
    } else if (a[i] !== b[i]) return null;
  }
  return params;
}

export const Features = {
  all: (): Feature[] => generated,

  /** Exact paths win over `:param` patterns. */
  matchPage(pathname: string): PageMatch | null {
    const path = clean(pathname);
    let param: PageMatch | null = null;
    for (const feature of generated) {
      for (const page of feature.pages ?? []) {
        if (!page.path.includes(':')) {
          if (clean(page.path) === path) return { feature, page, params: {} };
        } else if (!param) {
          const params = matchPattern(page.path, path);
          if (params) param = { feature, page, params };
        }
      }
    }
    return param;
  },

  apiRoute(name: string): ApiRoute | null {
    for (const f of generated) if (f.api && Object.hasOwn(f.api, name)) return f.api[name]!;
    return null;
  },

  /** Duplicate path / api / nav-key detection (run by tests so two agents cannot silently shadow each other). */
  conflicts(): string[] {
    const seen = new Map<string, string>();
    const out: string[] = [];
    const add = (kind: string, key: string, owner: string) => {
      const k = kind + ':' + key;
      if (seen.has(k)) out.push(`${kind} "${key}" defined by both ${seen.get(k)} and ${owner}`);
      else seen.set(k, owner);
    };
    for (const f of generated) {
      add('feature', f.id, f.id);
      for (const p of f.pages ?? []) add('page', clean(p.path), f.id);
      for (const n of Object.keys(f.api ?? {})) add('api', n, f.id);
      for (const n of f.nav ?? []) add('nav', n.key, f.id);
    }
    return out;
  },
};
