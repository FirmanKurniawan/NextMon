import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Crypto, safeEqual } from '../../src/lib/crypto.ts';
import { Env } from '../../src/lib/env.ts';
import { Routers } from '../../src/lib/routers.ts';
import { Store } from '../../src/lib/store.ts';
import { Workspace } from '../../src/lib/workspace.ts';
import { bootstrapPlatform, makeTenant } from '../helpers.ts';

describe('Crypto (AES-256-GCM)', () => {
  it('roundtrips, uses random IVs, wire format is v1:base64(iv12|tag16|ct)', () => {
    const a = Crypto.encrypt('s3cret-pässword ✓');
    const b = Crypto.encrypt('s3cret-pässword ✓');
    expect(a).not.toBe(b);
    expect(a.startsWith('v1:')).toBe(true);
    expect(Buffer.from(a.slice(3), 'base64').length).toBe(12 + 16 + Buffer.byteLength('s3cret-pässword ✓'));
    expect(Crypto.decrypt(a)).toBe('s3cret-pässword ✓');
    expect(Crypto.encrypt('')).toBe('');
  });

  it('IVs never repeat across many encryptions', () => {
    const ivs = new Set<string>();
    for (let i = 0; i < 2000; i++) ivs.add(Buffer.from(Crypto.encrypt('x').slice(3), 'base64').subarray(0, 12).toString('hex'));
    expect(ivs.size).toBe(2000);
  });

  it('tampered / truncated / foreign input decrypts to empty, never throws', () => {
    const e = Crypto.encrypt('hello');
    const raw = Buffer.from(e.slice(3), 'base64');
    raw[raw.length - 1] ^= 1;
    expect(Crypto.decrypt('v1:' + raw.toString('base64'))).toBe('');
    expect(Crypto.decrypt('v1:AAAA')).toBe('');
    expect(Crypto.decrypt('plain')).toBe('');
    expect(Crypto.decrypt('')).toBe('');
  });

  it('key file is created once, exclusively, with a strict mode', () => {
    Crypto.encrypt('x');
    const f = path.join(Env.dataDir(), 'secret.key');
    expect(Buffer.from(fs.readFileSync(f, 'utf8'), 'base64').length).toBe(32);
    if (process.platform !== 'win32') expect(fs.statSync(f).mode & 0o077).toBe(0);
    const before = fs.readFileSync(f, 'utf8');
    Crypto.reset();
    Crypto.encrypt('y');
    expect(fs.readFileSync(f, 'utf8')).toBe(before); // never regenerated
    // exclusive create: opening with 'wx' again must fail
    expect(() => fs.closeSync(fs.openSync(f, 'wx'))).toThrow();
  });

  it('safeEqual', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });

  it('rotate() re-encrypts router passwords of EVERY workspace and keeps a backup of the old key', async () => {
    await bootstrapPlatform();
    const t1 = await makeTenant('rot1');
    const t2 = await makeTenant('rot2');
    for (const [ws, pass] of [[t1.ws, 'pw-one'], [t2.ws, 'pw-two']] as const) {
      Workspace.run(ws, () => Routers.save({ name: 'R-' + pass, type: 'real', host: '10.9.9.9', user: 'api', pass }));
    }
    const f = path.join(Env.dataDir(), 'secret.key');
    const oldKey = fs.readFileSync(f, 'utf8');
    const blobsBefore = [t1.ws, t2.ws].map((ws) => Workspace.run(ws, () => Store.read<{ type: string; pass: string }[]>('routers', []).find((r) => r.type === 'real')!.pass));
    const n = Crypto.rotate();
    expect(n).toBe(2);
    expect(fs.readFileSync(f, 'utf8')).not.toBe(oldKey);
    const baks = fs.readdirSync(Env.dataDir()).filter((x) => x.startsWith('secret.key.bak-'));
    expect(baks).toHaveLength(1);
    expect(fs.readFileSync(path.join(Env.dataDir(), baks[0]!), 'utf8')).toBe(oldKey);
    [t1.ws, t2.ws].forEach((ws, i) => {
      const blob = Workspace.run(ws, () => Store.read<{ type: string; pass: string }[]>('routers', []).find((r) => r.type === 'real')!.pass);
      expect(blob).not.toBe(blobsBefore[i]);
      expect(Crypto.decrypt(blob)).toBe(i === 0 ? 'pw-one' : 'pw-two');
    });
  });

  it('NEXTMON_SECRET env key works and disables rotation', () => {
    const old = process.env.NEXTMON_SECRET;
    process.env.NEXTMON_SECRET = Buffer.alloc(32, 7).toString('base64');
    try {
      const e = Crypto.encrypt('envkey');
      expect(Crypto.decrypt(e)).toBe('envkey');
      expect(() => Crypto.rotate()).toThrow(/NEXTMON_SECRET/);
      process.env.NEXTMON_SECRET = 'short';
      expect(() => Crypto.encrypt('x')).toThrow();
    } finally {
      if (old === undefined) delete process.env.NEXTMON_SECRET;
      else process.env.NEXTMON_SECRET = old;
    }
  });
});
