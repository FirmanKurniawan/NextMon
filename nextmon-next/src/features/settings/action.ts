/**
 * Helper for the server actions of this area: runs runAction (session + CSRF + capability + workspace), turns guard errors into
 * a result the form can toast, translates messages with the caller's language and refreshes the page data.
 */
import { revalidatePath } from 'next/cache';
import type { AppContext } from '../types.ts';
import { HttpError, runAction } from '../../server/guard.ts';
import type { Cap } from '../../lib/users.ts';
import type { ActionResult } from './result.ts';

export type Out = { ok: boolean; msg: string; params?: Record<string, string | number>; key?: string; note?: string };

export async function act(cap: Cap, path: string, fd: FormData, fn: (ctx: AppContext, fd: FormData) => Promise<Out> | Out): Promise<ActionResult> {
  try {
    return await runAction({ cap }, fd, async (ctx, f) => {
      const r = await fn(ctx, f);
      if (r.ok) revalidatePath(path);
      const msg = ctx.t(r.msg, r.params) + (r.note ? ' ' + r.note : '');
      return { ok: r.ok, msg, ...(r.key ? { key: r.key } : {}) };
    });
  } catch (e) {
    if (e instanceof HttpError) return { ok: false, msg: e.message };
    throw e;
  }
}

export const str = (fd: FormData, k: string, max = 500): string => String(fd.get(k) ?? '').slice(0, max);
