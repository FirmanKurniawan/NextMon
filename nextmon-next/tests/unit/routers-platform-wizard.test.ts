/** Routers (CRUD / share rules), platform accounts + workspace switch, setup wizard (demo driver) and the zip writer. */
import zlib from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { Context } from '../../src/lib/context.ts';
import { Routers } from '../../src/lib/routers.ts';
import { Sessions } from '../../src/lib/sessions.ts';
import { Share } from '../../src/lib/share.ts';
import { Store } from '../../src/lib/store.ts';
import { Users } from '../../src/lib/users.ts';
import { Workspace } from '../../src/lib/workspace.ts';
import { deleteRouter, outgoingShares, revokeShare, saveRouter, shareRouter } from '../../src/features/routers/logic.ts';
import { UserError } from '../../src/features/routers/util.ts';
import { accountRows, createAccount, deleteAccount, limitsFrom, resetOwnerPassword, saveLimits, setStatus, slugify, switchWorkspace } from '../../src/features/platform/logic.ts';
import { cli, mask, readParams, runStep, savedOut, walledDefaults } from '../../src/features/wizard/logic.ts';
import { buildZip } from '../../src/features/wizard/zip.ts';
import { bootstrapPlatform, makeTenant } from '../helpers.ts';
import type { User } from '../../src/lib/users.ts';

const form = (o: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) fd.set(k, v);
  return fd;
};
const asUser = <T,>(u: User, ws: string, fn: () => T): T =>
  Context.run({ ws, actor: { id: u.id, username: u.username, role: u.role, workspace: u.workspace }, ip: '127.0.0.1' }, fn);

let P: { ws: string; platform: User };
let A: { ws: string; owner: User };
let B: { ws: string; owner: User };

beforeAll(async () => {
  P = await bootstrapPlatform();
  A = await makeTenant('rt-a');
  B = await makeTenant('rt-b');
});

describe('routers logic', () => {
  it('validates, saves with an encrypted password and enforces the router limit', () => {
    asUser(A.owner, A.ws, () => {
      expect(() => saveRouter({ name: '', type: 'real', host: '1.1.1.1' })).toThrow(UserError);
      expect(() => saveRouter({ name: 'x', type: 'real', host: 'bad host!' })).toThrow('Invalid host.');
      saveRouter({ name: 'Cafe', type: 'real', host: '10.1.1.1', port: '8728', user: 'api', pass: 'secret-pass' });
      const stored = Store.read<{ pass: string; name: string }[]>('routers', []).find((r) => r.name === 'Cafe')!;
      expect(stored.pass).not.toContain('secret-pass');
      expect(stored.pass.length).toBeGreaterThan(10);
      // out-of-range port falls back to the default
      saveRouter({ name: 'Cafe2', type: 'real', host: '10.1.1.2', port: '99999', ssl: true });
      expect(Routers.list().find((r) => r.name === 'Cafe2')!.port).toBe(8729);
    });
    Workspace.update(A.ws, { limits: { routers: 3 } });
    asUser(A.owner, A.ws, () => {
      expect(() => saveRouter({ name: 'Over', type: 'real', host: '10.1.1.3' })).toThrow(/Router limit reached/);
    });
  });

  it('blank password on edit keeps the stored one; delete keeps at least one router', () => {
    asUser(A.owner, A.ws, () => {
      const r = Routers.list().find((x) => x.name === 'Cafe')!;
      const before = Store.read<{ id: string; pass: string }[]>('routers', []).find((x) => x.id === r.id)!.pass;
      saveRouter({ id: r.id, name: 'Cafe', type: 'real', host: '10.1.1.9', pass: '' });
      const after = Store.read<{ id: string; pass: string }[]>('routers', []).find((x) => x.id === r.id)!;
      expect(after.pass).toBe(before);
      for (const x of Routers.list().filter((y) => y.id !== r.id)) deleteRouter(x.id);
      expect(() => deleteRouter(r.id)).toThrow('At least one router must remain.');
    });
  });

  it('share / revoke: ro stays read-only for the recipient, recipient cannot edit or delete, owner can revoke', async () => {
    const real = asUser(B.owner, B.ws, () => {
      saveRouter({ name: 'Shared one', type: 'real', host: '10.2.2.2', user: 'u', pass: 'pw' });
      return Routers.list().find((r) => r.name === 'Shared one')!;
    });
    asUser(B.owner, B.ws, () => {
      expect(() => shareRouter({ router: real.id, to: 'nope-nope', mode: 'ro' })).toThrow('Unknown target workspace.');
      expect(() => shareRouter({ router: real.id, to: 'rt-b', mode: 'ro' })).toThrow('Unknown target workspace.');
      const demo = Routers.list().find((r) => r.type === 'demo')!;
      expect(() => shareRouter({ router: demo.id, to: 'rt-a', mode: 'ro' })).toThrow('A demo router cannot be shared.');
      shareRouter({ router: real.id, to: 'rt-a', mode: 'ro' });
      expect(outgoingShares()).toHaveLength(1);
    });
    asUser(A.owner, A.ws, () => {
      const seen = Routers.list().find((r) => r.id === real.id)!;
      expect(seen.shared).toBe(true);
      expect(seen.mode).toBe('ro');
      expect('pass' in seen).toBe(false);
      expect(() => saveRouter({ id: real.id, name: 'hijack', type: 'real', host: '6.6.6.6' })).toThrow('A shared router can only be changed by its owner.');
      expect(() => deleteRouter(real.id)).toThrow('A shared router can only be changed by its owner.');
    });
    // owner re-shares as rw (replaces), then revokes by share id
    asUser(B.owner, B.ws, () => {
      shareRouter({ router: real.id, to: 'rt-a', mode: 'rw' });
      expect(outgoingShares()).toHaveLength(1);
      expect(Routers.get(real.id)!.mode).toBe('rw');
      const sid = outgoingShares()[0]!.id;
      revokeShare({ share: sid });
      expect(outgoingShares()).toHaveLength(0);
    });
    asUser(A.owner, A.ws, () => expect(Routers.get(real.id)).toBeNull());
    // recipient drops a share it received (router alone)
    asUser(B.owner, B.ws, () => shareRouter({ router: real.id, to: 'rt-a', mode: 'ro' }));
    asUser(A.owner, A.ws, () => revokeShare({ router: real.id }));
    expect(Share.outgoing(B.ws)).toHaveLength(0);
    // a stranger cannot revoke somebody else's share by guessing its id
    asUser(B.owner, B.ws, () => shareRouter({ router: real.id, to: 'rt-a', mode: 'ro' }));
    const sid = Share.outgoing(B.ws)[0]!.id;
    const C = await makeTenant('rt-c');
    asUser(C.owner, C.ws, () => expect(() => revokeShare({ share: sid })).toThrow('Share not found.'));
    expect(Share.outgoing(B.ws)).toHaveLength(1);
  });
});

describe('platform accounts', () => {
  it('slugify', () => {
    expect(slugify('Warung Budi & Co.')).toBe('warung-budi-co');
    expect(limitsFrom(form({ routers: '4', staff: '', vouchers_per_day: 'x', log_rows: '100' }))).toEqual({ routers: 4, log_rows: 100 });
  });

  it('create validates owner / password policy and refuses duplicates', async () => {
    await asUser(P.platform, P.ws, async () => {
      await expect(createAccount(form({ name: '', owner: 'abc', password: 'longenough1' }))).rejects.toThrow('Name is required.');
      await expect(createAccount(form({ name: 'Nnn', owner: 'a b', password: 'longenough1' }))).rejects.toThrow(/Owner username/);
      await expect(createAccount(form({ name: 'Nnn', owner: 'okuser', password: 'short' }))).rejects.toThrow(/at least 8/);
      await expect(createAccount(form({ name: 'Nnn', owner: 'owner-rt-a', password: 'longenough1' }))).rejects.toThrow('Username already exists.');
      const slug = await createAccount(form({ name: 'New Shop', owner: 'newshop', password: 'longenough1', routers: '2' }));
      expect(slug).toBe('new-shop');
      await expect(createAccount(form({ name: 'New Shop', owner: 'other1', password: 'longenough1' }))).rejects.toThrow('Slug already in use.');
      const row = accountRows().find((r) => r.slug === 'new-shop')!;
      expect(row.owner_name).toBe('newshop');
      expect(row.eff.routers).toBe(2);
      expect(row.router_count).toBe(0); // new accounts start empty (onboarding)
    });
  });

  it('suspend blocks sessions, limits override, reset kills owner sessions, delete wipes data', async () => {
    const T = await makeTenant('rt-del');
    const tok = Sessions.create(T.owner, T.ws, { ip: '1.1.1.1', ua: 'x' });
    expect(Sessions.resolve(tok.token)).not.toBeNull();
    asUser(P.platform, P.ws, () => setStatus(T.ws, 'suspended'));
    expect(Sessions.resolve(tok.token)).toBeNull(); // suspended workspace: owner session dies
    asUser(P.platform, P.ws, () => {
      setStatus(T.ws, 'active');
      saveLimits(T.ws, form({ routers: '9', staff: '' }));
      expect(Workspace.limits(T.ws).routers).toBe(9);
      saveLimits(T.ws, form({}));
      expect(Workspace.limits(T.ws).routers).toBe(5); // override removed: platform default
      expect(() => setStatus('w_deadbeef', 'active')).toThrow('Workspace not found.');
    });
    const tok2 = Sessions.create(T.owner, T.ws, { ip: '1.1.1.1', ua: 'x' });
    await asUser(P.platform, P.ws, async () => {
      await expect(resetOwnerPassword(T.ws, 'x')).rejects.toThrow(/at least 8/);
      await resetOwnerPassword(T.ws, 'brand-new-pass-1');
    });
    expect(Sessions.resolve(tok2.token)).toBeNull();
    asUser(P.platform, P.ws, () => {
      expect(() => deleteAccount(P.ws, T.ws)).toThrow(/cannot be deleted/); // holds the platform admin
      expect(() => deleteAccount(T.ws, T.ws)).toThrow(/Leave this workspace/);
      deleteAccount(T.ws, P.ws);
    });
    expect(Workspace.get(T.ws)).toBeNull();
    expect(Users.inWorkspace(T.ws)).toHaveLength(0);
    expect(Store.allNames().some((n) => n.startsWith(`ws/${T.ws}/`))).toBe(false);
    const audit = Store.global('platform_audit').rows<{ action: string }>(50).map((r) => r.action);
    expect(audit).toEqual(expect.arrayContaining(['workspace.create', 'workspace.suspend', 'workspace.limits', 'workspace.reset_password', 'workspace.delete']));
  });

  it('switch: enter, leave (home), audited in target + platform log, unknown target refused', () => {
    const s = Sessions.create(P.platform, P.ws, { ip: '1.1.1.1', ua: 'x' });
    const hash = Sessions.resolve(s.token)!.session.hash;
    const r = asUser(P.platform, P.ws, () => switchWorkspace(hash, P.platform, P.ws, 'rt-a'));
    expect(r.target.id).toBe(A.ws);
    expect(r.home).toBe(false);
    expect(Sessions.resolve(s.token)!.session.ws).toBe(A.ws);
    expect(Workspace.run(A.ws, () => Store.tail<{ action: string; impersonating?: boolean }>('audit.log', 5)).some((x) => x.action === 'platform.enter' && x.impersonating)).toBe(true);
    const back = asUser(P.platform, A.ws, () => switchWorkspace(hash, P.platform, A.ws, 'home'));
    expect(back.home).toBe(true);
    expect(Sessions.resolve(s.token)!.session.ws).toBe(P.ws);
    expect(() => asUser(P.platform, P.ws, () => switchWorkspace(hash, P.platform, P.ws, 'does-not-exist'))).toThrow('Workspace not found.');
  });
});

describe('wizard', () => {
  it('validates parameters and masks secrets in CLI text', () => {
    asUser(A.owner, A.ws, () => {
      expect(() => readParams(form({ server_ip: 'not an ip' }))).toThrow(/Server address/);
      expect(() => readParams(form({ api_user: 'bad user!' }))).toThrow(/API user name/);
      expect(() => readParams(form({ ntp_servers: 'a b' }))).toThrow(/NTP/);
      expect(() => readParams(form({ html_dir: '../etc' }))).toThrow(/template folder/);
      const p = readParams(form({ server_ip: '192.168.88.0/24', ol_mode: 'rem' }), 'Nm.Example.com');
    expect(p.server_ip).toBe('192.168.88.0/24');
    expect(p.mode).toBe('rem');
    expect(cli('/user', 'add', { name: 'nextmon', password: 'p w$' })).toBe('/user add name=nextmon password="p w\\$"');
    expect(mask('/user add name=x password="a b" group=y')).toBe('/user add name=x password="***" group=y');
    expect(walledDefaults('portal.example.com')[0]).toBe('portal.example.com');
    });
  });

  it('preview sends nothing; apply needs confirmation; apply on the demo router works and is logged', async () => {
    const T = await makeTenant('rt-wiz');
    await asUser(T.owner, T.ws, async () => {
      const router = Routers.list()[0]!;
      const driver = Routers.driver(router.id);
      const env = { driver, router, demo: true, t: (k: string) => k, portal: 'wiz.example.com' };
      const before = (await driver.print('/ip/hotspot/walled-garden')).length;
      await runStep(form({ step: 'walled', mode: 'preview', confirm: '' }), env);
      expect((await driver.print('/ip/hotspot/walled-garden')).length).toBe(before);
      expect(savedOut(router.id)!.rows.every((r) => r.status === 'plan')).toBe(true);
      await expect(runStep(form({ step: 'walled', mode: 'apply' }), env)).rejects.toThrow('Tick the confirmation box before applying.');
      await expect(runStep(form({ step: 'bogus', mode: 'preview' }), env)).rejects.toThrow('Unknown action.');
      await runStep(form({ step: 'walled', mode: 'apply', confirm: '1' }), env);
      const after = await driver.print('/ip/hotspot/walled-garden');
      expect(after.some((w) => w['dst-host'] === 'wiz.example.com')).toBe(true);
      expect(savedOut(router.id)!.rows.some((r) => r.status === 'ok')).toBe(true);
      expect(Store.tail('wizard.log', 5).length).toBeGreaterThan(0);
      // second apply: nothing duplicated
      await runStep(form({ step: 'walled', mode: 'apply', confirm: '1' }), env);
      expect((await driver.print('/ip/hotspot/walled-garden')).length).toBe(after.length);
    });
  });

  it('user step: extra confirmation for risky ops, generated password is never logged', async () => {
    const T = await makeTenant('rt-wiz2');
    await asUser(T.owner, T.ws, async () => {
      const router = Routers.list()[0]!;
      const driver = Routers.driver(router.id);
      const env = { driver, router, demo: true, t: (k: string) => k, portal: '' };
      await runStep(form({ step: 'user', mode: 'apply', confirm: '1', api_user: 'nextmon', level: 'op' }), env);
      expect((await driver.print('/user')).some((u) => u.name === 'nextmon')).toBe(true);
      // existing user: reset needs ack_resetuser
      await runStep(form({ step: 'user', mode: 'apply', confirm: '1', api_user: 'nextmon', level: 'op' }), env);
      expect(savedOut(router.id)!.rows.some((r) => r.status === 'skip')).toBe(true);
      const logged = JSON.stringify(Store.tail('wizard.log', 50));
      expect(logged).not.toMatch(/"password=[A-Za-z0-9]{20}/);
      // read-only shared router cannot apply
      await expect(runStep(form({ step: 'ntp', mode: 'apply', confirm: '1' }), { ...env, router: { ...router, shared: true, mode: 'ro' } })).rejects.toThrow('This shared router is read-only.');
    });
  });
});

describe('zip writer', () => {
  it('produces a valid archive (EOCD, entry count, deflate round trip)', () => {
    const data = Buffer.from('hello hello hello hello hello hello hello hello');
    const zip = buildZip([
      { name: 'dir/a.txt', data },
      { name: 'b.bin', data: Buffer.from([1, 2, 3]) },
    ]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    const eocd = zip.length - 22;
    expect(zip.readUInt32LE(eocd)).toBe(0x06054b50);
    expect(zip.readUInt16LE(eocd + 10)).toBe(2);
    const method = zip.readUInt16LE(8);
    const csize = zip.readUInt32LE(18);
    const nlen = zip.readUInt16LE(26);
    const body = zip.subarray(30 + nlen, 30 + nlen + csize);
    expect(method).toBe(8);
    expect(zlib.inflateRawSync(body).equals(data)).toBe(true);
    expect(zip.readUInt32LE(14)).toBe(zlib.crc32(data) >>> 0);
  });
});
