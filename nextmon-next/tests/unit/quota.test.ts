/** Per-workspace limits: vouchers_per_day (lib/quota.ts) and log_rows (capped logs in Store.append). */
import { beforeAll, describe, expect, it } from 'vitest';
import { DemoDriver } from '../../src/lib/demo.ts';
import { Audit } from '../../src/lib/audit.ts';
import { logUsage, QuotaError, Quota } from '../../src/lib/quota.ts';
import { CAPPED_LOGS, saveSettings, Store } from '../../src/lib/store.ts';
import { generate } from '../../src/lib/voucher.ts';
import { Workspace } from '../../src/lib/workspace.ts';
import { bootstrapPlatform } from '../helpers.ts';

let MAIN: string;
const mk = async (slug: string, limits: Record<string, number>) => {
  const { workspace } = await Workspace.create({ name: slug.toUpperCase(), slug, owner: { username: 'owner-' + slug, password: 'ownerpass123' }, limits });
  return workspace.id;
};
const demo = (ws: string, id: string) => new DemoDriver(ws, id, 'Asia/Jakarta');
const gen = (r: DemoDriver, qty: number) => generate(r, { profile: 'default', qty, length: 6, charset: 'lowernum', mode: 'vc' });

beforeAll(async () => {
  MAIN = (await bootstrapPlatform()).ws;
});

describe('vouchers_per_day', () => {
  it('exact boundary passes, the next voucher is refused with used/limit and nothing is created or counted', async () => {
    const a = await mk('quota-a1', { vouchers_per_day: 10, log_rows: 0 });
    const r = demo(a, 'a1');
    await Workspace.run(a, async () => {
      expect((await gen(r, 10)).items).toHaveLength(10);
      expect(Quota.used()).toBe(10);
      const before = (await r.print('/ip/hotspot/user')).length;
      const e = await gen(r, 1).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(QuotaError);
      expect((e as QuotaError).used).toBe(10);
      expect((e as QuotaError).limit).toBe(10);
      expect((e as QuotaError).message).toContain('10 of 10');
      expect((await r.print('/ip/hotspot/user')).length).toBe(before);
      expect(Quota.used()).toBe(10);
    });
  });

  it('a batch that does not fit is refused as a whole; the remainder still fits', async () => {
    const a = await mk('quota-a2', { vouchers_per_day: 10, log_rows: 0 });
    const r = demo(a, 'a2');
    await Workspace.run(a, async () => {
      await gen(r, 7);
      const before = (await r.print('/ip/hotspot/user')).length;
      await expect(gen(r, 5)).rejects.toBeInstanceOf(QuotaError);
      expect((await r.print('/ip/hotspot/user')).length).toBe(before);
      expect(Quota.used()).toBe(7);
      await gen(r, 3);
      expect(Quota.used()).toBe(10);
    });
  });

  it('splitting into many small (even parallel) requests cannot exceed the limit', async () => {
    const a = await mk('quota-a3', { vouchers_per_day: 10, log_rows: 0 });
    const r = demo(a, 'a3');
    await Workspace.run(a, async () => {
      const res = await Promise.allSettled(Array.from({ length: 30 }, () => gen(r, 1)));
      expect(res.filter((x) => x.status === 'fulfilled')).toHaveLength(10);
      expect(res.filter((x) => x.status === 'rejected').every((x) => (x as PromiseRejectedResult).reason instanceof QuotaError)).toBe(true);
      expect(Quota.used()).toBe(10);
    });
  });

  it('rolls back when generation fails', async () => {
    const a = await mk('quota-a4', { vouchers_per_day: 10, log_rows: 0 });
    class Broken extends DemoDriver {
      override async addMany(): Promise<string[]> {
        throw new Error('router down');
      }
    }
    await Workspace.run(a, async () => {
      await expect(gen(new Broken(a, 'bad', 'Asia/Jakarta'), 6)).rejects.toThrow('router down');
      expect(Quota.used()).toBe(0);
      await gen(demo(a, 'a4'), 10); // the full limit is still available
      expect(Quota.used()).toBe(10);
    });
  });

  it('guard() releases on throw and keeps the count on success', async () => {
    const a = await mk('quota-a5', { vouchers_per_day: 5, log_rows: 0 });
    await Workspace.run(a, async () => {
      expect(await Quota.guard(2, () => 'ok')).toBe('ok');
      expect(Quota.used()).toBe(2);
      await expect(
        Quota.guard(2, () => {
          throw new Error('x');
        }),
      ).rejects.toThrow('x');
      expect(Quota.used()).toBe(2);
      await expect(Quota.guard(4, () => 'never')).rejects.toBeInstanceOf(QuotaError);
      expect(Quota.used()).toBe(2);
    });
  });

  it('tenant isolation: workspace A usage does not affect B', async () => {
    const a = await mk('quota-iso-a', { vouchers_per_day: 3, log_rows: 0 });
    const b = await mk('quota-iso-b', { vouchers_per_day: 3, log_rows: 0 });
    await Workspace.run(a, async () => {
      await gen(demo(a, 'ia'), 3);
      await expect(gen(demo(a, 'ia'), 1)).rejects.toBeInstanceOf(QuotaError);
    });
    expect(Quota.used(b)).toBe(0);
    expect(Quota.used(a)).toBe(3);
    await Workspace.run(b, async () => expect((await gen(demo(b, 'ib'), 3)).items).toHaveLength(3));
    expect(Quota.usage(b)).toEqual({ used: 3, limit: 3 });
  });

  it('unlimited when the limit is 0, and for the main workspace', async () => {
    const a = await mk('quota-unl', { vouchers_per_day: 0, log_rows: 0 });
    await Workspace.run(a, async () => {
      await gen(demo(a, 'u1'), 40);
      await gen(demo(a, 'u1'), 40);
      expect(Quota.used()).toBe(0); // nothing counted
    });
    expect(Workspace.limits(MAIN).vouchers_per_day).toBe(0);
    expect(Workspace.limits(MAIN).log_rows).toBe(0);
    await Workspace.run(MAIN, async () => {
      await gen(demo(MAIN, 'm1'), 60);
      expect(Quota.usage().limit).toBe(0);
    });
  });

  it('the day follows the workspace timezone and an old day does not count', async () => {
    const a = await mk('quota-tz', { vouchers_per_day: 5, log_rows: 0 });
    await Workspace.run(a, () => {
      saveSettings({ timezone: 'Pacific/Kiritimati' }); // UTC+14
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Kiritimati', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      expect(Quota.day()).toBe(today);
      Quota.reserve(5);
      expect(() => Quota.reserve(1)).toThrow(QuotaError);
      Store.write('quota', { day: '2000-01-01', used: 5 });
      expect(Quota.used()).toBe(0);
      Quota.reserve(5);
      expect(Quota.used()).toBe(5);
    });
  });

  it('release never goes below zero and leaves another day alone', async () => {
    const a = await mk('quota-rel', { vouchers_per_day: 5, log_rows: 0 });
    await Workspace.run(a, () => {
      const t = Quota.reserve(3);
      Quota.release(t);
      Quota.release(t);
      expect(Quota.used()).toBe(0);
      const t2 = Quota.reserve(2);
      Store.write('quota', { day: '2000-01-01', used: 9 });
      Quota.release(t2);
      expect(Store.read<{ used: number }>('quota', { used: -1 }).used).toBe(9);
    });
  });
});

describe('log_rows', () => {
  it('caps audit / notify / alerts / wizard logs per workspace (oldest dropped), other collections and platform_audit untouched', async () => {
    const a = await mk('quota-log-a', { vouchers_per_day: 0, log_rows: 20 });
    const b = await mk('quota-log-b', { vouchers_per_day: 0, log_rows: 0 });
    Workspace.run(a, () => {
      for (const l of CAPPED_LOGS) {
        for (let i = 1; i <= 60; i++) Store.append(l, { n: i });
        expect(Store.count(l)).toBe(20);
        expect(Store.tail<{ n: number }>(l, 1)[0]!.n).toBe(60);
        const rows = Store.rows<{ n: number }>(l, 100);
        expect(rows.at(-1)!.n).toBe(41);
      }
      for (let i = 0; i < 30; i++) Store.append('pos-x.log', { i }); // not capped (sales record)
      expect(Store.count('pos-x.log')).toBe(30);
      for (let i = 0; i < 30; i++) Audit.log('t.x', 'row ' + i); // the real writer is capped too
      expect(Store.count('audit.log')).toBe(20);
      expect(logUsage(a)).toEqual({ used: 20, limit: 20 });
    });
    Workspace.run(b, () => {
      for (let i = 1; i <= 60; i++) Store.append('audit.log', { n: i });
      expect(Store.count('audit.log')).toBe(60); // unlimited, and A's cap did not touch B
    });
    Workspace.run(MAIN, () => {
      for (let i = 1; i <= 60; i++) Store.append('audit.log', { n: i });
      expect(Store.count('audit.log')).toBeGreaterThanOrEqual(60); // main is unlimited
    });
    const pa = Store.global('platform_audit').count();
    for (let i = 0; i < 60; i++) Store.global('platform_audit').append({ n: i });
    expect(Store.global('platform_audit').count()).toBe(pa + 60);
  });

  it('a lowered limit trims on the next append', async () => {
    const a = await mk('quota-log-c', { vouchers_per_day: 0, log_rows: 0 });
    Workspace.run(a, () => {
      for (let i = 1; i <= 50; i++) Store.append('notify.log', { n: i });
      expect(Store.count('notify.log')).toBe(50);
      Workspace.update(a, { limits: { log_rows: 10 } });
      Store.append('notify.log', { n: 51 });
      expect(Store.count('notify.log')).toBe(10);
      expect(Store.tail<{ n: number }>('notify.log', 1)[0]!.n).toBe(51);
    });
  });
});
