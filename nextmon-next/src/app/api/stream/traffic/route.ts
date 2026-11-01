import { Sessions } from '../../../../lib/sessions.ts';
import { IFACE_RE, TrafficHub } from '../../../../lib/traffic-hub.ts';
import type { HubEvent } from '../../../../lib/traffic-hub.ts';
import { singleton } from '../../../../lib/singleton.ts';
import { getContext, sessionToken } from '../../../../server/context.ts';
import { jsonResponse } from '../../../../server/guard.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_PER_SESSION = 6;
const open = singleton('sseCounts', () => new Map<string, number>());

/**
 * GET /api/stream/traffic?interface=ether1  - Server-Sent Events.
 * MikroTik has no WebSocket, but the API socket streams natively: TrafficHub keeps ONE `/interface/monitor-traffic` subscription per
 * (router, interface) and fans samples out to every connected browser. Events: `sample` {t,rx,tx} and `status`.
 * The connection never counts as session activity (idle timeout still applies) and is closed when the session ends.
 */
export async function GET(req: Request): Promise<Response> {
  const ctx = await getContext();
  if (!ctx) return jsonResponse({ ok: false, error: 'unauthenticated' }, 401);
  const iface = new URL(req.url).searchParams.get('interface') ?? 'ether1';
  if (!IFACE_RE.test(iface)) return jsonResponse({ ok: false, error: 'bad interface' }, 400);
  if (!ctx.router) return jsonResponse({ ok: false, error: 'No router configured' }, 404);
  const sid = ctx.session.hash;
  if ((open.get(sid) ?? 0) >= MAX_PER_SESSION) return jsonResponse({ ok: false, error: 'too many streams' }, 429, { 'retry-after': '5' });
  const token = await sessionToken();
  const routerId = ctx.router.id;
  const enc = new TextEncoder();
  let cleanup: () => void = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      open.set(sid, (open.get(sid) ?? 0) + 1);
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed || (controller.desiredSize ?? 1) <= 0) return; // slow client: drop the sample instead of buffering
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      let unsub: () => void = () => {};
      const timers: { hb?: NodeJS.Timeout } = {};
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(timers.hb);
        unsub();
        const n = (open.get(sid) ?? 1) - 1;
        if (n <= 0) open.delete(sid);
        else open.set(sid, n);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      try {
        unsub = ctx.run(() =>
          TrafficHub.subscribe(routerId, iface, (e: HubEvent) => {
            if (e.type === 'sample') send('sample', e.sample);
            else send('status', { state: e.state, error: e.error });
          }),
        );
      } catch (err) {
        send('status', { state: 'error', error: (err as Error).message });
        cleanup();
        return;
      }
      controller.enqueue(enc.encode('retry: 3000\n\n'));
      let beats = 0;
      timers.hb = setInterval(() => {
        if (++beats % 2 === 0 && !Sessions.resolve(token, false)) return cleanup(); // logged out / expired / suspended meanwhile
        if (!closed) controller.enqueue(enc.encode(': ping\n\n'));
      }, 15000);
      req.signal.addEventListener('abort', cleanup);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      'x-accel-buffering': 'no',
      connection: 'keep-alive',
    },
  });
}
