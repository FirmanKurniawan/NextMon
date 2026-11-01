/**
 * Workspace (tenant) registry + the current-workspace context. Contract mirrors the PHP edition (docs/MULTITENANT.md):
 *   Workspace.id()/idOrNull()   active workspace of this async call chain (throws NoWorkspaceError when none)
 *   Workspace.run(id, fn)       run fn inside another workspace (cron, webhook, public pages, platform admin switching)
 *   Workspace.get/all/bySlug/create/limits/setStatus/delete/dir
 * The workspace id is NEVER taken from client input: the server resolves it from the session and calls run().
 */
import fs from 'node:fs';
import path from 'node:path';
import { Context } from './context.ts';
import { randomHex } from './crypto.ts';
import { Env } from './env.ts';
import { NoWorkspaceError, setLogCapResolver, Store, WS_ID_RE } from './store.ts';
import { Users } from './users.ts';
import type { User } from './users.ts';

export type Limits = { routers: number; staff: number; vouchers_per_day: number; log_rows: number };
export const DEFAULT_LIMITS: Limits = { routers: 5, staff: 5, vouchers_per_day: 1000, log_rows: 20000 };

export type WorkspaceRec = {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'suspended';
  limits: Partial<Limits>;
  created: number;
};

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;
const RESERVED_SLUGS = new Set(['admin', 'api', 'platform', 'login', 'setup', 'shop', 'status', 'static', 'assets']);

const doc = () => Store.global('workspaces');

export class WorkspaceError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'WorkspaceError';
  }
}

export const Workspace = {
  ID_RE: WS_ID_RE,

  idOrNull(): string | null {
    return Context.current().ws ?? null;
  },

  id(): string {
    const ws = Context.current().ws;
    if (!ws) throw new NoWorkspaceError('No active workspace');
    return ws;
  },

  /** Run fn with `id` as the active workspace. Works with sync and async callbacks. */
  run<T>(id: string, fn: () => T): T {
    if (!WS_ID_RE.test(id)) throw new NoWorkspaceError('Invalid workspace id');
    return Context.run({ ws: id }, fn);
  },

  get(id: string): WorkspaceRec | null {
    return doc().read<WorkspaceRec[]>([]).find((w) => w.id === id) ?? null;
  },

  all(): WorkspaceRec[] {
    return doc().read<WorkspaceRec[]>([]);
  },

  bySlug(slug: string): WorkspaceRec | null {
    const s = slug.toLowerCase();
    return doc().read<WorkspaceRec[]>([]).find((w) => w.slug === s) ?? null;
  },

  /** Platform defaults overlaid with the per-workspace override. */
  limits(id: string): Limits {
    const plat = Store.global('platform').read<{ default_limits?: Partial<Limits> }>({}).default_limits ?? {};
    const rec = Workspace.get(id);
    const base = rec?.slug === 'main' ? { routers: 0, staff: 0, vouchers_per_day: 0, log_rows: 0 } : { ...DEFAULT_LIMITS, ...plat }; // `main` is unlimited unless overridden
    return { ...base, ...(rec?.limits ?? {}) };
  },

  /**
   * Create a workspace + its owner. `ownerRole: 'platform'` is only for the first-run setup (the platform admin's personal
   * workspace). Seeds a Demo Router when `demo` is set. Returns { workspace, owner }.
   */
  async create(input: {
    name: string;
    slug: string;
    owner: { username: string; password: string; name?: string };
    limits?: Partial<Limits>;
    ownerRole?: 'admin' | 'platform';
    demo?: boolean;
    /** first-run setup: fail (and roll back) if any user already exists */
    onlyIfEmpty?: boolean;
  }): Promise<{ workspace: WorkspaceRec; owner: User }> {
    const slug = input.slug.trim().toLowerCase();
    if (!SLUG_RE.test(slug)) throw new WorkspaceError('Invalid slug: 2-31 chars, a-z 0-9 and dash.');
    if (RESERVED_SLUGS.has(slug) && slug !== 'main') throw new WorkspaceError('This slug is reserved.');
    const name = input.name.trim().slice(0, 60);
    if (!name) throw new WorkspaceError('Name is required.');
    const rec: WorkspaceRec = {
      id: 'w_' + randomHex(4),
      slug,
      name,
      status: 'active',
      limits: input.limits ?? {},
      created: Math.floor(Date.now() / 1000),
    };
    let taken = false;
    doc().update<WorkspaceRec[]>((list) => {
      if (list.some((w) => w.slug === slug)) {
        taken = true;
        return list;
      }
      return [...list, rec];
    }, []);
    if (taken) throw new WorkspaceError('Slug already in use.');
    const owner = await Users.create(
      { ...input.owner, role: input.ownerRole ?? 'admin', workspace: rec.id },
      { allowPlatform: input.ownerRole === 'platform', onlyIfEmpty: input.onlyIfEmpty },
    );
    if (!owner) {
      doc().update<WorkspaceRec[]>((list) => list.filter((w) => w.id !== rec.id), []);
      throw new WorkspaceError(input.onlyIfEmpty ? 'Setup is already completed.' : 'Username already taken.');
    }
    if (input.demo) {
      const { Routers } = await import('./routers.ts');
      Workspace.run(rec.id, () => Routers.ensureDemo());
    }
    return { workspace: rec, owner };
  },

  update(id: string, patch: Partial<Pick<WorkspaceRec, 'name' | 'limits' | 'status'>>): void {
    doc().update<WorkspaceRec[]>((list) => list.map((w) => (w.id === id ? { ...w, ...patch } : w)), []);
  },

  setStatus(id: string, status: 'active' | 'suspended'): void {
    Workspace.update(id, { status });
  },

  /** Delete the workspace, its users, all its documents/logs and files. */
  delete(id: string): void {
    if (!WS_ID_RE.test(id)) throw new WorkspaceError('bad id');
    Store.purgeWorkspace(id);
    Users.removeWorkspace(id);
    doc().update<WorkspaceRec[]>((list) => list.filter((w) => w.id !== id), []);
    Store.global('shares').update<{ owner: string; to: string }[]>((l) => l.filter((s) => s.owner !== id && s.to !== id), []);
    fs.rmSync(path.join(Env.dataDir(), 'ws', id), { recursive: true, force: true });
  },

  /** Per-workspace directory for non-document files (orders, backups...). Created on demand. */
  dir(sub = ''): string {
    const id = Workspace.id();
    const clean = sub.replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^\.+/, '_');
    const p = path.join(Env.dataDir(), 'ws', id, clean);
    fs.mkdirSync(p, { recursive: true, mode: 0o770 });
    return p;
  },
};

setLogCapResolver((ws) => Workspace.limits(ws).log_rows);
