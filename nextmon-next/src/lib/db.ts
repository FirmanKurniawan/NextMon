/**
 * SQLite access (built-in node:sqlite, Node >= 22.5). One connection per data directory, WAL mode.
 * Schema (PRAGMA user_version migrations):
 *   docs(name PK, data JSON, updated)         documents (Store.read/write/update)
 *   logs(id AUTOINCREMENT, name, ts, data)    append-only collections (Store.append/rows/tail)
 *   sessions(id_hash PK, uid, ws, csrf, ...)  server-side login sessions (see sessions.ts)
 * Only this file touches node:sqlite. Everything else goes through Store (workspace namespacing) or Sessions.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Env } from './env.ts';
import { singleton } from './singleton.ts';

export type Row = Record<string, unknown>;
type Stmt = {
  run(...a: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...a: unknown[]): Row | undefined;
  all(...a: unknown[]): Row[];
};
type Sqlite = { exec(sql: string): void; prepare(sql: string): Stmt; close(): void };

function openSqlite(file: string): Sqlite {
  // node:sqlite prints an ExperimentalWarning on load; keep the log clean
  const orig = process.emitWarning;
  process.emitWarning = ((w: unknown, ...rest: unknown[]) => {
    if (String(typeof w === 'string' ? w : (w as Error)?.message).includes('SQLite')) return;
    return (orig as (...a: unknown[]) => void).call(process, w, ...rest);
  }) as typeof process.emitWarning;
  try {
    // getBuiltinModule: no bundler-visible require() of a non-standard builtin (Node >= 22.3)
    const mod = process.getBuiltinModule('node:sqlite') as unknown as { DatabaseSync: new (f: string) => Sqlite } | undefined;
    if (!mod) throw new Error('node:sqlite is not available: NextMON needs Node.js >= 22.5');
    return new mod.DatabaseSync(file);
  } finally {
    process.emitWarning = orig;
  }
}

const MIGRATIONS: string[] = [
  `CREATE TABLE docs (name TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL);
   CREATE TABLE logs (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, ts INTEGER NOT NULL, data TEXT NOT NULL);
   CREATE INDEX logs_name_id ON logs(name, id);
   CREATE TABLE sessions (id_hash TEXT PRIMARY KEY, uid TEXT NOT NULL, ws TEXT NOT NULL, csrf TEXT NOT NULL,
     created INTEGER NOT NULL, last INTEGER NOT NULL, ip TEXT NOT NULL DEFAULT '', ua TEXT NOT NULL DEFAULT '',
     router TEXT NOT NULL DEFAULT '', lang TEXT NOT NULL DEFAULT '');
   CREATE INDEX sessions_uid ON sessions(uid);`,
];

export class Db {
  readonly file: string;
  private raw: Sqlite;
  private stmts = new Map<string, Stmt>();
  private depth = 0;

  constructor(file: string) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o770 });
    this.raw = openSqlite(file);
    this.raw.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
    this.migrate();
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      /* Windows */
    }
  }

  private version(): number {
    return Number(this.raw.prepare('PRAGMA user_version').get()?.user_version ?? 0);
  }

  private migrate(): void {
    for (let i = this.version(); i < MIGRATIONS.length; i++) {
      this.raw.exec('BEGIN IMMEDIATE');
      try {
        if (this.version() > i) {
          this.raw.exec('ROLLBACK'); // another process migrated first
          continue;
        }
        this.raw.exec(MIGRATIONS[i]!);
        this.raw.exec(`PRAGMA user_version=${i + 1}`);
        this.raw.exec('COMMIT');
      } catch (e) {
        try {
          this.raw.exec('ROLLBACK');
        } catch {
          /* ignore */
        }
        throw e;
      }
    }
  }

  st(sql: string): Stmt {
    let s = this.stmts.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.stmts.set(sql, s);
    }
    return s;
  }

  /** Run fn in a write transaction (BEGIN IMMEDIATE); nested calls become savepoints. fn must be synchronous. */
  tx<T>(fn: () => T): T {
    if (this.depth > 0) {
      const sp = `sp${this.depth}`;
      this.raw.exec(`SAVEPOINT ${sp}`);
      this.depth++;
      try {
        const r = fn();
        this.raw.exec(`RELEASE ${sp}`);
        return r;
      } catch (e) {
        this.raw.exec(`ROLLBACK TO ${sp}; RELEASE ${sp}`);
        throw e;
      } finally {
        this.depth--;
      }
    }
    this.raw.exec('BEGIN IMMEDIATE');
    this.depth = 1;
    try {
      const r = fn();
      this.raw.exec('COMMIT');
      return r;
    } catch (e) {
      try {
        this.raw.exec('ROLLBACK');
      } catch {
        /* already rolled back */
      }
      throw e;
    } finally {
      this.depth = 0;
    }
  }

  close(): void {
    this.stmts.clear();
    try {
      this.raw.close();
    } catch {
      /* ignore */
    }
  }
}

const holder = () => singleton('db', () => ({ cur: null as Db | null }));

/** Connection for the current NEXTMON_DATA (re-opened when the env var changes, e.g. in tests). */
export function db(): Db {
  const file = path.join(Env.dataDir(), 'nextmon.db');
  const h = holder();
  if (!h.cur || h.cur.file !== file) {
    h.cur?.close();
    h.cur = new Db(file);
  }
  return h.cur;
}

export function closeDb(): void {
  const h = holder();
  h.cur?.close();
  h.cur = null;
}
