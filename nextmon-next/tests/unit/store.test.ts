import { describe, expect, it } from 'vitest';
import { Context } from '../../src/lib/context.ts';
import { db } from '../../src/lib/db.ts';
import { getSettings, GLOBAL_DOCS, NoWorkspaceError, saveSettings, sanitizeName, Store } from '../../src/lib/store.ts';
import { Workspace } from '../../src/lib/workspace.ts';

const W1 = 'w_aaaaaaaa';
const W2 = 'w_bbbbbbbb';

describe('Store (workspace-namespaced SQLite)', () => {
  it('FAILS CLOSED: per-workspace collections need an active workspace', () => {
    expect(() => Store.read('routers', [])).toThrow(NoWorkspaceError);
    expect(() => Store.write('routers', [])).toThrow(NoWorkspaceError);
    expect(() => Store.update('routers', (x) => x, [])).toThrow(NoWorkspaceError);
    expect(() => Store.append('audit.log', {})).toThrow(NoWorkspaceError);
    expect(() => Store.rows('audit.log')).toThrow(NoWorkspaceError);
    expect(() => Store.has('routers')).toThrow(NoWorkspaceError);
    expect(() => Store.delete('routers')).toThrow(NoWorkspaceError);
  });

  it('rejects malformed workspace ids in the context (cannot smuggle a path / another tenant)', () => {
    for (const bad of ['w_AAAAAAAA', 'w_aaaaaaa', '../x', 'w_aaaaaaaa/../w_bbbbbbbb', 'main', '']) {
      expect(() => Context.run({ ws: bad }, () => Store.read('routers', []))).toThrow(NoWorkspaceError);
      expect(() => Workspace.run(bad, () => 1)).toThrow(NoWorkspaceError);
    }
  });

  it('read/write/update/has/delete are isolated per workspace and share nothing', () => {
    Workspace.run(W1, () => Store.write('routers', [{ id: 'r1' }]));
    Workspace.run(W2, () => {
      expect(Store.has('routers')).toBe(false);
      expect(Store.read('routers', ['none'])).toEqual(['none']);
      Store.write('routers', [{ id: 'r2' }]);
    });
    Workspace.run(W1, () => {
      expect(Store.read('routers', [])).toEqual([{ id: 'r1' }]);
      Store.update<{ id: string }[]>('routers', (l) => [...l, { id: 'r1b' }], []);
    });
    Workspace.run(W2, () => expect(Store.read('routers', [])).toEqual([{ id: 'r2' }]));
    Workspace.run(W1, () => {
      expect(Store.names()).toContain('routers');
      Store.delete('routers');
      expect(Store.has('routers')).toBe(false);
    });
    Workspace.run(W2, () => expect(Store.has('routers')).toBe(true));
  });

  it('backend keys carry the workspace prefix; no way to read another tenant by passing a crafted collection name', () => {
    Workspace.run(W1, () => Store.write('secretdoc', { v: 1 }));
    Workspace.run(W2, () => {
      expect(Store.read(`ws/${W1}/secretdoc`, 'miss')).toBe('miss'); // sanitised to ws_w_aaaaaaaa_secretdoc inside W2's namespace
      expect(Store.read('../secretdoc', 'miss')).toBe('miss');
    });
    const keys = Store.allNames();
    expect(keys).toContain(`ws/${W1}/secretdoc`);
  });

  it('update() is atomic and rolls back when the callback throws', () => {
    Workspace.run(W1, () => {
      Store.write('counter', { n: 1 });
      expect(() =>
        Store.update<{ n: number }>('counter', (c) => {
          c.n = 99;
          throw new Error('boom');
        }, { n: 0 }),
      ).toThrow('boom');
      expect(Store.read('counter', { n: 0 })).toEqual({ n: 1 });
      for (let i = 0; i < 50; i++) Store.update<{ n: number }>('counter', (c) => ({ n: c.n + 1 }), { n: 0 });
      expect(Store.read<{ n: number }>('counter', { n: 0 }).n).toBe(51);
    });
  });

  it('append-only logs: rows newest first, paging, where filters, count, prune, per workspace', () => {
    Workspace.run(W1, () => {
      for (let i = 1; i <= 10; i++) Store.append('events', { i, kind: i % 2 ? 'odd' : 'even' });
      expect(Store.count('events')).toBe(10);
      expect(Store.tail<{ i: number }>('events', 3).map((r) => r.i)).toEqual([10, 9, 8]);
      expect(Store.rows<{ i: number }>('events', 2, 2).map((r) => r.i)).toEqual([8, 7]);
      expect(Store.rows('events', 100, 0, { kind: 'even' })).toHaveLength(5);
      expect(() => Store.rows('events', 1, 0, { 'bad key; drop': 'x' })).toThrow();
      expect(Store.prune('events', 4)).toBe(6);
      expect(Store.count('events')).toBe(4);
      expect(Store.tail<{ i: number }>('events', 10).map((r) => r.i)).toEqual([10, 9, 8, 7]);
    });
    Workspace.run(W2, () => expect(Store.count('events')).toBe(0));
  });

  it('global collections work without a workspace; the allow-list is closed', () => {
    Store.global('workspaces'); // allowed
    Store.global('users').write([{ id: 'x' }]);
    expect(Store.global('users').read([])).toEqual([{ id: 'x' }]);
    Store.global('users').write([]);
    expect(() => Store.global('routers')).toThrow(/not a global/);
    expect(() => Store.global('settings')).toThrow();
    expect(Store.isGlobal('users')).toBe(true);
    expect(Store.isGlobal('routers')).toBe(false);
    // tenant data names must never be global
    for (const n of ['routers', 'settings', 'shop', 'wallets', 'resellers', 'apikeys', 'scheduler', 'orders', 'audit.log', 'notify.log']) {
      expect(GLOBAL_DOCS).not.toContain(n);
    }
  });

  it('sanitizeName can never yield a dot-path or hidden name', () => {
    for (const n of ['.', '..', '../x', '.hidden', 'a/b', 'a\\b', '', ' ']) {
      const s = sanitizeName(n);
      expect(s).not.toMatch(/^\./);
      expect(s).not.toMatch(/[/\\]/);
      expect(s.length).toBeGreaterThan(0);
    }
  });

  it('purgeWorkspace removes only that workspace', () => {
    Workspace.run(W1, () => Store.write('p', 1));
    Workspace.run(W2, () => Store.write('p', 2));
    Store.purgeWorkspace(W1);
    Workspace.run(W1, () => expect(Store.has('p')).toBe(false));
    Workspace.run(W2, () => expect(Store.read('p', 0)).toBe(2));
    expect(() => Store.purgeWorkspace('w_zz')).toThrow();
  });

  it('settings: defaults with no workspace, per-workspace overrides', () => {
    expect(getSettings().currency).toBe('Rp');
    Workspace.run(W1, () => {
      saveSettings({ currency: 'USD' });
      expect(getSettings().currency).toBe('USD');
    });
    Workspace.run(W2, () => expect(getSettings().currency).toBe('Rp'));
  });

  it('uses WAL journal mode', () => {
    expect(String(db().st('PRAGMA journal_mode').get()?.journal_mode)).toBe('wal');
  });
});
