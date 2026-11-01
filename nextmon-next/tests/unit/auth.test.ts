import { beforeAll, describe, expect, it } from 'vitest';
import { Auth, Csrf } from '../../src/lib/auth.ts';
import { Audit } from '../../src/lib/audit.ts';
import { Context } from '../../src/lib/context.ts';
import { hashPassword, passwordError, verifyPassword } from '../../src/lib/password.ts';
import { Sessions } from '../../src/lib/sessions.ts';
import { Store } from '../../src/lib/store.ts';
import { CAPS, can, Users } from '../../src/lib/users.ts';
import { Workspace } from '../../src/lib/workspace.ts';
import { addStaff, bootstrapPlatform, makeTenant } from '../helpers.ts';

let ctx: { ws: string; a: string; b: string };
beforeAll(async () => {
  await bootstrapPlatform();
  const a = await makeTenant('alpha');
  const b = await makeTenant('beta');
  ctx = { ws: '', a: a.ws, b: b.ws };
});

describe('password hashing (scrypt)', () => {
  it('stores a self-describing, salted, non-plain hash and verifies it', async () => {
    const h = await hashPassword('correct horse battery');
    expect(h).toMatch(/^scrypt\$\d+\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(h).not.toContain('correct horse');
    expect(await hashPassword('correct horse battery')).not.toBe(h); // random salt
    expect((await verifyPassword('correct horse battery', h)).ok).toBe(true);
    expect((await verifyPassword('wrong', h)).ok).toBe(false);
    expect((await verifyPassword('', h)).ok).toBe(false);
  });
  it('reports needsRehash when the stored cost is below the configured one; refuses absurd parameters', async () => {
    const weak = await hashPassword('pw-12345678', 10);
    const r = await verifyPassword('pw-12345678', weak);
    expect(r).toEqual({ ok: true, needsRehash: true });
    const parts = weak.split('$');
    parts[1] = '25'; // N = 2^25 would eat gigabytes: must be refused, not computed
    expect((await verifyPassword('pw-12345678', parts.join('$'))).ok).toBe(false);
    expect((await verifyPassword('x', 'scrypt$bogus')).ok).toBe(false);
  });
  it('unknown user / missing hash still runs a hash and fails', async () => {
    expect((await verifyPassword('anything', undefined)).ok).toBe(false);
  });
  it('policy: min length, NUL, username inside password', () => {
    expect(passwordError('short', 'bob')).toBeTruthy();
    expect(passwordError('long-enough-1', 'long')).toMatch(/username/);
    expect(passwordError('abc\0defghij', 'x')).toMatch(/invalid/);
    expect(passwordError('a-good-password', 'bob')).toBeNull();
    expect(passwordError('lowercase1', 'x', { min: 8, upper: true, digit: false, symbol: false, noUsername: true })).toMatch(/upper/);
  });
});

describe('roles -> capabilities', () => {
  it('matrix', () => {
    expect(CAPS.platform).toEqual(['view', 'sell', 'write', 'admin', 'platform']);
    expect(can({ role: 'admin' }, 'admin')).toBe(true);
    expect(can({ role: 'admin' }, 'platform')).toBe(false);
    expect(can({ role: 'operator' }, 'write')).toBe(true);
    expect(can({ role: 'operator' }, 'admin')).toBe(false);
    expect(can({ role: 'reseller' }, 'sell')).toBe(true);
    expect(can({ role: 'reseller' }, 'write')).toBe(false);
    expect(can({ role: 'viewer' }, 'view')).toBe(true);
    expect(can({ role: 'viewer' }, 'sell')).toBe(false);
    expect(can({ role: 'nonsense' }, 'view')).toBe(false);
    expect(can(null, 'view')).toBe(false);
  });
  it('platform users can not be created through the normal path; usernames are unique case-insensitively', async () => {
    await expect(Users.create({ username: 'sneaky', password: 'password123', role: 'platform', workspace: ctx.a })).rejects.toThrow();
    expect(await Users.create({ username: 'OWNER-ALPHA', password: 'password123', role: 'viewer', workspace: ctx.a })).toBeNull();
  });
});

describe('first-run setup', () => {
  it('works exactly once and can be locked with NEXTMON_SETUP_TOKEN', async () => {
    // users already exist in this data dir (beforeAll): setup must refuse
    const r = await Auth.setup({ username: 'hacker', password: 'password123', password2: 'password123' });
    expect(r).toEqual({ ok: false, message: 'Setup is already completed.' });
    process.env.NEXTMON_SETUP_TOKEN = 'tok-123';
    try {
      expect(Auth.setupTokenOk('tok-123')).toBe(true);
      expect(Auth.setupTokenOk('tok-124')).toBe(false);
      expect(Auth.setupTokenOk('')).toBe(false);
      expect(Auth.setupTokenOk(null)).toBe(false);
    } finally {
      delete process.env.NEXTMON_SETUP_TOKEN;
    }
  });
});

describe('login + rate limiting', () => {
  it('right password ok; wrong / unknown give the same message and are audited', async () => {
    const ok = await Auth.attempt('owner-alpha', 'ownerpass123', '203.0.113.5');
    expect(ok.ok).toBe(true);
    const bad = await Auth.attempt('owner-alpha', 'nope-nope', '203.0.113.5');
    const unknown = await Auth.attempt('nobody-here', 'nope-nope', '203.0.113.5');
    expect(bad).toEqual({ ok: false, message: 'Wrong username or password.' });
    expect(unknown).toEqual(bad);
    const fails = Store.global('platform_audit').rows<{ action: string; detail: string }>(50, 0, { action: 'login.fail' });
    expect(fails.some((f) => f.detail === 'owner-alpha')).toBe(true);
  });

  it('5 wrong passwords lock user+ip, even the right password is refused while locked', async () => {
    for (let i = 0; i < 5; i++) await Auth.attempt('owner-beta', 'bad-' + i, '198.51.100.1');
    const r = await Auth.attempt('owner-beta', 'ownerpass123', '198.51.100.1');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.message).toMatch(/Too many attempts/);
    expect(r.ok === false && r.params?.[':m']).toBeGreaterThan(0);
  });

  it('PARALLEL guesses are counted when reserved: 40 concurrent attempts can not all be checked', async () => {
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => Auth.attempt('staff-par', 'guess-' + i, '198.51.100.77')));
    const checked = results.filter((r) => !r.ok && r.message === 'Wrong username or password.').length;
    const locked = results.filter((r) => !r.ok && /Too many/.test(r.message)).length;
    expect(checked).toBeLessThanOrEqual(5);
    expect(locked).toBeGreaterThanOrEqual(35);
  });

  it('distributed guessing: one username from many IPs locks the username (per-username lock)', async () => {
    await addStaff(ctx.a, 'victim', 'viewer', 'victimpass123');
    let lockedAt = -1;
    for (let i = 0; i < 40; i++) {
      const r = await Auth.attempt('victim', 'wrong-' + i, `192.0.2.${i + 1}`); // a different IP every time
      if (!r.ok && /Too many/.test(r.message)) {
        lockedAt = i;
        break;
      }
    }
    expect(lockedAt).toBeGreaterThan(0);
    expect(lockedAt).toBeLessThanOrEqual(30);
    const real = await Auth.attempt('victim', 'victimpass123', '192.0.2.250');
    expect(real.ok).toBe(false); // the real user is held off too while the account is under attack (10 min)
  });

  it('password spraying: one IP across many usernames trips the IP lock', async () => {
    let locked = false;
    for (let i = 0; i < 40 && !locked; i++) {
      const r = await Auth.attempt('spray' + i, 'password', '192.0.2.200');
      locked = !r.ok && /Too many/.test(r.message);
    }
    expect(locked).toBe(true);
  });

  it('a successful login clears the user counters', async () => {
    for (let i = 0; i < 3; i++) await Auth.attempt('owner-alpha', 'bad' + i, '203.0.113.99');
    expect((await Auth.attempt('owner-alpha', 'ownerpass123', '203.0.113.99')).ok).toBe(true);
    for (let i = 0; i < 4; i++) await Auth.attempt('owner-alpha', 'bad' + i, '203.0.113.99');
    expect((await Auth.attempt('owner-alpha', 'ownerpass123', '203.0.113.99')).ok).toBe(true); // 4 < 5: not locked
  });

  it('disabled users and suspended workspaces can not log in; the platform admin still can', async () => {
    const c = await makeTenant('gamma');
    const staff = await addStaff(c.ws, 'gamma-staff', 'operator');
    Users.update(staff.id, { disabled: true });
    expect((await Auth.attempt('gamma-staff', 'staffpass123', '10.1.1.1')).ok).toBe(false);
    Users.update(staff.id, { disabled: false });
    Workspace.setStatus(c.ws, 'suspended');
    const r = await Auth.attempt('owner-gamma', 'ownerpass123', '10.1.1.2');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.message).toMatch(/suspended/);
    Workspace.setStatus(c.ws, 'active');
    expect((await Auth.attempt('owner-gamma', 'ownerpass123', '10.1.1.3')).ok).toBe(true);
  });
});

describe('sessions', () => {
  it('stores only a hash, validates, binds to the workspace of the user, dies with the user / suspension', async () => {
    const u = Users.find('owner-alpha')!;
    const { token, csrf } = Sessions.create(u, u.workspace, { ip: '1.2.3.4', ua: 'vitest' });
    expect(token.length).toBeGreaterThan(30);
    const raw = JSON.stringify(Store.allNames());
    expect(raw).not.toContain(token);
    const r = Sessions.resolve(token)!;
    expect(r.user.id).toBe(u.id);
    expect(r.session.csrf).toBe(csrf);
    expect(r.workspace.id).toBe(ctx.a);
    expect(Sessions.resolve('x'.repeat(40))).toBeNull();
    expect(Sessions.resolve(undefined)).toBeNull();
    Workspace.setStatus(ctx.a, 'suspended');
    expect(Sessions.resolve(token)).toBeNull();
    Workspace.setStatus(ctx.a, 'active');
  });

  it('a normal user can never be moved into someone else\'s workspace, only a platform admin can switch', async () => {
    const u = Users.find('owner-alpha')!;
    const { token } = Sessions.create(u, ctx.b, { ip: '1.1.1.1', ua: '' }); // forged: session says workspace B
    expect(Sessions.resolve(token)).toBeNull();
    const p = Users.find('root')!;
    const s = Sessions.create(p, p.workspace, { ip: '1.1.1.1', ua: '' });
    const r1 = Sessions.resolve(s.token)!;
    Sessions.setWorkspace(r1.session.hash, ctx.b);
    const r2 = Sessions.resolve(s.token)!;
    expect(r2.workspace.id).toBe(ctx.b);
    expect(r2.user.role).toBe('platform');
  });

  it('idle timeout and logout destroy the session', async () => {
    const u = Users.find('owner-beta')!;
    const { token } = Sessions.create(u, u.workspace, { ip: '1.1.1.1', ua: '' });
    process.env.NEXTMON_SESSION_IDLE_MIN = '1';
    try {
      expect(Sessions.resolve(token)).not.toBeNull();
      const { db } = await import('../../src/lib/db.ts');
      db().st('UPDATE sessions SET last = ? WHERE uid = ?').run(Math.floor(Date.now() / 1000) - 120, u.id);
      expect(Sessions.resolve(token)).toBeNull();
    } finally {
      delete process.env.NEXTMON_SESSION_IDLE_MIN;
    }
    const s2 = Sessions.create(u, u.workspace, { ip: '1.1.1.1', ua: '' });
    Sessions.destroy(s2.token);
    expect(Sessions.resolve(s2.token)).toBeNull();
  });

  it('resolve(token, false) does not count as activity', async () => {
    const u = Users.find('owner-beta')!;
    const { token } = Sessions.create(u, u.workspace, { ip: '1.1.1.1', ua: '' });
    const { db } = await import('../../src/lib/db.ts');
    const old = Math.floor(Date.now() / 1000) - 600;
    db().st('UPDATE sessions SET last = ? WHERE uid = ?').run(old, u.id);
    Sessions.resolve(token, false);
    expect(Number(db().st('SELECT MAX(last) AS l FROM sessions WHERE uid = ?').get(u.id)?.l)).toBe(old);
    Sessions.resolve(token, true);
    expect(Number(db().st('SELECT MAX(last) AS l FROM sessions WHERE uid = ?').get(u.id)?.l)).toBeGreaterThan(old);
  });
});

describe('CSRF', () => {
  it('session token: exact match only', () => {
    const t = 'a'.repeat(48);
    expect(Csrf.verify(t, t)).toBe(true);
    for (const bad of ['', 'a'.repeat(47), 'a'.repeat(49), 'b'.repeat(48), null, undefined, 5, ['a'.repeat(48)]]) expect(Csrf.verify(bad, t)).toBe(false);
    expect(Csrf.verify(t, '')).toBe(false);
  });
  it('pre-login token: purpose-bound, expiring, tamper-proof', () => {
    const tok = Csrf.pre('login');
    expect(Csrf.verifyPre('login', tok)).toBe(true);
    expect(Csrf.verifyPre('setup', tok)).toBe(false);
    expect(Csrf.verifyPre('login', tok + 'x')).toBe(false);
    expect(Csrf.verifyPre('login', Csrf.pre('login', -10))).toBe(false);
    expect(Csrf.verifyPre('login', 'garbage')).toBe(false);
    expect(Csrf.verifyPre('login', undefined)).toBe(false);
  });
});

describe('audit', () => {
  it('records actor / workspace / ip from the context; impersonation also lands in the platform log', () => {
    Context.run({ ws: ctx.a, ip: '9.9.9.9', actor: { id: 'u1', username: 'alice', role: 'admin', workspace: ctx.a } }, () => Audit.log('thing.done', 'detail\x07 with ctrl'));
    const row = Workspace.run(ctx.a, () => Audit.tail(1))[0]!;
    expect(row).toMatchObject({ user: 'alice', workspace: ctx.a, ip: '9.9.9.9', action: 'thing.done', detail: 'detail with ctrl' });
    Context.run({ ws: ctx.b, impersonating: true, ip: '8.8.8.8', actor: { id: 'p', username: 'root', role: 'platform', workspace: ctx.ws } }, () => Audit.log('platform.touch', 'x'));
    expect(Audit.platformTail(5).some((r) => r.action === 'platform.touch' && r.impersonating)).toBe(true);
    expect(Workspace.run(ctx.b, () => Audit.tail(5)).some((r) => r.action === 'platform.touch')).toBe(true);
    expect(Workspace.run(ctx.a, () => Audit.tail(50)).some((r) => r.action === 'platform.touch')).toBe(false);
  });
});
