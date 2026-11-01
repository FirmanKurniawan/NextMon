import { describe, expect, it } from 'vitest';
import { BaseDriver, CachedDriver, ReadOnlyDriver, isReadOnlyCommand, type Driver, type Row } from '../../src/lib/driver.ts';
import { DemoDriver } from '../../src/lib/demo.ts';
import { RouterOSError } from '../../src/lib/routeros.ts';
import { Workspace } from '../../src/lib/workspace.ts';

class Stub extends BaseDriver {
  readonly demo = false;
  prints = 0;
  writes = 0;
  async print(): Promise<Row[]> { this.prints++; return [{ n: String(this.prints) }]; }
  async add(): Promise<string> { this.writes++; return '*1'; }
  async set(): Promise<void> { this.writes++; }
  async remove(): Promise<void> { this.writes++; }
  async command(): Promise<Row[]> { this.writes++; return []; }
  stream(): never { throw new Error('n/a'); }
}

describe('CachedDriver', () => {
  it('serves repeated reads from cache, and every write bumps the generation (read-your-writes)', async () => {
    const s = new Stub();
    const d = new CachedDriver(s, 'ns-test-1');
    await d.print('/ip/hotspot/user');
    await d.print('/ip/hotspot/user');
    expect(s.prints).toBe(1);
    await d.add('/ip/hotspot/user', { name: 'x' });
    await d.print('/ip/hotspot/user');
    expect(s.prints).toBe(2);
    await d.print('/ip/hotspot/active'); await d.print('/ip/hotspot/active');
    expect(s.prints).toBe(3);
    CachedDriver.flush('ns-test-1');
    await d.print('/ip/hotspot/active');
    expect(s.prints).toBe(4);
  });
  it('paths without a TTL are never cached; namespaces are independent', async () => {
    const s = new Stub();
    const a = new CachedDriver(s, 'ns-a'); const b = new CachedDriver(s, 'ns-b');
    await a.print('/system/script'); await a.print('/system/script');
    expect(s.prints).toBe(2);
    await a.print('/ip/hotspot/user'); await b.print('/ip/hotspot/user');
    expect(s.prints).toBe(4);
  });
  it('a write that lands between fetch and store does not leave a stale entry', async () => {
    const s = new Stub();
    const d = new CachedDriver(s, 'ns-race');
    const slow = new Stub();
    slow.print = async () => { slow.prints++; await new Promise((r) => setTimeout(r, 30)); return [{ v: 'old' }]; };
    const dd = new CachedDriver(slow, 'ns-race2');
    const p = dd.print('/ip/hotspot/user');
    await dd.add('/ip/hotspot/user', {});
    await p;
    await dd.print('/ip/hotspot/user');
    expect(slow.prints).toBe(2);
    void d;
  });
});

describe('ReadOnlyDriver', () => {
  it('allows reads and read-only commands, refuses everything else with a rejected promise', async () => {
    const s = new Stub();
    const d: Driver = new ReadOnlyDriver(s);
    await expect(d.print('/ip/hotspot/user')).resolves.toBeTruthy();
    for (const f of [() => d.add('/x', {}), () => d.set('/x', '*1', {}), () => d.remove('/x', '*1'), () => d.command('/system/reboot'), () => d.addMany('/x', [{}])]) {
      await expect(f()).rejects.toThrow(RouterOSError);
    }
    expect(s.writes).toBe(0);
    expect(isReadOnlyCommand('/tool/ping')).toBe(true);
    expect(isReadOnlyCommand('/system/reboot')).toBe(false);
    expect(isReadOnlyCommand('/system/script/run')).toBe(false);
  });
});

describe('DemoDriver', () => {
  it('print / add / set / remove round-trip, printMany and addMany', async () => {
    const d = new DemoDriver('w_dddddddd', 'drv1', 'Asia/Jakarta');
    await Workspace.run('w_dddddddd', async () => {
      const before = (await d.print('/ip/hotspot/user')).length;
      const id = await d.add('/ip/hotspot/user', { name: 'zz1', password: 'p', profile: 'default' });
      expect((await d.print('/ip/hotspot/user')).length).toBe(before + 1);
      await d.set('/ip/hotspot/user', id, { comment: 'hello' });
      expect((await d.print('/ip/hotspot/user', { name: 'zz1' }))[0]!.comment).toBe('hello');
      await d.remove('/ip/hotspot/user', id);
      expect(await d.print('/ip/hotspot/user', { name: 'zz1' })).toHaveLength(0);
      const many = await d.printMany({ a: ['/ip/hotspot/user'], b: ['/ip/hotspot/user/profile'] });
      expect(many.a!.length).toBeGreaterThan(0);
      expect(many.b!.length).toBeGreaterThan(0);
      const ids = await d.addMany('/ip/hotspot/user', [{ name: 'm1', password: 'x' }, { name: 'm2', password: 'x' }]);
      expect(ids).toHaveLength(2);
    });
  });
});
