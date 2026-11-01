/**
 * Workspace app-data backup / restore (format: docs/BACKUP-FORMAT.md; the PHP edition reads and writes the same file).
 *
 * Export: routers (passwords blank, or still AES-encrypted on request), settings (+ voucher templates), shop config, resellers, wallets,
 * wallet ledger, reseller batches and shop orders of the ACTIVE workspace. File = JSON { format, version, edition, checksum, payload }
 * where payload is the data as a JSON *string* and checksum its SHA-256, so both editions verify the very same bytes.
 *
 * Restore: parseBackup() validates everything and returns normalised data (nothing is written); applyBackup() takes a safety backup of
 * the current data, then replaces the selected collections in ONE database transaction (all or nothing). The workspace is always the
 * active one (Store resolves it from the request context): the file carries no workspace id and every id inside it that could name a
 * tenant is dropped or rewritten. Global collections (users, sessions, workspaces, shares, api keys and their index, cron tokens) are
 * never read from the file. Safety backups and the pending preview live in per-workspace documents (no files, no paths).
 */
import crypto from 'node:crypto';
import { Crypto } from './crypto.ts';
import { db } from './db.ts';
import { sanitizeTemplateHtml } from './sanitize.ts';
import { Routers } from './routers.ts';
import { Share } from './share.ts';
import { Store } from './store.ts';
import { Workspace } from './workspace.ts';

export const BACKUP_FORMAT = 'nextmon-backup';
export const BACKUP_VERSION = 1;
export const MAX_BYTES = 8 * 1048576; // below the 10 MB the Next.js request pipeline buffers
export const MAX_ROWS = 50000;
export const MAX_ORDERS = 20000;
export const MAX_ROUTERS = 200;
const MAX_DEPTH = 12;
const MAX_STR = 200000;
const PENDING_TTL = 900;
const KEEP_SAFETY = 10;

export type Kind = 'doc' | 'log' | 'orders';
export const COLLECTIONS: Readonly<Record<string, Kind>> = {
  routers: 'doc',
  settings: 'doc',
  shop: 'doc',
  resellers: 'doc',
  wallets: 'doc',
  wallet_ledger: 'log',
  reseller_batches: 'log',
  orders: 'orders',
};
const ORDER_STATES = ['pending', 'paid', 'expired', 'failed', 'refunded'];
const DROP_KEYS = new Set(['workspace', 'workspace_id', 'ws', 'owner_ws', 'owner_workspace', '__ws']);
const REJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SECRET_RE = /^v1:[A-Za-z0-9+/]{38,}={0,2}$/;

type Obj = Record<string, unknown>;
export type BackupData = { docs: Record<string, unknown>; logs: Record<string, Obj[]>; orders: Obj[] };
export type PlanRow = { id: string; current: number; incoming: number };
export type Meta = { edition: string; version: number; created: string; secrets: boolean };
export type Parsed = { meta: Meta; data: BackupData; warnings: { key: string; params: Record<string, number> }[]; ignored: string[] };

/** A problem the user can fix. `key` is the English source string, `params` its :placeholders (translated by the caller). */
export class BackupError extends Error {
  key: string;
  params: Record<string, string | number>;
  constructor(key: string, params: Record<string, string | number> = {}) {
    super(Object.entries(params).reduce((s, [k, v]) => s.split(k).join(String(v)), key));
    this.name = 'BackupError';
    this.key = key;
    this.params = params;
  }
}

/** Test hook: called after each collection of a restore was written. */
export const hooks: { afterWrite: ((c: string) => void) | null } = { afterWrite: null };

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const sha = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const INVALID = 'The backup content is not valid.';
const invalidIn = (c: string) => new BackupError('Invalid data in ":c".', { ':c': c });
const nowS = () => Math.floor(Date.now() / 1000);
const wsSuffix = () => Workspace.id().slice(2).toUpperCase();

// ---- export ---------------------------------------------------------------------------------------------

function strip(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(strip);
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, strip(x)]));
  return typeof v === 'string' && SECRET_RE.test(v) ? '' : v;
}

function orderIds(): string[] {
  return Store.names().filter((n) => n.startsWith('order.'));
}

/** The data of the active workspace. Only collections that exist are included. Logs are oldest first. */
export function snapshot(stripSecrets: boolean): BackupData {
  const d: BackupData = { docs: {}, logs: {}, orders: [] };
  for (const [c, kind] of Object.entries(COLLECTIONS)) {
    if (kind === 'doc' && Store.has(c)) d.docs[c] = Store.read<unknown>(c, {});
    else if (kind === 'log' && Store.count(c) > 0) {
      const rows: Obj[] = [];
      for (let off = 0; off < MAX_ROWS; off += 10000) {
        const part = Store.rows<Obj>(c, 10000, off);
        rows.push(...part);
        if (part.length < 10000) break;
      }
      d.logs[c] = rows.reverse();
    }
  }
  d.orders = orderIds()
    .map((n) => Store.read<Obj | null>(n, null))
    .filter((o): o is Obj => isObj(o))
    .sort((a, b) => Number(a.created ?? 0) - Number(b.created ?? 0));
  return stripSecrets ? (strip(d) as BackupData) : d;
}

/** Keep the file below the upload limit: drop the oldest log rows (the ledgers are retention-pruned anyway). True when rows were dropped. */
function fit(data: BackupData): boolean {
  let cut = false;
  while (JSON.stringify(data).length > MAX_BYTES - 262144) {
    let best: string | null = null;
    for (const [c, rows] of Object.entries(data.logs)) if (rows.length > 1 && (best === null || rows.length > data.logs[best]!.length)) best = c;
    if (best === null) throw new BackupError('The data is too large for one backup file (max :n MB).', { ':n': MAX_BYTES / 1048576 });
    data.logs[best] = data.logs[best]!.slice(Math.max(1, Math.floor(data.logs[best]!.length / 10)));
    cut = true;
  }
  return cut;
}

export function wrap(input: BackupData, secrets: boolean): string {
  const data: BackupData = { ...input, logs: { ...input.logs } };
  const truncated = fit(data);
  const payload = JSON.stringify(data);
  const counts: Record<string, number> = {};
  for (const [c, v] of Object.entries(data.docs)) counts[c] = Array.isArray(v) ? v.length : isObj(v) ? Object.keys(v).length : 1;
  for (const [c, rows] of Object.entries(data.logs)) counts[c] = rows.length;
  if (data.orders.length) counts.orders = data.orders.length;
  return JSON.stringify(
    {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      edition: 'next',
      created: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      includes_secrets: secrets,
      truncated,
      counts,
      checksum: { algo: 'sha256', value: sha(payload) },
      payload,
    },
    null,
    2,
  );
}

/** The downloadable file. */
export function exportBackup(secrets = false): string {
  return wrap(snapshot(!secrets), secrets);
}

// ---- validation -----------------------------------------------------------------------------------------

type Stats = { dropped: number; secrets: number; secretsBad: number; plainPass: number };

/** Recursively validate / normalise JSON data: depth, sizes, tenant keys, secrets. */
function clean(v: unknown, depth: number, st: Stats): unknown {
  if (depth > MAX_DEPTH) throw new BackupError(INVALID);
  if (Array.isArray(v)) return v.map((x) => clean(x, depth + 1, st));
  if (isObj(v)) {
    const o: Obj = {};
    for (const [k, x] of Object.entries(v)) {
      const lk = k.toLowerCase();
      if (REJECT_KEYS.has(lk)) throw new BackupError(INVALID);
      if (DROP_KEYS.has(lk)) {
        st.dropped++;
        continue;
      }
      if (k === '' || k.length > 100 || /[\x00-\x1F]/.test(k)) throw new BackupError(INVALID);
      o[k] = clean(x, depth + 1, st);
    }
    return o;
  }
  if (typeof v === 'string') {
    if (v.length > MAX_STR || v.includes('\0')) throw new BackupError(INVALID);
    if (SECRET_RE.test(v)) {
      if (Crypto.decrypt(v) === '') {
        st.secretsBad++;
        return '';
      }
      st.secrets++;
    }
    return v;
  }
  if (typeof v === 'boolean' || v === null || (typeof v === 'number' && Number.isFinite(v))) return v;
  throw new BackupError(INVALID);
}

/** Maps accept `[]` (PHP encodes an empty map that way). */
function asMap(v: unknown, c: string): Obj {
  if (Array.isArray(v) && v.length === 0) return {};
  if (!isObj(v)) throw invalidIn(c);
  return v;
}
function asList(v: unknown, c: string, max: number): unknown[] {
  if (isObj(v) && Object.keys(v).length === 0) return [];
  if (!Array.isArray(v) || v.length > max) throw invalidIn(c);
  return v;
}

const ID32 = /^[A-Za-z0-9_-]{1,32}$/;
const KEY64 = /^[A-Za-z0-9_.@-]{1,64}$/;
const noCtl = (s: unknown, n: number) => String(s ?? '').replace(/[\x00-\x1F]/g, '').slice(0, n);
const chars = (s: string, n: number) => Array.from(s).slice(0, n).join('');

function routersDoc(v: unknown, st: Stats): unknown[] {
  const list = asList(v, 'routers', MAX_ROUTERS);
  const seen = new Set<string>();
  return list.map((r, i) => {
    const bad = () => new BackupError('Router #:n is invalid.', { ':n': i + 1 });
    if (!isObj(r)) throw bad();
    const id = String(r.id ?? '');
    if (!ID32.test(id) || seen.has(id)) throw bad();
    seen.add(id);
    const type = r.type === 'demo' ? 'demo' : 'real';
    const name = chars(noCtl(r.name, 200).trim(), 40);
    const host = String(r.host ?? '').trim();
    if (name === '' || !/^[A-Za-z0-9.\-:]{0,253}$/.test(host) || (type === 'real' && host === '')) throw bad();
    const ssl = !!r.ssl;
    let port = Math.trunc(Number(r.port ?? 8728));
    if (!Number.isFinite(port) || port < 1 || port > 65535) port = ssl ? 8729 : 8728;
    let pass = typeof r.pass === 'string' ? r.pass : '';
    if (pass !== '') {
      if (!SECRET_RE.test(pass)) {
        st.plainPass++;
        pass = '';
      } else if (Crypto.decrypt(pass) === '') {
        st.secretsBad++;
        pass = '';
      } else st.secrets++;
    }
    const session = String(r.session ?? name).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40) || 'router';
    return { id, name, session, type, host, port, ssl, verify_tls: ssl && !!r.verify_tls, user: chars(noCtl(r.user, 200), 64), pass, hotspot_name: chars(noCtl(r.hotspot_name, 200), 60) };
  });
}

function settingsDoc(raw: unknown, st: Stats): Obj {
  const s = clean(asMap(raw, 'settings'), 0, st) as Obj;
  if ('lang' in s && s.lang !== 'id' && s.lang !== 'en') delete s.lang;
  if ('timezone' in s) {
    let ok = typeof s.timezone === 'string';
    if (ok) {
      try {
        new Intl.DateTimeFormat('en', { timeZone: s.timezone as string });
      } catch {
        ok = false;
      }
    }
    if (!ok) delete s.timezone;
  }
  if ('currency' in s) s.currency = chars(String(s.currency ?? ''), 6);
  if ('max_qty' in s) s.max_qty = Math.max(1, Math.min(2000, Math.trunc(Number(s.max_qty)) || 1));
  if ('templates' in s) {
    const t = asList(s.templates, 'templates', 100);
    s.templates = t.map((x) => {
      const o = isObj(x) ? x : {};
      const id = String(o.id ?? '');
      const name = chars(String(o.name ?? '').trim(), 40);
      if (!ID32.test(id) || name === '') throw invalidIn('templates');
      // user HTML only ever re-enters through the allow-list sanitiser
      return {
        id,
        name,
        html: sanitizeTemplateHtml(chars(String(o.html ?? ''), 60000)),
        w: Math.max(20, Math.min(300, Number(o.w ?? 70) || 70)),
        h: Math.max(10, Math.min(300, Number(o.h ?? 40) || 40)),
      };
    });
  }
  return s;
}

function docOf(c: string, v: unknown, st: Stats): unknown {
  switch (c) {
    case 'routers':
      return routersDoc(v, st);
    case 'settings':
      return settingsDoc(v, st);
    case 'wallets': {
      const o: Record<string, number> = {};
      for (const [k, n] of Object.entries(asMap(v, c))) {
        if (!KEY64.test(k) || typeof n !== 'number' || !Number.isInteger(n) || Math.abs(n) > 1e12) throw invalidIn(c);
        o[k] = n;
      }
      return o;
    }
    case 'resellers': {
      const o: Obj = {};
      for (const [k, cfg] of Object.entries(asMap(v, c))) {
        if (!KEY64.test(k) || !isObj(cfg)) throw invalidIn(c);
        o[k] = clean(cfg, 1, st);
      }
      return o;
    }
    default:
      return clean(asMap(v, c), 0, st);
  }
}

function rowsOf(c: string, v: unknown, st: Stats): Obj[] {
  return asList(v, c, MAX_ROWS).map((r) => {
    if (!isObj(r)) throw invalidIn(c);
    const o = clean(r, 1, st) as Obj;
    if (JSON.stringify(o).length > 20000) throw invalidIn(c);
    return o;
  });
}

const BASE_RE = /^KL\d{6}-[A-F0-9]{6}(-[A-F0-9]{8})?$/;
function ordersOf(v: unknown, st: Stats): Obj[] {
  const seen = new Set<string>();
  return asList(v, 'orders', MAX_ORDERS).map((o) => {
    const id = isObj(o) ? String(o.id ?? '') : '';
    if (!BASE_RE.test(id) || seen.has(id.slice(0, 15)) || !isObj(o)) throw invalidIn('orders');
    seen.add(id.slice(0, 15));
    if (
      !ORDER_STATES.includes(String(o.status)) ||
      typeof o.token !== 'string' ||
      !/^[A-Za-z0-9]{8,64}$/.test(o.token) ||
      typeof o.amount === 'boolean' ||
      !Number.isFinite(Number(o.amount)) ||
      !isObj(o.package) ||
      !Number.isInteger(o.created)
    ) {
      throw invalidIn('orders');
    }
    // the workspace part of an id is never trusted: apply re-binds it to the active workspace
    return clean({ ...o, id: id.slice(0, 15) }, 1, st) as Obj;
  });
}

const safeName = (s: string) => s.replace(/[^A-Za-z0-9_.\- ]/g, '_').slice(0, 40);

/** Validate an uploaded file. Nothing is written. Throws BackupError. */
export function parseBackup(raw: string): Parsed {
  if (raw.length > MAX_BYTES) throw new BackupError('File is too large (max :n MB).', { ':n': MAX_BYTES / 1048576 });
  const notBackup = () => new BackupError('This is not a NextMON backup file.');
  if (raw === '' || raw.includes('\0')) throw notBackup();
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  let f: unknown;
  let p: unknown;
  try {
    f = JSON.parse(raw);
  } catch {
    throw notBackup();
  }
  if (!isObj(f) || f.format !== BACKUP_FORMAT) throw notBackup();
  const ver = f.version;
  if (typeof ver !== 'number' || !Number.isInteger(ver) || ver < 1) throw notBackup();
  if (ver > BACKUP_VERSION) throw new BackupError('This backup was made by a newer version (format :v). Update NextMON first.', { ':v': ver });
  if (f.edition !== 'php' && f.edition !== 'next') throw notBackup();
  const cs = f.checksum;
  const payload = f.payload;
  if (!isObj(cs) || cs.algo !== 'sha256' || typeof cs.value !== 'string' || !/^[a-f0-9]{64}$/.test(cs.value) || typeof payload !== 'string') throw notBackup();
  const want = Buffer.from(cs.value);
  const got = Buffer.from(sha(payload));
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) throw new BackupError('The checksum does not match: the file is damaged or was edited.');
  try {
    p = JSON.parse(payload);
  } catch {
    throw new BackupError(INVALID);
  }
  if (!isObj(p)) throw new BackupError(INVALID);
  const st: Stats = { dropped: 0, secrets: 0, secretsBad: 0, plainPass: 0 };
  const out: BackupData = { docs: {}, logs: {}, orders: [] };
  const ignored: string[] = [];
  const label = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, '?').slice(0, 40);
  try {
    for (const sec of ['docs', 'logs'] as const) {
      const part = p[sec] ?? {};
      if (!isObj(part) && !(Array.isArray(part) && part.length === 0)) throw new BackupError(INVALID);
      for (const [name, val] of Object.entries(isObj(part) ? part : {})) {
        const kind = Object.hasOwn(COLLECTIONS, name) ? COLLECTIONS[name] : undefined;
        if (kind !== (sec === 'docs' ? 'doc' : 'log')) {
          ignored.push(label(name)); // users, sessions, workspaces, api keys... never imported
          continue;
        }
        if (sec === 'docs') out.docs[name] = docOf(name, val, st);
        else out.logs[name] = rowsOf(name, val, st);
      }
    }
    for (const k of Object.keys(p)) if (!['docs', 'logs', 'orders'].includes(k)) ignored.push(label(k));
    if (p.orders !== undefined) out.orders = ordersOf(p.orders, st);
  } catch (e) {
    if (e instanceof RangeError) throw new BackupError(INVALID);
    throw e;
  }
  if (!Object.keys(out.docs).length && !Object.keys(out.logs).length && !out.orders.length) throw new BackupError('The backup does not contain any data NextMON can restore.');
  const warnings: Parsed['warnings'] = [];
  if (st.dropped) warnings.push({ key: ':n workspace references in the file were ignored.', params: { ':n': st.dropped } });
  if (st.secretsBad) warnings.push({ key: ":n secrets could not be decrypted with this installation's key and were left empty.", params: { ':n': st.secretsBad } });
  if (f.truncated) warnings.push({ key: 'The file is incomplete: the oldest log rows were left out to keep it small.', params: {} });
  if (st.plainPass) warnings.push({ key: ':n plain-text router passwords were ignored.', params: { ':n': st.plainPass } });
  return { meta: { edition: String(f.edition), version: ver, created: String(f.created ?? '').slice(0, 40), secrets: !!f.includes_secrets }, data: out, warnings, ignored: [...new Set(ignored)] };
}

// ---- preview --------------------------------------------------------------------------------------------

const size = (v: unknown): number => (Array.isArray(v) ? v.length : isObj(v) ? Object.keys(v).length : 1);

/** One row per collection present in the file, with what exists now. */
export function plan(data: BackupData): PlanRow[] {
  const rows: PlanRow[] = [];
  for (const [c, kind] of Object.entries(COLLECTIONS)) {
    if (kind === 'doc' && c in data.docs) rows.push({ id: c, current: Store.has(c) ? size(Store.read<unknown>(c, {})) : 0, incoming: size(data.docs[c]) });
    else if (kind === 'log' && c in data.logs) rows.push({ id: c, current: Store.count(c), incoming: data.logs[c]!.length });
    else if (kind === 'orders' && data.orders.length) rows.push({ id: 'orders', current: orderIds().length, incoming: data.orders.length });
  }
  return rows;
}
export const available = (data: BackupData): string[] => plan(data).map((r) => r.id);

/** Workspace-dependent checks (router limit). */
export function check(data: BackupData, sel: string[]): void {
  if (sel.includes('routers') && Array.isArray(data.docs.routers)) {
    const lim = Workspace.limits(Workspace.id()).routers;
    if (lim > 0 && data.docs.routers.length > lim) throw new BackupError('Router limit reached for this account (:n).', { ':n': lim });
  }
}

// ---- apply ----------------------------------------------------------------------------------------------

type Router = { id: string; pass?: string };

function write(data: BackupData, sel: string[], restore: boolean): void {
  for (const c of sel) {
    const kind = COLLECTIONS[c];
    if (kind === 'doc') {
      if (!(c in data.docs)) {
        Store.delete(c);
        continue;
      }
      let v = data.docs[c];
      if (c === 'routers' && restore) {
        const cur = new Map(Store.read<Router[]>('routers', []).map((r) => [r.id, r.pass ?? '']));
        // blank password in the file = keep the stored one of the same router (same rule as the router form)
        v = (v as Router[]).map((r) => (!r.pass && cur.get(r.id) ? { ...r, pass: cur.get(r.id) } : r));
      }
      Store.write(c, v);
    } else if (kind === 'log') {
      Store.prune(c, 0);
      for (const row of data.logs[c] ?? []) Store.append(c, row);
    } else {
      const sfx = '-' + wsSuffix();
      for (const n of orderIds()) Store.delete(n);
      for (const o of data.orders) {
        const id = String(o.id).slice(0, 15) + sfx; // the id carries its workspace: always the active one
        Store.write('order.' + id, { ...o, id });
      }
    }
    if (restore && hooks.afterWrite) hooks.afterWrite(c);
  }
}

function afterRouters(sel: string[], old: Router[]): void {
  if (!sel.includes('routers')) return;
  try {
    const now = Store.read<Router[]>('routers', []).map((r) => r.id);
    const ws = Workspace.id();
    for (const r of old) if (!now.includes(r.id)) Share.revokeRouter(ws, r.id);
    for (const id of new Set([...old.map((r) => r.id), ...now])) Routers.forget(id);
  } catch (e) {
    console.error('[nextmon] restore: post-processing failed', e);
  }
}

/**
 * Replace the selected collections of the active workspace. All or nothing: a snapshot of the current data is stored first (kept
 * even when the restore fails) and everything is written inside one transaction that rolls back on any error.
 */
export function applyBackup(data: BackupData, sel: string[]): { safety: string; applied: string[] } {
  const chosen = available(data).filter((c) => sel.includes(c));
  if (chosen.length === 0) throw new BackupError('Select at least one item to restore.');
  check(data, chosen);
  const safety = writeSafety(snapshot(false));
  const old = Store.read<Router[]>('routers', []);
  try {
    db().tx(() => write(data, chosen, true));
  } catch (e) {
    console.error('[nextmon] restore failed, rolled back:', e);
    throw new BackupError('Restore failed: nothing was changed.');
  }
  afterRouters(chosen, old);
  return { safety, applied: chosen };
}

// ---- safety backups -------------------------------------------------------------------------------------

export type SafetyFile = { name: string; size: number; time: number };
const SAFETY_RE = /^pre-restore-\d{8}-\d{6}-[a-f0-9]{4}$/;
const IDX = 'backup.safety.index';
export const safetyName = (n: string): boolean => SAFETY_RE.test(n);

function writeSafety(snap: BackupData): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const name = `pre-restore-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${crypto.randomBytes(2).toString('hex')}`;
  const body = wrap(snap, true);
  try {
    db().tx(() => {
      Store.write('backup.safety.' + name, { body });
      const list = [{ name, size: body.length, time: nowS() }, ...Store.read<SafetyFile[]>(IDX, [])];
      for (const old of list.slice(KEEP_SAFETY)) Store.delete('backup.safety.' + old.name);
      Store.write(IDX, list.slice(0, KEEP_SAFETY));
    });
  } catch {
    throw new BackupError('Could not write the safety backup. Nothing was changed.');
  }
  return name;
}

/** Newest first. */
export function safetyFiles(): SafetyFile[] {
  return Store.read<SafetyFile[]>(IDX, []).filter((f) => safetyName(f.name));
}

/** Body of a safety backup of the ACTIVE workspace, or null. The name is matched against a strict pattern and the index. */
export function safetyBody(name: string): string | null {
  if (!safetyName(name) || !safetyFiles().some((f) => f.name === name)) return null;
  return Store.read<{ body?: string }>('backup.safety.' + name, {}).body ?? null;
}

// ---- pending preview (between "check file" and "restore") ------------------------------------------------

export type Pending = { token: string; uid: string; ts: number; file: string; meta: Meta; warnings: Parsed['warnings']; ignored: string[]; plan: PlanRow[] };

export function stash(parsed: Parsed, fileName: string, uid: string): string {
  const token = crypto.randomBytes(16).toString('hex');
  const meta: Pending = { token, uid, ts: nowS(), file: safeName(fileName), meta: parsed.meta, warnings: parsed.warnings, ignored: parsed.ignored, plan: plan(parsed.data) };
  db().tx(() => {
    Store.write('backup.pending.data', parsed.data);
    Store.write('backup.pending', meta);
  });
  return token;
}

export function discard(): void {
  Store.delete('backup.pending');
  Store.delete('backup.pending.data');
}

/** The pending preview of the active workspace for this user, or null (expired / other user / none). */
export function pending(uid: string): Pending | null {
  const m = Store.read<Pending | null>('backup.pending', null);
  if (!m) return null;
  if (nowS() - Number(m.ts) > PENDING_TTL) {
    discard();
    return null;
  }
  return m.uid === uid ? m : null;
}

export function pendingData(uid: string, token: string): BackupData | null {
  const m = pending(uid);
  if (!m || token === '' || token.length !== m.token.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(m.token))) return null;
  const d = Store.read<BackupData | null>('backup.pending.data', null);
  return d && isObj(d.docs) && isObj(d.logs) && Array.isArray(d.orders) ? d : null;
}
