import fs from 'node:fs';
import path from 'node:path';

export const dynamic = 'force-dynamic';

/** Service worker: the shared sw.js with the `BASE` prefix prepended (same as the PHP route). Scope = the whole site. */
export function GET(): Response {
  const file = path.join(process.cwd(), 'public', 'assets', 'js', 'sw.js');
  let src = '';
  try {
    src = fs.readFileSync(file, 'utf8');
  } catch {
    return new Response('// service worker not available', { status: 404, headers: { 'content-type': 'application/javascript' } });
  }
  return new Response('const BASE="";\n' + src, {
    headers: { 'content-type': 'application/javascript; charset=utf-8', 'service-worker-allowed': '/', 'cache-control': 'no-cache' },
  });
}
