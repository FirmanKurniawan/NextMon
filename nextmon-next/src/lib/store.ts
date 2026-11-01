/**
 * Store - the ONLY door to persistent data (documents + append-only logs), with transparent per-workspace namespacing.
 * Mirrors the PHP Store contract (docs/MULTITENANT.md):
 *   - Every collection is per-workspace ("ws/<id>/<name>" in the backend) UNLESS its name is in GLOBAL_DOCS.
 *   - The workspace comes from Context (AsyncLocalStorage), set by Workspace.run() after the server resolved the session.
 *   - No active workspace => NoWorkspaceError (FAIL CLOSED) - never a fallback to global data.
 *   - Global collections are reached explicitly with Store.global(name) (or by name; they never need a workspace).
 * API is synchronous (node:sqlite is synchronous); update() runs the callback inside BEGIN IMMEDIATE so it is atomic
 * across processes too.
 */
import { Context } from './context.ts';
import { db } from './db.ts';
import { singleton } from './singleton.ts';

export class NoWorkspaceError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'NoWorkspaceError';
  }
}

/**
 * Collections that are NOT per-workspace. Same list as the PHP edition; anything else needs an active workspace.
 * Next-edition additions: `locks` (distributed login/rate locks) - sessions live in their own table (sessions.ts).
 */
export const GLOBAL_DOCS: readonly string[] = [
  'users',
  'login_attempts',
  'rate_limits',
  'sessions_meta',
  'workspaces',
  'shares',
  'platform',
  'apikey_index',
  'session_index',
  'shop_rate',
  'platform_audit',
  'locks',
];

export const WS_ID_RE = /^w_[a-f0-9]{8}$/;

/** Collection names: letters, digits, _ . - ; never empty / hidden / path-like. */
export function sanitizeName(name: string): string {
  const n = name.replace(/[^A-Za-z0-9_.-]/g, '_');
  if (n.replace(/^\.+/, '') === '') return '_';
  return n.startsWith('.') ? '_' + n.slice(1) : n;
}

const isGlobalName = (n: string) => GLOBAL_DOCS.includes(n);

/** Backend key of a collection for the active workspace. */
function key(name: string): string {
  const n = sanitizeName(name);
  if (isGlobalName(n)) return n;
  const ws = Context.current().ws;
  if (!ws) throw new NoWorkspaceError(`No active workspace: refusing to access '${n}'`);
  if (!WS_ID_RE.test(ws)) throw new NoWorkspaceError('Invalid workspace id in context');
  return `ws/${ws}/${n}`;
}

function parse<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

function readKey<T>(k: string, def: T): T {
  const r = db().st('SELECT data FROM docs WHERE name = ?').get(k);
  return r ? parse<T>(String(r.data), def) : def;
}

function writeKey(k: string, data: unknown): void {
  db()
    .st('INSERT INTO docs(name, data, updated) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET data=excluded.data, updated=excluded.updated')
    .run(k, JSON.stringify(data ?? null), Math.floor(Date.now() / 1000));
}

export type Where = Record<string, string | number | boolean>;

/** Per-workspace log collections trimmed to the workspace's `log_rows` limit on append (ledgers / sales records are never trimmed). */
export const CAPPED_LOGS: readonly string[] = ['audit.log', 'notify.log', 'alerts.log', 'wizard.log'];
/** workspace id -> log_rows limit (0 = unlimited). Registered by workspace.ts (store.ts cannot import it: cycle). */
const logCapResolver = singleton<{ fn: ((ws: string) => number) | null }>('store.logcap', () => ({ fn: null }));
export function setLogCapResolver(fn: (ws: string) => number): void {
  logCapResolver.fn = fn;
}

export const Store = {
  isGlobal(name: string): boolean {
    return isGlobalName(sanitizeName(name));
  },

  read<T = unknown>(name: string, def: T): T {
    return readKey<T>(key(name), def);
  },

  write(name: string, data: unknown): void {
    writeKey(key(name), data);
  },

  /** Read-modify-write under an exclusive lock. fn gets the current value and returns the new one. Returns the new value. */
  update<T>(name: string, fn: (cur: T) => T, def: T): T {
    const k = key(name);
    return db().tx(() => {
      const next = fn(readKey<T>(k, def));
      writeKey(k, next);
      return next;
    });
  },

  has(name: string): boolean {
    return !!db().st('SELECT 1 AS x FROM docs WHERE name = ?').get(key(name));
  },

  delete(name: string): void {
    db().st('DELETE FROM docs WHERE name = ?').run(key(name));
  },

  /** Document names of the active workspace (the global ones when none is active). */
  names(): string[] {
    const ws = Context.current().ws;
    const pre = ws ? `ws/${ws}/` : '';
    const out: string[] = [];
    for (const r of db().st('SELECT name FROM docs').all()) {
      const n = String(r.name);
      if (pre) {
        if (n.startsWith(pre)) out.push(n.slice(pre.length));
      } else if (!n.startsWith('ws/')) out.push(n);
    }
    return out;
  },

  // ---- append-only collections ----------------------------------------------------------------

  append(collection: string, row: Record<string, unknown>): void {
    db().st('INSERT INTO logs(name, ts, data) VALUES(?,?,?)').run(key(collection), Math.floor(Date.now() / 1000), JSON.stringify(row));
    const ws = Context.current().ws;
    if (ws && logCapResolver.fn && CAPPED_LOGS.includes(sanitizeName(collection))) {
      const cap = logCapResolver.fn(ws);
      if (cap > 0) Store.prune(collection, cap); // exact, O(log n + cap) through the (name, id) index
    }
  },

  /** Paged read, newest first. `where` = exact matches on top-level row keys. */
  rows<T = Record<string, unknown>>(collection: string, limit = 100, offset = 0, where: Where = {}): T[] {
    const k = key(collection);
    let sql = 'SELECT data FROM logs WHERE name = ?';
    const args: unknown[] = [k];
    for (const [f, v] of Object.entries(where)) {
      if (!/^\w{1,40}$/.test(f)) throw new Error('bad filter key');
      sql += ` AND json_extract(data, '$.${f}') = ?`;
      args.push(typeof v === 'boolean' ? (v ? 1 : 0) : v);
    }
    sql += ' ORDER BY id DESC LIMIT ? OFFSET ?';
    args.push(Math.max(0, Math.min(10000, limit)), Math.max(0, offset));
    return db()
      .st(sql)
      .all(...args)
      .map((r) => parse<T>(String(r.data), {} as T));
  },

  tail<T = Record<string, unknown>>(collection: string, n = 200): T[] {
    return Store.rows<T>(collection, n, 0);
  },

  count(collection: string): number {
    return Number(db().st('SELECT COUNT(*) AS c FROM logs WHERE name = ?').get(key(collection))?.c ?? 0);
  },

  /** Keep only the newest `keep` entries. Returns the number removed. */
  prune(collection: string, keep: number): number {
    const k = key(collection);
    const r = db()
      .st('DELETE FROM logs WHERE name = ? AND id <= COALESCE((SELECT id FROM logs WHERE name = ? ORDER BY id DESC LIMIT 1 OFFSET ?), 0)')
      .run(k, k, Math.max(0, keep));
    return Number(r.changes);
  },

  /** Explicit handle on a GLOBAL collection. Throws for anything not in GLOBAL_DOCS. */
  global(name: string): StoreGlobal {
    const n = sanitizeName(name);
    if (!isGlobalName(n)) throw new Error(`'${n}' is not a global collection`);
    return new StoreGlobal(n);
  },

  /** Delete every document and log of one workspace (Workspace.delete). */
  purgeWorkspace(wsId: string): void {
    if (!WS_ID_RE.test(wsId)) throw new Error('bad workspace id');
    const pre = `ws/${wsId}/`;
    const d = db();
    d.tx(() => {
      d.st('DELETE FROM docs WHERE substr(name, 1, ?) = ?').run(pre.length, pre);
      d.st('DELETE FROM logs WHERE substr(name, 1, ?) = ?').run(pre.length, pre);
    });
  },

  /** Every raw backend key of every workspace (CLI / maintenance only). */
  allNames(): string[] {
    return db()
      .st('SELECT name FROM docs')
      .all()
      .map((r) => String(r.name));
  },
};

export class StoreGlobal {
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
  read<T = unknown>(def: T): T {
    return Store.read(this.name, def);
  }
  write(data: unknown): void {
    Store.write(this.name, data);
  }
  update<T>(fn: (cur: T) => T, def: T): T {
    return Store.update(this.name, fn, def);
  }
  append(row: Record<string, unknown>): void {
    Store.append(this.name, row);
  }
  rows<T = Record<string, unknown>>(limit = 100, offset = 0, where: Where = {}): T[] {
    return Store.rows<T>(this.name, limit, offset, where);
  }
  count(): number {
    return Store.count(this.name);
  }
  prune(keep: number): number {
    return Store.prune(this.name, keep);
  }
  has(): boolean {
    return Store.has(this.name);
  }
  delete(): void {
    Store.delete(this.name);
  }
}

// ---- settings ------------------------------------------------------------------------------------

export type Settings = {
  lang: 'id' | 'en';
  timezone: string;
  currency: string;
  hotspot_name: string;
  login_url: string;
  max_qty: number;
  live_report: boolean;
  [k: string]: unknown;
};

export const SETTING_DEFAULTS: Settings = {
  lang: 'id',
  timezone: 'Asia/Jakarta',
  currency: 'Rp',
  hotspot_name: 'NextMON WiFi',
  login_url: 'http://hotspot.local/login',
  max_qty: 500,
  live_report: true,
  status_cors: '',
  // Telegram: every event type is subscribed until the owner unticks it (same defaults as the PHP edition's Store::defaults())
  telegram: { enabled: false, token: '', chat_id: '', events: ['sale', 'voucher', 'router', 'login'] },
  webhook_url: '',
  templates: [],
};

/**
 * Settings of the active workspace. With NO active workspace (login page, setup) it returns the defaults overlaid with the
 * platform-level settings (language/timezone only, never tenant data); it never throws.
 */
export function getSettings(): Settings {
  const ws = Context.current().ws;
  const stored = ws
    ? Store.read<Record<string, unknown>>('settings', {})
    : ((Store.global('platform').read<{ settings?: Record<string, unknown> }>({}).settings ?? {}) as Record<string, unknown>);
  return { ...SETTING_DEFAULTS, ...stored } as Settings;
}

export function saveSettings(patch: Record<string, unknown>): void {
  Store.update<Record<string, unknown>>('settings', (cur) => ({ ...cur, ...patch }), {});
}
