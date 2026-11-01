import { Env } from '../../../lib/env.ts';
import { Users } from '../../../lib/users.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Liveness/readiness for the launcher, Docker and reverse proxies. No tenant data. */
export async function GET(): Promise<Response> {
  let db = 'ok';
  let setup = false;
  try {
    setup = !Users.hasUsers();
  } catch {
    db = 'error';
  }
  return Response.json({ ok: db === 'ok', app: 'nextmon-next', db, setup_required: setup, demo: Env.demoForced() }, { status: db === 'ok' ? 200 : 503, headers: { 'cache-control': 'no-store' } });
}
