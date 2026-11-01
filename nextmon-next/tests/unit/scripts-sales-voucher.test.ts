import { describe, expect, it } from 'vitest';
import { DemoDriver } from '../../src/lib/demo.ts';
import { byProfile, daily, filter, parse, recordName, sum, ts, zonedParts, zonedToTs } from '../../src/lib/sales.ts';
import { MODES, onLogin, parseMeta, seconds, validDuration } from '../../src/lib/scripts.ts';
import { saveSettings } from '../../src/lib/store.ts';
import { AMBIGUOUS, batchOf, CHARSETS, code, expiryOf, generate, loginUrl } from '../../src/lib/voucher.ts';
import { Workspace } from '../../src/lib/workspace.ts';

const WS = 'w_cccccccc';
const demo = (id: string) => new DemoDriver(WS, id, 'Asia/Jakarta');

describe('on-login script generator', () => {
  it('mode none / unknown mode yields an empty script', () => {
    expect(onLogin('none', '1000', '1d', '1000', false, false, 'p')).toBe('');
    expect(onLogin('bogus', '1000', '1d', '1000', false, false, 'p')).toBe('');
  });
  it('metadata line first and parseMeta round-trips for every mode', () => {
    for (const m of MODES.filter((x) => x !== 'none')) {
      const s = onLogin(m, '5.000', '1d2h', '6000', true, false, 'Gold');
      expect(s.startsWith(`:put (",${m},5000,1d2h,6000,,Enable,Disable,");`)).toBe(true);
      expect(parseMeta(s)).toEqual({ mode: m, price: '5000', validity: '1d2h', sprice: '6000', lock_user: true, lock_server: false });
    }
  });
  it('braces, brackets and unescaped quotes are balanced', () => {
    for (const m of ['rem', 'ntf', 'remc', 'ntfc']) {
      for (const [lu, ls] of [[true, true], [false, false]] as const) {
        const s = onLogin(m, '1000', '30m', '', lu, ls, 'P 1');
        expect(s.split('{').length).toBe(s.split('}').length);
        expect(s.split('[').length).toBe(s.split(']').length);
        expect((s.match(/(?<!\\)"/g) ?? []).length % 2).toBe(0);
      }
    }
  });
  it('record modes add the sale script, non-record modes do not', () => {
    const c = onLogin('remc', '1000', '1d', '1500', false, false, 'Gold');
    expect(c).toContain('/system script add name="$date-|-$time-|-$user-|-1500-|-$address-|-$mac-|-1d-|-Gold-|-$comment"');
    expect(onLogin('rem', '1000', '1d', '1500', false, false, 'Gold')).not.toContain('/system script add');
  });
  it('rem removes the user, ntf only blocks it', () => {
    expect(onLogin('rem', '1', '1d', '1', false, false, 'p')).toContain('/ip hotspot user remove');
    const ntf = onLogin('ntf', '1', '1d', '1', false, false, 'p');
    expect(ntf).not.toContain('/ip hotspot user remove');
    expect(ntf).toContain('limit-uptime=1s');
  });
  it('no validity => no scheduler; invalid validity is dropped (injection)', () => {
    expect(onLogin('rem', '1', '', '1', false, false, 'p')).not.toContain('/system scheduler add');
    expect(onLogin('rem', '1', '1d; /system reset-configuration', '1', false, false, 'p')).not.toContain('reset-configuration');
    expect(onLogin('rem', '1', '1d\n/system reset-configuration', '1', false, false, 'p')).not.toContain('reset-configuration');
  });
  it('attacker-controlled text never reaches the script (digits-only prices, sanitised profile)', () => {
    const s = onLogin('remc', '10"; /x', '1d', '5$(evil)', false, false, 'a"; :put pwn; "b');
    expect(s).not.toContain('pwn;');
    expect(s).not.toContain('evil');
    expect(parseMeta(s)).toMatchObject({ price: '10', sprice: '5' });
  });
  it('seconds / validDuration', () => {
    expect(seconds('1d2h3m4s')).toBe(93784);
    expect(seconds('1w')).toBe(604800);
    expect(seconds('')).toBe(0);
    expect(validDuration('') && validDuration('1d') && validDuration('1w2d3h4m5s')).toBe(true);
    for (const bad of ['1x', 'd', '1d ', '1d\n', ' 1d', '1d;', '9999999999d']) expect(validDuration(bad), bad).toBe(false);
  });
});

describe('sales parsing (Mikhmon-compatible)', () => {
  const tz = 'Asia/Jakarta';
  const rows = parse(
    [
      { '.id': '*1', name: 'oct/12/2026-|-10:00:00-|-u1-|-5000-|-10.0.0.2-|-AA:BB-|-1d-|-Gold-|-vc-001-10.12.26' },
      { '.id': '*2', name: 'oct/13/2026-|-11:30:00-|-u2-|-7000-|-10.0.0.3-|-CC:DD-|-3d-|-Silver-|-' },
      { '.id': '*3', name: 'garbage' },
    ],
    tz,
  );
  it('parses, sorts newest first and ignores garbage', () => {
    expect(rows).toHaveLength(2);
    expect(rows[0]!.user).toBe('u2');
    expect(sum(rows)).toBe(12000);
    expect(rows[1]!.ts).toBe(zonedToTs(2026, 10, 12, 10, 0, 0, tz));
    expect(rows[1]!.ts).toBe(Date.UTC(2026, 9, 12, 3, 0, 0) / 1000); // Jakarta = UTC+7
  });
  it('filter / daily / byProfile', () => {
    expect(filter(rows, 'day', '2026-10-12', '', tz)).toHaveLength(1);
    expect(filter(rows, 'month', '2026-10', '', tz)).toHaveLength(2);
    expect(filter(rows, 'all', '', 'Gold', tz)).toHaveLength(1);
    expect(daily(rows, tz)).toEqual({ '2026-10-12': 5000, '2026-10-13': 7000 });
    expect(byProfile(rows)).toEqual({ Silver: 7000, Gold: 5000 });
  });
  it('ts() understands both date styles and rejects nonsense', () => {
    expect(ts('2026-01-05', '01:02:03', tz)).toBe(zonedToTs(2026, 1, 5, 1, 2, 3, tz));
    expect(ts('nonsense', '00:00:00', tz)).toBe(0);
  });
  it('recordName round-trips through parse', () => {
    const t = zonedToTs(2026, 3, 4, 9, 8, 7, tz);
    const name = recordName({ ts: t, user: 'uu', price: 2500, profile: 'P', validity: '1d' }, tz);
    const r = parse([{ name }], tz);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ ts: t, price: 2500, user: 'uu', profile: 'P' });
    expect(zonedParts(t, tz)).toMatchObject({ y: 2026, mo: 3, d: 4, h: 9, mi: 8, s: 7 });
  });
});

describe('voucher generator', () => {
  it('code() honours length and charset for every charset; unknown charset falls back', () => {
    for (const [name, set] of Object.entries(CHARSETS)) {
      for (const len of [3, 6, 9, 12, 16]) {
        const c = code(len, name);
        expect(c).toHaveLength(len);
        expect([...c].every((ch) => set.includes(ch))).toBe(true);
      }
    }
    expect([...code(50, 'bogus')].every((c) => CHARSETS.lowernum!.includes(c))).toBe(true);
  });
  it('letter charsets have no ambiguous characters; the strict "safe" sets drop look-alike pairs', () => {
    for (const n of ['lower', 'upper', 'lowernum', 'uppernum', 'mixed']) expect([...AMBIGUOUS].some((c) => CHARSETS[n]!.includes(c)), n).toBe(false);
    for (const n of ['safe', 'safeupper']) {
      expect(CHARSETS[n]).not.toMatch(/[0O1lIioSsZzBbQqGgVv258]/);
      expect(CHARSETS[n]!.length).toBeGreaterThanOrEqual(20);
    }
  });
  it('codes are random', () => {
    expect(new Set(Array.from({ length: 50 }, () => code(8, 'mixed'))).size).toBeGreaterThan(45);
  });
  it('generate: qty, prefix, uniqueness, vc mode user==pass, comment format, users created on the driver', async () => {
    const r = demo('gen1');
    const o = await Workspace.run(WS, () => generate(r, { profile: 'default', qty: 120, prefix: 'ab-', length: 5, charset: 'num', mode: 'vc', batch: 'Test 1' })); // generate() counts toward the workspace quota
    expect(o.items).toHaveLength(120);
    expect(new Set(o.items.map((i) => i[0])).size).toBe(120);
    for (const [n, p] of o.items) {
      expect(n).toMatch(/^ab-\d{5}$/);
      expect(p).toBe(n);
    }
    expect(o.comment).toMatch(/^vc-\d{3}-\d\d\.\d\d\.\d\d-Test 1$/);
    expect(batchOf(o.comment)).toBe(o.comment);
    expect(await r.print('/ip/hotspot/user', { comment: o.comment })).toHaveLength(120);
  });
  it('up mode has separate passwords, avoids existing names, caps by max_qty', async () => {
    Workspace.run(WS, () => saveSettings({ max_qty: 10 }));
    const r = demo('gen2');
    const o = await Workspace.run(WS, () => generate(r, { profile: 'default', qty: 9999, length: 4, charset: 'lowernum', mode: 'up' }));
    expect(o.items).toHaveLength(10);
    expect(o.items.filter(([n, p]) => n !== p).length).toBeGreaterThanOrEqual(8);
    const o2 = await Workspace.run(WS, () => generate(r, { profile: 'default', qty: 5, length: 4, charset: 'num', mode: 'vc' }));
    const all = [...o.items, ...o2.items].map((i) => i[0]);
    expect(new Set(all).size).toBe(all.length);
  });
  it('small keyspace stops instead of looping forever', async () => {
    Workspace.run(WS, () => saveSettings({ max_qty: 500 }));
    const t = Date.now();
    const o = await Workspace.run(WS, () => generate(demo('gen3'), { profile: 'default', qty: 100, length: 3, charset: 'num' }));
    expect(o.items.length).toBeGreaterThan(0);
    expect(o.items.length).toBeLessThanOrEqual(100);
    expect(Date.now() - t).toBeLessThan(5000);
    expect(new Set(o.items.map((i) => i[0])).size).toBe(o.items.length);
  });
  it('prefix and batch are sanitised; length clamped', async () => {
    const o = await Workspace.run(WS, () => generate(demo('gen4'), { profile: 'default', qty: 1, prefix: 'a<b>"c', length: 99, charset: 'num', batch: '<x>y;z' }));
    expect(o.items[0]![0]).toMatch(/^abc\d{16}$/);
    expect(o.comment).not.toMatch(/[<>;"]/);
  });
  it('expiryOf / batchOf / loginUrl', () => {
    expect(expiryOf('oct/12/2026 10:00:00 vc-123-10.28.26-x')).toBe('oct/12/2026 10:00:00');
    expect(expiryOf('vc-123-10.28.26')).toBe('');
    expect(batchOf('oct/12/2026 10:00:00 vc-123-10.28.26-x')).toBe('vc-123-10.28.26-x');
    expect(batchOf('random comment')).toBe('');
    Workspace.run(WS, () => {
      saveSettings({ login_url: 'http://h/login' });
      expect(loginUrl('a b', 'p&q')).toBe('http://h/login?username=a%20b&password=p%26q');
      saveSettings({ login_url: 'http://h/login?x=1' });
      expect(loginUrl('u', 'p')).toBe('http://h/login?x=1&username=u&password=p');
    });
  });
});
