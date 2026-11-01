/**
 * TrafficHub - the realtime design: MikroTik has no WebSocket, but the API socket streams natively. For every
 * (router, interface) we open ONE `/interface/monitor-traffic` stream on the router (without `once`) and fan each sample out to ALL
 * browser clients (SSE routes subscribe here). The upstream is cancelled (/cancel) a few seconds after the last subscriber leaves,
 * restarted with exponential backoff when it dies, and restarted when it stalls. A shared router (several workspaces) shares one
 * upstream: the key uses the OWNER workspace of the router.
 */
import { Routers } from './routers.ts';
import type { Driver, StreamHandle } from './driver.ts';
import { singleton } from './singleton.ts';

export type Sample = { t: number; rx: number; tx: number };
export type HubEvent = { type: 'sample'; sample: Sample } | { type: 'status'; state: 'live' | 'reconnecting'; error?: string };
type Listener = (e: HubEvent) => void;

type Entry = {
  key: string;
  routerId: string;
  iface: string;
  driver: Driver;
  subs: Set<Listener>;
  handle: StreamHandle | null;
  last: Sample | null;
  retry: NodeJS.Timeout | null;
  closeTimer: NodeJS.Timeout | null;
  stallTimer: NodeJS.Timeout | null;
  fails: number;
  opened: number;
  rows: number;
  lastRowAt: number;
  error: string;
};

const GRACE_MS = 3000;
const STALL_MS = 10000;

export const IFACE_RE = /^[A-Za-z0-9_.\-]{1,40}$/;

class Hub {
  private entries = new Map<string, Entry>();

  /** Subscribe to samples of one interface of the router visible to the ACTIVE workspace (call inside a workspace context). */
  subscribe(routerId: string, iface: string, cb: Listener): () => void {
    if (!IFACE_RE.test(iface)) throw new Error('bad interface name');
    const rv = Routers.get(routerId);
    if (!rv) throw new Error('Unknown router');
    const key = `${rv.owner}:${rv.id}:${iface}`;
    let e = this.entries.get(key);
    if (!e) {
      e = { key, routerId, iface, driver: Routers.driver(routerId), subs: new Set(), handle: null, last: null, retry: null, closeTimer: null, stallTimer: null, fails: 0, opened: 0, rows: 0, lastRowAt: 0, error: '' };
      this.entries.set(key, e);
    }
    if (e.closeTimer) {
      clearTimeout(e.closeTimer);
      e.closeTimer = null;
    }
    e.subs.add(cb);
    if (e.last) cb({ type: 'sample', sample: e.last });
    if (!e.handle && !e.retry) this.open(e);
    const entry = e;
    return () => {
      entry.subs.delete(cb);
      if (entry.subs.size === 0 && !entry.closeTimer) entry.closeTimer = setTimeout(() => this.close(entry), GRACE_MS);
    };
  }

  private emit(e: Entry, ev: HubEvent): void {
    for (const cb of [...e.subs]) {
      try {
        cb(ev);
      } catch {
        e.subs.delete(cb);
      }
    }
  }

  private open(e: Entry): void {
    if (e.handle || !e.subs.size) return;
    e.opened++;
    e.lastRowAt = Date.now();
    this.armStall(e);
    let h: StreamHandle;
    try {
      h = e.driver.stream('/interface/monitor-traffic', { interface: e.iface }, {
        onRow: (row) => {
          e.rows++;
          e.lastRowAt = Date.now();
          e.fails = 0;
          if (e.error) {
            e.error = '';
            this.emit(e, { type: 'status', state: 'live' });
          }
          const s: Sample = { t: Date.now(), rx: Number(row['rx-bits-per-second']) || 0, tx: Number(row['tx-bits-per-second']) || 0 };
          e.last = s;
          this.emit(e, { type: 'sample', sample: s });
        },
        onEnd: (err) => {
          if (e.handle === h) e.handle = null;
          this.disarmStall(e);
          if (!e.subs.size) return;
          e.error = err?.message ?? 'stream ended';
          e.fails++;
          this.emit(e, { type: 'status', state: 'reconnecting', error: e.error });
          const wait = Math.min(15000, 1000 * 2 ** Math.min(e.fails - 1, 4));
          e.retry = setTimeout(() => {
            e.retry = null;
            this.open(e);
          }, wait);
          e.retry.unref?.();
        },
      });
    } catch (err) {
      e.error = (err as Error).message;
      e.fails++;
      this.emit(e, { type: 'status', state: 'reconnecting', error: e.error });
      e.retry = setTimeout(() => {
        e.retry = null;
        this.open(e);
      }, 5000);
      return;
    }
    e.handle = h;
  }

  private armStall(e: Entry): void {
    this.disarmStall(e);
    e.stallTimer = setInterval(() => {
      if (e.handle && Date.now() - e.lastRowAt > STALL_MS) {
        const h = e.handle;
        void h.cancel(); // onEnd fires -> backoff + reopen
      }
    }, 2500);
    e.stallTimer.unref?.();
  }
  private disarmStall(e: Entry): void {
    if (e.stallTimer) clearInterval(e.stallTimer);
    e.stallTimer = null;
  }

  private close(e: Entry): void {
    if (e.subs.size) return;
    this.disarmStall(e);
    if (e.retry) clearTimeout(e.retry);
    e.retry = null;
    e.closeTimer = null;
    const h = e.handle;
    e.handle = null;
    this.entries.delete(e.key);
    if (h) void h.cancel();
  }

  /** Diagnostics: one row per upstream stream. */
  stats(): { key: string; subscribers: number; upstreamOpen: boolean; opened: number; rows: number; lastRowAt: number; error: string }[] {
    return [...this.entries.values()].map((e) => ({ key: e.key, subscribers: e.subs.size, upstreamOpen: !!e.handle, opened: e.opened, rows: e.rows, lastRowAt: e.lastRowAt, error: e.error }));
  }

  closeAll(): void {
    for (const e of [...this.entries.values()]) {
      e.subs.clear();
      this.close(e);
    }
  }
}

export const TrafficHub = singleton('trafficHub', () => new Hub());
