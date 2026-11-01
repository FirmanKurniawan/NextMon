/** Settings / security / notifications logic: staff rules + limits, API keys, policy, sessions visibility, webhook SSRF, secret rotation. */
import { beforeAll, describe, expect, it } from 'vitest';
import { visibleSessions } from '../../src/features/security/data.ts';
import { ApiKeys } from '../../src/lib/apikeys.ts';
import { Crypto } from '../../src/lib/crypto.ts';
import { Notify } from '../../src/lib/notify.ts';
import { Security } from '../../src/lib/security.ts';
import { Sessions } from '../../src/lib/sessions.ts';
import { changePassword, deleteUser, saveUser, staffUsage } from '../../src/lib/staff.ts';
import { getSettings, Store } from '../../src/lib/store.ts';
import { Users } from '../../src/lib/users.ts';
import { Workspace } from '../../src/lib/workspace.ts';
import '../../src/features/notifications/secrets.ts';
import { bootstrapPlatform, makeTenant } from '../helpers.ts';


let A: Awaited<ReturnType<typeof makeTenant>>;
let B: Awaited<ReturnType<typeof makeTenant>>;

beforeAll(async () => {
  await bootstrapPlatform();
  A = await makeTenant('auth-a');
  B = await makeTenant('auth-b');
});

describe('staff management', () => {
  it('owner creates staff, never owner accounts; limit is enforced', async () => {
    const owner = Users.byId(A.owner.id)!;
    const r1 = await Workspace.run(A.ws, () => saveUser(owner, A.ws, { id: '', username: 'op-a', role: 'operator', password: 'Operator-pass-1' }));
    expect(r1.ok).toBe(true);
    const r2 = await Workspace.run(A.ws, () => saveUser(owner, A.ws, { id: '', username: 'boss-a', role: 'admin', password: 'Operator-pass-1' }));
    expect(r2).toMatchObject({ ok: false, msg: 'Only the platform admin can create owner accounts.' });
    Workspace.update(A.ws, { limits: { staff: 1 } });
    expect(staffUsage(A.ws)).toEqual({ used: 1, max: 1 });
    const r3 = await Workspace.run(A.ws, () => saveUser(owner, A.ws, { id: '', username: 'op-a2', role: 'viewer', password: 'Operator-pass-1' }));
    expect(r3).toMatchObject({ ok: false, msg: 'Your plan allows at most :n staff accounts.' });
  });

  it('cannot touch users of another workspace, whatever id is posted', async () => {
    const ownerB = Users.byId(B.owner.id)!;
    const target = Users.inWorkspace(A.ws).find((u) => u.username === 'op-a')!;
    const del = await Workspace.run(B.ws, () => deleteUser(ownerB, B.ws, target.id));
    expect(del).toMatchObject({ ok: false, msg: 'User not found.' });
    const upd = await Workspace.run(B.ws, () => saveUser(ownerB, B.ws, { id: target.id, username: 'x', role: 'viewer', password: '' }));
    expect(upd).toMatchObject({ ok: false, msg: 'User not found.' });
    expect(Users.byId(target.id)?.role).toBe('operator');
  });

  it('last admin cannot be demoted; self delete refused; password reset kills sessions', async () => {
    const owner = Users.byId(A.owner.id)!;
    const demote = await Workspace.run(A.ws, () => saveUser(owner, A.ws, { id: owner.id, username: owner.username, role: 'viewer', password: '' }));
    expect(demote).toMatchObject({ ok: false, msg: 'Cannot demote the last admin.' });
    expect(await Workspace.run(A.ws, () => deleteUser(owner, A.ws, owner.id))).toMatchObject({ ok: false, msg: 'You cannot delete yourself.' });
    const op = Users.inWorkspace(A.ws).find((u) => u.username === 'op-a')!;
    Sessions.create(op, A.ws, { ip: '1.1.1.1', ua: 'x' });
    expect(Sessions.listFor(op.id).length).toBe(1);
    const reset = await Workspace.run(A.ws, () => saveUser(owner, A.ws, { id: op.id, username: op.username, role: 'operator', password: 'Brand-new-pass-2' }));
    expect(reset.ok).toBe(true);
    expect(Sessions.listFor(op.id).length).toBe(0);
  });

  it('changePassword checks the current password and keeps only the current session', async () => {
    const u = Users.byId(A.owner.id)!;
    const keep = Sessions.create(u, A.ws, { ip: '1.1.1.1', ua: 'keep' });
    Sessions.create(u, A.ws, { ip: '2.2.2.2', ua: 'drop' });
    const hash = Sessions.listFor(u.id).find((s) => s.ua === 'keep')!.hash;
    void keep;
    const bad = await Workspace.run(A.ws, () => changePassword(u, hash, { current: 'nope', next: 'Another-pass-3', next2: 'Another-pass-3' }));
    expect(bad).toMatchObject({ ok: false, msg: 'Current password is wrong.' });
    const ok = await Workspace.run(A.ws, () => changePassword(u, hash, { current: 'ownerpass123', next: 'Another-pass-3', next2: 'Another-pass-3' }));
    expect(ok.ok).toBe(true);
    expect(Sessions.listFor(u.id).map((s) => s.ua)).toEqual(['keep']);
  });
});

describe('security policy + sessions', () => {
  it('policy is per workspace and enforced for new passwords', async () => {
    Workspace.run(A.ws, () => Security.save({ pw_min: 12, pw_upper: true, pw_digit: true, pw_symbol: false, pw_no_username: true, timeout_min: 30 }));
    expect(Workspace.run(A.ws, () => Security.policy().pw_min)).toBe(12);
    expect(Workspace.run(B.ws, () => Security.policy().pw_min)).toBe(8);
    expect(Workspace.run(A.ws, () => Security.passwordError('short1A', 'x'))).not.toBeNull();
    expect(Workspace.run(A.ws, () => Security.passwordError('Long-enough-pass-9', 'x'))).toBeNull();
    expect(Security.idleSeconds(A.ws)).toBe(1800);
  });

  it('session visibility: staff see only their own, owners all of the workspace, never another workspace', () => {
    const op = Users.inWorkspace(A.ws).find((u) => u.username === 'op-a')!;
    const owner = Users.byId(A.owner.id)!;
    Sessions.create(op, A.ws, { ip: '3.3.3.3', ua: 'op' });
    Sessions.create(Users.byId(B.owner.id)!, B.ws, { ip: '4.4.4.4', ua: 'b' });
    expect(visibleSessions(A.ws, op.id, false).every((s) => s.uid === op.id)).toBe(true);
    const all = visibleSessions(A.ws, owner.id, true);
    expect(all.some((s) => s.uid === op.id)).toBe(true);
    expect(all.some((s) => s.ua === 'b')).toBe(false);
  });
});

describe('API keys', () => {
  it('a key resolves to its own workspace only and can be revoked only there', () => {
    const { rec, key } = Workspace.run(A.ws, () => ApiKeys.create('billing', 'write'));
    expect(key.startsWith('kl_')).toBe(true);
    const auth = ApiKeys.authenticate(key);
    expect(auth.ok && auth.ws).toBe(A.ws);
    expect(Workspace.run(B.ws, () => ApiKeys.list())).toEqual([]);
    expect(Workspace.run(B.ws, () => ApiKeys.revoke(rec.id))).toBeNull();
    expect(ApiKeys.authenticate(key).ok).toBe(true);
    expect(Workspace.run(A.ws, () => ApiKeys.revoke(rec.id))).not.toBeNull();
    expect(ApiKeys.authenticate(key).ok).toBe(false);
  });
});

describe('notifications', () => {
  it('stores the token encrypted, keeps it on blank, and drops a private webhook URL (SSRF)', async () => {
    const r = await Workspace.run(A.ws, () => Notify.save({ enabled: true, token: '123:SECRET', chat_id: '-100', webhook_url: 'http://127.0.0.1:9/hook', events: ['sale', 'bogus'] }));
    expect(r.note).not.toBe('');
    const s = Workspace.run(A.ws, () => getSettings());
    const tg = s.telegram as { token: string; events: string[] };
    expect(tg.token).not.toContain('SECRET');
    expect(Crypto.decrypt(tg.token)).toBe('123:SECRET');
    expect(tg.events).toEqual(['sale']);
    expect(s.webhook_url).toBe('');
    await Workspace.run(A.ws, () => Notify.save({ enabled: true, token: '', chat_id: '-100', webhook_url: '', events: [] }));
    expect(Crypto.decrypt((Workspace.run(A.ws, () => getSettings()).telegram as { token: string }).token)).toBe('123:SECRET');
    // other workspace has nothing
    expect(Workspace.run(B.ws, () => Notify.config().tg.token)).toBeFalsy();
  });

  it('a test send to a blocked webhook is refused and logged, not sent', async () => {
    Workspace.run(A.ws, () => Notify.config());
    Workspace.run(A.ws, () => Store.update<Record<string, unknown>>('settings', (c) => ({ ...c, telegram: { ...(c.telegram as object), enabled: false }, webhook_url: 'http://127.0.0.1:9/hook' }), {}));
    const out = await Workspace.run(A.ws, () => Notify.send('t', 'test', ['webhook']));
    expect(out.ok).toBe(false);
    expect(out.msg).toMatch(/blocked/);
    expect(Workspace.run(A.ws, () => Notify.log(5)[0]?.ok)).toBe(false);
    expect(Workspace.run(B.ws, () => Notify.log(5)).length).toBe(0);
  });

  it('rekey (Crypto.rotate) re-encrypts the Telegram tokens of every workspace', () => {
    Workspace.run(B.ws, () => Store.update<Record<string, unknown>>('settings', (c) => ({ ...c, telegram: { token: Crypto.encrypt('b-token') } }), {}));
    Crypto.rotate();
    expect(Crypto.decrypt((Workspace.run(A.ws, () => getSettings()).telegram as { token: string }).token)).toBe('123:SECRET');
    expect(Crypto.decrypt((Workspace.run(B.ws, () => getSettings()).telegram as { token: string }).token)).toBe('b-token');
  });
});
