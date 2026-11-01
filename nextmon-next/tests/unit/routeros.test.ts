import { afterEach, describe, expect, it } from 'vitest';
import { buildWords, decodeLength, encodeLength, encodeSentence, LIMITS, RouterOSClient, RouterOSError, RouterPool, SentenceParser } from '../../src/lib/routeros.ts';
import { startFake } from '../fixtures/fake-routeros.ts';
import type { Fake } from '../fixtures/fake-routeros.ts';

let fake: Fake | null = null;
const clients: RouterOSClient[] = [];
afterEach(async () => {
  clients.splice(0).forEach((c) => c.close());
  await fake?.close();
  fake = null;
});
const mk = (port: number, o: Partial<ConstructorParameters<typeof RouterOSClient>[0]> = {}) => {
  const c = new RouterOSClient({ host: '127.0.0.1', port, user: 'admin', password: 'secret', timeoutMs: 2000, ...o });
  clients.push(c);
  return c;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('length encoding', () => {
  it('boundaries for 1/2/3/4/5-byte forms', () => {
    const hex = (n: number) => encodeLength(n).toString('hex');
    expect(hex(0)).toBe('00');
    expect(hex(0x7f)).toBe('7f');
    expect(hex(0x80)).toBe('8080');
    expect(hex(0x3fff)).toBe('bfff');
    expect(hex(0x4000)).toBe('c04000');
    expect(hex(0x1fffff)).toBe('dfffff');
    expect(hex(0x200000)).toBe('e0200000');
    expect(hex(0x0fffffff)).toBe('efffffff');
    expect(hex(0x10000000)).toBe('f010000000');
    expect(hex(0xffffffff)).toBe('f0ffffffff');
  });
  it('encode -> decode roundtrip across the range', () => {
    for (const n of [0, 1, 127, 128, 255, 300, 16383, 16384, 100000, 2097151, 2097152, 5000000, 268435455, 268435456]) {
      expect(decodeLength(encodeLength(n))).toBe(n);
    }
  });
});

describe('SentenceParser', () => {
  it('reassembles sentences from arbitrary fragments (1 byte at a time)', () => {
    const buf = Buffer.concat([encodeSentence(['!re', '=name=a', '=comment=' + 'x'.repeat(5000)]), encodeSentence(['!done'])]);
    const p = new SentenceParser();
    const out: string[][] = [];
    for (let i = 0; i < buf.length; i++) out.push(...p.push(buf.subarray(i, i + 1)));
    expect(out).toHaveLength(2);
    expect(out[0]![2]!.length).toBe(9 + 5000);
    expect(out[1]).toEqual(['!done']);
  });
  it('rejects an absurd word length before allocating', () => {
    const p = new SentenceParser(1024);
    expect(() => p.push(Buffer.from([0xf0, 0x7f, 0xff, 0xff, 0xff]))).toThrow(RouterOSError);
  });
  it('handles multi-byte UTF-8 split across chunks', () => {
    const b = encodeSentence(['!re', '=name=héllo ✓']);
    const p = new SentenceParser();
    const out = [...p.push(b.subarray(0, 9)), ...p.push(b.subarray(9))];
    expect(out[0]![1]).toBe('=name=héllo ✓');
  });
});

describe('buildWords', () => {
  it('maps attrs/query/proplist and booleans', () => {
    expect(buildWords({ path: '/ip/hotspot/user/print', query: { name: 'a', disabled: false }, props: ['name'] }, '7')).toEqual([
      '/ip/hotspot/user/print',
      '=.proplist=.id,name',
      '?name=a',
      '?disabled=no',
      '.tag=7',
    ]);
  });
  it('refuses paths / names that could smuggle extra API words', () => {
    expect(() => buildWords({ path: '/ip/x\n=evil=1' })).toThrow(RouterOSError);
    expect(() => buildWords({ path: '/ip/x', attrs: { 'a=b': '1' } })).toThrow(RouterOSError);
    expect(() => buildWords({ path: '/ip/../x' })).toThrow(RouterOSError);
    expect(() => buildWords({ path: '/ip/x', query: { 'a b': '1' } })).toThrow(RouterOSError);
  });
  it('values are length-prefixed so they may hold anything (no injection through values)', async () => {
    fake = await startFake();
    const c = mk(fake.port);
    const r = await c.send({ path: '/echo', attrs: { comment: 'x\n=evil=1\0y ?z' } });
    expect(r.rows[0]!.comment).toBe('x\n=evil=1\0y ?z');
    expect(r.rows[0]!.evil).toBeUndefined();
  });
});

describe('client against the fake RouterOS server', () => {
  it('plain login + print with 1/2/3-byte length words + add + !trap', async () => {
    fake = await startFake({ mode: 'plain' });
    const c = mk(fake.port);
    const rows = (await c.send({ path: '/ip/hotspot/user/print' })).rows;
    expect(rows.map((r) => r.name)).toEqual(['alice', 'bob', 'carl']);
    expect(rows[0]!.comment).toHaveLength(200);
    expect(rows[1]!.comment).toHaveLength(20000);
    expect(rows[2]!.comment).toHaveLength(300000);
    expect((await c.send({ path: '/ip/hotspot/user/add', attrs: { name: 'n' } })).done.ret).toBe('*9F');
    await expect(c.send({ path: '/boom' })).rejects.toThrow('no such command');
    // the connection stays usable after a trap
    expect((await c.send({ path: '/ip/hotspot/user/print', query: { name: 'bob' } })).rows).toHaveLength(1);
  });

  it('wrong password -> RouterOSError, socket released', async () => {
    fake = await startFake();
    const c = mk(fake.port, { password: 'WRONG' });
    await expect(c.connect()).rejects.toThrow(/invalid user name or password/);
    expect(c.connected).toBe(false);
  });

  it('legacy MD5 challenge login', async () => {
    fake = await startFake({ mode: 'legacy' });
    const c = mk(fake.port);
    expect((await c.send({ path: '/ip/hotspot/user/print' })).rows).toHaveLength(3);
    const bad = mk(fake.port, { password: 'nope' });
    await expect(bad.connect()).rejects.toThrow(/invalid user name/);
  });

  it('survives 7-byte fragmented replies', async () => {
    fake = await startFake({ fragment: 7 });
    const c = mk(fake.port);
    const r = await c.send({ path: '/ip/hotspot/user/print' });
    expect(r.rows[2]!.comment).toHaveLength(300000);
  });

  it('connection refused fails fast with RouterOSError', async () => {
    fake = await startFake();
    const port = fake.port;
    await fake.close();
    fake = null;
    const t = Date.now();
    await expect(mk(port, { connectTimeoutMs: 1500 }).connect()).rejects.toBeInstanceOf(RouterOSError);
    expect(Date.now() - t).toBeLessThan(3000);
  });

  it('pipelining: concurrent commands share ONE socket and replies are demultiplexed by tag (out of order)', async () => {
    fake = await startFake();
    const c = mk(fake.port);
    await c.connect();
    const order: string[] = [];
    const slow = c.send({ path: '/slow', attrs: { ms: 250 } }).then((r) => (order.push('slow'), r));
    const fast = c.send({ path: '/slow', attrs: { ms: 10 } }).then((r) => (order.push('fast'), r));
    const [rs, rf] = await Promise.all([slow, fast]);
    expect(order).toEqual(['fast', 'slow']);
    expect(rs.rows[0]!.waited).toBe('250');
    expect(rf.rows[0]!.waited).toBe('10');
    expect(fake.connections).toBe(1);
  });

  it('sendMany: per-command results, one failing command does not poison the rest', async () => {
    fake = await startFake();
    const c = mk(fake.port);
    const res = await c.sendMany([{ path: '/many', attrs: { n: 3 } }, { path: '/boom' }, { path: '/ip/hotspot/user/add', attrs: { name: 'x' } }]);
    expect(res[0]!.reply!.rows).toHaveLength(3);
    expect(res[1]!.error!.message).toBe('no such command');
    expect(res[2]!.reply!.done.ret).toBe('*9F');
    expect(fake.connections).toBe(1);
  });

  it('pipelines hundreds of commands in chunks', async () => {
    fake = await startFake();
    const c = mk(fake.port);
    const res = await c.sendMany(Array.from({ length: 350 }, (_, i) => ({ path: '/ip/hotspot/user/add', attrs: { name: 'u' + i } })));
    expect(res).toHaveLength(350);
    expect(res.every((r) => r.reply?.done.ret === '*9F')).toBe(true);
  });

  it('!empty (RouterOS 7.18+) yields an empty result', async () => {
    fake = await startFake();
    expect((await mk(fake.port).send({ path: '/empty' })).rows).toEqual([]);
  });

  it('command timeout rejects only that command, sends /cancel, connection keeps working', async () => {
    fake = await startFake();
    const c = mk(fake.port);
    await c.connect();
    await expect(c.send({ path: '/hang' }, { timeoutMs: 150 })).rejects.toThrow(/timeout/);
    await sleep(30);
    expect(fake.received.some((w) => w[0] === '/cancel')).toBe(true);
    expect((await c.send({ path: '/many', attrs: { n: 2 } })).rows).toHaveLength(2);
  });

  it('!fatal rejects pending commands and the next call reconnects', async () => {
    fake = await startFake();
    const c = mk(fake.port);
    await expect(c.send({ path: '/fatal' })).rejects.toMatchObject({ connection: true });
    expect((await c.send({ path: '/many', attrs: { n: 1 } })).rows).toHaveLength(1);
    expect(fake.connections).toBe(2);
  });

  it('server dropping the socket mid-flight gives a connection error, not a hang', async () => {
    fake = await startFake();
    const c = mk(fake.port);
    await c.connect();
    const p = c.send({ path: '/hang' });
    await sleep(20);
    fake.dropAll();
    await expect(p).rejects.toMatchObject({ connection: true });
  });

  it('reply size limits: too many rows is refused', async () => {
    fake = await startFake();
    const c = mk(fake.port);
    const old = LIMITS.MAX_ROWS;
    LIMITS.MAX_ROWS = 50;
    try {
      await expect(c.send({ path: '/many', attrs: { n: 500 } })).rejects.toThrow(/too large/);
    } finally {
      LIMITS.MAX_ROWS = old;
    }
  });
});

describe('streaming', () => {
  it('delivers rows continuously and cancel() stops the stream via /cancel (interrupted is not an error)', async () => {
    fake = await startFake();
    const c = mk(fake.port);
    const rows: number[] = [];
    let ended: { err?: Error } | null = null;
    const h = c.stream(
      { path: '/interface/monitor-traffic', attrs: { interface: 'ether1' } },
      { onRow: (r) => rows.push(Number(r['rx-bits-per-second'])), onEnd: (err) => (ended = { err }) },
    );
    await sleep(200);
    expect(rows.length).toBeGreaterThan(3);
    expect(rows[1]! - rows[0]!).toBe(1000);
    await h.cancel();
    expect(ended).toEqual({ err: undefined });
    const n = rows.length;
    await sleep(100);
    expect(rows.length).toBe(n);
    expect(fake.activeStreams()).toBe(0);
    expect(fake.received.some((w) => w[0] === '/cancel' && w[1]!.startsWith('=tag='))).toBe(true);
  });

  it('streams and normal commands share one socket (pipelining while streaming)', async () => {
    fake = await startFake();
    const c = mk(fake.port);
    const h = c.stream({ path: '/interface/monitor-traffic' }, { onRow: () => {} });
    await sleep(60);
    expect((await c.send({ path: '/ip/hotspot/user/print' })).rows).toHaveLength(3);
    expect(fake.connections).toBe(1);
    await h.cancel();
  });

  it('a lost connection ends the stream with an error', async () => {
    fake = await startFake();
    const c = mk(fake.port);
    const end = new Promise<Error | undefined>((res) => c.stream({ path: '/interface/monitor-traffic' }, { onRow: () => {}, onEnd: res }));
    await sleep(80);
    fake.dropAll();
    expect(await end).toBeInstanceOf(RouterOSError);
  });
});

describe('RouterLink / RouterPool', () => {
  it('shares one connection per key, replaces the link when credentials change', async () => {
    fake = await startFake();
    const pool = new RouterPool();
    const o = { host: '127.0.0.1', port: fake.port, user: 'admin', password: 'secret' };
    const l1 = pool.link('r1', o);
    expect(pool.link('r1', o)).toBe(l1);
    await Promise.all([l1.use((c) => c.send({ path: '/many', attrs: { n: 1 } })), l1.use((c) => c.send({ path: '/many', attrs: { n: 1 } }))]);
    expect(fake.connections).toBe(1);
    const l2 = pool.link('r1', { ...o, password: 'other' });
    expect(l2).not.toBe(l1);
    pool.closeAll();
  });

  it('circuit breaker: after a failed login further attempts fail instantly, until it half-opens', async () => {
    fake = await startFake();
    const pool = new RouterPool();
    const link = pool.link('b', { host: '127.0.0.1', port: fake.port, user: 'admin', password: 'bad', breakerMs: 300 });
    await expect(link.ready()).rejects.toThrow(/invalid user name/);
    const loginsBefore = fake.received.filter((w) => w[0] === '/login').length;
    const t = Date.now();
    await expect(link.ready()).rejects.toThrow(/unreachable/);
    expect(Date.now() - t).toBeLessThan(50);
    expect(fake.received.filter((w) => w[0] === '/login').length).toBe(loginsBefore); // no new network attempt
    await sleep(350);
    await expect(link.ready()).rejects.toThrow(/invalid user name/); // half-open: tries again
    pool.closeAll();
  });

  it('reads are retried once on a fresh connection when a reused socket died while idle', async () => {
    fake = await startFake();
    const pool = new RouterPool();
    const link = pool.link('x', { host: '127.0.0.1', port: fake.port, user: 'admin', password: 'secret', timeoutMs: 1000 });
    await link.use((c) => c.send({ path: '/many', attrs: { n: 1 } }));
    fake.dropAll();
    await sleep(30);
    const r = await link.use((c) => c.send({ path: '/many', attrs: { n: 2 } }), true);
    expect(r.rows).toHaveLength(2);
    pool.closeAll();
  });
});
