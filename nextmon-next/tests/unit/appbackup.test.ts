/**
 * Workspace app-data backup / restore (src/lib/appbackup.ts): round trips, hostile files, tenant safety, atomic rollback and the
 * cross-edition fixture written by the PHP edition (tests/fixtures/backup-from-php.json).
 * NM_WRITE_FIXTURE=1 rewrites tests/fixtures/backup-from-next.json (the file the PHP test restores).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import * as AB from '../../src/lib/appbackup.ts';
import { Crypto } from '../../src/lib/crypto.ts';
import { Store } from '../../src/lib/store.ts';
import { Workspace } from '../../src/lib/workspace.ts';
import { bootstrapPlatform, makeTenant } from '../helpers.ts';

type Obj = Record<string, unknown>;
const sfx = (ws: string) => ws.slice(2).toUpperCase();

function seed(tag: string, ws = Workspace.id()): void {
  Store.write('routers', [
    { id: 'a1b2c3d4', name: `R-${tag}`, session: `r${tag}`.toLowerCase(), type: 'real', host: '10.0.0.1', port: 8728, ssl: false, verify_tls: false, user: 'api', pass: Crypto.encrypt(`pw-${tag}`), hotspot_name: 'WiFi' },
    { id: 'demo', name: 'Demo', session: 'demo', type: 'demo', host: '', port: 8728, ssl: false, user: '', pass: '', hotspot_name: '' },
  ]);
  Store.write('settings', {
    hotspot_name: `Net ${tag}`,
    currency: 'Rp',
    telegram: { enabled: true, token: Crypto.encrypt(`tg-${tag}`), chat_id: '42' },
    templates: [{ id: 't1', name: 'Card', html: '<div class="v">{{user}}</div>', w: 70, h: 40 }],
  });
  Store.write('shop', { enabled: true, gw: { tripay: { merchant: 'M1', private_key: Crypto.encrypt(`gw-${tag}`) } }, mock_secret: Crypto.encrypt(`mock-${tag}`) });
  Store.write('resellers', { 'u-1': { commission: 10, limit: 5 } });
  Store.write('wallets', { 'u-1': 12500 });
  Store.append('wallet_ledger', { id: `L1${tag}`, ts: 100, uid: 'u-1', type: 'topup', amount: 20000, bal: 20000, note: '', ref: '', meta: {}, by: 'owner' });
  Store.append('wallet_ledger', { id: `L2${tag}`, ts: 200, uid: 'u-1', type: 'sale', amount: -7500, bal: 12500, note: '', ref: '', meta: {}, by: 'u-1' });
  Store.append('reseller_batches', { id: `B1${tag}`, ts: 150, uid: 'u-1', qty: 5 });
  const id = `KL250101-ABCDEF-${sfx(ws)}`;
  Store.write(`order.${id}`, {
    id, token: 'tok' + crypto.randomBytes(8).toString('hex'), created: 1700000000, updated: 1700000100, expires: 1700003600, status: 'paid',
    package: { id: 'p1', profile: '1h', price: 5000, label: '1 hour' }, amount: 5000, customer: { name: `Cust ${tag}` }, gateway: 'mock', router: 'a1b2c3d4',
    ref: '', pay_url: '', pay_info: '', voucher: null, fulfil: '', notes: [], events: [], ip: '1.2.3.4',
  });
}

/** A syntactically valid file around an arbitrary payload (correct checksum). */
function file(payload: Obj, over: Obj = {}): string {
  const p = JSON.stringify(payload);
  return JSON.stringify({ format: 'nextmon-backup', version: 1, edition: 'php', created: '2026-01-01T00:00:00Z', includes_secrets: false, checksum: { algo: 'sha256', value: crypto.createHash('sha256').update(p).digest('hex') }, payload: p, ...over });
}
const rejects = (raw: string) => expect(() => AB.parseBackup(raw)).toThrow(AB.BackupError);
const all = (d: AB.BackupData) => Workspace.run(A, () => AB.available(d));

let A: string;
let B: string;
beforeAll(async () => {
  await bootstrapPlatform();
  A = (await makeTenant('bk-alpha')).ws;
  B = (await makeTenant('bk-beta')).ws;
});

describe('round trips', () => {
  it('Next -> Next into another workspace; secrets stay out unless asked', () => {
    Workspace.run(A, () => seed('A'));
    Workspace.run(B, () => Store.write('routers', [{ id: 'ffffffff', name: 'B-old', session: 'b', type: 'real', host: '9.9.9.9', port: 8728, ssl: false, user: '', pass: '', hotspot_name: '' }]));
    const plain = Workspace.run(A, () => AB.exportBackup(false));
    expect(plain).not.toContain('v1:');
    expect(plain).not.toContain('pw-A');
    expect(plain).not.toContain(A);
    const f = JSON.parse(plain);
    expect([f.format, f.version, f.edition]).toEqual(['nextmon-backup', 1, 'next']);
    expect(f.checksum.value).toBe(crypto.createHash('sha256').update(f.payload).digest('hex'));
    const parsed = AB.parseBackup(plain);
    expect(parsed.warnings).toEqual([]);
    expect(all(parsed.data)).toEqual(['routers', 'settings', 'shop', 'resellers', 'wallets', 'wallet_ledger', 'reseller_batches', 'orders']);
    const r = Workspace.run(B, () => AB.applyBackup(parsed.data, all(parsed.data)));
    expect(AB.safetyName(r.safety)).toBe(true);
    Workspace.run(B, () => {
      const routers = Store.read<Obj[]>('routers', []);
      expect(routers.map((x) => x.id)).toEqual(['a1b2c3d4', 'demo']);
      expect(routers[0]!.pass).toBe('');
      expect(Store.read<Obj>('settings', {}).hotspot_name).toBe('Net A');
      expect((Store.read<Obj>('settings', {}).telegram as Obj).token).toBe('');
      expect(Store.read('wallets', {})).toEqual({ 'u-1': 12500 });
      expect(Store.rows<Obj>('wallet_ledger', 10).map((x) => x.id)).toEqual(['L2A', 'L1A']);
      const orders = Store.names().filter((n) => n.startsWith('order.'));
      expect(orders).toEqual([`order.KL250101-ABCDEF-${sfx(B)}`]);
      expect(AB.safetyFiles().length).toBe(1);
      expect(AB.safetyBody(AB.safetyFiles()[0]!.name)).toContain('nextmon-backup');
    });
    Workspace.run(A, () => {
      expect(Crypto.decrypt(Store.read<Obj[]>('routers', [])[0]!.pass as string)).toBe('pw-A');
      expect(Store.names().filter((n) => n.startsWith('order.'))).toEqual([`order.KL250101-ABCDEF-${sfx(A)}`]);
    });
    const withSecrets = AB.parseBackup(Workspace.run(A, () => AB.exportBackup(true)));
    expect(withSecrets.warnings).toEqual([]);
    Workspace.run(B, () => AB.applyBackup(withSecrets.data, ['routers', 'settings', 'shop']));
    Workspace.run(B, () => {
      expect(Crypto.decrypt(Store.read<Obj[]>('routers', [])[0]!.pass as string)).toBe('pw-A');
      expect(Crypto.decrypt((Store.read<Obj>('settings', {}).telegram as Obj).token as string)).toBe('tg-A');
      expect(Crypto.decrypt(Store.read<Obj>('shop', {}).mock_secret as string)).toBe('mock-A');
    });
  });

  it('partial selection and blank router password keeps the stored one', () => {
    const w = A;
    Workspace.run(w, () => {
      seed('M');
      const raw = AB.exportBackup(false);
      Store.write('wallets', { 'u-1': 1 });
      Store.write('settings', { hotspot_name: 'changed' });
      const p = AB.parseBackup(raw);
      AB.applyBackup(p.data, ['wallets', 'routers']);
      expect(Store.read('wallets', {})).toEqual({ 'u-1': 12500 });
      expect(Store.read<Obj>('settings', {}).hotspot_name).toBe('changed');
      expect(Crypto.decrypt(Store.read<Obj[]>('routers', [])[0]!.pass as string)).toBe('pw-M');
      expect(() => AB.applyBackup(p.data, [])).toThrow(AB.BackupError);
      expect(() => AB.applyBackup(p.data, ['users', '../x'])).toThrow(AB.BackupError);
    });
  });
});

describe('size limit', () => {
  it('an oversized export drops the oldest log rows to stay under the upload limit and says so', () => {
    const rows = Array.from({ length: 30000 }, (_v, i) => ({ id: 'L' + i, ts: i, note: 'x'.repeat(400) }));
    const raw = AB.wrap({ docs: { wallets: { u: 1 } }, logs: { wallet_ledger: rows }, orders: [] }, false);
    expect(raw.length).toBeLessThan(AB.MAX_BYTES);
    const p = AB.parseBackup(raw);
    const kept = p.data.logs.wallet_ledger!;
    expect(kept.length).toBeLessThan(30000);
    expect(kept.length).toBeGreaterThan(1000);
    expect(kept.at(-1)!.id).toBe('L29999');
    expect(p.warnings.length).toBe(1);
  });
});

describe('hostile files', () => {
  it('rejects malformed, tampered, oversized and unsupported files', () => {
    const good = Workspace.run(A, () => AB.exportBackup(false));
    const f = JSON.parse(good) as Obj;
    for (const raw of ['', 'not json', '\0\0\0', '[]', 'A'.repeat(AB.MAX_BYTES + 1)]) rejects(raw);
    rejects(JSON.stringify({ ...f, format: 'other' }));
    rejects(JSON.stringify({ ...f, version: 2 }));
    rejects(JSON.stringify({ ...f, version: '1' }));
    rejects(JSON.stringify({ ...f, edition: 'evil' }));
    rejects(JSON.stringify({ ...f, checksum: { algo: 'sha256', value: '0'.repeat(64) } }));
    rejects(JSON.stringify({ ...f, checksum: { algo: 'md5', value: (f.checksum as Obj).value } }));
    rejects(JSON.stringify({ ...f, payload: (f.payload as string).replace('changed', 'chang3d') }));
    rejects(file({ docs: {} }));
    rejects(file({ docs: { routers: 'x' } }));
    rejects(file({ docs: { routers: [{ id: '../../etc', name: 'x', host: '1.1.1.1' }] } }));
    rejects(file({ docs: { routers: [{ id: 'abcd1234', name: 'x', host: 'a b;rm' }] } }));
    rejects(file({ docs: { routers: [{ id: 'abcd1234', name: 'x', host: '1.1.1.1' }, { id: 'abcd1234', name: 'y', host: '1.1.1.2' }] } }));
    rejects(`{"format":"nextmon-backup","version":1,"edition":"php","checksum":{"algo":"sha256","value":"${crypto.createHash('sha256').update('{"docs":{"shop":{"__proto__":{"a":1}}}}').digest('hex')}"},"payload":"{\\"docs\\":{\\"shop\\":{\\"__proto__\\":{\\"a\\":1}}}}"}`);
    rejects(file({ docs: { wallets: { 'u-1': 'lots' } } }));
    rejects(file({ docs: { wallets: { '../x': 5 } } }));
    rejects(file({ orders: [{ id: '../../x', status: 'paid', token: 'abcdefgh1', amount: 1, package: {}, created: 1 }] }));
    rejects(file({ orders: [{ id: 'KL250101-ABCDEF', status: 'hacked', token: 'abcdefgh1', amount: 1, package: {}, created: 1 }] }));
    let deep: Obj = { a: 1 };
    for (let i = 0; i < 40; i++) deep = { x: deep };
    rejects(file({ docs: { shop: deep } }));
    rejects(file({ docs: { shop: { k: 'x'.repeat(300000) } } }));
    rejects(file({ logs: { wallet_ledger: Array.from({ length: AB.MAX_ROWS + 1 }, () => ({ a: 1 })) } }));
    rejects(file({ logs: { wallet_ledger: ['not a row'] } }));
    expect(() => AB.parseBackup(good)).not.toThrow(); // control
  });

  it('a nesting bomb that blows the JSON parser stack is a clean rejection', () => {
    const p = '['.repeat(200000);
    rejects(file({}, { payload: p, checksum: { algo: 'sha256', value: crypto.createHash('sha256').update(p).digest('hex') } }));
  });
});

describe('tenant safety', () => {
  it('tenant keys, global collections, plaintext and foreign secrets never get in', () => {
    const foreign = 'v1:' + crypto.randomBytes(40).toString('base64');
    const raw = file({
      docs: {
        users: [{ id: 'u1', username: 'evil', role: 'platform' }],
        workspaces: [{ id: 'w_deadbeef' }],
        sessions_meta: { x: 1 },
        apikeys: [{ hash: 'abc' }],
        apikey_index: { abc: 'w_x' },
        '../../etc/passwd': { x: 1 },
        monitor: { cron_token: 'steal' },
        settings: {
          hotspot_name: 'X', workspace: A, ws: A, nested: { owner_ws: A, ok: 1 }, telegram: { token: foreign, chat_id: '1' },
          templates: [{ id: 't1', name: 'T', html: '<script>alert(1)</script><div onclick="x()">hi</div>', w: 9999, h: 1 }],
        },
        routers: [{ id: 'abcd1234', name: 'R', host: '1.1.1.1', pass: 'plain-text', shared: true, mode: 'rw', owner_ws: A }],
      },
      logs: { 'audit.log': [{ action: 'forged' }], wallet_ledger: [{ id: 'x', workspace: A, bal: 1 }] },
      orders: [{ id: `KL250101-ABCDEF-${sfx(A)}`, token: 'abcdefgh12', amount: 1, package: {}, created: 5, status: 'paid', workspace: A }],
    });
    const p = AB.parseBackup(raw);
    expect(p.ignored.length).toBeGreaterThanOrEqual(6);
    for (const g of ['users', 'workspaces', 'sessions_meta', 'apikeys', 'apikey_index', 'monitor']) expect(p.data.docs).not.toHaveProperty(g);
    expect(p.data.logs).not.toHaveProperty('audit.log');
    expect(JSON.stringify(p.data).toLowerCase()).not.toContain(A.slice(2));
    const r0 = (p.data.docs.routers as Obj[])[0]!;
    expect(r0.pass).toBe('');
    expect(r0).not.toHaveProperty('shared');
    expect(((p.data.docs.settings as Obj).telegram as Obj).token).toBe('');
    const tpl = ((p.data.docs.settings as Obj).templates as Obj[])[0]!;
    expect(tpl.html).not.toMatch(/<script|onclick/);
    expect(tpl.w).toBe(300);
    expect(p.warnings.length).toBeGreaterThan(0);

    Workspace.run(A, () => Store.write('routers', [{ id: 'aaaaaaaa', name: 'A-keep', session: 'a', type: 'real', host: '2.2.2.2', port: 8728, ssl: false, user: '', pass: '', hotspot_name: '' }]));
    Workspace.run(B, () => AB.applyBackup(p.data, all(p.data)));
    Workspace.run(A, () => {
      expect(Store.read<Obj[]>('routers', []).map((x) => x.id)).toEqual(['aaaaaaaa']);
      expect(Store.names().filter((n) => n.startsWith('order.') && n.includes('-ABCDEF-')).length).toBe(1); // A's own seeded order only
    });
    Workspace.run(B, () => {
      expect(Store.names().filter((n) => n.startsWith('order.'))).toEqual([`order.KL250101-ABCDEF-${sfx(B)}`]);
      expect(Store.rows('wallet_ledger', 10).length).toBe(1);
      expect(Store.rows('audit.log', 10).some((r) => (r as Obj).action === 'forged')).toBe(false);
    });
  });

  it('router limit of the workspace is enforced', async () => {
    const { Workspace: W } = await import('../../src/lib/workspace.ts');
    const { workspace } = await W.create({ name: 'Tiny', slug: 'bk-tiny', owner: { username: 'owner-bk-tiny', password: 'ownerpass123' }, limits: { routers: 1 } });
    const p = AB.parseBackup(file({ docs: { routers: [{ id: 'aaaaaaaa', name: 'a', host: '1.1.1.1' }, { id: 'bbbbbbbb', name: 'b', host: '1.1.1.2' }] } }));
    expect(() => W.run(workspace.id, () => AB.applyBackup(p.data, ['routers']))).toThrow(AB.BackupError);
    expect(W.run(workspace.id, () => Store.read('routers', []))).toEqual([]);
  });

  it('pending preview is bound to user, token and workspace and expires', () => {
    const p = AB.parseBackup(file({ docs: { wallets: { u: 1 } } }));
    const tok = Workspace.run(A, () => AB.stash(p, '../../evil name.json', 'user-1'));
    Workspace.run(A, () => {
      expect(AB.pending('user-1')).not.toBeNull();
      expect(AB.pending('user-1')!.file).not.toMatch(/[/\\]/);
      expect(AB.pending('user-2')).toBeNull();
      expect(AB.pendingData('user-1', 'wrong')).toBeNull();
      expect(AB.pendingData('user-1', tok)).not.toBeNull();
    });
    Workspace.run(B, () => {
      expect(AB.pending('user-1')).toBeNull();
      expect(AB.pendingData('user-1', tok)).toBeNull();
    });
    Workspace.run(A, () => {
      Store.update<Obj>('backup.pending', (m) => ({ ...m, ts: Math.floor(Date.now() / 1000) - 4000 }), {});
      expect(AB.pending('user-1')).toBeNull();
      expect(Store.has('backup.pending')).toBe(false);
    });
  });

  it('safety names cannot be used for traversal', () => {
    Workspace.run(A, () => {
      for (const n of ['../secret.key', '..\\x', 'pre-restore-20250101-010101-abcd/../../x', 'x', 'pre-restore-1', 'pre-restore-20250101-010101-abcd\0']) expect(AB.safetyBody(n)).toBeNull();
    });
  });
});

describe('atomic apply', () => {
  it('a failing restore rolls everything back and keeps the safety backup', () => {
    Workspace.run(B, () => {
      seed('R', B);
      const snap = () => JSON.stringify([Store.read('routers', []), Store.read('settings', {}), Store.read('wallets', {}), Store.rows('wallet_ledger', 100), Store.names().filter((n) => n.startsWith('order.')).sort()]);
      const before = snap();
      const nSafety = AB.safetyFiles().length;
      const p = AB.parseBackup(
        file({
          docs: { routers: [{ id: 'cccccccc', name: 'NEW', host: '1.1.1.1' }], settings: { hotspot_name: 'NEW' }, wallets: { 'u-9': 1 } },
          logs: { wallet_ledger: [{ id: 'new' }] },
          orders: [{ id: 'KL250102-ABCDEF', token: 'abcdefgh12', amount: 1, package: {}, created: 5, status: 'paid' }],
        }),
      );
      AB.hooks.afterWrite = (c) => {
        if (c === 'wallet_ledger') throw new Error('boom after the ledger was replaced');
      };
      try {
        expect(() => AB.applyBackup(p.data, all(p.data))).toThrow(/nothing was changed/);
      } finally {
        AB.hooks.afterWrite = null;
      }
      expect(snap()).toBe(before);
      expect(AB.safetyFiles().length).toBe(nSafety + 1);
      expect(() => AB.parseBackup(AB.safetyBody(AB.safetyFiles()[0]!.name)!)).not.toThrow(); // the safety file is itself a valid backup
    });
  });
});

describe('cross-edition', () => {
  it('a file written by the PHP edition restores here', () => {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'backup-from-php.json'), 'utf8');
    expect(JSON.parse(raw).edition).toBe('php');
    const p = AB.parseBackup(raw);
    expect(p.warnings).toEqual([]);
    Workspace.run(B, () => {
      expect(AB.applyBackup(p.data, all(p.data)).applied.length).toBeGreaterThan(0);
      expect(Store.read<Obj>('settings', {}).hotspot_name).toBe('PHP Fixture');
      expect(Store.read<Obj[]>('routers', []).map((r) => r.id)).toEqual(['22222222', 'demo']);
      expect(Store.read('wallets', {})).toEqual({ 'u-1': 12500 });
      expect(Store.rows('wallet_ledger', 10).length).toBe(2);
      expect(Store.names().filter((n) => n.startsWith('order.'))).toEqual([`order.KL250101-ABCDEF-${sfx(B)}`]);
    });
  });

  it.runIf(process.env.NM_WRITE_FIXTURE === '1')('writes tests/fixtures/backup-from-next.json', () => {
    const w = Workspace.run(A, () => {
      Store.write('routers', [{ id: '11111111', name: 'Next Router', session: 'nx', type: 'real', host: '10.1.1.1', port: 8728, ssl: false, verify_tls: false, user: 'api', pass: '', hotspot_name: 'Next WiFi' }]);
      Store.write('settings', { hotspot_name: 'Next Fixture', currency: 'Rp', templates: [{ id: 't1', name: 'Card', html: '<div>{{user}}</div>', w: 70, h: 40 }] });
      Store.write('shop', { enabled: true });
      Store.write('resellers', { 'u-1': { commission: 10 } });
      Store.write('wallets', { 'u-1': 12500 });
      Store.prune('wallet_ledger', 0);
      Store.prune('reseller_batches', 0);
      Store.append('wallet_ledger', { id: 'NL1', ts: 100, uid: 'u-1', type: 'topup', amount: 20000, bal: 20000 });
      Store.append('wallet_ledger', { id: 'NL2', ts: 200, uid: 'u-1', type: 'sale', amount: -7500, bal: 12500 });
      for (const n of Store.names().filter((x) => x.startsWith('order.'))) Store.delete(n);
      Store.write(`order.KL250101-ABCDEF-${sfx(A)}`, { id: `KL250101-ABCDEF-${sfx(A)}`, token: 'nexttoken12345', created: 1700000000, updated: 1700000100, expires: 1700003600, status: 'paid', package: { id: 'p1', profile: '1h', price: 5000, label: '1 hour' }, amount: 5000, customer: { name: 'Next Customer' }, gateway: 'mock', router: '11111111', ref: '', pay_url: '', pay_info: '', voucher: null, fulfil: '', notes: [], events: [], ip: '1.2.3.4' });
      return AB.exportBackup(false);
    });
    fs.writeFileSync(path.join(__dirname, '..', 'fixtures', 'backup-from-next.json'), w);
  });
});
