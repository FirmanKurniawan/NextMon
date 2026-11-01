import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Routers } from '../../src/lib/routers.ts';
import { routerPool } from '../../src/lib/routeros.ts';
import { TrafficHub, type HubEvent } from '../../src/lib/traffic-hub.ts';
import { Workspace } from '../../src/lib/workspace.ts';
import { startFake, type Fake } from '../fixtures/fake-routeros.ts';
import { bootstrapPlatform, makeTenant } from '../helpers.ts';

let fake: Fake;
let ws: string;
let rid: string;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  await bootstrapPlatform();
  ws = (await makeTenant('hub-t')).ws;
  fake = await startFake();
  rid = Workspace.run(ws, () => Routers.save({ name: 'fake', type: 'real', host: '127.0.0.1', port: fake.port, user: 'admin', pass: 'secret' }).id);
});
afterAll(async () => {
  TrafficHub.closeAll();
  routerPool().closeAll?.();
  await fake.close();
});

describe('TrafficHub', () => {
  it('N browsers share ONE upstream stream, all receive samples, and it closes after the last one leaves', async () => {
    const got: number[] = [0, 0, 0];
    const offs = [0, 1, 2].map((i) => Workspace.run(ws, () => TrafficHub.subscribe(rid, 'ether1', (e: HubEvent) => { if (e.type === 'sample') got[i]!++; })));
    await wait(2500);
    expect(fake.streamStarts()).toBe(1);
    expect(fake.activeStreams()).toBe(1);
    expect(got.every((n) => n >= 1)).toBe(true);
    const st = TrafficHub.stats();
    expect(st).toHaveLength(1);
    expect(st[0]).toMatchObject({ subscribers: 3, upstreamOpen: true, opened: 1 });
    // a late subscriber gets the last sample immediately and still no new upstream
    let first: HubEvent | null = null;
    const late = Workspace.run(ws, () => TrafficHub.subscribe(rid, 'ether1', (e) => { first ??= e; }));
    expect(first).toMatchObject({ type: 'sample' });
    expect(fake.streamStarts()).toBe(1);
    // a different interface is a different upstream
    const other = Workspace.run(ws, () => TrafficHub.subscribe(rid, 'ether2', () => {}));
    await wait(300);
    expect(fake.streamStarts()).toBe(2);
    other();
    late();
    offs.forEach((f) => f());
    await wait(3600); // grace 3s
    expect(TrafficHub.stats()).toHaveLength(0);
    await wait(300);
    expect(fake.activeStreams()).toBe(0); // /cancel reached the router
  }, 20000);

  it('rejects bad interface names and routers of other workspaces', async () => {
    expect(() => Workspace.run(ws, () => TrafficHub.subscribe(rid, 'eth;rm', () => {}))).toThrow();
    const other = (await makeTenant('hub-other')).ws;
    expect(() => Workspace.run(other, () => TrafficHub.subscribe(rid, 'ether1', () => {}))).toThrow(/Unknown router/);
  });

  it('reconnects after the upstream connection drops', async () => {
    const before = fake.streamStarts();
    const events: HubEvent[] = [];
    const off = Workspace.run(ws, () => TrafficHub.subscribe(rid, 'ether1', (e) => events.push(e)));
    await wait(1500);
    fake.dropAll();
    await wait(4000);
    expect(events.some((e) => e.type === 'status' && e.state === 'reconnecting')).toBe(true);
    expect(fake.streamStarts()).toBeGreaterThan(before + 0);
    const n = events.filter((e) => e.type === 'sample').length;
    await wait(2000);
    expect(events.filter((e) => e.type === 'sample').length).toBeGreaterThan(n);
    off();
  }, 20000);
});
