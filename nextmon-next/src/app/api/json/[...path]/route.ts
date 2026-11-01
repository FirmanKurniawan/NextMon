import { Features } from '../../../../features/registry.ts';
import type { ApiRoute } from '../../../../features/types.ts';
import { jsonResponse, runApi } from '../../../../server/guard.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Dispatcher for every feature API: /api/json/<name>[/rest...] (also reachable as /json/<name> through a rewrite, which is what
 * the shared pages.js calls). Session, CSRF (non-GET), capability, rate limit and workspace context are applied by runApi().
 */
async function handle(req: Request, { params }: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await params;
  const route: ApiRoute | null = Features.apiRoute(path[0] ?? '');
  const method = req.method as Method;
  const h = route?.[method];
  if (!route) return jsonResponse({ ok: false, error: 'not found' }, 404);
  if (!h) return jsonResponse({ ok: false, error: 'method not allowed' }, 405, { allow: (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as Method[]).filter((m) => route[m]).join(', ') });
  return runApi({ cap: route.caps?.[method] ?? route.cap }, req, path.slice(1).map(decodeURIComponent), h);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
