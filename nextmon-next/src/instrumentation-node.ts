/**
 * Node-runtime boot hooks.
 *
 * Next 15 route handlers / middleware do not expose the TCP peer address. Client-IP based security (login rate limits, audit, the
 * "trusted proxy" decision for X-Forwarded-For) needs it, so we wrap the HTTP server's 'request' dispatch and stamp the socket's
 * remote address into the request header `x-nextmon-peer`. The header is ALWAYS overwritten (a client-sent value is discarded), so
 * it can be trusted by lib/net.ts. Also closes pooled RouterOS connections on shutdown.
 */
import http from 'node:http';
import type { IncomingMessage } from 'node:http';

export async function registerNode(): Promise<void> {
  const proto = http.Server.prototype as unknown as { emit: (ev: string, ...a: unknown[]) => boolean; __nmPeer?: boolean };
  if (!proto.__nmPeer) {
    proto.__nmPeer = true;
    const orig = proto.emit;
    proto.emit = function (this: unknown, ev: string, ...args: unknown[]) {
      if (ev === 'request') {
        const req = args[0] as IncomingMessage;
        req.headers['x-nextmon-peer'] = req.socket?.remoteAddress ?? 'unknown';
      }
      return orig.call(this, ev, ...args);
    };
  }
  const closeAll = async () => {
    try {
      const { routerPool } = await import('./lib/routeros.ts');
      routerPool().closeAll();
      const { TrafficHub } = await import('./lib/traffic-hub.ts');
      TrafficHub.closeAll();
    } catch {
      /* shutting down */
    }
  };
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sig, () => {
      // a handler suppresses Node's default exit: exit ourselves when nobody else is listening
      void closeAll().finally(() => {
        if (process.listenerCount(sig) === 0) process.exit(0);
      });
    });
  }
}
