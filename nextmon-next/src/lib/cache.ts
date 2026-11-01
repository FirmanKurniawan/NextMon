/**
 * Tiny in-process TTL cache with generation-based invalidation, for derived / remote data (never for source-of-truth data: that
 * is Store). Keys MUST include the workspace + router id (use Cache.scope()) so one tenant can never be served another's entry.
 *
 * Generations: entries remember Cache.gen(ns) at the time the fetch STARTED and are only valid while it is unchanged;
 * Cache.bump(ns) invalidates a whole group at once (the CachedDriver bumps `ws:router` on every write).
 */
import { singleton } from './singleton.ts';

type Entry = { exp: number; gen: number; v: unknown };
const state = singleton('cache', () => ({ m: new Map<string, Entry>(), gens: new Map<string, number>(), inflight: new Map<string, Promise<unknown>>() }));
const MAX = 5000;

type CacheApi = {
  scope(ws: string, ...parts: string[]): string;
  gen(ns: string): number;
  bump(ns: string): void;
  get<T>(key: string, ns?: string): T | undefined;
  set(key: string, v: unknown, ttlSec: number, ns?: string, gen?: number): void;
  delete(key: string): void;
  clear(): void;
  remember<T>(key: string, ttlSec: number, fn: () => Promise<T>, ns?: string): Promise<T>;
};

export const Cache: CacheApi = {
  scope(ws: string, ...parts: string[]): string {
    return [ws, ...parts].join('|');
  },
  gen(ns: string): number {
    return state.gens.get(ns) ?? 0;
  },
  bump(ns: string): void {
    state.gens.set(ns, Cache.gen(ns) + 1);
  },
  get<T>(key: string, ns = ''): T | undefined {
    const e = state.m.get(key);
    if (!e) return undefined;
    if (e.exp < Date.now() || (ns && e.gen !== Cache.gen(ns))) {
      state.m.delete(key);
      return undefined;
    }
    return e.v as T;
  },
  set(key: string, v: unknown, ttlSec: number, ns = '', gen = Cache.gen(ns)): void {
    if (ttlSec <= 0) return;
    if (state.m.size >= MAX) {
      const now = Date.now();
      for (const [k, e] of state.m) if (e.exp < now) state.m.delete(k);
      if (state.m.size >= MAX) state.m.delete(state.m.keys().next().value as string);
    }
    state.m.set(key, { exp: Date.now() + ttlSec * 1000, gen, v });
  },
  delete(key: string): void {
    state.m.delete(key);
  },
  clear(): void {
    state.m.clear();
    state.gens.clear();
    state.inflight.clear();
  },
  /** Read-through with single-flight (concurrent callers share one fetch). The generation is read BEFORE fetching. */
  async remember<T>(key: string, ttlSec: number, fn: () => Promise<T>, ns = ''): Promise<T> {
    const hit = Cache.get<T>(key, ns);
    if (hit !== undefined) return hit;
    const fl = state.inflight.get(key);
    if (fl) return fl as Promise<T>;
    const gen = Cache.gen(ns);
    const p = fn()
      .then((v) => {
        Cache.set(key, v, ttlSec, ns, gen);
        return v;
      })
      .finally(() => state.inflight.delete(key));
    state.inflight.set(key, p);
    return p;
  },
};
