/**
 * Hotspot users CSV import / export (Mikhmon-style columns). Port of nextmon-php ImportController.
 * Flow: upload -> validate + preview (nothing written) -> commit (optionally dry-run) -> result + error report.
 * Parsed rows hold plain passwords, so they wait ENCRYPTED (AES-GCM, Crypto) in a per-workspace doc until commit / cancel / 30 min;
 * a token only works for the session that created it (index doc `import_idx`), like $_SESSION['import'] in the PHP edition.
 */
import crypto from 'node:crypto';
import { Crypto } from '../../lib/crypto.ts';
import { seconds, validDuration } from '../../lib/scripts.ts';
import { parseMeta } from '../../lib/scripts.ts';
import { Store } from '../../lib/store.ts';
import type { TFn } from '../../lib/i18n.ts';
import type { Driver } from '../../lib/driver.ts';

export const MAX_BYTES = 2 * 1024 * 1024;
export const MAX_ROWS = 5000;
export const SHOW = 300; // preview rows rendered
export const TTL = 30 * 60; // seconds a pending import survives

/** canonical key => [export header, aliases (normalised: lowercase letters/digits only)] */
export const COLS: Record<string, [string, string[]]> = {
  server: ['Server', ['server', 'hotspotserver']],
  name: ['Name', ['name', 'user', 'username', 'login', 'voucher', 'code']],
  password: ['Password', ['password', 'pass', 'pwd']],
  profile: ['Profile', ['profile', 'package', 'paket']],
  'mac-address': ['Mac Address', ['macaddress', 'mac']],
  'limit-uptime': ['Time Limit', ['timelimit', 'limituptime', 'uptimelimit', 'limittime']],
  'limit-bytes-total': ['Data Limit', ['datalimit', 'limitbytestotal', 'limitbytes', 'bytelimit', 'limitdata']],
  comment: ['Comment', ['comment', 'note', 'keterangan']],
  disabled: ['Disabled', ['disabled', 'disable']],
};
export const STATS: Record<string, string> = { uptime: 'Uptime', 'bytes-in': 'Bytes In', 'bytes-out': 'Bytes Out' };

export type RowState = 'new' | 'update' | 'skip' | 'error';
export type PreviewRow = { line: number; st: RowState; exists: boolean; d: Record<string, string>; err: string[] };
export type Pending = { rows: PreviewRow[]; mode: 'skip' | 'overwrite'; counts: Record<RowState, number>; file: string; router: string; cols: string[]; fatal: string; ts: number };
export type RowError = { line: number; name: string; error: string };
export type Result = { added: number; updated: number; skipped: number; errors: number; dry: boolean; mode: string; file: string; ts: number; rowErrors: RowError[] };

// ---- CSV text <-> cells ------------------------------------------------------------------------------

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Spreadsheet formula guard on export. */
export const out = (v: string): string => (v !== '' && '=+-@\t\r'.includes(v[0]!) && !/^[+-]?\d+([.,]\d+)?$/.test(v) ? "'" + v : v);
/** Undo the guard on import (trims). */
export const inn = (v: string): string => {
  const s = v.trim();
  return s.length > 1 && s[0] === "'" && '=+-@'.includes(s[1]!) ? s.slice(1) : s;
};

/** One CSV line like PHP fputcsv (fields with the separator, quote, CR/LF, tab, space or backslash are quoted). */
export function csvLine(cells: (string | number)[], sep: string): string {
  return (
    cells
      .map((c) => {
        const s = String(c);
        return s !== '' && new RegExp(`[${sep === ';' ? ';' : sep === '\t' ? '\\t' : ','}"\\n\\r\\t \\\\]`).test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      })
      .join(sep) + '\r\n'
  );
}

/** Decode upload bytes: UTF-8 (BOM stripped), else Windows-1252. */
export function decodeCsv(buf: Uint8Array): string {
  let b = buf;
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3);
  let s: string;
  try {
    s = new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    s = new TextDecoder('windows-1252').decode(b);
  }
  return s.replace(/\0/g, '');
}

/** RFC 4180 reader: quoted fields may hold separators, doubled quotes and line breaks. One record per entry. */
export function readRecords(text: string, sep: string): string[][] {
  const recs: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  let any = false; // the record has content (a bare blank line is [null] in PHP)
  const end = () => {
    row.push(cur);
    recs.push(row);
    row = [];
    cur = '';
    any = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"' && cur === '') {
      q = true;
      any = true;
    } else if (c === sep) {
      row.push(cur);
      cur = '';
      any = true;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      end();
    } else {
      cur += c;
      any = true;
    }
  }
  if (any || cur !== '' || row.length > 0) end();
  return recs;
}

export type Parsed = { map: string[] | null; rows: { line: number; cells: string[] }[]; error: string };

export function parseCsv(text: string, t: TFn): Parsed {
  const first = text.split('\n', 1)[0] ?? '';
  let sep = ',';
  let best = first.split(',').length - 1;
  for (const c of [';', '\t']) {
    const n = first.split(c).length - 1;
    if (n > best) {
      best = n;
      sep = c;
    }
  }
  const rows: Parsed['rows'] = [];
  let map: string[] | null = null;
  let line = 0;
  for (const cells of readRecords(text, sep)) {
    line++;
    if (cells.every((c) => c.trim() === '')) continue; // blank line
    if (map === null) {
      const m: string[] = [];
      for (const [i, h] of cells.entries()) {
        const nh = norm(h);
        m[i] = '';
        for (const [key, def] of Object.entries(COLS)) {
          if (def[1].includes(nh) && !m.includes(key)) {
            m[i] = key;
            break;
          }
        }
      }
      map = m;
      if (!m.includes('name')) return { map: null, rows: [], error: t('No "Name" column found in the first row. Download the template to see the expected columns.') };
      continue;
    }
    if (rows.length >= MAX_ROWS) return { map, rows, error: t('Too many rows: the limit is :n rows per file.', { ':n': MAX_ROWS }) };
    rows.push({ line, cells });
  }
  return { map, rows, error: map === null ? t('The file is empty.') : '' };
}

// ---- row validation ----------------------------------------------------------------------------------------

export type RouterCtx = { profiles: Set<string>; validity: Record<string, string>; servers: string[]; existing: Map<string, string> };

export async function routerContext(r: Driver): Promise<RouterCtx> {
  const got = await r.printMany({
    profiles: ['/ip/hotspot/user/profile', {}, ['name', 'on-login']],
    users: ['/ip/hotspot/user', {}, ['name']],
    servers: ['/ip/hotspot', {}, ['name']],
  });
  const profiles = new Set<string>();
  const validity: Record<string, string> = {};
  for (const p of got.profiles ?? []) {
    profiles.add(p.name ?? '');
    validity[p.name ?? ''] = parseMeta(p['on-login'] ?? '')?.validity ?? '';
  }
  return {
    profiles,
    validity,
    servers: (got.servers ?? []).map((s) => s.name ?? ''),
    existing: new Map((got.users ?? []).map((u) => [u.name ?? '', u['.id'] ?? ''])),
  };
}

const yes = (v: string): boolean | null => {
  const s = v.trim().toLowerCase();
  if (s === '') return null;
  if (['yes', 'true', '1', 'y', 'ya', 'disabled'].includes(s)) return true;
  if (['no', 'false', '0', 'n', 'tidak', 'enabled'].includes(s)) return false;
  return null;
};

/** Validate one row. Returns the cleaned data and the error list. */
export function checkRow(cells: string[], map: string[], ctx: RouterCtx, t: TFn): { d: Record<string, string>; err: string[] } {
  const d: Record<string, string> = {};
  for (const [i, key] of map.entries()) if (key !== '' && cells[i] !== undefined) d[key] = inn(cells[i]!);
  const err: string[] = [];
  const name = d.name ?? '';
  if (name === '') err.push(t('Name is empty.'));
  else if (!/^[\w.\-@]{1,64}$/.test(name)) err.push(t('Invalid username (letters, digits, . - _ @, max 64).'));
  if (d.password !== undefined && (d.password.length > 64 || /[\x00-\x1F]/.test(d.password))) err.push(t('Password too long or has control characters.'));
  if (d.profile !== undefined && d.profile === '') d.profile = 'default';
  if (d.profile !== undefined && !ctx.profiles.has(d.profile)) err.push(t('Profile ":p" does not exist on this router.', { ':p': d.profile }));
  if (d.server !== undefined && d.server !== '' && d.server !== 'all' && !ctx.servers.includes(d.server)) err.push(t('Hotspot server ":s" does not exist.', { ':s': d.server }));
  if (d['mac-address'] !== undefined && d['mac-address'] !== '') {
    if (!/^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/.test(d['mac-address'])) err.push(t('Invalid MAC address.'));
    else d['mac-address'] = d['mac-address'].replace(/-/g, ':').toUpperCase();
  }
  if (d['limit-uptime'] !== undefined && d['limit-uptime'] !== '') {
    d['limit-uptime'] = d['limit-uptime'].toLowerCase();
    if (!validDuration(d['limit-uptime'])) err.push(t('Time limit format is invalid (example: 1h30m).'));
    else {
      const validity = ctx.validity[d.profile ?? 'default'] ?? '';
      if (validity !== '' && seconds(d['limit-uptime']) > seconds(validity)) err.push(t('Time limit (:l) must not exceed validity (:v).', { ':l': d['limit-uptime'], ':v': validity }));
    }
  }
  if (d['limit-bytes-total'] !== undefined && d['limit-bytes-total'] !== '' && !/^\d+[kKmMgG]?$/.test(d['limit-bytes-total'])) err.push(t('Data limit format is invalid (example: 500M or 2G).'));
  if (d.comment !== undefined) {
    d.comment = d.comment.replace(/[\r\n]+/g, ' ').trim();
    if ([...d.comment].length > 255) err.push(t('Comment is longer than 255 characters.'));
  }
  if (d.disabled !== undefined && d.disabled !== '') {
    const b = yes(d.disabled);
    if (b === null) err.push(t('Disabled must be yes or no.'));
    else d.disabled = b ? 'yes' : 'no';
  }
  return { d, err };
}

// ---- pending imports (encrypted at rest, bound to the session) --------------------------------------------

type Index = Record<string, { ts: number; sess: string }>;
const IDX = 'import_idx';
const doc = (token: string, kind: 'rows' | 'result') => `import_${token}_${kind}`;
export const validToken = (t: string): boolean => /^[a-f0-9]{16}$/.test(t);
const now = () => Math.floor(Date.now() / 1000);

/** Drop every pending import older than TTL (called on each upload). */
export function gc(): void {
  Store.update<Index>(
    IDX,
    (idx) => {
      for (const [tok, v] of Object.entries(idx)) {
        if (v.ts < now() - TTL) {
          Store.delete(doc(tok, 'rows'));
          Store.delete(doc(tok, 'result'));
          delete idx[tok];
        }
      }
      return idx;
    },
    {},
  );
}

export function create(sess: string, p: Omit<Pending, 'ts'>): string {
  gc();
  const token = crypto.randomBytes(8).toString('hex');
  Store.write(doc(token, 'rows'), Crypto.encrypt(JSON.stringify({ ...p, ts: now() })));
  Store.update<Index>(IDX, (idx) => ({ ...idx, [token]: { ts: now(), sess } }), {});
  return token;
}

const allowed = (token: string, sess: string): boolean => {
  if (!validToken(token)) return false;
  const e = Store.read<Index>(IDX, {})[token];
  return !!e && e.sess === sess && e.ts >= now() - TTL;
};

export function load(token: string, sess: string): Pending | null {
  if (!allowed(token, sess)) return null;
  const raw = Store.read<string>(doc(token, 'rows'), '');
  const s = raw ? Crypto.decrypt(raw) : '';
  try {
    return s ? (JSON.parse(s) as Pending) : null;
  } catch {
    return null;
  }
}

export function saveResult(token: string, res: Result): void {
  Store.write(doc(token, 'result'), res);
}

export function loadResult(token: string, sess: string): Result | null {
  if (!allowed(token, sess)) return null;
  return Store.read<Result | null>(doc(token, 'result'), null);
}

/** Forget the parsed rows (they hold passwords); the result stays until TTL. */
export function dropRows(token: string): void {
  Store.delete(doc(token, 'rows'));
}

export function drop(token: string): void {
  dropRows(token);
  Store.delete(doc(token, 'result'));
  Store.update<Index>(
    IDX,
    (idx) => {
      delete idx[token];
      return idx;
    },
    {},
  );
}
