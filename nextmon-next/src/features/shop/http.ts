/**
 * Outbound HTTP for payment gateways and notification webhooks. EVERY call goes through Net.checkOutboundUrl (SSRF guard: public
 * addresses only) and the connection is PINNED to the vetted address (defeats DNS rebinding). Redirects are never followed.
 * Tests replace `Http.request` to simulate a gateway.
 */
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { Net } from '../../lib/net.ts';

export class GatewayError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'GatewayError';
  }
}

export type HttpResult = { status: number; json: Record<string, unknown> | null; raw: string };
export type HttpOpts = { headers?: Record<string, string>; body?: string; basicUser?: string; timeoutMs?: number };

const MAX_BODY = 1024 * 1024;

async function pinnedRequest(method: string, url: string, o: HttpOpts = {}): Promise<HttpResult> {
  const chk = await Net.checkOutboundUrl(url);
  if (!chk.ok) throw new GatewayError('Blocked outbound URL: ' + chk.error);
  const u = chk.url;
  const addr = chk.addresses[0]!;
  const fam = isIP(addr) === 6 ? 6 : 4;
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.basicUser !== undefined) headers.Authorization = 'Basic ' + Buffer.from(o.basicUser + ':').toString('base64');
  if (o.body !== undefined) headers['Content-Length'] = String(Buffer.byteLength(o.body));
  const lib = u.protocol === 'https:' ? https : http;
  return new Promise<HttpResult>((resolve, reject) => {
    const req = lib.request(
      {
        method,
        hostname: u.hostname.replace(/^\[|\]$/g, ''),
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        headers,
        timeout: o.timeoutMs ?? 20000,
        // connect to the address we validated, never re-resolve
        lookup: ((_h: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) => (opts?.all ? cb(null, [{ address: addr, family: fam }]) : cb(null, addr, fam))) as never,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > MAX_BODY) {
            req.destroy(new GatewayError('Gateway response too large'));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json: Record<string, unknown> | null = null;
          try {
            const j = JSON.parse(raw);
            if (j && typeof j === 'object' && !Array.isArray(j)) json = j as Record<string, unknown>;
          } catch {
            /* not JSON */
          }
          resolve({ status: res.statusCode ?? 0, json, raw });
        });
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new GatewayError('Gateway timed out')));
    req.on('error', (e) => reject(e instanceof GatewayError ? e : new GatewayError('Gateway unreachable: ' + e.message)));
    if (o.body !== undefined) req.write(o.body);
    req.end();
  });
}

export const Http = {
  request: pinnedRequest as (method: string, url: string, o?: HttpOpts) => Promise<HttpResult>,
};
