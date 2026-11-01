import { describe, expect, it } from 'vitest';
import { cell, csvLine } from '../../src/features/backup/api.ts';
import { backupDue, backups, config, downsample, evaluate, fmtDur, history, jobBackup, jobPoll, parseExpiry, parseMs, saveConfig, state, token } from '../../src/features/monitor/logic.ts';
import type { MonitorCfg, Point } from '../../src/features/monitor/logic.ts';
import { platformCronToken, run, runWorkspace, tokenScope, schedState } from '../../src/features/scheduler/run.ts';
import { ipKey, paginate, search, validId, validIp, validMac } from '../../src/features/_netkit/util.ts';
import { Store } from '../../src/lib/store.ts';
import { Workspace } from '../../src/lib/workspace.ts';
import { bootstrapPlatform, makeTenant } from '../helpers.ts';

describe('netkit helpers', () => {
  it('validates ids, ips and macs', () => {
    expect(validId('*1A', false)).toBe(true);
    expect(validId('', false)).toBe(false);
    expect(validId('1A')).toBe(false);
    expect(validIp('10.0.0.1', false)).toBe(true);
    expect(validIp('10.0.0.999', false)).toBe(false);
    expect(validMac('AA:BB:CC:DD:EE:FF')).toBe(true);
    expect(validMac('AA-BB')).toBe(false);
  });
  it('sorts by ip, searches and paginates', () => {
    expect(ipKey('10.0.0.2')).toBeLessThan(ipKey('10.0.0.10'));
    const rows = [{ a: 'Foo' }, { a: 'bar' }];
    expect(search(rows, 'FO', ['a'])).toEqual([{ a: 'Foo' }]);
    const pg = paginate(Array.from({ length: 250 }, (_, i) => i), 9, 100);
    expect(pg.page).toBe(3);
    expect(pg.rows).toHaveLength(50);
  });
});

describe('backup csv', () => {
  it('guards spreadsheet formulas and quotes cells', () => {
    expect(cell('=1+1')).toBe("'=1+1");
    expect(cell('-5')).toBe('-5');
    expect(cell('abc')).toBe('abc');
    expect(csvLine(['a,b', 'c"d', 'e'])).toBe('"a,b","c""d",e');
  });
});

describe('monitor logic', () => {
  it('parses RouterOS durations and times', () => {
    expect(parseMs('12ms345us')).toBeCloseTo(12.345);
    expect(parseMs('1s20ms')).toBe(1020);
    expect(parseMs('timeout')).toBeNull();
    expect(fmtDur(45)).toBe('45s');
    expect(fmtDur(90061)).toBe('1d 1h 1m');
    expect(parseExpiry('jan/05/2030 10:00:00')).toBe(Math.floor(new Date(2030, 0, 5, 10, 0, 0).getTime() / 1000));
    expect(parseExpiry('nonsense')).toBeNull();
  });

  it('decides when the scheduled backup is due (time zone aware)', () => {
    const c = { backup: { freq: 'daily', at: '03:00', dow: 0, keep: 7, binary: false } } as MonitorCfg;
    const now = Date.UTC(2030, 5, 10, 5, 0, 0) / 1000; // 12:00 in Asia/Jakarta
    const slot = Date.UTC(2030, 5, 10, 3 - 7 + 24, 0, 0) / 1000 - 86400; // 03:00 Jakarta = 20:00 UTC the day before
    expect(backupDue(c, slot - 10, now, 'Asia/Jakarta')).toBe(true);
    expect(backupDue(c, slot + 10, now, 'Asia/Jakarta')).toBe(false);
    expect(backupDue({ backup: { ...c.backup, freq: 'off' } } as MonitorCfg, 0, now)).toBe(false);
  });

  it('downsamples and keeps outages', () => {
    const pts: Point[] = Array.from({ length: 500 }, (_, i) => (i === 250 ? { ts: i, ok: 0 as const } : { ts: i, ok: 1 as const, lat: 10 }));
    const d = downsample(pts, 100);
    expect(d.length).toBeLessThanOrEqual(100);
    expect(d.some((p) => !p.ok)).toBe(true);
  });

  it('debounces offline / recovery alerts and keeps data per workspace', async () => {
    const { ws } = await bootstrapPlatform();
    const t2 = await makeTenant('netb');
    await Workspace.run(ws, async () => {
      const c = config();
      let st = await evaluate('r1', {}, { ts: 100, ok: 0, err: 'down' }, c);
      expect(st.online).toBe(true); // 1 failed check is not enough
      st = await evaluate('r1', st, { ts: 200, ok: 0, err: 'down' }, c);
      expect(st.online).toBe(false);
      st = await evaluate('r1', st, { ts: 300, ok: 1, cpu: 5, mem: 5, lat: 1 }, c);
      expect(st.online).toBe(false); // needs 2 good checks
      st = await evaluate('r1', st, { ts: 400, ok: 1, cpu: 5, mem: 5, lat: 1 }, c);
      expect(st.online).toBe(true);
      expect(Store.tail('alerts.log', 10).map((a) => (a as { rule: string }).rule)).toEqual(['online', 'offline']);
      saveConfig({ poll_min: 9 });
    });
    Workspace.run(t2.ws, () => {
      expect(Store.tail('alerts.log', 10)).toHaveLength(0);
      expect(config().poll_min).toBe(5);
      expect(token()).not.toBe(Workspace.run(ws, () => token()));
    });
  });

  it('polls the demo router, stores history and backups per workspace', async () => {
    const a = await makeTenant('neta');
    const b = await makeTenant('netc');
    await Workspace.run(a.ws, async () => {
      expect(await jobPoll()).toMatch(/^1 router .*, 0 tidak terjangkau.$/);
      const rid = Object.keys(state())[0]!;
      expect(history(rid).length).toBeGreaterThan(100); // demo backfill + the new point
      expect(state()[rid]!.online).toBe(true);
      saveConfig({ ping_target: '' });
      expect(await jobBackup()).toMatch(/Demo Router: (local|router file)/);
      expect(backups().length).toBe(1);
    });
    Workspace.run(b.ws, () => {
      expect(Object.keys(state())).toHaveLength(0);
      expect(backups()).toHaveLength(0);
    });
  });
});

describe('scheduler', () => {
  it('maps cron tokens to scope and ignores suspended workspaces', async () => {
    const a = await makeTenant('scha');
    const b = await makeTenant('schb');
    const tokA = Workspace.run(a.ws, () => token());
    const tokB = Workspace.run(b.ws, () => token());
    expect(tokenScope('')).toBeNull();
    expect(tokenScope('nope')).toBeNull();
    expect(tokenScope(tokA)).toEqual([a.ws]);
    expect(tokenScope(tokB)).toEqual([b.ws]);
    expect(tokenScope(platformCronToken())).toEqual(['*']);
    Workspace.setStatus(b.ws, 'suspended');
    expect(tokenScope(tokB)).toBeNull();
    Workspace.setStatus(b.ws, 'active');
  });

  it('runs due jobs for each active workspace only and honours the scope', async () => {
    const a = await makeTenant('schc');
    const b = await makeTenant('schd');
    Workspace.setStatus(b.ws, 'suspended');
    const r = await run({ only: ['poll'], force: true, source: 'test', workspaces: [a.ws, b.ws] });
    expect(r.locked).toBe(false);
    expect(r.jobs.map((j) => j.ws)).toEqual([a.ws]);
    expect(Workspace.run(a.ws, () => schedState().jobs?.poll?.runs)).toBe(1);
    expect(Workspace.run(b.ws, () => schedState().jobs)).toBeUndefined();
    // not forced and just run: poll is not due again
    const again = await Workspace.run(a.ws, () => runWorkspace(a.ws, ['poll'], false, 'test'));
    expect(again[0]).toMatchObject({ job: 'poll', ran: false });
    Workspace.setStatus(b.ws, 'active');
  });
});
