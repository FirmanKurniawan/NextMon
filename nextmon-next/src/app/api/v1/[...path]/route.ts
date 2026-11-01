import { handleV1 } from '../../../../lib/api-v1.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * /api/v1/* - API-key authenticated REST (see lib/api-v1.ts). NOTE: src/middleware.ts must list '/api/v1/' as public (no session
 * cookie); the key check happens in handleV1. Session/CSRF are intentionally not used here.
 */
async function handle(req: Request, { params }: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await params;
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'method not allowed' }), { status: 405, headers: { 'content-type': 'application/json', allow: 'GET, POST' } });
  }
  return handleV1(req, path.map(decodeURIComponent));
}

export const GET = handle;
export const POST = handle;
