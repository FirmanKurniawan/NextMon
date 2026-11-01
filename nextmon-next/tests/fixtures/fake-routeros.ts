/**
 * Fake RouterOS API server for tests (semantics ported from nextmon-php/tests/fixtures/fake_routeros.php, extended with tags,
 * out-of-order replies, streaming + /cancel, !empty, !fatal and fragmented writes).
 * Deliberately has its OWN word decoder/encoder so the client under test is not validated against itself.
 */
import net from 'node:net';
import crypto from 'node:crypto';

function enc(l: number): Buffer {
  if (l < 0x80) return Buffer.from([l]);
  if (l < 0x4000) return Buffer.from([(l >> 8) | 0x80, l & 0xff]);
  if (l < 0x200000) return Buffer.from([(l >> 16) | 0xc0, (l >> 8) & 0xff, l & 0xff]);
  if (l < 0x10000000) return Buffer.from([(l >> 24) | 0xe0, (l >> 16) & 0xff, (l >> 8) & 0xff, l & 0xff]);
  return Buffer.concat([Buffer.from([0xf0]), Buffer.from([(l >>> 24) & 255, (l >>> 16) & 255, (l >>> 8) & 255, l & 255])]);
}

/** pull one complete sentence out of buf, or null */
function takeSentence(buf: Buffer): { words: string[]; rest: Buffer } | null {
  const words: string[] = [];
  let p = 0;
  for (;;) {
    if (p >= buf.length) return null;
    const f = buf[p]!;
    let len: number;
    let n: number;
    if (f < 0x80) { len = f; n = 1; }
    else if (f < 0xc0) { if (p + 2 > buf.length) return null; len = ((f & 0x3f) << 8) | buf[p + 1]!; n = 2; }
    else if (f < 0xe0) { if (p + 3 > buf.length) return null; len = ((f & 0x1f) << 16) | (buf[p + 1]! << 8) | buf[p + 2]!; n = 3; }
    else if (f < 0xf0) { if (p + 4 > buf.length) return null; len = ((f & 0x0f) << 24) | (buf[p + 1]! << 16) | (buf[p + 2]! << 8) | buf[p + 3]!; n = 4; }
    else { if (p + 5 > buf.length) return null; len = buf.readUInt32BE(p + 1); n = 5; }
    if (len === 0) return { words, rest: buf.subarray(p + n) };
    if (p + n + len > buf.length) return null;
    words.push(buf.toString('utf8', p + n, p + n + len));
    p += n + len;
  }
}

export type FakeOpts = { mode?: 'plain' | 'legacy'; user?: string; pass?: string; fragment?: number };
export type Fake = {
  port: number;
  connections: number;
  /** every command sentence received (login included) */
  received: string[][];
  activeStreams: () => number;
  /** number of times a monitor-traffic stream was started */
  streamStarts: () => number;
  /** forcibly drop all client sockets */
  dropAll: () => void;
  close: () => Promise<void>;
};

export async function startFake(o: FakeOpts = {}): Promise<Fake> {
  const mode = o.mode ?? 'plain';
  const USER = o.user ?? 'admin';
  const PASS = o.pass ?? 'secret';
  const challenge = 'ab'.repeat(16);
  const received: string[][] = [];
  const socks = new Set<net.Socket>();
  let streamStarts = 0;
  const streams = new Map<string, NodeJS.Timeout>(); // `${connId}:${tag}` -> interval
  let cid = 0;
  const fake: Fake = {
    port: 0,
    connections: 0,
    received,
    activeStreams: () => streams.size,
    streamStarts: () => streamStarts,
    dropAll: () => socks.forEach((s) => s.destroy()),
    close: async () => {
      for (const t of streams.values()) clearInterval(t);
      streams.clear();
      socks.forEach((s) => s.destroy());
      await new Promise<void>((r) => srv.close(() => r()));
    },
  };

  const srv = net.createServer((sock) => {
    const id = ++cid;
    fake.connections++;
    socks.add(sock);
    let buf: Buffer = Buffer.alloc(0);
    let authed = false;
    const send = (words: string[], tag?: string) => {
      const w = tag !== undefined ? [...words, `.tag=${tag}`] : words;
      const out = Buffer.concat([...w.flatMap((x) => [enc(Buffer.byteLength(x)), Buffer.from(x)]), Buffer.from([0])]);
      if (!o.fragment) return void sock.write(out);
      for (let i = 0; i < out.length; i += o.fragment) sock.write(out.subarray(i, i + o.fragment));
    };
    sock.on('error', () => {});
    sock.on('close', () => {
      socks.delete(sock);
      for (const [k, t] of streams) if (k.startsWith(id + ':')) { clearInterval(t); streams.delete(k); }
    });
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        const s = takeSentence(buf);
        if (!s) break;
        buf = s.rest;
        if (!s.words.length) continue;
        handle(s.words);
      }
    });

    function handle(w: string[]): void {
      received.push(w);
      const cmd = w[0]!;
      const a: Record<string, string> = {};
      const q: string[] = [];
      let tag: string | undefined;
      for (const x of w.slice(1)) {
        if (x.startsWith('.tag=')) tag = x.slice(5);
        else if (x.startsWith('=')) { const p = x.indexOf('=', 1); a[x.slice(1, p)] = x.slice(p + 1); }
        else if (x.startsWith('?')) q.push(x);
      }
      if (cmd === '/quit') { send(['!fatal', 'session terminated on request']); sock.end(); return; }
      if (cmd === '/login') {
        if (mode === 'legacy' && !a.response) return send(['!done', '=ret=' + challenge], tag);
        const ok = mode === 'legacy'
          ? a.name === USER && a.response === '00' + crypto.createHash('md5').update(Buffer.concat([Buffer.from([0]), Buffer.from(PASS), Buffer.from(challenge, 'hex')])).digest('hex')
          : a.name === USER && a.password === PASS;
        if (ok) { authed = true; return send(['!done'], tag); }
        send(['!trap', '=message=invalid user name or password (6)'], tag);
        return send(['!done'], tag);
      }
      if (!authed) { send(['!fatal', 'not logged in']); sock.end(); return; }
      switch (cmd) {
        case '/cancel': {
          const key = `${id}:${a.tag}`;
          const t = streams.get(key);
          if (t) {
            clearInterval(t);
            streams.delete(key);
            send(['!trap', '=category=2', '=message=interrupted'], a.tag);
            send(['!done'], a.tag);
          }
          return send(['!done'], tag);
        }
        case '/ip/hotspot/user/print': {
          const wantName = q.find((x) => x.startsWith('?name='))?.slice(6);
          const rows = [
            ['*1', 'alice', 'x'.repeat(200)],
            ['*2', 'bob', 'y'.repeat(20000)],
            ['*3', 'carl', 'z'.repeat(300000)],
          ].filter((r) => !wantName || r[1] === wantName);
          for (const r of rows) send(['!re', `=.id=${r[0]}`, `=name=${r[1]}`, `=comment=${r[2]}`], tag);
          return send(['!done'], tag);
        }
        case '/ip/hotspot/user/add':
          return send(['!done', '=ret=*9F'], tag);
        case '/boom':
          send(['!trap', '=message=no such command'], tag);
          return send(['!done'], tag);
        case '/empty':
          send(['!empty'], tag);
          return send(['!done'], tag);
        case '/fatal':
          send(['!fatal', 'bye']);
          sock.end();
          return;
        case '/slow':
          setTimeout(() => { send(['!re', `=waited=${a.ms}`], tag); send(['!done'], tag); }, Number(a.ms ?? 100));
          return;
        case '/hang':
          return; // never answers
        case '/echo': {
          send(['!re', ...Object.entries(a).map(([k, v]) => `=${k}=${v}`), ...q.map((x) => `=query${x}`)], tag);
          return send(['!done'], tag);
        }
        case '/many': {
          for (let i = 0; i < Number(a.n ?? 10); i++) send(['!re', `=i=${i}`], tag);
          return send(['!done'], tag);
        }
        case '/interface/monitor-traffic': {
          streamStarts++;
          let n = 0;
          const t = setInterval(() => {
            n++;
            send(['!re', `=name=${a.interface ?? 'ether1'}`, `=rx-bits-per-second=${1000 * n}`, `=tx-bits-per-second=${500 * n}`], tag);
          }, 25);
          streams.set(`${id}:${tag}`, t);
          return;
        }
        default:
          return send(['!done'], tag);
      }
    }
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  fake.port = (srv.address() as net.AddressInfo).port;
  return fake;
}
