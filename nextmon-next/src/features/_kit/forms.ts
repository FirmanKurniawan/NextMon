/**
 * Plain-form POST endpoints for the hotspot feature family (users, profiles, vouchers, ...), mounted at /hs/<key> by
 * src/app/hs/[...path]/route.ts. Same flow as the PHP edition: POST -> do the work -> 303 back with a flash message.
 * Why not Server Actions: the shared vanilla JS (confirm dialogs, floating bulk bar, dialogs) owns these forms, uploads can be
 * 2 MB, and downloads/JSON replies share one mechanism. Guard = session + CSRF (`_csrf` field or X-CSRF-Token) + capability,
 * then the handler runs inside ctx.run() so the workspace is the one from the server-side session.
 */
import type { AppContext } from '../types.ts';
import type { Cap } from '../types.ts';

/** A message meant for the user (validation). Becomes an error flash on the page the form came from. */
export class UserError extends Error {
  to?: string;
  constructor(message: string, to?: string) {
    super(message);
    this.name = 'UserError';
    this.to = to;
  }
}

export type FormCtx = { ctx: AppContext; fd: FormData; req: Request };
export type FormResult = { to: string; msg?: string; type?: 'ok' | 'err' } | { json: Record<string, unknown>; status?: number };
export type FormRoute = {
  cap: Cap;
  /** Page to return to when the form carries no (valid) `back` field. */
  back: string;
  run(c: FormCtx): Promise<FormResult> | FormResult;
  /** JSON reply (fetch) instead of a redirect; errors are returned as { ok:false, error }. */
  json?: boolean;
};

export const str = (fd: FormData, k: string, d = ''): string => {
  const v = fd.get(k);
  return typeof v === 'string' ? v.trim() : d;
};
/** Value as-is (passwords, HTML): no trimming. */
export const raw = (fd: FormData, k: string): string => {
  const v = fd.get(k);
  return typeof v === 'string' ? v : '';
};
export const arr = (fd: FormData, k: string): string[] => fd.getAll(k).filter((v): v is string => typeof v === 'string');
/** RouterOS item ids only (*1A). */
export const ids = (fd: FormData, k = 'ids'): string[] => arr(fd, k).filter((i) => /^\*[0-9A-Fa-f]+$/.test(i));
export const validId = (id: string): boolean => id === '' || /^\*[0-9A-Fa-f]+$/.test(id);
export const isTrue = (v: unknown): boolean => v === 'true' || v === 'yes';

/** The page the form came from (hidden `back` field) when it is a same-site path, else the default. */
export function backTo(fd: FormData, def: string): string {
  const b = str(fd, 'back');
  return b.length > 0 && b.length <= 500 && b.startsWith('/') && !b.startsWith('//') && !b.includes('\\') && !/[\x00-\x1f]/.test(b) ? b : def;
}

/** Router shared read-only: write controls are not rendered and the driver refuses writes anyway. */
export const isRo = (ctx: AppContext): boolean => !!ctx.router && ctx.router.shared && ctx.router.mode === 'ro';
