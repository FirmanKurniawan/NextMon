/**
 * Driver: the one contract every RouterOS caller programs against (same spirit as PHP Driver.php + Pipe.php).
 * Implementations: RealDriver (driver-real.ts, RouterOS API), DemoDriver (demo.ts, in-memory mock), and the decorators below:
 *   ReadOnlyDriver  - shared router with mode `ro`: every write is refused (enforced here, not in the UI)
 *   CachedDriver    - short TTL read-through cache; ANY write through it bumps the router's cache generation
 * Paths look like "/ip/hotspot/user" (spaces are accepted too and normalised).
 */
import { Cache } from './cache.ts';
import { RouterOSError } from './routeros.ts';
import type { Attrs, Row, StreamHandle, StreamHandlers } from './routeros.ts';

export type { Attrs, Row, StreamHandle, StreamHandlers };
export { RouterOSError };

export type PrintReq = [path: string, query?: Attrs, props?: string[]];
export type TryAdd = { id: string; err: string | null };
export type TrySet = { err: string | null };

export interface Driver {
  readonly demo: boolean;
  /** List rows. `query` = equality filters (AND), `props` = limit the returned fields. */
  print(path: string, query?: Attrs, props?: string[]): Promise<Row[]>;
  /** Add a row, returns the new .id */
  add(path: string, attrs: Attrs): Promise<string>;
  /** Update the row with .id (or name) = id */
  set(path: string, id: string, attrs: Attrs): Promise<void>;
  /** Remove the row with .id = id */
  remove(path: string, id: string): Promise<void>;
  /** Run any other command, e.g. /tool/ping, /system/backup/save */
  command(path: string, attrs?: Attrs, query?: Attrs): Promise<Row[]>;
  /** N independent prints in ONE round trip (pipelined on a real router). */
  printMany(reqs: Record<string, PrintReq>): Promise<Record<string, Row[]>>;
  /** Pipelined adds; throws the first error after the rest were sent. */
  addMany(path: string, rows: Attrs[]): Promise<string[]>;
  /** Pipelined adds that never throw per row (bulk import). */
  addTry(path: string, rows: Attrs[]): Promise<TryAdd[]>;
  setMany(path: string, changes: [id: string, attrs: Attrs][]): Promise<void>;
  setTry(path: string, changes: [id: string, attrs: Attrs][]): Promise<TrySet[]>;
  removeMany(path: string, ids: string[]): Promise<void>;
  commandMany(path: string, attrsList: Attrs[]): Promise<void>;
  /** Never-ending command (monitor-traffic, torch, log follow). Rows arrive via h.onRow; cancel() stops it. */
  stream(path: string, attrs: Attrs, h: StreamHandlers): StreamHandle;
  close(): void;
}

export const normPath = (p: string): string => '/' + p.trim().replace(/\s+/g, '/').replace(/^\/+|\/+$/g, '');

/** Sequential defaults for the batch helpers; subclasses override with real pipelining. */
export abstract class BaseDriver implements Driver {
  abstract readonly demo: boolean;
  abstract print(path: string, query?: Attrs, props?: string[]): Promise<Row[]>;
  abstract add(path: string, attrs: Attrs): Promise<string>;
  abstract set(path: string, id: string, attrs: Attrs): Promise<void>;
  abstract remove(path: string, id: string): Promise<void>;
  abstract command(path: string, attrs?: Attrs, query?: Attrs): Promise<Row[]>;
  abstract stream(path: string, attrs: Attrs, h: StreamHandlers): StreamHandle;
  close(): void {}

  async printMany(reqs: Record<string, PrintReq>): Promise<Record<string, Row[]>> {
    const out: Record<string, Row[]> = {};
    for (const [k, q] of Object.entries(reqs)) out[k] = await this.print(q[0], q[1] ?? {}, q[2] ?? []);
    return out;
  }
  async addMany(path: string, rows: Attrs[]): Promise<string[]> {
    const ids: string[] = [];
    for (const r of rows) ids.push(await this.add(path, r));
    return ids;
  }
  async addTry(path: string, rows: Attrs[]): Promise<TryAdd[]> {
    const out: TryAdd[] = [];
    for (const r of rows) {
      try {
        out.push({ id: await this.add(path, r), err: null });
      } catch (e) {
        if (!(e instanceof RouterOSError)) throw e;
        out.push({ id: '', err: e.message });
      }
    }
    return out;
  }
  async setMany(path: string, changes: [string, Attrs][]): Promise<void> {
    for (const [id, a] of changes) await this.set(path, id, a);
  }
  async setTry(path: string, changes: [string, Attrs][]): Promise<TrySet[]> {
    const out: TrySet[] = [];
    for (const [id, a] of changes) {
      try {
        await this.set(path, id, a);
        out.push({ err: null });
      } catch (e) {
        if (!(e instanceof RouterOSError)) throw e;
        out.push({ err: e.message });
      }
    }
    return out;
  }
  async removeMany(path: string, ids: string[]): Promise<void> {
    for (const id of ids) await this.remove(path, id);
  }
  async commandMany(path: string, attrsList: Attrs[]): Promise<void> {
    for (const a of attrsList) await this.command(path, a);
  }
}

/** Last path segments of commands that never change router state. */
export const READONLY_CMD = new Set(['monitor-traffic', 'ping', 'print', 'getall', 'torch', 'resolve', 'traceroute', 'bandwidth-test']);
const lastSeg = (p: string) => normPath(p).split('/').pop() ?? '';
export const isReadOnlyCommand = (path: string, attrs: Attrs = {}): boolean =>
  READONLY_CMD.has(lastSeg(path)) || (lastSeg(path) === 'export' && !('file' in attrs));

// ---- ReadOnly ---------------------------------------------------------------------------------------

export class ReadOnlyDriver extends BaseDriver {
  readonly inner: Driver;
  constructor(inner: Driver) {
    super();
    this.inner = inner;
  }
  get demo(): boolean {
    return this.inner.demo;
  }
  private err(): RouterOSError {
    return new RouterOSError('This router is shared read-only: changes are not allowed.');
  }
  /** rejected promise (never a synchronous throw) so callers can use await/try or .catch uniformly */
  private deny(): Promise<never> {
    return Promise.reject(this.err());
  }
  print(path: string, query?: Attrs, props?: string[]) {
    return this.inner.print(path, query, props);
  }
  override printMany(reqs: Record<string, PrintReq>) {
    return this.inner.printMany(reqs);
  }
  add(): Promise<string> {
    return this.deny();
  }
  set(): Promise<void> {
    return this.deny();
  }
  remove(): Promise<void> {
    return this.deny();
  }
  override addMany(): Promise<string[]> {
    return this.deny();
  }
  override addTry(): Promise<TryAdd[]> {
    return this.deny();
  }
  override setMany(): Promise<void> {
    return this.deny();
  }
  override setTry(): Promise<TrySet[]> {
    return this.deny();
  }
  override removeMany(): Promise<void> {
    return this.deny();
  }
  override commandMany(path: string, list: Attrs[]): Promise<void> {
    if (!list.every((a) => isReadOnlyCommand(path, a))) return this.deny();
    return this.inner.commandMany(path, list);
  }
  command(path: string, attrs: Attrs = {}, query?: Attrs): Promise<Row[]> {
    if (!isReadOnlyCommand(path, attrs)) return this.deny();
    return this.inner.command(path, attrs, query);
  }
  stream(path: string, attrs: Attrs, h: StreamHandlers): StreamHandle {
    if (!isReadOnlyCommand(path, attrs)) throw this.err();
    return this.inner.stream(path, attrs, h);
  }
  override close(): void {
    this.inner.close();
  }
}

// ---- Cached -----------------------------------------------------------------------------------------

/** path => ttl seconds (same table as the PHP edition) */
export const CACHE_TTL: Record<string, number> = {
  '/system/resource': 3,
  '/system/health': 5,
  '/system/identity': 300,
  '/ip/hotspot/active': 3,
  '/ip/hotspot/host': 4,
  '/ip/hotspot/user': 8,
  '/ip/hotspot/user/profile': 30,
  '/ip/hotspot': 60,
  '/ip/hotspot/ip-binding': 6,
  '/interface': 20,
  '/queue/simple': 6,
  '/log': 4,
};

/**
 * Read-through cache in front of a remote Driver. Keys = namespace (workspace + router) + path + query + props, so tenants can never
 * see each other's entries. ANY write through this wrapper bumps the namespace generation, which invalidates every cached read of
 * that router at once; entries remember the generation current when their fetch STARTED, so a read racing a write can never
 * resurrect old data. Disable with NEXTMON_RCACHE=0.
 */
export class CachedDriver extends BaseDriver {
  readonly inner: Driver;
  readonly ns: string;
  constructor(inner: Driver, ns: string) {
    super();
    this.inner = inner;
    this.ns = ns;
  }
  get demo(): boolean {
    return this.inner.demo;
  }
  static enabled(): boolean {
    return process.env.NEXTMON_RCACHE !== '0';
  }
  /** Invalidate every cached read of a router namespace (also callable by code that wrote to the router by other means). */
  static flush(ns: string): void {
    Cache.bump(ns);
  }
  private key(path: string, query: Attrs, props: string[]): string {
    return `rd|${this.ns}|${normPath(path)}|${JSON.stringify(query)}|${JSON.stringify(props)}`;
  }
  private ttl(path: string): number {
    return CachedDriver.enabled() && !this.inner.demo ? (CACHE_TTL[normPath(path)] ?? 0) : 0;
  }
  async print(path: string, query: Attrs = {}, props: string[] = []): Promise<Row[]> {
    const ttl = this.ttl(path);
    if (!ttl) return this.inner.print(path, query, props);
    return Cache.remember(this.key(path, query, props), ttl, () => this.inner.print(path, query, props), this.ns);
  }
  override async printMany(reqs: Record<string, PrintReq>): Promise<Record<string, Row[]>> {
    const out: Record<string, Row[]> = {};
    const miss: Record<string, PrintReq> = {};
    const gen = Cache.gen(this.ns); // read BEFORE fetching
    for (const [k, q] of Object.entries(reqs)) {
      const ttl = this.ttl(q[0]);
      const hit = ttl ? Cache.get<Row[]>(this.key(q[0], q[1] ?? {}, q[2] ?? []), this.ns) : undefined;
      if (hit) out[k] = hit;
      else miss[k] = q;
    }
    if (Object.keys(miss).length) {
      const got = await this.inner.printMany(miss);
      for (const [k, rows] of Object.entries(got)) {
        out[k] = rows;
        const q = miss[k]!;
        const ttl = this.ttl(q[0]);
        if (ttl) Cache.set(this.key(q[0], q[1] ?? {}, q[2] ?? []), rows, ttl, this.ns, gen);
      }
    }
    return Object.fromEntries(Object.keys(reqs).map((k) => [k, out[k]!]));
  }

  private async written<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } finally {
      Cache.bump(this.ns); // even a failed write may have partly applied
    }
  }
  add(path: string, attrs: Attrs) {
    return this.written(() => this.inner.add(path, attrs));
  }
  set(path: string, id: string, attrs: Attrs) {
    return this.written(() => this.inner.set(path, id, attrs));
  }
  remove(path: string, id: string) {
    return this.written(() => this.inner.remove(path, id));
  }
  override addMany(path: string, rows: Attrs[]) {
    return this.written(() => this.inner.addMany(path, rows));
  }
  override addTry(path: string, rows: Attrs[]) {
    return this.written(() => this.inner.addTry(path, rows));
  }
  override setMany(path: string, c: [string, Attrs][]) {
    return this.written(() => this.inner.setMany(path, c));
  }
  override setTry(path: string, c: [string, Attrs][]) {
    return this.written(() => this.inner.setTry(path, c));
  }
  override removeMany(path: string, ids: string[]) {
    return this.written(() => this.inner.removeMany(path, ids));
  }
  override commandMany(path: string, l: Attrs[]) {
    return this.written(() => this.inner.commandMany(path, l));
  }
  command(path: string, attrs: Attrs = {}, query?: Attrs) {
    if (isReadOnlyCommand(path, attrs)) return this.inner.command(path, attrs, query);
    return this.written(() => this.inner.command(path, attrs, query));
  }
  stream(path: string, attrs: Attrs, h: StreamHandlers) {
    return this.inner.stream(path, attrs, h);
  }
  override close(): void {
    this.inner.close();
  }
}
