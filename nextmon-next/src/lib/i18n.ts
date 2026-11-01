/**
 * Tiny i18n, same model as the PHP edition: SOURCE STRINGS ARE ENGLISH, dictionaries map English => translation, a missing key
 * falls back to the English text. Placeholders use :name, e.g. t('Deleted :n users', { ':n': 3 }).
 *
 * Core Indonesian dictionary: src/i18n/id.json (ported from nextmon-php/lang via scripts/port-lang.php).
 * Feature modules add theirs with `i18n: { id: {...} }` in their defineFeature() - merged at startup, no shared file edited.
 */
import idCore from '../i18n/id.json' with { type: 'json' };
import { singleton } from './singleton.ts';

export type Lang = 'id' | 'en';
export const LANGS: readonly Lang[] = ['id', 'en'];
export const isLang = (l: unknown): l is Lang => l === 'id' || l === 'en';
export type Dict = Record<string, string>;
export type TFn = (key: string, params?: Record<string, string | number>) => string;

const dicts = singleton('i18n', () => ({ id: { ...(idCore as Dict) } as Dict, en: {} as Dict }));

export const I18n = {
  /** Merge extra strings (feature modules). Existing keys are NOT overwritten by a later registration with the same value-less key. */
  register(lang: Lang, extra: Dict): void {
    Object.assign(dicts[lang], extra);
  },

  dict(lang: Lang): Dict {
    return dicts[lang];
  },

  translate(lang: Lang, key: string, params?: Record<string, string | number>): string {
    let out = dicts[lang][key] ?? key;
    if (params) for (const [k, v] of Object.entries(params)) out = out.split(k).join(String(v));
    return out;
  },

  translator(lang: Lang): TFn {
    return (key, params) => I18n.translate(lang, key, params);
  },

  /** Pick a language: explicit cookie > Accept-Language > default. */
  pick(cookie: string | undefined, accept: string | null | undefined, fallback: Lang = 'id'): Lang {
    if (isLang(cookie)) return cookie;
    const a = (accept ?? '').toLowerCase();
    if (a.startsWith('en') && !a.includes('id')) return 'en';
    return fallback;
  },
};
