/**
 * Routers of the active workspace (document `routers`) + routers other workspaces share with it, and the driver factory.
 * Every RouterOS call in the app obtains its Driver here (Routers.driver(id)); nothing else builds clients.
 *
 *   own router     : RealDriver|DemoDriver wrapped in CachedDriver (real only)
 *   shared (ro)    : same, wrapped in ReadOnlyDriver
 *   NEXTMON_DEMO=1 : every router entry is served by the DemoDriver
 * Passwords are AES-256-GCM encrypted at rest and NEVER leave this module (RouterView has no password field).
 */
import { CachedDriver, ReadOnlyDriver } from './driver.ts';
import type { Driver } from './driver.ts';
import { DemoDriver } from './demo.ts';
import { RealDriver } from './driver-real.ts';
import { Crypto } from './crypto.ts';
import { Env } from './env.ts';
import { routerPool } from './routeros.ts';
import { Share } from './share.ts';
import { singleton } from './singleton.ts';
import type { ShareMode } from './share.ts';
import { getSettings, Store } from './store.ts';
import { Workspace } from './workspace.ts';
import { randomHex } from './crypto.ts';

export type RouterCfg = {
  id: string;
  name: string;
  session: string;
  type: 'demo' | 'real';
  host: string;
  port: number;
  ssl: boolean;
  verify_tls: boolean;
  user: string;
  /** encrypted (v1:...) - never expose */
  pass: string;
  hotspot_name: string;
};

/** What UI code gets to see: no password. */
export type RouterView = Omit<RouterCfg, 'pass'> & { shared: boolean; mode: ShareMode; owner: string; has_password: boolean };

export const ROUTER_ID_RE = /^[a-f0-9]{8}$/;
export class RouterError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'RouterError';
  }
}

const own = (): RouterCfg[] => Store.read<RouterCfg[]>('routers', []);
const view = (r: RouterCfg, shared: boolean, mode: ShareMode, owner: string): RouterView => {
  const { pass, ...rest } = r;
  return { ...rest, shared, mode, owner, has_password: !!pass };
};

type Resolved = { cfg: RouterCfg; owner: string; mode: ShareMode; shared: boolean };

function resolve(id: string): Resolved | null {
  const ws = Workspace.id();
  const mine = own().find((r) => r.id === id);
  if (mine) return { cfg: mine, owner: ws, mode: 'rw', shared: false };
  const rule = Share.for(id, ws);
  if (!rule) return null;
  const cfg = Workspace.run(rule.owner, () => own().find((r) => r.id === id));
  return cfg ? { cfg, owner: rule.owner, mode: rule.mode, shared: true } : null;
}

export const Routers = {
  /** Own routers followed by routers shared with this workspace. */
  list(): RouterView[] {
    const ws = Workspace.id();
    const out = own().map((r) => view(r, false, 'rw', ws));
    for (const rule of Share.incoming(ws)) {
      const cfg = Workspace.run(rule.owner, () => own().find((r) => r.id === rule.router));
      if (cfg) out.push(view(cfg, true, rule.mode, rule.owner));
    }
    return out;
  },

  get(id: string): RouterView | null {
    const r = resolve(id);
    return r ? view(r.cfg, r.shared, r.mode, r.owner) : null;
  },

  /** The router to use: `preferred` when it is visible to this workspace, else the first one, else null. */
  current(preferred?: string): RouterView | null {
    const l = Routers.list();
    return l.find((r) => r.id === preferred) ?? l[0] ?? null;
  },

  /** Create the per-workspace Demo Router when the workspace has no router at all (onboarding / "try demo mode"). */
  ensureDemo(): RouterView {
    const existing = own().find((r) => r.type === 'demo');
    if (existing) return view(existing, false, 'rw', Workspace.id());
    const cfg: RouterCfg = { id: randomHex(4), name: 'Demo Router', session: 'demo', type: 'demo', host: '', port: 8728, ssl: false, verify_tls: false, user: '', pass: '', hotspot_name: 'Demo WiFi' };
    Store.update<RouterCfg[]>('routers', (l) => [...l, cfg], []);
    return view(cfg, false, 'rw', Workspace.id());
  },

  /** Create or update an OWN router. `pass` blank on update = keep the stored password. Enforces the workspace router limit. */
  save(input: Partial<Omit<RouterCfg, 'pass'>> & { name: string; pass?: string }): RouterView {
    const name = input.name.trim().slice(0, 40);
    if (!name) throw new RouterError('Name is required.');
    const type = input.type === 'demo' ? 'demo' : 'real';
    const host = (input.host ?? '').trim();
    if (type === 'real' && !/^[A-Za-z0-9.\-:]+$/.test(host)) throw new RouterError('Invalid host.');
    let port = Number(input.port ?? 8728);
    if (!Number.isInteger(port) || port < 1 || port > 65535) port = input.ssl ? 8729 : 8728;
    const id = input.id && ROUTER_ID_RE.test(input.id) ? input.id : '';
    const limit = Workspace.limits(Workspace.id()).routers;
    let saved!: RouterCfg;
    Store.update<RouterCfg[]>(
      'routers',
      (list) => {
        const i = id ? list.findIndex((r) => r.id === id) : -1;
        if (i < 0 && limit > 0 && list.length >= limit) throw new RouterError('Router limit reached for this workspace.');
        const prev = i >= 0 ? list[i]! : null;
        saved = {
          id: prev?.id ?? randomHex(4),
          name,
          session: (input.session ?? name).toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'router',
          type,
          host,
          port,
          ssl: !!input.ssl,
          verify_tls: !!input.ssl && !!input.verify_tls,
          user: (input.user ?? '').trim().slice(0, 64),
          pass: input.pass ? Crypto.encrypt(input.pass) : (prev?.pass ?? ''),
          hotspot_name: (input.hotspot_name ?? '').slice(0, 60),
        };
        const c = [...list];
        if (i >= 0) c[i] = saved;
        else c.push(saved);
        return c;
      },
      [],
    );
    Routers.forget(saved.id);
    return view(saved, false, 'rw', Workspace.id());
  },

  remove(id: string): void {
    Store.update<RouterCfg[]>('routers', (l) => l.filter((r) => r.id !== id), []);
    Share.revokeRouter(Workspace.id(), id);
    Routers.forget(id);
  },

  /** Drop pooled connections / cached state of one OWN router (credentials changed, router deleted). */
  forget(id: string): void {
    const ws = Workspace.id();
    routerPool().drop(`${ws}:${id}`);
    CachedDriver.flush(`${ws}:${id}`);
  },

  /** Driver for a router visible to this workspace (own or shared). Throws RouterError for unknown ids. */
  driver(id: string): Driver {
    const r = resolve(id);
    if (!r) throw new RouterError('Unknown router');
    const base = buildBase(r.cfg, r.owner);
    return r.mode === 'ro' ? new ReadOnlyDriver(base) : base;
  },

  /** One-off connection test with posted (unsaved) values; blank password + existing id = reuse the stored one. */
  async test(input: { id?: string; type?: string; host: string; port?: number; ssl?: boolean; verify_tls?: boolean; user: string; pass?: string }): Promise<{ ok: boolean; message: string }> {
    if (input.type === 'demo') return { ok: true, message: 'Demo router OK' };
    const port = Number(input.port ?? 8728);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, message: 'Invalid API port (1-65535). Default is 8728, or 8729 for API-SSL.' };
    if (!/^[A-Za-z0-9.\-:]+$/.test(input.host)) return { ok: false, message: 'Invalid host.' };
    let pass = input.pass ?? '';
    if (!pass && input.id) {
      const old = resolve(input.id);
      if (old) pass = Crypto.decrypt(old.cfg.pass);
    }
    const key = `test:${Workspace.id()}:${randomHex(4)}`;
    const link = routerPool().link(key, { host: input.host, port, tls: !!input.ssl, verifyTls: !!input.verify_tls, user: input.user, password: pass, timeoutMs: 6000 });
    try {
      const d = new RealDriver(link);
      const res = (await d.print('/system/resource'))[0] ?? {};
      const idn = (await d.print('/system/identity'))[0]?.name ?? '';
      return { ok: true, message: `${idn} - RouterOS ${res.version ?? '?'} (${res['board-name'] ?? '?'})` };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    } finally {
      routerPool().drop(key);
    }
  },
};

function buildBase(cfg: RouterCfg, owner: string): Driver {
  if (cfg.type === 'demo' || Env.demoForced()) return demoFor(owner, cfg.id);
  const ns = `${owner}:${cfg.id}`;
  const link = routerPool().link(ns, {
    host: cfg.host,
    port: cfg.port,
    tls: cfg.ssl,
    verifyTls: cfg.verify_tls,
    user: cfg.user,
    password: Crypto.decrypt(cfg.pass),
  });
  return new CachedDriver(new RealDriver(link), ns);
}

function demoFor(owner: string, id: string): Driver {
  const m = singleton('demoDrivers', () => new Map<string, DemoDriver>());
  let d = m.get(`${owner}:${id}`);
  if (!d) {
    const tz = Workspace.run(owner, () => String(getSettings().timezone || 'Asia/Jakarta'));
    d = new DemoDriver(owner, id, tz);
    m.set(`${owner}:${id}`, d);
  }
  return d;
}

// router passwords of every workspace take part in key rotation
Crypto.registerSecretSource({
  name: 'routers',
  list() {
    const refs: { value: string; save(v: string): void }[] = [];
    for (const w of Workspace.all()) {
      Workspace.run(w.id, () => {
        for (const r of own()) {
          if (!r.pass) continue;
          refs.push({
            value: r.pass,
            save: (v) => Workspace.run(w.id, () => Store.update<RouterCfg[]>('routers', (l) => l.map((x) => (x.id === r.id ? { ...x, pass: v } : x)), [])),
          });
        }
      });
    }
    return refs;
  },
});
