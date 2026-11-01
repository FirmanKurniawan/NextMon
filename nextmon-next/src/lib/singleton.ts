/**
 * Process-wide singletons that must survive Next.js module duplication (route handlers, RSC and SSR bundles may each
 * load their own copy of a module; HMR reloads modules). State is anchored on globalThis.
 */
export function singleton<T>(name: string, init: () => T): T {
  const g = globalThis as unknown as Record<symbol, unknown>;
  const key = Symbol.for('nextmon.' + name);
  if (!(key in g)) g[key] = init();
  return g[key] as T;
}

/** Drop a singleton (tests). */
export function dropSingleton(name: string): void {
  delete (globalThis as unknown as Record<symbol, unknown>)[Symbol.for('nextmon.' + name)];
}
