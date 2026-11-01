/**
 * Shared helpers of the routers / platform / wizard features: a user-facing error type and the action wrapper that turns thrown
 * errors into a translated { ok:false, msg } (the client shows it as a toast). No Next imports here, so it is unit-testable.
 */
import { RouterError } from '../../lib/routers.ts';
import { RouterOSError } from '../../lib/routeros.ts';
import { WorkspaceError } from '../../lib/workspace.ts';
import type { AppContext } from '../types.ts';

export type ActionResult = { ok: boolean; msg?: string; data?: unknown };

/** An expected, user-correctable problem. `key` is an English source string for t(). */
export class UserError extends Error {
  params?: Record<string, string | number>;
  constructor(key: string, params?: Record<string, string | number>) {
    super(key);
    this.name = 'UserError';
    this.params = params;
  }
}

/** Run fn; a returned string = success message (English key), a thrown UserError / RouterError / WorkspaceError = failure toast. */
export async function respond(ctx: AppContext, fn: () => Promise<string | ActionResult | void> | string | ActionResult | void): Promise<ActionResult> {
  try {
    const r = await fn();
    if (typeof r === 'string') return { ok: true, msg: ctx.t(r) };
    if (r && typeof r === 'object') return r.msg ? { ...r, msg: ctx.t(r.msg) } : r;
    return { ok: true };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, msg: ctx.t(e.message, e.params) };
    if (e instanceof RouterError || e instanceof WorkspaceError) return { ok: false, msg: ctx.t(e.message) };
    if (e instanceof RouterOSError) return { ok: false, msg: e.message };
    if (e instanceof Error && e.name === 'HttpError') throw e; // 403 / 419 from the guard: let it surface
    console.error('[nextmon] action error', e);
    return { ok: false, msg: ctx.t('Something went wrong') };
  }
}

export const str = (fd: FormData, k: string): string => {
  const v = fd.get(k);
  return typeof v === 'string' ? v : '';
};
