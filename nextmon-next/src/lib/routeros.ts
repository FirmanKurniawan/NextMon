/**
 * RouterOS API client (plain 8728 / TLS 8729) over node:net / node:tls.
 * Protocol: https://help.mikrotik.com/docs/spaces/ROS/pages/47579160/API
 *
 *  - word length encoding (1-5 byte prefix), sentences end with an empty word, incremental parser (partial TCP reads are fine)
 *  - login: v6.43+ plain `/login =name= =password=`; falls back to the legacy MD5 challenge when the router answers `=ret=<hex>`
 *  - replies !re / !done / !trap / !fatal / !empty (v7.18+); a !trap fails the command AFTER its !done (the stream stays in sync)
 *  - TAGS + PIPELINING: any number of commands share one socket concurrently, replies are demultiplexed by `.tag`
 *  - STREAMING: commands that never end (`/interface/monitor-traffic`, `/tool/torch`, `/log/print follow`) via stream(), cancelled
 *    with `/cancel =tag=` (the router then answers !trap interrupted + !done, which is not an error)
 *  - hard limits: word size, sentence size, bytes and rows per reply, per-command timeout (+ best-effort /cancel), watchdog for a
 *    connection that goes silent while commands are pending
 *  - RouterLink / RouterPool: one lazily-connected, shared connection per router with idle close, TCP keepalive, reconnect on next use
 *    and a circuit breaker (after a failed connect/login further attempts fail instantly for a few seconds)
 *
 * NOTE: verified against the in-repo fake RouterOS server (tests/fixtures/fake-routeros.ts); never against a real device from here.
 */
import crypto from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';
import { singleton } from './singleton.ts';

export type Row = Record<string, string>;
export type Attrs = Record<string, string | number | boolean>;

export class RouterOSError extends Error {
  /** `category` of the !trap, when the router sent one */
  category?: string;
  /** connection-level failure (closed, timeout, !fatal, breaker): the command may not have reached the router */
  connection: boolean;
  constructor(message: string, opts: { category?: string; connection?: boolean } = {}) {
    super(message);
    this.name = 'RouterOSError';
    this.category = opts.category;
    this.connection = opts.connection ?? false;
  }
}

export const LIMITS = {
  MAX_WORD: 8 * 1024 * 1024,
  MAX_SENTENCE: 16 * 1024 * 1024,
  MAX_WORDS: 8192,
  MAX_REPLY: 64 * 1024 * 1024,
  MAX_ROWS: 200_000,
  PIPE_CHUNK: 100,
};

// ---- word encoding ---------------------------------------------------------------------------------

export function encodeLength(n: number): Buffer {
  if (n < 0 || !Number.isInteger(n) || n > 0xffffffff) throw new RangeError('bad length');
  if (n < 0x80) return Buffer.from([n]);
  if (n < 0x4000) return Buffer.from([(n >> 8) | 0x80, n & 0xff]);
  if (n < 0x200000) return Buffer.from([(n >> 16) | 0xc0, (n >> 8) & 0xff, n & 0xff]);
  if (n < 0x10000000) return Buffer.from([(n >>> 24) | 0xe0, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
  const b = Buffer.alloc(5);
  b[0] = 0xf0;
  b.writeUInt32BE(n, 1);
  return b;
}

/** Bytes needed by the length prefix starting with `first`. */
const prefixSize = (first: number): number => (first < 0x80 ? 1 : first < 0xc0 ? 2 : first < 0xe0 ? 3 : first < 0xf0 ? 4 : 5);

/** Decode a length prefix at buf[0..]; caller guarantees buf holds prefixSize(buf[0]) bytes. */
export function decodeLength(buf: Buffer): number {
  const f = buf[0]!;
  if (f < 0x80) return f;
  if (f < 0xc0) return ((f & 0x3f) << 8) | buf[1]!;
  if (f < 0xe0) return ((f & 0x1f) << 16) | (buf[1]! << 8) | buf[2]!;
  if (f < 0xf0) return ((f & 0x0f) << 24) | (buf[1]! << 16) | (buf[2]! << 8) | buf[3]!;
  return buf.readUInt32BE(1);
}

export function encodeSentence(words: string[]): Buffer {
  const parts: Buffer[] = [];
  for (const w of words) {
    const b = Buffer.from(w, 'utf8');
    parts.push(encodeLength(b.length), b);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

/** Incremental sentence parser: feed TCP chunks, get complete sentences (arrays of words). Linear time even for huge words. */
export class SentenceParser {
  private chunks: Buffer[] = [];
  private avail = 0;
  private need = 1; // bytes that must be buffered before the next parsing attempt
  private words: string[] = [];
  private sentenceBytes = 0;
  private maxWord: number;
  private maxSentence: number;
  /** total bytes consumed since construction (for the stall watchdog) */
  total = 0;

  constructor(maxWord = LIMITS.MAX_WORD, maxSentence = LIMITS.MAX_SENTENCE) {
    this.maxWord = maxWord;
    this.maxSentence = maxSentence;
  }

  push(chunk: Buffer): string[][] {
    this.chunks.push(chunk);
    this.avail += chunk.length;
    this.total += chunk.length;
    const out: string[][] = [];
    if (this.avail < this.need) return out;
    let buf = this.chunks.length === 1 ? this.chunks[0]! : Buffer.concat(this.chunks);
    let pos = 0;
    for (;;) {
      const rest = buf.length - pos;
      if (rest < 1) {
        this.need = 1;
        break;
      }
      const ps = prefixSize(buf[pos]!);
      if (rest < ps) {
        this.need = ps; // bytes (relative to the first unconsumed byte) needed to read the length prefix
        break;
      }
      const len = decodeLength(buf.subarray(pos, pos + ps));
      if (len > this.maxWord) throw new RouterOSError(`Router sent an oversized word (${len} bytes)`, { connection: true });
      if (len === 0) {
        pos += ps;
        if (this.words.length) out.push(this.words);
        this.words = [];
        this.sentenceBytes = 0;
        continue;
      }
      if (rest < ps + len) {
        this.need = ps + len;
        break;
      }
      this.sentenceBytes += len;
      if (this.sentenceBytes > this.maxSentence || this.words.length >= LIMITS.MAX_WORDS) {
        throw new RouterOSError('Router sent an oversized sentence', { connection: true });
      }
      this.words.push(buf.toString('utf8', pos + ps, pos + ps + len));
      pos += ps + len;
    }
    buf = pos ? buf.subarray(pos) : buf;
    this.chunks = buf.length ? [buf] : [];
    this.avail = buf.length;
    // need is relative to the start of the (new) buffer
    return out;
  }
}

// ---- commands --------------------------------------------------------------------------------------

export type Command = {
  /** API path with slashes, e.g. /ip/hotspot/user/print */
  path: string;
  attrs?: Attrs;
  /** equality filters, sent as ?name=value (ANDed by RouterOS) */
  query?: Attrs;
  /** `.proplist` */
  props?: string[];
};

const PATH_RE = /^\/[A-Za-z0-9/_.-]{1,200}$/;
const NAME_RE = /^[A-Za-z0-9_.-]{1,80}$/;

const val = (v: string | number | boolean): string => (v === true ? 'yes' : v === false ? 'no' : String(v));

/** Command -> API words. Refuses names/paths that could smuggle extra words; values are length-prefixed so they can hold anything. */
export function buildWords(c: Command, tag?: string): string[] {
  if (!PATH_RE.test(c.path) || c.path.includes('//') || c.path.includes('..')) throw new RouterOSError('Invalid command path: ' + c.path.slice(0, 60));
  const w = [c.path];
  for (const [k, v] of Object.entries(c.attrs ?? {})) {
    if (!NAME_RE.test(k)) throw new RouterOSError('Invalid attribute name: ' + k.slice(0, 40));
    if (v === undefined) continue;
    w.push(`=${k}=${val(v)}`);
  }
  if (c.props?.length) {
    const p = c.props.map((x) => x.trim());
    if (p.some((x) => !NAME_RE.test(x))) throw new RouterOSError('Invalid property name');
    w.push(`=.proplist=${[...new Set(['.id', ...p])].join(',')}`);
  }
  for (const [k, v] of Object.entries(c.query ?? {})) {
    if (!NAME_RE.test(k)) throw new RouterOSError('Invalid query name: ' + k.slice(0, 40));
    w.push(`?${k}=${val(v)}`);
  }
  if (tag) w.push(`.tag=${tag}`);
  return w;
}

function parseAttrs(words: string[], from = 1): Row {
  const o: Row = {};
  for (let i = from; i < words.length; i++) {
    const w = words[i]!;
    if (w.charCodeAt(0) !== 61 /* = */) {
      if (w.startsWith('.tag=')) o['.tag'] = w.slice(5);
      continue;
    }
    const p = w.indexOf('=', 1);
    if (p < 0) o[w.slice(1)] = '';
    else o[w.slice(1, p)] = w.slice(p + 1);
  }
  return o;
}

export type Reply = { rows: Row[]; done: Row };
export type Settled = { reply: Reply; error?: undefined } | { error: Error; reply?: undefined };

export type StreamHandlers = {
  onRow(row: Row): void;
  /** called exactly once; err is set when the stream ended abnormally (not when you cancelled it) */
  onEnd?(err?: Error): void;
};
export type StreamHandle = { cancel(): Promise<void>; readonly done: Promise<void> };

export type ClientOptions = {
  host: string;
  port?: number;
  tls?: boolean;
  verifyTls?: boolean;
  user: string;
  password: string;
  timeoutMs?: number;
  connectTimeoutMs?: number;
  /** a connection with pending commands that receives nothing for this long is declared dead */
  watchdogMs?: number;
  keepAliveMs?: number;
};

type Pending = {
  tag: string;
  rows: Row[];
  traps: { message: string; category?: string }[];
  bytes: number;
  resolve(r: Reply): void;
  reject(e: Error): void;
  timer: NodeJS.Timeout | null;
  onRow?: (row: Row) => void;
  stream: boolean;
  cancelled: boolean;
  settled: boolean;
};

export class RouterOSClient {
  readonly opts: Required<Omit<ClientOptions, 'password'>> & { password: string };
  private sock: net.Socket | null = null;
  private parser = new SentenceParser();
  private pending = new Map<string, Pending>();
  private seq = 0;
  private connecting: Promise<void> | null = null;
  private closed = true;
  private lastRx = 0;
  private watchdog: NodeJS.Timeout | null = null;
  /** number of commands completed on this socket (RouterLink uses it to decide whether a retry is safe) */
  served = 0;
  lastUsed = Date.now();

  constructor(o: ClientOptions) {
    this.opts = {
      host: o.host,
      port: o.port ?? (o.tls ? 8729 : 8728),
      tls: o.tls ?? false,
      verifyTls: o.verifyTls ?? false,
      user: o.user,
      password: o.password,
      timeoutMs: o.timeoutMs ?? 8000,
      connectTimeoutMs: o.connectTimeoutMs ?? 5000,
      watchdogMs: o.watchdogMs ?? 30000,
      keepAliveMs: o.keepAliveMs ?? 30000,
    };
  }

  get connected(): boolean {
    return !this.closed && !!this.sock && !this.connecting;
  }
  get inflight(): number {
    return this.pending.size;
  }
  get streams(): number {
    let n = 0;
    for (const p of this.pending.values()) if (p.stream) n++;
    return n;
  }

  /** Connect + login (idempotent; concurrent callers share one attempt). */
  connect(): Promise<void> {
    if (this.connected) return Promise.resolve();
    this.connecting ??= this.doConnect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async doConnect(): Promise<void> {
    this.destroySocket(new RouterOSError('Reconnecting', { connection: true }));
    const o = this.opts;
    const sock = await new Promise<net.Socket>((resolve, reject) => {
      let s: net.Socket;
      const fail = (e: Error) => {
        clearTimeout(t);
        s?.destroy();
        reject(new RouterOSError(`Cannot connect to ${o.host}:${o.port}: ${(e as NodeJS.ErrnoException).code ?? e.message}`, { connection: true }));
      };
      const ok = () => {
        clearTimeout(t);
        s.removeListener('error', fail);
        resolve(s);
      };
      const t = setTimeout(() => fail(new Error('timeout')), o.connectTimeoutMs);
      if (o.tls) {
        const base: tls.ConnectionOptions = { host: o.host, port: o.port, rejectUnauthorized: o.verifyTls, servername: net.isIP(o.host) ? undefined : o.host };
        // RouterOS API-SSL without a certificate negotiates anonymous DH, which OpenSSL 3 only allows at security level 0
        if (!o.verifyTls) base.ciphers = 'DEFAULT:ADH:AECDH:@SECLEVEL=0';
        try {
          s = tls.connect(base, ok);
        } catch {
          s = tls.connect({ ...base, ciphers: undefined }, ok);
        }
      } else {
        s = net.connect({ host: o.host, port: o.port }, ok);
      }
      s.once('error', fail);
    });
    sock.setNoDelay(true);
    sock.setKeepAlive(true, o.keepAliveMs);
    this.sock = sock;
    this.closed = false;
    this.parser = new SentenceParser();
    this.lastRx = Date.now();
    sock.on('data', (d) => this.onData(d));
    sock.on('error', (e) => this.fail(new RouterOSError('Connection error: ' + ((e as NodeJS.ErrnoException).code ?? e.message), { connection: true })));
    sock.on('close', () => this.fail(new RouterOSError('Connection closed by router', { connection: true })));
    this.startWatchdog();
    try {
      await this.login();
    } catch (e) {
      this.destroySocket(e as Error);
      throw e;
    }
  }

  private async login(): Promise<void> {
    const o = this.opts;
    const first = await this.exec({ path: '/login', attrs: { name: o.user, password: o.password } }, o.timeoutMs, true);
    const ret = first.done.ret;
    if (ret) {
      // legacy (pre 6.43) challenge-response: response = "00" + md5(0x00 + password + challenge)
      const h = crypto.createHash('md5').update(Buffer.concat([Buffer.from([0]), Buffer.from(o.password, 'utf8'), Buffer.from(ret, 'hex')])).digest('hex');
      await this.exec({ path: '/login', attrs: { name: o.user, response: '00' + h } }, o.timeoutMs, true);
    }
  }

  private startWatchdog(): void {
    this.stopWatchdog();
    const every = Math.max(1000, Math.min(5000, this.opts.watchdogMs / 4));
    this.watchdog = setInterval(() => {
      // streams may legitimately be quiet (e.g. `/log/print follow`): only ordinary commands count here
      let waiting = 0;
      for (const p of this.pending.values()) if (!p.stream) waiting++;
      if (waiting && Date.now() - this.lastRx > this.opts.watchdogMs) {
        this.fail(new RouterOSError('Router stopped responding', { connection: true }));
      }
    }, every);
    this.watchdog.unref?.();
  }
  private stopWatchdog(): void {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
  }

  private onData(d: Buffer): void {
    this.lastRx = Date.now();
    let sentences: string[][];
    try {
      sentences = this.parser.push(d);
    } catch (e) {
      this.fail(e as Error);
      return;
    }
    for (const s of sentences) this.dispatch(s);
  }

  private dispatch(words: string[]): void {
    const type = words[0]!;
    if (type === '!fatal') {
      this.fail(new RouterOSError('Router closed the connection: ' + (words[1] ?? 'fatal'), { connection: true }));
      return;
    }
    const attrs = parseAttrs(words);
    const tag = attrs['.tag'];
    const p = tag !== undefined ? this.pending.get(tag) : undefined;
    if (!p) return; // late reply of a timed-out / cancelled command: drop
    if (type === '!re') {
      let n = 0;
      for (let i = 1; i < words.length; i++) n += words[i]!.length;
      p.bytes += n;
      if (p.bytes > LIMITS.MAX_REPLY || (!p.stream && p.rows.length >= LIMITS.MAX_ROWS)) {
        this.finish(p, new RouterOSError('Router reply too large'));
        void this.sendCancel(p.tag);
        return;
      }
      delete attrs['.tag'];
      if (p.onRow) {
        try {
          p.onRow(attrs);
        } catch {
          /* a faulty subscriber must not break the connection */
        }
      } else p.rows.push(attrs);
    } else if (type === '!trap') {
      p.traps.push({ message: attrs.message ?? 'unknown error', category: attrs.category });
    } else if (type === '!done') {
      delete attrs['.tag'];
      this.served++;
      const trap = p.traps.find((t) => !(p.cancelled && /interrupted/i.test(t.message)));
      if (trap) this.finish(p, new RouterOSError(trap.message, { category: trap.category }));
      else this.finish(p, undefined, { rows: p.rows, done: attrs });
    } // !empty and unknown types: ignore (a !done follows)
  }

  private finish(p: Pending, err?: Error, ok?: Reply): void {
    if (p.settled) return;
    p.settled = true;
    if (p.timer) clearTimeout(p.timer);
    this.pending.delete(p.tag);
    this.lastUsed = Date.now();
    if (err) p.reject(err);
    else p.resolve(ok ?? { rows: p.rows, done: {} });
  }

  private fail(err: Error): void {
    if (this.closed && !this.sock) return;
    this.destroySocket(err);
  }

  private destroySocket(err: Error): void {
    this.stopWatchdog();
    const s = this.sock;
    this.sock = null;
    this.closed = true;
    if (s) {
      s.removeAllListeners('data');
      s.on('error', () => {});
      s.destroy();
    }
    const list = [...this.pending.values()];
    for (const p of list) this.finish(p, err instanceof RouterOSError ? err : new RouterOSError(err.message, { connection: true }));
  }

  private write(words: string[]): void {
    if (!this.sock || this.closed) throw new RouterOSError('Not connected', { connection: true });
    this.sock.write(encodeSentence(words));
  }

  private nextTag(): string {
    this.seq = (this.seq + 1) % 0x7fffffff;
    return String(this.seq || 1);
  }

  /** Send one command and wait for its completion. Internal: use send() (which connects first). */
  private exec(c: Command, timeoutMs: number, noConnectCheck = false, onRow?: (r: Row) => void, stream = false): Promise<Reply> & { tag: string } {
    const tag = this.nextTag();
    let resolve!: (r: Reply) => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<Reply>((res, rej) => {
      resolve = res;
      reject = rej;
    }) as Promise<Reply> & { tag: string };
    promise.tag = tag;
    if (!noConnectCheck && !this.connected) {
      reject(new RouterOSError('Not connected', { connection: true }));
      return promise;
    }
    const p: Pending = { tag, rows: [], traps: [], bytes: 0, resolve, reject, timer: null, onRow, stream, cancelled: false, settled: false };
    if (!stream && timeoutMs > 0) {
      p.timer = setTimeout(() => {
        this.finish(p, new RouterOSError('Router read timeout', { connection: true }));
        void this.sendCancel(tag);
      }, timeoutMs);
    }
    try {
      const words = buildWords(c, tag);
      this.pending.set(tag, p);
      this.write(words);
    } catch (e) {
      this.pending.delete(tag);
      if (p.timer) clearTimeout(p.timer);
      p.settled = true;
      reject(e as Error);
    }
    return promise;
  }

  private async sendCancel(tag: string): Promise<void> {
    try {
      if (this.sock && !this.closed) this.write(['/cancel', `=tag=${tag}`]);
    } catch {
      /* connection already gone */
    }
  }

  /** Connect if needed and run one command. Rejects with RouterOSError (first !trap message) on router errors. */
  async send(c: Command, opts: { timeoutMs?: number } = {}): Promise<Reply> {
    await this.connect();
    this.lastUsed = Date.now();
    return this.exec(c, opts.timeoutMs ?? this.opts.timeoutMs);
  }

  /**
   * Pipeline: all commands are written back-to-back (in chunks of PIPE_CHUNK) and answered concurrently over the same socket.
   * Never rejects for router-side errors: each result is { reply } or { error } in input order.
   */
  async sendMany(cmds: Command[], opts: { timeoutMs?: number } = {}): Promise<Settled[]> {
    await this.connect();
    const out: Settled[] = [];
    for (let i = 0; i < cmds.length; i += LIMITS.PIPE_CHUNK) {
      const chunk = cmds.slice(i, i + LIMITS.PIPE_CHUNK);
      const res = await Promise.all(
        chunk.map((c) =>
          this.exec(c, opts.timeoutMs ?? this.opts.timeoutMs).then(
            (reply): Settled => ({ reply }),
            (error: Error): Settled => ({ error }),
          ),
        ),
      );
      out.push(...res);
    }
    return out;
  }

  /**
   * Streaming command (never ends by itself). Rows go to h.onRow. cancel() sends /cancel and resolves when the router confirmed.
   * h.onEnd(err) fires once when the stream ends abnormally (connection lost, router error) - or without err after a cancel.
   */
  stream(c: Command, h: StreamHandlers): StreamHandle {
    let ended = false;
    let p: Pending | undefined;
    let tag = '';
    const end = (err?: Error) => {
      if (ended) return;
      ended = true;
      try {
        h.onEnd?.(err);
      } catch {
        /* ignore */
      }
    };
    const done: Promise<void> = (async () => {
      try {
        await this.connect();
        const pr = this.exec(c, 0, false, h.onRow, true);
        tag = pr.tag;
        p = this.pending.get(tag);
        await pr;
        end();
      } catch (e) {
        end(p?.cancelled ? undefined : (e as Error));
      }
    })();
    return {
      done,
      cancel: async () => {
        if (p) p.cancelled = true;
        if (tag) await this.sendCancel(tag);
        // the router answers !trap interrupted + !done; do not wait forever if it does not
        await Promise.race([done, new Promise<void>((r) => setTimeout(r, 2000))]);
        if (tag && this.pending.has(tag)) {
          const left = this.pending.get(tag)!;
          this.finish(left, new RouterOSError('cancelled'));
        }
        end();
      },
    };
  }

  close(): void {
    this.destroySocket(new RouterOSError('Connection closed', { connection: true }));
  }
}

// ---- link + pool (shared connection per router, breaker, idle close) ------------------------------------------

export type LinkOptions = ClientOptions & { breakerMs?: number; idleMs?: number };

export class RouterLink {
  readonly key: string;
  readonly fingerprint: string;
  readonly client: RouterOSClient;
  private breakerUntil = 0;
  private lastError = '';
  private breakerMs: number;
  idleMs: number;

  constructor(key: string, fingerprint: string, o: LinkOptions) {
    this.key = key;
    this.fingerprint = fingerprint;
    this.client = new RouterOSClient(o);
    this.breakerMs = o.breakerMs ?? 15000;
    this.idleMs = o.idleMs ?? 60000;
  }

  get breakerOpen(): boolean {
    return Date.now() < this.breakerUntil;
  }

  /** Connected client, or a RouterOSError instantly while the breaker is open. */
  async ready(): Promise<RouterOSClient> {
    if (this.client.connected) return this.client;
    if (this.breakerOpen) throw new RouterOSError(`Router unreachable (retrying shortly): ${this.lastError}`, { connection: true });
    try {
      await this.client.connect();
      return this.client;
    } catch (e) {
      this.lastError = (e as Error).message;
      // also opens for wrong credentials: hammering a router with a bad password can lock the API user out
      this.breakerUntil = Date.now() + this.breakerMs;
      throw e;
    }
  }

  resetBreaker(): void {
    this.breakerUntil = 0;
  }

  /**
   * Run `fn` on a ready client. When `retryRead` is set and the failure was a connection error on a REUSED socket (it may simply have
   * died while idle), reconnect once and run again. Never retry writes.
   */
  async use<T>(fn: (c: RouterOSClient) => Promise<T>, retryRead = false): Promise<T> {
    const c = await this.ready();
    const reused = c.served > 0;
    try {
      return await fn(c);
    } catch (e) {
      if (retryRead && reused && e instanceof RouterOSError && e.connection && !this.breakerOpen) {
        const c2 = await this.ready();
        return fn(c2);
      }
      throw e;
    }
  }

  get idle(): boolean {
    return this.client.inflight === 0 && Date.now() - this.client.lastUsed > this.idleMs;
  }
  close(): void {
    this.client.close();
  }
}

export class RouterPool {
  private links = new Map<string, RouterLink>();
  private sweeper: NodeJS.Timeout | null = null;

  /** Get or create the shared link for `key`; a changed fingerprint (host/credentials edited) replaces it. */
  link(key: string, o: LinkOptions): RouterLink {
    const fp = crypto
      .createHash('sha256')
      .update([o.host, o.port ?? '', o.tls ? 1 : 0, o.verifyTls ? 1 : 0, o.user, o.password].join('\0'))
      .digest('hex');
    let l = this.links.get(key);
    if (l && l.fingerprint !== fp) {
      l.close();
      this.links.delete(key);
      l = undefined;
    }
    if (!l) {
      l = new RouterLink(key, fp, o);
      this.links.set(key, l);
      this.ensureSweeper();
    }
    return l;
  }

  drop(key: string): void {
    this.links.get(key)?.close();
    this.links.delete(key);
  }

  closeAll(): void {
    for (const l of this.links.values()) l.close();
    this.links.clear();
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
  }

  stats(): { key: string; connected: boolean; inflight: number; streams: number; breakerOpen: boolean }[] {
    return [...this.links.values()].map((l) => ({ key: l.key, connected: l.client.connected, inflight: l.client.inflight, streams: l.client.streams, breakerOpen: l.breakerOpen }));
  }

  private ensureSweeper(): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => {
      for (const [k, l] of this.links) {
        if (l.client.connected && l.client.streams === 0 && l.idle) l.close(); // reconnects lazily on next use
        if (!l.client.connected && l.idle && !l.breakerOpen) this.links.delete(k);
      }
      if (!this.links.size && this.sweeper) {
        clearInterval(this.sweeper);
        this.sweeper = null;
      }
    }, 10000);
    this.sweeper.unref?.();
  }
}

export const routerPool = (): RouterPool => singleton('routerPool', () => new RouterPool());
