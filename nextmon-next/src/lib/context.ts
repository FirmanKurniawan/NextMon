/**
 * Request context carried through AsyncLocalStorage: active workspace (the ONLY source Store trusts), actor, client IP,
 * language. Workspace.run() / Context.run() establish it; there is no way to set it from client input.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { singleton } from './singleton.ts';

export type Actor = { id: string; username: string; role: string; workspace: string };
export type Ctx = {
  ws?: string;
  actor?: Actor;
  ip?: string;
  routerId?: string;
  lang?: string;
  /** true when a platform admin acts inside a workspace that is not their own */
  impersonating?: boolean;
};

const als = singleton('als.ctx', () => new AsyncLocalStorage<Ctx>());

export const Context = {
  current(): Ctx {
    return als.getStore() ?? {};
  },
  /** Run fn with the given fields merged over the parent context. */
  run<T>(patch: Ctx, fn: () => T): T {
    return als.run({ ...(als.getStore() ?? {}), ...patch }, fn);
  },
};
