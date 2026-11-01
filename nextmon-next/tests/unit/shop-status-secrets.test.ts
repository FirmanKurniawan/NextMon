/** Public voucher status: tenant resolution + data isolation; shop gateway secrets: encrypted at rest and part of key rotation. */
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Shop } from '../../src/features/shop/config.ts';
import { bySession, limited, lookup, statusJson, statusPage } from '../../src/features/status/lookup.ts';
import { Context } from '../../src/lib/context.ts';
import { Crypto } from '../../src/lib/crypto.ts';
import { Env } from '../../src/lib/env.ts';
import { Routers } from '../../src/lib/routers.ts';
import { Store } from '../../src/lib/store.ts';
import { Workspace } from '../../src/lib/workspace.ts';
import { bootstrapPlatform, makeTenant } from '../helpers.ts';

let A: { ws: string };
let B: { ws: string };
let C: { ws: string };
const inWs = <T>(ws: string, fn: () => T): T => Workspace.run(ws, () => Context.run({ ip: '198.51.100.5' }, fn));

beforeAll(async () => {
  await bootstrapPlatform();
  A = await makeTenant('st-a');
  B = await makeTenant('st-b');
  C = await makeTenant('st-c');
  // A: session "alpha" (unique). B and C both own "twin" (ambiguous without ?w=).
  inWs(A.ws, () => Routers.save({ id: Routers.list()[0]!.id, name: 'Alpha', session: 'alpha', type: 'demo', hotspot_name: 'Alpha WiFi' }));
  inWs(B.ws, () => Routers.save({ id: Routers.list()[0]!.id, name: 'Twin B', session: 'twin', type: 'demo', hotspot_name: 'B WiFi' }));
  inWs(C.ws, () => Routers.save({ id: Routers.list()[0]!.id, name: 'Twin C', session: 'twin', type: 'demo', hotspot_name: 'C WiFi' }));
});

const someVoucher = async (ws: string) =>
  inWs(ws, async () => {
    const r = Routers.driver(Routers.list()[0]!.id);
    await r.add('/ip/hotspot/user', { name: 'only' + ws.slice(2, 6), password: 'x', profile: '1Jam', comment: 'vc-100-01.01.26' });
    return 'only' + ws.slice(2, 6);
  });

describe('/status tenant resolution', () => {
  it('finds the workspace by its router session name (case-insensitive)', () => {
    expect(bySession('ALPHA')?.ws.id).toBe(A.ws);
    expect(bySession('nope')).toBeNull();
    expect(bySession('')).toBeNull();
  });
  it('a duplicated session name is never guessed: needs ?w=slug, which must match', () => {
    expect(bySession('twin')).toBeNull();
    expect(bySession('twin', 'st-b')?.ws.id).toBe(B.ws);
    expect(bySession('twin', 'st-c')?.ws.id).toBe(C.ws);
    expect(bySession('twin', 'st-a')).toBeNull(); // a slug that does not own it
    expect(bySession('alpha', 'st-b')).toBeNull();
  });
  it('suspended workspaces disappear from the lookup', () => {
    Workspace.setStatus(A.ws, 'suspended');
    expect(bySession('alpha')).toBeNull();
    Workspace.setStatus(A.ws, 'active');
    expect(bySession('alpha')?.ws.id).toBe(A.ws);
  });
  it('a voucher of A is not found through B\'s session, and not through a wrong slug', async () => {
    const code = await someVoucher(A.ws);
    const ok = await statusPage('alpha', code, '', '198.51.100.31');
    expect(ok.res?.user).toBe(code);
    expect(ok.brand).toBe('Alpha WiFi');
    const viaB = await statusPage('twin', code, 'st-b', '198.51.100.31');
    expect(viaB.res).toBeNull();
    expect(viaB.err).toBe('Voucher not found.');
    const unknown = await statusPage('twin', code, '', '198.51.100.31');
    expect(unknown.err).toBe('Unknown session name.');
    expect(unknown.brand).toBe('NextMON'); // no tenant branding for an unknown session
  });
  it('status.json: 400 without session/user, 404 for unknown code, CORS only for allowed origins', async () => {
    const code = await someVoucher(A.ws);
    expect((await statusJson('', code, '', '198.51.100.32', '')).status).toBe(400);
    expect((await statusJson('alpha', '', '', '198.51.100.32', '')).status).toBe(400);
    const nf = await statusJson('alpha', 'doesnotexist', '', '198.51.100.32', 'https://evil.example');
    expect(nf.status).toBe(404);
    expect(nf.cors).toBe('');
    inWs(A.ws, () => Store.update<Record<string, unknown>>('settings', (s) => ({ ...s, status_cors: 'https://portal.example/' }), {}));
    const good = await statusJson('alpha', code, '', '198.51.100.32', 'https://portal.example');
    expect(good.status).toBe(200);
    expect(good.cors).toBe('https://portal.example');
    expect((good.body.data as { status: string }).status).toBe('new');
  });
  it('lookup tolerates a code typed with spaces and reports status', async () => {
    const code = await someVoucher(B.ws);
    const grouped = code.slice(0, 2) + ' ' + code.slice(2);
    const r = await inWs(B.ws, () => lookup(Routers.list()[0]!, grouped));
    expect(r?.user).toBe(code);
    expect(r?.status).toBe('new');
  });
  it('rate limit: 40 lookups / 10 min per IP', () => {
    const ip = '198.51.100.99';
    let over = false;
    for (let i = 0; i < 41; i++) over = limited(ip);
    expect(over).toBe(true);
  });
});

describe('shop gateway secrets', () => {
  it('stored encrypted per workspace and decrypted only through gwCfg; rekey keeps them readable', async () => {
    await import('../../src/features/shop/secrets.ts');
    inWs(A.ws, () => Shop.save({ gw: { tripay: { merchant_code: 'T1', private_key: Crypto.encrypt('priv-A'), api_key: Crypto.encrypt('api-A') }, xendit: { callback_token: Crypto.encrypt('tok-A') } } }));
    inWs(B.ws, () => Shop.save({ gw: { tripay: { merchant_code: 'T2', private_key: Crypto.encrypt('priv-B') } } }));
    const raw = JSON.stringify(inWs(A.ws, () => Store.read('shop', {})));
    expect(raw).not.toContain('priv-A');
    expect(raw).not.toContain('tok-A');
    const secret = inWs(A.ws, () => Shop.mockSecret());
    expect(inWs(A.ws, () => Shop.mockSecret())).toBe(secret); // stable
    expect(inWs(B.ws, () => Shop.mockSecret())).not.toBe(secret); // per workspace
    expect(JSON.stringify(inWs(A.ws, () => Store.read('shop', {})))).not.toContain(secret);
    const n = Crypto.rotate();
    expect(n).toBeGreaterThanOrEqual(5);
    expect(inWs(A.ws, () => Shop.gwCfg(Shop.config(), 'tripay').private_key)).toBe('priv-A');
    expect(inWs(A.ws, () => Shop.gwCfg(Shop.config(), 'xendit').callback_token)).toBe('tok-A');
    expect(inWs(B.ws, () => Shop.gwCfg(Shop.config(), 'tripay').private_key)).toBe('priv-B');
    expect(inWs(A.ws, () => Shop.mockSecret())).toBe(secret);
    expect(inWs(B.ws, () => Shop.gwCfg(Shop.config(), 'tripay').merchant_code)).toBe('T2');
    // tidy the key backup rotate() leaves next to the key file
    const dir = Env.dataDir();
    for (const f of fs.readdirSync(dir)) if (f.includes('.bak-')) fs.rmSync(path.join(dir, f), { force: true });
  });
});
