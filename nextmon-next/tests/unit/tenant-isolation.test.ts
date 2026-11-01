/**
 * Tenant isolation at the library layer: workspace B must not be able to read or change anything of workspace A, and shared
 * routers must behave (ro/rw, revocation, no password disclosure).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Audit } from '../../src/lib/audit.ts';
import { Cache } from '../../src/lib/cache.ts';
import { Context } from '../../src/lib/context.ts';
import { RouterOSError } from '../../src/lib/routeros.ts';
import { Routers, RouterError } from '../../src/lib/routers.ts';
import { Share } from '../../src/lib/share.ts';
import { getSettings, saveSettings, Store, NoWorkspaceError } from '../../src/lib/store.ts';
import { Users } from '../../src/lib/users.ts';
import { Workspace, WorkspaceError } from '../../src/lib/workspace.ts';
import { bootstrapPlatform, makeTenant } from '../helpers.ts';

let A: { ws: string; owner: { id: string } };
let B: { ws: string; owner: { id: string } };

beforeAll(async () => {
  await bootstrapPlatform();
  A = await makeTenant('tenant-a');
  B = await makeTenant('tenant-b');
});

describe('data isolation', () => {
  it('every per-workspace collection is invisible across workspaces (routers, settings, audit, demo state)', async () => {
    Workspace.run(A.ws, () => {
      saveSettings({ hotspot_name: 'A-ONLY' });
      Audit.log('a.secret', 'only for A');
      Routers.save({ name: 'A real', type: 'real', host: '10.0.0.1', user: 'u', pass: 'a-router-password' });
    });
    Workspace.run(B.ws, () => {
      expect(getSettings().hotspot_name).not.toBe('A-ONLY');
      expect(Audit.tail(100).some((r) => r.action === 'a.secret')).toBe(false);
      expect(Routers.list().map((r) => r.name)).not.toContain('A real');
      expect(Store.read('routers', []).length).toBe(1); // only B's own demo router
    });
    // the demo router of A is a different router/db than B's
    const aDemo = Workspace.run(A.ws, () => Routers.list().find((r) => r.type === 'demo')!);
    const bDemo = Workspace.run(B.ws, () => Routers.list().find((r) => r.type === 'demo')!);
    expect(aDemo.id).not.toBe(bDemo.id);
  });

  it('guessing A\'s router id from B yields "Unknown router" - for get, driver, save(update) and remove', async () => {
    const aReal = Workspace.run(A.ws, () => Routers.list().find((r) => r.type === 'real')!);
    Workspace.run(B.ws, () => {
      expect(Routers.get(aReal.id)).toBeNull();
      expect(() => Routers.driver(aReal.id)).toThrow(RouterError);
      expect(Routers.current(aReal.id)?.id).not.toBe(aReal.id);
      // an "update" with A's id creates a NEW router in B (and never touches A's)
      const made = Routers.save({ id: aReal.id, name: 'hijack', type: 'real', host: '10.6.6.6', user: 'x', pass: 'y' });
      expect(made.id).not.toBe(aReal.id);
      Routers.remove(aReal.id);
    });
    Workspace.run(A.ws, () => {
      const still = Routers.get(aReal.id)!;
      expect(still.host).toBe('10.0.0.1');
      expect(still.name).toBe('A real');
    });
  });

  it('demo router state (users created through the driver) is per workspace', async () => {
    const aDemo = Workspace.run(A.ws, () => Routers.list().find((r) => r.type === 'demo')!);
    const bDemo = Workspace.run(B.ws, () => Routers.list().find((r) => r.type === 'demo')!);
    const name = await Workspace.run(A.ws, async () => {
      const d = Routers.driver(aDemo.id);
      await d.add('/ip/hotspot/user', { name: 'only-in-a', password: 'x', profile: 'default' });
      return (await d.print('/ip/hotspot/user', { name: 'only-in-a' })).length;
    });
    expect(name).toBe(1);
    const inB = await Workspace.run(B.ws, async () => (await Routers.driver(bDemo.id).print('/ip/hotspot/user', { name: 'only-in-a' })).length);
    expect(inB).toBe(0);
  });

  it('the Context workspace is the only tenant selector: a crafted collection name or id can not cross over', () => {
    Workspace.run(A.ws, () => Store.write('probe', 'A-probe'));
    Workspace.run(B.ws, () => {
      expect(Store.read(`ws/${A.ws}/probe`, 'none')).toBe('none');
      expect(Store.read('../' + A.ws + '/probe', 'none')).toBe('none');
      expect(Store.read('probe', 'none')).toBe('none');
    });
    expect(() => Store.read('probe', 'none')).toThrow(NoWorkspaceError); // no workspace => no data
    expect(() => Context.run({ ws: A.ws + '/../' + B.ws }, () => Store.read('probe', 1))).toThrow(NoWorkspaceError);
  });

  it('cache keys are scoped: one tenant never gets another\'s cached entry', async () => {
    const k = (ws: string) => Cache.scope(ws, 'sales', 'r1');
    Cache.set(k(A.ws), 'A-data', 30);
    expect(Cache.get(k(B.ws))).toBeUndefined();
    expect(Cache.get(k(A.ws))).toBe('A-data');
  });

  it('async work keeps its workspace: interleaved tenants do not bleed into each other', async () => {
    const seen: string[] = [];
    const task = (ws: string, delay: number) =>
      Workspace.run(ws, async () => {
        await new Promise((r) => setTimeout(r, delay));
        Store.write('interleave', ws);
        await new Promise((r) => setTimeout(r, delay));
        seen.push(Store.read('interleave', '') + '@' + Workspace.id());
      });
    await Promise.all([task(A.ws, 15), task(B.ws, 5), task(A.ws, 1), task(B.ws, 9)]);
    expect(seen.every((s) => s.split('@')[0] === s.split('@')[1])).toBe(true);
  });

  it('deleting a workspace removes its data, users and shares but not the neighbours\'', async () => {
    const C = await makeTenant('tenant-c');
    Workspace.run(C.ws, () => Store.write('mine', 1));
    Workspace.delete(C.ws);
    expect(Workspace.get(C.ws)).toBeNull();
    expect(Users.find('owner-tenant-c')).toBeNull();
    expect(Store.allNames().some((n) => n.startsWith(`ws/${C.ws}/`))).toBe(false);
    expect(Workspace.get(A.ws)).not.toBeNull();
    Workspace.run(A.ws, () => expect(Store.has('probe')).toBe(true));
  });

  it('slug uniqueness and format; limits default + override', async () => {
    await expect(Workspace.create({ name: 'Dup', slug: 'tenant-a', owner: { username: 'dup-owner', password: 'password123' } })).rejects.toThrow(WorkspaceError);
    expect(Users.find('dup-owner')).toBeNull();
    for (const bad of ['A', 'ab c', '../x', 'api', '-x']) {
      await expect(Workspace.create({ name: 'x', slug: bad, owner: { username: 'zz' + bad.length, password: 'password123' } })).rejects.toThrow(WorkspaceError);
    }
    expect(Workspace.limits(A.ws).routers).toBe(5);
    Workspace.update(A.ws, { limits: { routers: 2 } });
    expect(Workspace.limits(A.ws).routers).toBe(2);
    Workspace.update(A.ws, { limits: {} });
    expect(Workspace.bySlug('TENANT-A')?.id).toBe(A.ws);
  });

  it('the router limit is enforced per workspace', async () => {
    const D = await makeTenant('tenant-d');
    Workspace.update(D.ws, { limits: { routers: 2 } });
    Workspace.run(D.ws, () => {
      Routers.save({ name: 'second', type: 'real', host: '10.1.1.1', user: 'u', pass: 'p' });
      expect(() => Routers.save({ name: 'third', type: 'real', host: '10.1.1.2', user: 'u', pass: 'p' })).toThrow(/limit/);
    });
  });
});

describe('router sharing', () => {
  it('ro share: recipient reads but every write is refused; password never visible; revoke removes access', async () => {
    const aReal = Workspace.run(A.ws, () => Routers.list().find((r) => r.type === 'real')!);
    const aDemo = Workspace.run(A.ws, () => Routers.list().find((r) => r.type === 'demo')!);
    // not shared yet
    expect(Workspace.run(B.ws, () => Routers.get(aDemo.id))).toBeNull();
    Share.grant(A.ws, aDemo.id, B.ws, 'ro', 'test');
    Workspace.run(B.ws, async () => {
      const v = Routers.get(aDemo.id)!;
      expect(v).toMatchObject({ shared: true, mode: 'ro', owner: A.ws });
      expect(JSON.stringify(Routers.list())).not.toContain('a-router-password');
      expect(Object.keys(v)).not.toContain('pass');
    });
    await Workspace.run(B.ws, async () => {
      const d = Routers.driver(aDemo.id);
      expect((await d.print('/ip/hotspot/user')).length).toBeGreaterThan(5);
      await expect(d.add('/ip/hotspot/user', { name: 'x' })).rejects.toThrow(/read-only/);
      await expect(d.set('/ip/hotspot/user', '*1', { comment: 'x' })).rejects.toThrow(RouterOSError);
      await expect(d.remove('/ip/hotspot/user', '*1')).rejects.toThrow(RouterOSError);
      await expect(d.command('/system/backup/save', { name: 'x' })).rejects.toThrow(RouterOSError);
      await expect(d.addMany('/ip/hotspot/user', [{ name: 'a' }, { name: 'b' }])).rejects.toThrow(RouterOSError);
      expect(await d.command('/tool/ping', { address: '1.1.1.1', count: 2 })).toHaveLength(2); // read-only commands pass
    });
    // the other (unshared) router stays invisible
    expect(Workspace.run(B.ws, () => Routers.get(aReal.id))).toBeNull();
    // upgrade to rw
    Share.grant(A.ws, aDemo.id, B.ws, 'rw', 'test');
    const wrote = await Workspace.run(B.ws, async () => {
      const d = Routers.driver(aDemo.id);
      await d.add('/ip/hotspot/user', { name: 'written-by-b', password: 'p', profile: 'default' });
      return (await d.print('/ip/hotspot/user', { name: 'written-by-b' })).length;
    });
    expect(wrote).toBe(1);
    // revoke
    const rule = Share.for(aDemo.id, B.ws)!;
    expect(Share.revoke(B.ws, rule.id)).toBe(false); // only the OWNER can revoke
    expect(Share.revoke(A.ws, rule.id)).toBe(true);
    expect(Workspace.run(B.ws, () => Routers.get(aDemo.id))).toBeNull();
    expect(() => Workspace.run(B.ws, () => Routers.driver(aDemo.id))).toThrow(RouterError);
  });

  it('a share to self or to an invalid workspace is rejected; the owner is validated by the caller', () => {
    expect(() => Share.grant(A.ws, 'x', A.ws, 'ro', 't')).toThrow();
    expect(() => Share.grant(A.ws, 'x', '../etc', 'ro', 't')).toThrow();
  });
});
