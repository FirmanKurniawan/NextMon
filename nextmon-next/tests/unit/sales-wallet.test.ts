/** Reseller wallet: charge / rollback / refund / credit limit, IDOR guard on batches, CSV injection, tenant isolation. */
import { beforeAll, describe, expect, it } from 'vitest';
import { Reseller } from '../../src/lib/reseller.ts';
import { Workspace } from '../../src/lib/workspace.ts';
import { reportFilters, ownerOf } from '../../src/features/reports/data.ts';
import { ledgerFilters } from '../../src/features/resellers/ui.tsx';
import { addStaff, bootstrapPlatform, makeTenant } from '../helpers.ts';

let A: { ws: string };
let B: { ws: string };
let ra: { id: string; username: string; role: string };
let rb: { id: string; username: string; role: string };

beforeAll(async () => {
  await bootstrapPlatform();
  A = await makeTenant('wal-a');
  B = await makeTenant('wal-b');
  ra = await addStaff(A.ws, 'res-a', 'reseller');
  rb = await addStaff(B.ws, 'res-b', 'reseller');
});

describe('wallet', () => {
  it('charges, enforces the credit limit, rolls back and refunds with commission reversal', () => {
    Workspace.run(A.ws, () => {
      Reseller.saveCfg(ra.id, { active: true, commission: 10, adj: -10, credit: 0, allow_all: true });
      expect(Reseller.topup(ra.id, 10000, 'bank').ok).toBe(true);
      const tk = Reseller.charge(ra, 'p1', 5000, 1);
      expect(Reseller.isBlocked(tk)).toBe(false);
      if (!tk || Reseller.isBlocked(tk)) throw new Error('blocked');
      expect(tk.cost).toBe(4500);
      expect(tk.comm).toBe(500);
      expect(Reseller.balance(ra.id)).toBe(6000);
      Reseller.rollback(tk, 'x');
      expect(Reseller.balance(ra.id)).toBe(10000);
      // too expensive: blocked, balance untouched
      const big = Reseller.charge(ra, 'p1', 50000, 1);
      expect(Reseller.isBlocked(big)).toBe(true);
      expect(Reseller.balance(ra.id)).toBe(10000);
      // refund a real sale, once
      const t2 = Reseller.charge(ra, 'p1', 5000, 1);
      if (!t2 || Reseller.isBlocked(t2)) throw new Error('blocked');
      expect(Reseller.refund(t2.sale, 'admin').ok).toBe(true);
      expect(Reseller.refund(t2.sale, 'admin').ok).toBe(false);
      expect(Reseller.balance(ra.id)).toBe(10000);
    });
  });

  it('inactive resellers and non resellers', () => {
    Workspace.run(A.ws, () => {
      Reseller.saveCfg(ra.id, { active: false, allow_all: true });
      expect(Reseller.isBlocked(Reseller.charge(ra, 'p1', 1000, 1))).toBe(true);
      expect(Reseller.charge({ id: 'x', username: 'op', role: 'operator' }, 'p1', 1000, 1)).toBeNull();
    });
  });

  it('batch ownership (IDOR): a reseller only reaches own batches', () => {
    Workspace.run(A.ws, () => {
      Reseller.recordBatch(ra, 'vc-123');
      expect(Reseller.mayPrint(ra, 'vc-123')).toBe(true);
      expect(Reseller.mayPrint(ra, 'vc-999')).toBe(false);
      expect(Reseller.mayPrint({ id: 'op', username: 'op', role: 'operator' }, 'vc-999')).toBe(true);
    });
  });

  it('is isolated per workspace', () => {
    Workspace.run(B.ws, () => {
      expect(Reseller.balance(ra.id)).toBe(0);
      expect(Reseller.rows({}).length).toBe(0);
      expect(Reseller.cfg(ra.id)).toBeNull();
      Reseller.topup(rb.id, 777, 'b');
    });
    Workspace.run(A.ws, () => {
      expect(Reseller.balance(rb.id)).toBe(0);
      expect(Reseller.rows({}).every((r) => r.uid === ra.id)).toBe(true);
    });
  });

  it('neutralises spreadsheet formulas in CSV', () => {
    expect(Reseller.cell('=1+1')).toBe("'=1+1");
    expect(Reseller.cell('-5')).toBe('-5');
    expect(Reseller.cell('hello')).toBe('hello');
  });
});

describe('filters', () => {
  it('reportFilters falls back on invalid values', () => {
    expect(reportFilters({ period: 'bogus' }).period).toBe('month');
    expect(reportFilters({ period: 'day', value: 'x' }).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(reportFilters({ period: 'all', value: 'zzz' }).value).toBe('');
    expect(ownerOf({ period: 'month', value: '2026-11', profile: '' })).toBe('nov2026');
  });
  it('ledgerFilters forces uid and validates dates', () => {
    expect(ledgerFilters({ uid: 'other', from: 'bad' }, 'me')).toMatchObject({ uid: 'me', from: '' });
    expect(ledgerFilters({ from: '2026-01-02' }).from).toBe('2026-01-02');
  });
});
