/**
 * Session-authenticated twins of the /api/v1 resources (PHP ApiController serves both from one switch): /json/users, profiles,
 * active, sales, vouchers, kick. Reads need `view`; vouchers/kick are POST and need `write` (checked inside resource(), same
 * error text as the PHP edition). `?router=ID` may pick another router of THIS workspace (unknown id: 404).
 */
import { readBody, resource } from '../../lib/api-v1.ts';
import { Routers } from '../../lib/routers.ts';
import { jsonResponse } from '../../server/guard.ts';
import type { ApiRoute } from '../types.ts';

const make = (name: string): ApiRoute => {
  const handler: ApiRoute['GET'] = async (ctx, req) => {
    const rid = new URL(req.url).searchParams.get('router') || ctx.router?.id || '';
    if (!rid || !Routers.get(rid)) return jsonResponse({ ok: false, error: 'unknown router' }, 404);
    const out = await resource(name, req, Routers.driver(rid), rid, await readBody(req), ctx.can('write'), ctx.workspace.id);
    return out;
  };
  return { cap: 'view', GET: handler, POST: handler };
};

export const restApi: Record<string, ApiRoute> = Object.fromEntries(['users', 'profiles', 'active', 'sales', 'vouchers', 'kick'].map((n) => [n, make(n)]));
