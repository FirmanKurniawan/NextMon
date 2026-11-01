/** Voucher settings stored in the workspace `settings` doc: custom templates, print presets, default preset (same keys as PHP). */
import crypto from 'node:crypto';
import { sanitizeTemplateHtml } from '../../lib/sanitize.ts';
import { Store } from '../../lib/store.ts';

export type CustomTemplate = { id: string; name: string; html: string; w: number; h: number };
export type Preset = { id: string; name: string; opts: PrintOpts };
export type PrintOpts = {
  design: string;
  paper: string;
  land: boolean;
  cols: number;
  gap: number;
  margin: number;
  scale: number;
  f: Record<string, boolean>;
  qrMode: string;
  ecc: string;
  qrStyle: string;
  qrLogo: boolean;
  ink: boolean;
  guides: boolean;
  accent: string;
  name: string;
  logo: string;
  group: boolean;
  ssid: string;
  wifipass: string;
  tqr: string;
};

type Settings = { templates?: unknown; voucher_presets?: unknown; voucher_default_preset?: unknown };
const settings = (): Settings => Store.read<Settings>('settings', {});
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// The sanitiser rebuilds the whole markup: memoise by content (bounded); it runs on every list/print view.
const memo = new Map<string, string>();
export function cleanHtml(html: string): string {
  const k = crypto.createHash('sha1').update(html).digest('hex');
  const hit = memo.get(k);
  if (hit !== undefined) return hit;
  const clean = sanitizeTemplateHtml(html);
  if (memo.size >= 200) memo.delete(memo.keys().next().value as string);
  memo.set(k, clean);
  return clean;
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

/** Custom HTML templates with their card size in mm (HTML is re-sanitised on every read). */
export function customTemplates(): CustomTemplate[] {
  const list = settings().templates;
  const out: CustomTemplate[] = [];
  for (const tp of Array.isArray(list) ? list : []) {
    if (!isObj(tp) || tp.id === undefined || tp.name === undefined || tp.html === undefined) continue;
    out.push({ id: String(tp.id), name: String(tp.name), html: cleanHtml(String(tp.html)), w: num(tp.w, 70), h: num(tp.h, 40) });
  }
  return out;
}

export function presets(): Preset[] {
  const list = settings().voucher_presets;
  return (Array.isArray(list) ? list : []).filter((p): p is Preset => isObj(p) && p.id !== undefined && p.name !== undefined && p.opts !== undefined);
}

export const defaultPreset = (): string => String(settings().voucher_default_preset ?? '');

/** Whitelist and clamp print settings coming from the browser. */
export function cleanOpts(raw: unknown): PrintOpts {
  const o: Record<string, unknown> = isObj(raw) ? raw : {};
  const bool = (k: string, d = false) => (o[k] !== undefined && o[k] !== null ? Boolean(o[k]) : d);
  const rng = (k: string, lo: number, hi: number, d: number) => {
    const v = o[k];
    const ok = typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));
    return ok && Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : d;
  };
  const pick = (k: string, list: string[], d: string) => {
    const v = o[k];
    return typeof v === 'string' && list.includes(v) ? v : d;
  };
  const fRaw = isObj(o.f) ? o.f : {};
  const f: Record<string, boolean> = {};
  for (const k of ['brand', 'logo', 'profile', 'validity', 'price', 'pass', 'qr', 'dns', 'serial', 'wifi']) f[k] = fRaw[k] !== undefined && fRaw[k] !== null ? Boolean(fRaw[k]) : true;
  let logo = typeof o.logo === 'string' ? o.logo : '';
  if (!/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(logo) || logo.length > 150000) logo = '';
  let design = typeof o.design === 'string' ? o.design : 'aurora';
  if (!/^(c:)?[a-z0-9_-]{1,24}$/i.test(design)) design = 'aurora';
  const text = (k: string, max: number) => (typeof o[k] === 'string' ? (o[k] as string).trim().slice(0, max) : '');
  return {
    design,
    paper: pick('paper', ['a4', 'a5', 'letter', 'f4', 't58', 't80'], 'a4'),
    land: bool('land'),
    cols: Math.trunc(rng('cols', 0, 8, 0)),
    gap: rng('gap', 0, 20, 3),
    margin: rng('margin', 0, 30, 6),
    scale: rng('scale', 30, 200, 100),
    f,
    qrMode: pick('qrMode', ['login', 'user', 'code'], 'login'),
    ecc: pick('ecc', ['L', 'M', 'Q', 'H'], 'M'),
    qrStyle: pick('qrStyle', ['square', 'round'], 'square'),
    qrLogo: bool('qrLogo'),
    ink: bool('ink'),
    guides: bool('guides', true),
    accent: typeof o.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.accent) ? o.accent : '#0b7285',
    name: text('name', 60),
    logo,
    group: bool('group', false),
    ssid: text('ssid', 32),
    wifipass: text('wifipass', 63),
    tqr: pick('tqr', ['native', 'raster', 'off'], 'native'),
  };
}

const update = (fn: (s: Record<string, unknown>) => Record<string, unknown>) => Store.update<Record<string, unknown>>('settings', fn, {});
const listOf = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export function savePreset(name: string, opts: PrintOpts): string {
  const id = crypto.randomBytes(4).toString('hex');
  update((s) => {
    const list = listOf<Preset>(s.voucher_presets).filter((p) => p?.name !== name);
    list.push({ id, name, opts });
    return { ...s, voucher_presets: list.slice(-30) };
  });
  return id;
}

export function deletePreset(id: string): void {
  update((s) => ({
    ...s,
    voucher_presets: listOf<Preset>(s.voucher_presets).filter((p) => p?.id !== id),
    ...(s.voucher_default_preset === id ? { voucher_default_preset: '' } : {}),
  }));
}

export function setDefaultPreset(id: string): boolean {
  if (!presets().some((p) => p.id === id)) return false;
  update((s) => ({ ...s, voucher_default_preset: id }));
  return true;
}

/** Create or replace a template (unknown id = new). `html` must already be sanitised. */
export function saveTemplate(id: string, name: string, html: string, w: number, h: number): void {
  update((s) => {
    const list = listOf<CustomTemplate>(s.templates).slice();
    const i = id !== '' ? list.findIndex((t) => t?.id === id) : -1;
    if (i >= 0) list[i] = { id, name, html, w, h };
    else list.push({ id: crypto.randomBytes(4).toString('hex'), name, html, w, h });
    return { ...s, templates: list };
  });
}

export function deleteTemplate(id: string): void {
  update((s) => ({ ...s, templates: listOf<CustomTemplate>(s.templates).filter((t) => t?.id !== id) }));
}
