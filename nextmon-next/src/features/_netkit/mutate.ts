/**
 * POST router for the write endpoints of a feature: /api/json/<feature>/<sub/path>. The guard (session, CSRF header, capability,
 * rate limit, workspace context) is applied by runApi(); the browser side is public/assets/next/net-forms.js, which posts the
 * <form data-api="..."> as FormData, shows the toast from `message` and reloads the page after a successful change.
 */
import { HttpError } from '../../server/guard.ts';
import type { ApiRoute, AppContext, Cap } from '../types.ts';
import { fail, formOf } from './util.ts';
import type { Reply } from './util.ts';

export type Action = { cap?: Cap; run: (ctx: AppContext, fd: FormData, req: Request) => Promise<Reply | Response> | Reply | Response };

export function writeRoute(actions: Record<string, Action | Action['run']>, opts: { cap?: Cap; getCap?: Cap; get?: ApiRoute['GET'] } = {}): ApiRoute {
  const cap = opts.cap ?? 'write';
  return {
    cap,
    caps: opts.get ? { GET: opts.getCap ?? 'view' } : undefined,
    GET: opts.get,
    async POST(ctx, req, rest) {
      const a = actions[rest.join('/')];
      if (!a) return fail('not found');
      const def: Action = typeof a === 'function' ? { run: a } : a;
      if (def.cap && !ctx.can(def.cap)) throw new HttpError(403, 'Forbidden');
      const out = await def.run(ctx, await formOf(req), req);
      return out instanceof Response ? out : { ...out };
    },
  };
}
