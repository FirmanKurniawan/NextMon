/**
 * Hotspot core (users, profiles, active, bindings, walled garden, vouchers, templates, CSV import): form handlers run against the
 * DemoDriver inside a workspace context, plus tenant isolation of everything they store (templates, presets, pending imports).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Context } from '../../src/lib/context.ts';
import { I18n } from '../../src/lib/i18n.ts';
import * as RS from '../../src/lib/reseller.ts';
import { RouterOSError } from '../../src/lib/routeros.ts';
import { Routers } from '../../src/lib/routers.ts';
import { Voucher } from '../../src/lib/voucher.ts';
import { can } from '../../src/lib/users.ts';
import type { Role } from '../../src/lib/users.ts';
import { Store } from '../../src/lib/store.ts';
import { activeForms } from '../../src/features/active/forms.ts';
import { bindingForms } from '../../src/features/bindings/forms.ts';
import { UserError } from '../../src/features/_kit/forms.ts';
import type { FormResult, FormRoute } from '../../src/features/_kit/forms.ts';
import { profileAttrs, statusOf } from '../../src/features/_kit/hotspot.ts';
import * as Imp from '../../src/features/import/data.ts';
import { importForms } from '../../src/features/import/forms.ts';
import { importApi } from '../../src/features/import/api.ts';
import { profileForms } from '../../src/features/profiles/forms.ts';
import { templateForms } from '../../src/features/templates/forms.ts';
import { userForms } from '../../src/features/users/forms.ts';
import { cleanOpts, customTemplates, presets } from '../../src/features/vouchers/data.ts';
import { voucherForms } from '../../src/features/vouchers/forms.ts';
import { printItems } from '../../src/features/vouchers/items.ts';
import { renderPrintHtml } from '../../src/features/vouchers/print.ts';
import { walledForms } from '../../src/features/walledgarden/forms.ts';
import type { AppContext } from '../../src/features/types.ts';
import { bootstrapPlatform, makeTenant } from '../helpers.ts';

const t = I18n.translator('en');

/** Minimal AppContext for a workspace (what getContext() builds from a session). */
function ctxFor(ws: string, userId: string, role: Role, session = 'sess-' + userId): AppContext {
  const user = { id: userId, username: 'u-' + userId, role, workspace: ws };
  const router = Context.run({ ws }, () => Routers.current());
  const ctx = {
    user,
    session: { hash: session },
    t,
    lang: 'en',
    router,
    csrf: 'x',
    can: (cap: Parameters<typeof can>[1]) => can(user, cap),
    run: <T,>(fn: () => T) => Context.run({ ws, actor: user, ip: '127.0.0.1', routerId: router?.id }, fn),
    driver: () => Routers.driver(router!.id),
  };
  return ctx as unknown as AppContext;
}

const form = (o: Record<string, string | string[]>): FormData => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return fd;
};

async function submit(ctx: AppContext, r: FormRoute, fd: FormData): Promise<FormResult> {
  return await ctx.run(async () => await r.run({ ctx, fd, req: new Request('http://localhost/x') }));
}
const fails = async (ctx: AppContext, r: FormRoute, fd: FormData): Promise<string> => {
  try {
    await submit(ctx, r, fd);
  } catch (e) {
    if (e instanceof UserError) return e.message;
    throw e;
  }
  return '';
};

let A: AppContext;
let B: AppContext;
let AR: AppContext; // a reseller of workspace A
let wsA = '';

beforeAll(async () => {
  await bootstrapPlatform();
  const a = await makeTenant('hs-a');
  const b = await makeTenant('hs-b');
  wsA = a.ws;
  A = ctxFor(a.ws, a.owner.id, 'admin');
  B = ctxFor(b.ws, b.owner.id, 'admin');
  AR = ctxFor(a.ws, 'rs-1', 'reseller');
});

describe('pure hotspot rules', () => {
  it('statusOf follows HotspotController::statusOf', () => {
    expect(statusOf({ disabled: 'true' }, true)).toBe('disabled');
    expect(statusOf({ 'limit-uptime': '1s' }, true)).toBe('expired');
    expect(statusOf({}, true)).toBe('online');
    expect(statusOf({ uptime: '5m' }, false)).toBe('used');
    expect(statusOf({ uptime: '0s' }, false)).toBe('new');
  });

  it('profile form -> attrs: modes, validity, script generation and rejection', () => {
    const ok = profileAttrs({ name: '1Jam', mode: 'remc', validity: '1d', price: '5000', rate_limit: '2M/2M', shared: '0', lock_user: '1' }, t);
    expect('attrs' in ok && ok.attrs['shared-users']).toBe('1');
    expect('attrs' in ok && ok.attrs['on-login']).toContain(',remc,5000,1d,5000,,Enable,Disable,');
    expect(profileAttrs({ name: 'x', mode: 'bogus' }, t)).toEqual({ error: 'Unknown expired mode.' });
    expect('error' in profileAttrs({ name: 'x', mode: 'rem', validity: '' }, t)).toBe(true);
    expect('error' in profileAttrs({ name: 'x', mode: 'none', validity: '1d x' }, t)).toBe(true);
    expect('error' in profileAttrs({ name: 'bad/name' }, t)).toBe(true);
    const none = profileAttrs({ name: 'n', mode: 'none' }, t);
    expect('attrs' in none && none.attrs['on-login']).toBe('');
  });
});

describe('profiles, users, active, bindings (DemoDriver)', () => {
  it('saves a profile with an on-login script, previews it, and deletes it', async () => {
    await submit(A, profileForms['hotspot/profiles/save']!, form({ name: 'Test30', mode: 'ntfc', validity: '30d', price: '20000', sprice: '25000' }));
    const rows = await A.run(() => A.driver().print('/ip/hotspot/user/profile', { name: 'Test30' }));
    expect(rows).toHaveLength(1);
    expect(rows[0]!['on-login']).toContain(',ntfc,20000,30d,25000,');
    const prev = (await submit(A, profileForms['hotspot/profiles/preview']!, form({ name: 'P', mode: 'rem', validity: '1h' }))) as { json: { ok: boolean; script: string } };
    expect(prev.json.ok).toBe(true);
    expect(prev.json.script).toContain('/ip hotspot user remove');
    const bad = (await submit(A, profileForms['hotspot/profiles/preview']!, form({ name: 'P', mode: 'rem' }))) as { json: { ok: boolean } };
    expect(bad.json.ok).toBe(false);
    await submit(A, profileForms['hotspot/profiles/delete']!, form({ id: rows[0]!['.id']!, name: 'Test30' }));
    expect(await A.run(() => A.driver().print('/ip/hotspot/user/profile', { name: 'Test30' }))).toHaveLength(0);
    // B never saw it
    expect(await B.run(() => B.driver().print('/ip/hotspot/user/profile', { name: 'Test30' }))).toHaveLength(0);
  });

  it('user save: validates name and time limit vs profile validity, then add / edit / bulk actions', async () => {
    await submit(A, profileForms['hotspot/profiles/save']!, form({ name: 'Short', mode: 'rem', validity: '1h' }));
    expect(await fails(A, userForms['hotspot/users/save']!, form({ name: 'bad name!', profile: 'default' }))).toBe('Invalid username.');
    expect(await fails(A, userForms['hotspot/users/save']!, form({ name: 'tuser', profile: 'Short', limit_uptime: '2h' }))).toContain('must not exceed validity');
    expect(await fails(A, userForms['hotspot/users/save']!, form({ name: 'tuser', profile: 'Short', limit_uptime: 'abc' }))).toContain('format is invalid');
    await submit(A, userForms['hotspot/users/save']!, form({ name: 'tuser', password: 'pw1', profile: 'Short', limit_uptime: '30m', comment: 'hello' }));
    const u = (await A.run(() => A.driver().print('/ip/hotspot/user', { name: 'tuser' })))[0]!;
    expect(u.password).toBe('pw1');
    expect(u['limit-uptime']).toBe('30m');
    // edit: clearing the limit really clears it; disabled flag is applied
    await submit(A, userForms['hotspot/users/save']!, form({ id: u['.id']!, name: 'tuser', password: 'pw1', profile: 'Short', limit_uptime: '', disabled: '1' }));
    const e = (await A.run(() => A.driver().print('/ip/hotspot/user', { name: 'tuser' })))[0]!;
    expect(e['limit-uptime']).toBe('0s');
    expect(e.disabled).toBe('true');
    // bulk
    await submit(A, userForms['hotspot/users/action']!, form({ 'ids[]': [u['.id']!], action: 'enable' }));
    expect((await A.run(() => A.driver().print('/ip/hotspot/user', { name: 'tuser' })))[0]!.disabled).toBe('false');
    expect(await fails(A, userForms['hotspot/users/action']!, form({ action: 'delete' }))).toBe('Nothing selected.');
    expect(await fails(A, userForms['hotspot/users/action']!, form({ 'ids[]': ['*1'], action: 'explode' }))).toBe('Unknown action.');
    await submit(A, userForms['hotspot/users/action']!, form({ 'ids[]': [u['.id']!, '../etc'], action: 'delete' }));
    expect(await A.run(() => A.driver().print('/ip/hotspot/user', { name: 'tuser' }))).toHaveLength(0);
  });

  it('kicks sessions and manages IP bindings', async () => {
    const act = await A.run(() => A.driver().print('/ip/hotspot/active'));
    expect(act.length).toBeGreaterThan(1);
    await submit(A, activeForms['hotspot/active/kick']!, form({ 'ids[]': [act[0]!['.id']!, 'junk'] }));
    expect(await A.run(() => A.driver().print('/ip/hotspot/active'))).toHaveLength(act.length - 1);
    expect(await B.run(() => B.driver().print('/ip/hotspot/active'))).not.toHaveLength(act.length - 1 + 100); // B has its own table

    expect(await fails(A, bindingForms['hotspot/bindings/save']!, form({ type: 'bypassed' }))).toBe('MAC or address is required.');
    await submit(A, bindingForms['hotspot/bindings/save']!, form({ mac: 'AA:BB:CC:DD:EE:01', type: 'blocked', comment: 'tv' }));
    const b = (await A.run(() => A.driver().print('/ip/hotspot/ip-binding'))).find((x) => x.comment === 'tv')!;
    expect(b.type).toBe('blocked');
    expect(await fails(A, bindingForms['hotspot/bindings/action']!, form({ 'ids[]': [b['.id']!], action: 'zap' }))).toBe('Unknown action.');
    await submit(A, bindingForms['hotspot/bindings/action']!, form({ 'ids[]': [b['.id']!], action: 'disable' }));
    expect((await A.run(() => A.driver().print('/ip/hotspot/ip-binding'))).find((x) => x.comment === 'tv')!.disabled).toBe('true');
    await submit(A, bindingForms['hotspot/bindings/action']!, form({ 'ids[]': [b['.id']!], action: 'remove' }));
    expect((await A.run(() => A.driver().print('/ip/hotspot/ip-binding'))).find((x) => x.comment === 'tv')).toBeUndefined();
  });
});

describe('walled garden', () => {
  it('validates host and IP entries, applies defaults without duplicates, bulk toggle/remove', async () => {
    const save = walledForms['walledgarden/save']!;
    expect(await fails(A, save, form({ kind: 'host', dst_host: 'bad host!', action: 'allow' }))).toContain('valid host name');
    expect(await fails(A, save, form({ kind: 'ip', dst_address: '10.0.0.1', protocol: 'tcp', dst_port: '99999x', action: 'accept' }))).toContain('address, protocol and port');
    await submit(A, save, form({ kind: 'host', dst_host: '*.Example.com', action: 'allow', comment: 'ex' }));
    await submit(A, save, form({ kind: 'ip', dst_address: '8.8.8.0/24', protocol: 'tcp', dst_port: '80,443', action: 'accept' }));
    const hosts = () => A.run(() => A.driver().print('/ip/hotspot/walled-garden'));
    expect((await hosts()).map((h) => h['dst-host'])).toContain('*.example.com');

    const def = walledForms['walledgarden/defaults']!;
    await submit(A, def, form({ portal: 'portal.example.net' }));
    const n1 = (await hosts()).length;
    await submit(A, def, form({ portal: 'portal.example.net' }));
    expect((await hosts()).length).toBe(n1); // nothing duplicated
    expect(await fails(A, def, form({ portal: 'not a host' }))).toContain('valid host name');

    const row = (await hosts()).find((h) => h['dst-host'] === '*.example.com')!;
    const act = walledForms['walledgarden/action']!;
    await submit(A, act, form({ kind: 'host', 'ids[]': [row['.id']!], action: 'toggle' }));
    expect((await hosts()).find((h) => h['dst-host'] === '*.example.com')!.disabled).toBe('true');
    await submit(A, act, form({ kind: 'host', 'ids[]': [row['.id']!], action: 'toggle' }));
    expect((await hosts()).find((h) => h['dst-host'] === '*.example.com')!.disabled).toBe('false');
    expect(await fails(A, act, form({ kind: 'host', action: 'remove' }))).toBe('Nothing selected.');
    await submit(A, act, form({ kind: 'host', 'ids[]': [row['.id']!], action: 'remove' }));
    expect((await hosts()).find((h) => h['dst-host'] === '*.example.com')).toBeUndefined();
    // tenant B has none of it
    expect((await B.run(() => B.driver().print('/ip/hotspot/walled-garden'))).some((h) => h['dst-host'] === 'portal.example.net')).toBe(false);
  });
});

describe('vouchers, presets, templates', () => {
  it('generates a batch with the PHP options, finds it by its tag, prints only what the role may see, deletes it', async () => {
    await submit(A, profileForms['hotspot/profiles/save']!, form({ name: 'V1', mode: 'remc', validity: '1d', price: '5000' }));
    const res = (await submit(A, voucherForms['vouchers/generate']!, form({ profile: 'V1', qty: '7', prefix: 'zz', length: '5', charset: 'num', mode: 'up', batch: 'B1', design: 'mini' }))) as { to: string; msg: string };
    expect(res.msg).toBe('7 vouchers created.');
    const tag = decodeURIComponent(/comment=([^&]+)/.exec(res.to)![1]!);
    expect(tag).toMatch(/^up-\d{3}-\d\d\.\d\d\.\d\d-B1$/);
    expect(res.to).toContain('&design=mini');
    const items = await A.run(() => printItems(A, tag, ''));
    expect(items).toHaveLength(7);
    expect(items[0]!.user).toMatch(/^zz\d{5}$/);
    expect(items[0]!.pass).toMatch(/^\d{5}$/);
    expect(items[0]!.price).toBe('Rp 5.000');
    expect(items[0]!.validity).toBe('1d');
    // single voucher quick print
    expect(await A.run(() => printItems(A, '', items[0]!.user))).toHaveLength(1);
    expect(((await submit(A, voucherForms['vouchers/quick']!, form({ code: 'abc d' }))) as { to: string }).to).toBe('/vouchers/print?user=abc%20d');
    expect(await fails(A, voucherForms['vouchers/quick']!, form({ code: '' }))).toBe('Enter a voucher code.');
    // validation
    expect(await fails(A, voucherForms['vouchers/generate']!, form({ profile: '' }))).toBe('Choose a profile.');
    expect(await fails(A, voucherForms['vouchers/generate']!, form({ profile: 'V1', limit_uptime: '3d' }))).toContain('must not exceed validity');
    // batch delete
    await submit(A, voucherForms['vouchers/delete']!, form({ tag }));
    expect(await A.run(() => printItems(A, tag, ''))).toHaveLength(0);
  });

  it('cleanOpts whitelists and clamps browser-supplied print settings', () => {
    const o = cleanOpts({ design: 'bad design!', paper: 'tabloid', cols: 99, gap: -5, scale: 9999, accent: 'red', logo: 'javascript:alert(1)', qrMode: 'x', f: { qr: false }, ssid: 'x'.repeat(100), land: 1 });
    expect(o).toMatchObject({ design: 'aurora', paper: 'a4', cols: 8, gap: 0, scale: 200, accent: '#0b7285', logo: '', qrMode: 'login', land: true });
    expect(o.f.qr).toBe(false);
    expect(o.f.brand).toBe(true);
    expect(o.ssid).toHaveLength(32);
    expect(cleanOpts('nonsense').design).toBe('aurora');
    expect(cleanOpts({ design: 'c:abc12345' }).design).toBe('c:abc12345');
  });

  it('presets: save (JSON reply), cap on default, delete; per workspace', async () => {
    const r = (await submit(A, voucherForms['vouchers/preset/save']!, form({ name: 'Mine', opts: JSON.stringify({ design: 'dark', paper: 't58' }) }))) as { json: { ok: boolean; id: string; presets: { name: string }[] } };
    expect(r.json.ok).toBe(true);
    expect(r.json.presets.map((p) => p.name)).toEqual(['Mine']);
    expect(voucherForms['vouchers/preset/default']!.cap).toBe('write'); // PHP: default preset needs write
    expect(((await submit(A, voucherForms['vouchers/preset/default']!, form({ id: r.json.id }))) as { json: { ok: boolean } }).json.ok).toBe(true);
    expect(((await submit(A, voucherForms['vouchers/preset/default']!, form({ id: 'nope' }))) as { json: { ok: boolean } }).json.ok).toBe(false);
    const bad = (await submit(A, voucherForms['vouchers/preset/save']!, form({ name: 'x', opts: '[1]' }))) as { status?: number };
    expect(bad.status).toBe(422);
    expect(B.run(() => presets())).toEqual([]);
    await submit(A, voucherForms['vouchers/preset/delete']!, form({ id: r.json.id }));
    expect(A.run(() => presets())).toEqual([]);
    expect(A.run(() => Store.read<{ voucher_default_preset?: string }>('settings', {}).voucher_default_preset)).toBe('');
  });

  it('templates: HTML is sanitised on save, size is clamped, update replaces, delete removes; isolated per workspace', async () => {
    const evil = '<div onclick="x()" style="width:70mm">{{user}}<script>alert(1)</script><img src="javascript:alert(1)"></div>';
    await submit(A, templateForms['vouchers/templates/save']!, form({ name: 'T1', html: evil, w: '5', h: '999' }));
    let list = A.run(() => customTemplates());
    expect(list).toHaveLength(1);
    expect(list[0]!.html).toContain('{{user}}');
    expect(list[0]!.html).not.toMatch(/script|onclick|javascript:/i);
    expect(list[0]).toMatchObject({ w: 20, h: 300 });
    await submit(A, templateForms['vouchers/templates/save']!, form({ id: list[0]!.id, name: 'T1b', html: '<b>hi</b>', w: '70', h: '40' }));
    list = A.run(() => customTemplates());
    expect(list.map((x) => x.name)).toEqual(['T1b']);
    expect(await fails(A, templateForms['vouchers/templates/save']!, form({ name: '', html: 'x' }))).toBe('Name and HTML are required.');
    expect(B.run(() => customTemplates())).toEqual([]);
    // stored HTML that bypassed save (tampered settings) is still cleaned on read
    A.run(() => Store.update<Record<string, unknown>>('settings', (s) => ({ ...s, templates: [{ id: 'z', name: 'raw', html: '<script>1</script><i>ok</i>', w: 70, h: 40 }] }), {}));
    expect(A.run(() => customTemplates())[0]!.html).toBe('<i>ok</i>');
    await submit(A, templateForms['vouchers/templates/delete']!, form({ id: 'z' }));
    expect(A.run(() => customTemplates())).toEqual([]);
  });
});

describe('CSV import / export', () => {
  const csv = 'Name;Password;Profile;Time Limit;Comment;Disabled\r\n' + 'imp1;pw1;default;1h;"first, quoted";no\r\n' + "imp2;pw2;nosuch;;;\r\n" + "imp3;;default;;'=SUM(A1);yes\r\n" + 'imp1;dup;default;;;\r\n' + '\r\n' + 'bad name;x;default;;;\r\n';

  it('parses separators, BOM, quotes, aliases and unknown headers', () => {
    const p = Imp.parseCsv(Imp.decodeCsv(new TextEncoder().encode(String.fromCharCode(0xfeff) + 'User,Pass,Package,MAC,Whatever\n"a ""b""",p,default,aa-bb-cc-dd-ee-ff,zzz\n')), t);
    expect(p.error).toBe('');
    expect(p.map).toEqual(['name', 'password', 'profile', 'mac-address', '']);
    expect(p.rows[0]!.cells[0]).toBe('a "b"');
    expect(Imp.parseCsv('Foo,Bar\n1,2', t).error).toContain('No "Name" column');
    expect(Imp.parseCsv('', t).error).toBe('The file is empty.');
    // Windows-1252 fallback
    expect(Imp.decodeCsv(new Uint8Array([0x4e, 0xe9]))).toBe('Né');
    // multi-line quoted cell counts as ONE line (like fgetcsv)
    const ml = Imp.parseCsv('Name,Comment\n"a","x\ny"\nb,z\n', t);
    expect(ml.rows.map((r) => r.line)).toEqual([2, 3]);
  });

  it('csv helpers: formula guard both ways, fputcsv-style quoting', () => {
    expect(Imp.out('=1+1')).toBe("'=1+1");
    expect(Imp.out('-5')).toBe('-5');
    expect(Imp.inn("  '=SUM(A1) ")).toBe('=SUM(A1)');
    expect(Imp.csvLine(['a', 'b c', 'd,e', 'q"r', ''], ',')).toBe('a,"b c","d,e","q""r",\r\n');
  });

  it('preview -> commit (skip / overwrite / dry run) with per-row results, in tenant A only', async () => {
    const fd = form({ mode: 'skip' });
    fd.append('csv', new File([csv], 'users.csv', { type: 'text/csv' }));
    const prev = (await submit(A, importForms['import/preview']!, fd)) as { to: string };
    const token = /t=([a-f0-9]{16})/.exec(prev.to)![1]!;
    const pend = A.run(() => Imp.load(token, A.session.hash))!;
    expect(pend.counts).toEqual({ new: 2, update: 0, skip: 0, error: 3 }); // imp2 (profile), imp1 dup, "bad name"
    expect(pend.rows.find((r) => r.d.name === 'imp3')!.d.comment).toBe('=SUM(A1)');
    expect(pend.rows.find((r) => r.d.name === 'imp3')!.d.disabled).toBe('yes');
    // the encrypted store must not hold a plain password
    expect(A.run(() => JSON.stringify(Store.read('import_' + token + '_rows', '')))).not.toContain('pw1');
    // another session / another workspace can neither read nor commit it
    expect(A.run(() => Imp.load(token, 'other-session'))).toBeNull();
    expect(B.run(() => Imp.load(token, A.session.hash))).toBeNull();
    expect(await fails(B, importForms['import/commit']!, form({ t: token }))).toBe('Import session expired. Upload the file again.');
    // dry run writes nothing and keeps the rows
    await submit(A, importForms['import/commit']!, form({ t: token, mode: 'skip', dry: '1' }));
    expect(await A.run(() => A.driver().print('/ip/hotspot/user', { name: 'imp1' }))).toHaveLength(0);
    const dry = A.run(() => Imp.loadResult(token, A.session.hash))!;
    expect(dry).toMatchObject({ dry: true, added: 2, errors: 3 });
    expect(A.run(() => Imp.load(token, A.session.hash))).not.toBeNull();
    // real run
    await submit(A, importForms['import/commit']!, form({ t: token, mode: 'skip' }));
    const imp3 = (await A.run(() => A.driver().print('/ip/hotspot/user', { name: 'imp3' })))[0]!;
    expect(imp3.comment).toBe('=SUM(A1)');
    expect(imp3.disabled).toMatch(/^(true|yes)$/); // DemoDriver.add keeps the CSV spelling, a real router answers true
    expect(await A.run(() => A.driver().print('/ip/hotspot/user', { name: 'imp1' }))).toHaveLength(1);
    expect(await B.run(() => B.driver().print('/ip/hotspot/user', { name: 'imp1' }))).toHaveLength(0);
    const res = A.run(() => Imp.loadResult(token, A.session.hash))!;
    expect(res).toMatchObject({ dry: false, added: 2, errors: 3 });
    expect(res.rowErrors.map((e) => e.line)).toEqual([3, 5, 7]);
    expect(A.run(() => Imp.load(token, A.session.hash))).toBeNull(); // passwords dropped after a real run
    // overwrite: only the non-empty cells change the existing user
    const fd2 = form({ mode: 'overwrite' });
    fd2.append('csv', new File(['Name,Comment,Password\nimp1,changed,\n'], 'o.csv'));
    const t2 = /t=([a-f0-9]{16})/.exec(((await submit(A, importForms['import/preview']!, fd2)) as { to: string }).to)![1]!;
    await submit(A, importForms['import/commit']!, form({ t: t2, mode: 'overwrite' }));
    const after = (await A.run(() => A.driver().print('/ip/hotspot/user', { name: 'imp1' })))[0]!;
    expect(after.comment).toBe('changed');
    expect(after.password).toBe('pw1');
    // cancel forgets everything
    await submit(A, importForms['import/cancel']!, form({ t: t2 }));
    expect(A.run(() => Imp.loadResult(t2, A.session.hash))).toBeNull();
  });

  it('rejects empty, oversized and wrong-type uploads', async () => {
    expect(await fails(A, importForms['import/preview']!, form({}))).toBe('Choose a CSV file first.');
    const big = form({});
    big.append('csv', new File([new Uint8Array(Imp.MAX_BYTES + 1)], 'big.csv'));
    expect(await fails(A, importForms['import/preview']!, big)).toContain('too large');
    const exe = form({});
    exe.append('csv', new File(['Name\nx'], 'x.exe'));
    expect(await fails(A, importForms['import/preview']!, exe)).toBe('Only .csv files are accepted.');
    const hdr = form({});
    hdr.append('csv', new File(['Name\n'], 'h.csv'));
    expect(await fails(A, importForms['import/preview']!, hdr)).toBe('The file has a header but no data rows.');
  });

  it('export honours profile / search filters, formula guard and separators; template + errors downloads', async () => {
    await submit(A, userForms['hotspot/users/save']!, form({ name: 'exp1', password: '=cmd', profile: 'default', comment: 'needle' }));
    const get = (rest: string, qs = '') => A.run(async () => (await importApi.GET!(A, new Request('http://localhost/api/json/import/' + rest + qs), [rest])) as Response);
    const r = await get('export', '?q=needle&sep=semicolon');
    expect(r.headers.get('content-disposition')).toMatch(/hotspot-users-\d{8}-\d{6}\.csv/);
    const body = await r.text();
    expect(Array.from(new Uint8Array(await (await get('export')).arrayBuffer()).slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(body).not.toContain('imp1');
    expect(body).toContain('Server;Name;Password;Profile;"Mac Address";"Time Limit";"Data Limit";Comment;Disabled'); // fputcsv also quotes fields with a space
    expect(body).toContain("all;exp1;'=cmd;default;;;;needle;no");
    expect(body).not.toContain('imp1');
    expect(await (await get('template')).text()).toContain('Server,Name,Password,Profile');
    await expect(A.run(async () => await importApi.GET!(A, new Request('http://localhost/x'), ['nope']))).rejects.toThrow('not found');
  });
});

describe('reseller voucher generation: wallet charge, rollback and batch isolation', () => {
  const tagOf = (to: string) => decodeURIComponent(/comment=([^&]+)/.exec(to)![1]!);
  const gen = (c: AppContext, o: Record<string, string>) => submit(c, voucherForms['vouchers/generate']!, form(o)) as Promise<{ to: string; msg: string }>;
  const usersOf = (c: AppContext, tag: string) => c.run(async () => (await c.driver().print('/ip/hotspot/user', {}, ['name', 'comment'])).filter((u) => Voucher.batchOf(u.comment ?? '') === tag));
  const bal = (uid: string) => A.run(() => RS.balance(uid));
  const cfgOf = (uid: string, over: Record<string, unknown> = {}) => A.run(() => RS.saveCfg(uid, { active: true, commission: 10, adj: 0, credit: 0, allow_all: true, ...over }));

  /** Same driver, but the bulk add creates only the first two users and then fails (e.g. the router drops the connection). */
  const flaky = (c: AppContext): AppContext => ({
    ...c,
    driver: () =>
      new Proxy(c.driver(), {
        get(target, prop) {
          if (prop === 'addMany')
            return async (path: string, rows: Record<string, string>[]) => {
              await target.addMany(path, rows.slice(0, 2));
              throw new RouterOSError('connection lost');
            };
          const v = Reflect.get(target, prop) as unknown;
          return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
        },
      }),
  });

  beforeAll(async () => {
    await submit(A, profileForms['hotspot/profiles/save']!, form({ name: 'R5k', mode: 'remc', validity: '1d', price: '5000' }));
    cfgOf('rs-1');
    A.run(() => RS.topup('rs-1', 50000, 'test'));
  });

  it('charges the wallet (cost - commission) before creating the users and records the batch for the reseller', async () => {
    const res = await gen(AR, { profile: 'R5k', qty: '4' });
    expect(res.msg).toBe('4 vouchers created.');
    expect(bal('rs-1')).toBe(50000 - 4 * 5000 + 2000); // 10 % commission on the base price
    expect(await usersOf(AR, tagOf(res.to))).toHaveLength(4);
    const sale = A.run(() => RS.rows({ uid: 'rs-1', type: 'sale' }));
    expect(sale[0]).toMatchObject({ amount: -20000 });
    expect(A.run(() => RS.mayPrint(AR.user, tagOf(res.to)))).toBe(true);
  });

  it('blocks without creating anything when the balance, the profile permission or the account state does not allow it', async () => {
    const before = bal('rs-1');
    const count = async () => (await A.run(() => A.driver().print('/ip/hotspot/user'))).length;
    const n0 = await count();
    expect(await fails(AR, voucherForms['vouchers/generate']!, form({ profile: 'R5k', qty: '100' }))).toMatch(/Insufficient balance|Saldo tidak cukup/);
    cfgOf('rs-1', { allow_all: false, profiles: { '1Jam': null } });
    expect(await fails(AR, voucherForms['vouchers/generate']!, form({ profile: 'R5k', qty: '1' }))).toMatch(/not allowed to sell|tidak diizinkan menjual/);
    cfgOf('rs-1', { active: false });
    expect(await fails(AR, voucherForms['vouchers/generate']!, form({ profile: 'R5k', qty: '1' }))).toMatch(/not active|tidak aktif/);
    cfgOf('rs-1');
    expect(await fails(AR, voucherForms['vouchers/generate']!, form({ profile: 'NoSuchProfile', qty: '1' }))).toBe('Profile not found.');
    expect(await fails(AR, voucherForms['vouchers/generate']!, form({ profile: 'R5k', qty: '1', limit_uptime: '9d' }))).toContain('must not exceed validity');
    expect(bal('rs-1')).toBe(before);
    expect(await count()).toBe(n0);
  });

  it('rolls back the wallet charge AND removes the router users it managed to create when generation fails half way', async () => {
    const before = bal('rs-1');
    const users0 = (await A.run(() => A.driver().print('/ip/hotspot/user'))).length;
    await expect(submit(flaky(AR), voucherForms['vouchers/generate']!, form({ profile: 'R5k', qty: '6' }))).rejects.toThrow('connection lost');
    expect(bal('rs-1')).toBe(before);
    expect((await A.run(() => A.driver().print('/ip/hotspot/user'))).length).toBe(users0); // the 2 partially created users are gone
    const ledger = A.run(() => RS.rows({ uid: 'rs-1' }));
    expect(ledger.some((r) => r.type === 'refund' && r.note.startsWith('rollback'))).toBe(true);
    expect(ledger.filter((r) => r.type === 'sale' && r.amount === -30000)).toHaveLength(1); // charge + refund both on the books
    // an admin (never charged) failing half way also leaves nothing behind and touches no wallet
    const adminFlaky = flaky(A);
    await expect(submit(adminFlaky, voucherForms['vouchers/generate']!, form({ profile: 'R5k', qty: '3' }))).rejects.toThrow('connection lost');
    expect((await A.run(() => A.driver().print('/ip/hotspot/user'))).length).toBe(users0);
    expect(bal('rs-1')).toBe(before);
  });

  it('does not charge admins/operators and never lets one reseller reach another reseller\'s or the admin\'s batches (IDOR)', async () => {
    const RS2 = ctxFor(wsA, 'rs-2', 'reseller');
    cfgOf('rs-2');
    A.run(() => RS.topup('rs-2', 100000, 'test'));
    const adminBefore = bal(A.user.id);
    const adminBatch = await gen(A, { profile: 'R5k', qty: '2' });
    expect(bal(A.user.id)).toBe(adminBefore);
    const r1 = await gen(AR, { profile: 'R5k', qty: '2' });
    const r2 = await gen(RS2, { profile: 'R5k', qty: '3' });
    const [tAdmin, t1, t2] = [tagOf(adminBatch.to), tagOf(r1.to), tagOf(r2.to)];
    const sees = (c: AppContext, tag: string) => c.run(async () => (await printItems(c, tag, '')).length);
    expect([await sees(AR, t1), await sees(AR, t2), await sees(AR, tAdmin)]).toEqual([2, 0, 0]);
    expect([await sees(RS2, t1), await sees(RS2, t2), await sees(RS2, tAdmin)]).toEqual([0, 3, 0]);
    expect([await sees(A, t1), await sees(A, t2), await sees(A, tAdmin)]).toEqual([2, 3, 2]); // admins see everything
    // single-voucher path (?user=) is checked per batch too
    const someOfR2 = (await usersOf(A, t2))[0]!.name!;
    expect(await AR.run(() => printItems(AR, '', someOfR2))).toHaveLength(0);
    expect(await RS2.run(() => printItems(RS2, '', someOfR2))).toHaveLength(1);
    // a user with no batch tag at all (created by hand) is invisible to resellers
    await submit(A, userForms['hotspot/users/save']!, form({ name: 'handmade', password: 'x', profile: 'default' }));
    expect(await AR.run(() => printItems(AR, '', 'handmade'))).toHaveLength(0);
    // batch ownership is per workspace
    expect(B.run(() => RS.mayPrint(AR.user, t1))).toBe(false);
    // resellers can never delete batches
    expect(voucherForms['vouchers/delete']!.cap).toBe('write');
    expect(A.run(() => can(AR.user, 'write'))).toBe(false);
  });
});

describe('print view HTML', () => {
  it('escapes every dynamic value and neutralises </script> inside the JSON blocks; scripts carry the CSP nonce', () => {
    const evil = '</script><img src=x onerror=alert(1)>';
    const html = A.run(() => renderPrintHtml(A, 'N0NCE', [{ user: evil, pass: evil, profile: evil, price: '', validity: '', limit: '', comment: evil, url: '' }], evil));
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('</script><img');
    expect(html).toContain('&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;'); // the tag line
    expect(html).toContain('\\u003c/script\\u003e'); // JSON blocks
    for (const m of html.matchAll(/<script\b([^>]*)>/g)) if (!m[1]!.includes('application/json')) expect(m[1]).toContain('nonce="N0NCE"');
    expect(html).toContain('data-page="print"');
    expect(html).toContain('"base":"/hs"');
  });
});

describe('capabilities of the registered routes', () => {
  it('every write endpoint needs write (or sell for voucher generation); nothing is open to view', () => {
    const all: Record<string, FormRoute> = { ...userForms, ...profileForms, ...activeForms, ...bindingForms, ...walledForms, ...voucherForms, ...templateForms, ...importForms };
    for (const [key, r] of Object.entries(all)) {
      if (key === 'hotspot/profiles/preview') expect(r.cap).toBe('view'); // pure computation, same as PHP
      else expect(['sell', 'write'], key).toContain(r.cap);
    }
    expect(all['vouchers/generate']!.cap).toBe('sell');
    expect(all['vouchers/delete']!.cap).toBe('write');
    expect(all['import/commit']!.cap).toBe('write');
    expect(wsA).not.toBe('');
  });
});
