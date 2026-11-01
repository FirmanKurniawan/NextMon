/**
 * PHP/Next parity (docs/PARITY.md): navigation per role, tab bar fallback, CSP dev/prod split, /json twins of the PHP ApiController
 * resources, hosts bulk remove, workspace switching rules, CLI command names.
 */
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Features } from '../../src/features/registry.ts';
import { hostForms } from '../../src/features/hosts/forms.ts';
import { switchWorkspace } from '../../src/features/platform/logic.ts';
import { UserError } from '../../src/features/routers/util.ts';
import type { AppContext } from '../../src/features/types.ts';
import { Context } from '../../src/lib/context.ts';
import { I18n } from '../../src/lib/i18n.ts';
import { Routers } from '../../src/lib/routers.ts';
import { Sessions } from '../../src/lib/sessions.ts';
import { getSettings } from '../../src/lib/store.ts';
import { can } from '../../src/lib/users.ts';
import type { Role } from '../../src/lib/users.ts';
import { buildNav, tabItems } from '../../src/nav/registry.ts';
import { buildCsp } from '../../src/server/csp.ts';
import { addStaff, bootstrapPlatform, makeTenant } from '../helpers.ts';

const keys = (role: Role) =>
  buildNav((c) => can({ role }, c), role)
    .flatMap((g) => g.items)
    .map((i) => i.key);

describe('navigation per role (same menu as the PHP edition)', () => {
  it('"My wallet" is for reseller accounts only; resellers/orders/shop settings for owners', () => {
    expect(keys('reseller')).toContain('wallet');
    for (const r of ['admin', 'operator', 'viewer', 'platform'] as Role[]) expect(keys(r)).not.toContain('wallet');
    expect(keys('admin')).toContain('resellers');
    expect(keys('operator')).not.toContain('resellers');
    expect(keys('operator')).toContain('orders');
    expect(keys('viewer')).not.toContain('orders');
    expect(keys('admin')).toContain('shop_settings');
    expect(keys('operator')).not.toContain('shop_settings');
  });
  it('Security is reachable from the menu for everyone; Accounts for the platform admin only', () => {
    for (const r of ['platform', 'admin', 'operator', 'reseller', 'viewer'] as Role[]) expect(keys(r)).toContain('security');
    expect(keys('platform')).toContain('platform');
    expect(keys('admin')).not.toContain('platform');
  });
  it('item order follows the PHP menu (Network: queues, firewall, tools, backup, monitor, pppoe, dhcp, arp, walled garden, wizard)', () => {
    const k = keys('admin');
    const order = ['queues', 'firewall', 'tools', 'backup', 'monitor', 'pppoe', 'dhcp', 'arp', 'walledgarden', 'wizard'];
    expect(order.map((x) => k.indexOf(x))).toEqual(order.map((x) => k.indexOf(x)).sort((a, b) => a - b));
    expect(order.every((x) => k.includes(x))).toBe(true);
    const sys = ['routers', 'notifications', 'audit', 'settings', 'platform', 'security'];
    const kp = keys('platform');
    expect(sys.map((x) => kp.indexOf(x))).toEqual(sys.map((x) => kp.indexOf(x)).sort((a, b) => a - b));
  });
  it('tab bar: Active sessions replaces Vouchers for roles that cannot sell', () => {
    const tab = (r: Role) => tabItems(buildNav((c) => can({ role: r }, c), r)).map((i) => i.key);
    expect(tab('admin')).toEqual(['dashboard', 'users', 'vouchers', 'reports']);
    expect(tab('viewer')).toEqual(['dashboard', 'users', 'active', 'reports']);
  });
});

describe('CSP', () => {
  it('production: nonce-only inline styles; dev: Next dev overlay styles allowed', () => {
    const prod = buildCsp('abc', { dev: false, https: false });
    expect(prod).toContain("style-src-elem 'self' 'nonce-abc'");
    expect(prod).not.toContain("style-src-elem 'self' 'nonce-abc' 'unsafe-inline'");
    expect(prod).not.toMatch(/style-src 'self' 'unsafe-inline'/);
    expect(prod).not.toContain('unsafe-eval');
    const dev = buildCsp('abc', { dev: true, https: false });
    expect(dev).toContain("style-src-elem 'self' 'unsafe-inline'");
    expect(dev).not.toContain("style-src-elem 'self' 'nonce-abc'");
  });
});

describe('JSON twins of the PHP ApiController resources', () => {
  it('serves users, profiles, active, sales, vouchers, kick for the session', () => {
    for (const n of ['users', 'profiles', 'active', 'sales', 'vouchers', 'kick', 'hosts', 'dashboard', 'status', 'traffic', 'interfaces', 'health', 'logs']) {
      expect(Features.apiRoute(n), n).not.toBeNull();
    }
    expect(Features.conflicts()).toEqual([]);
  });
});

describe('CLI', () => {
  it('has the PHP command names (doctor, tenant:list, tenant:status, crypto:rotate/rekey, storage:*, cache:clear, cron)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../scripts/cli.mts'), 'utf8');
    for (const c of ['doctor', 'tenant:list', 'tenant:status', 'crypto:rotate', 'rekey', 'storage:status', 'storage:vacuum', 'cache:clear', 'cron']) expect(src, c).toContain(`'${c}'`);
  });
});

let boot: Awaited<ReturnType<typeof bootstrapPlatform>>;
beforeAll(async () => {
  boot = await bootstrapPlatform();
});

describe('hosts bulk remove + settings defaults', () => {
  const ws = () => boot.ws;
  const ctxOf = (id: string): AppContext => {
    const user = { id: 'u1', username: 'root', role: 'platform' as Role, workspace: id };
    const router = Context.run({ ws: id }, () => Routers.current());
    return {
      user,
      t: I18n.translator('en'),
      router,
      can: (c: Parameters<typeof can>[1]) => can(user, c),
      run: <T,>(fn: () => T) => Context.run({ ws: id, actor: user, ip: '127.0.0.1', routerId: router?.id }, fn),
      driver: () => Routers.driver(router!.id),
    } as unknown as AppContext;
  };
  it('removes the selected hosts', async () => {
    const ctx = ctxOf(ws());
    const before = await ctx.run(() => ctx.driver().print('/ip/hotspot/host'));
    expect(before.length).toBeGreaterThan(1);
    const fd = new FormData();
    fd.append('ids[]', before[0]!['.id']!);
    const r = await ctx.run(() => hostForms['hotspot/hosts/remove']!.run({ ctx, fd, req: new Request('http://x') }));
    expect('to' in r && r.to).toBe('/hotspot/hosts');
    const after = await ctx.run(() => ctx.driver().print('/ip/hotspot/host'));
    expect(after.length).toBe(before.length - 1);
  });
  it('telegram events are all subscribed by default (PHP Store::defaults)', () => {
    const s = Context.run({ ws: ws() }, () => getSettings());
    expect((s.telegram as { events: string[] }).events).toEqual(['sale', 'voucher', 'router', 'login']);
  });
});

describe('switching workspace (platform admin)', () => {
  it('accepts id, slug, "home" and "" ; rejects unknown targets; clears the selected router', async () => {
    const { ws, platform } = boot;
    const tenant = await makeTenant('acme');
    await addStaff(tenant.ws, 'staff1', 'viewer');
    const { token } = Sessions.create(platform, ws, { ip: '127.0.0.1', ua: 't', lang: 'en' });
    const hash = Sessions.resolve(token)!.session.hash;
    Sessions.setRouter(hash, 'whatever');
    const act = (to: string) => Context.run({ ws: Sessions.resolve(token)!.workspace.id, actor: { id: platform.id, username: platform.username, role: 'platform', workspace: ws } }, () => switchWorkspace(hash, platform, Sessions.resolve(token)!.workspace.id, to));
    expect(act('acme').target.id).toBe(tenant.ws);
    expect(Sessions.resolve(token)!.workspace.id).toBe(tenant.ws);
    expect(Sessions.resolve(token)!.session.router).toBe('');
    expect(act('home').home).toBe(true);
    expect(Sessions.resolve(token)!.workspace.id).toBe(ws);
    expect(act(tenant.ws).target.id).toBe(tenant.ws);
    expect(act('').target.id).toBe(ws);
    expect(() => act('nope')).toThrow(UserError);
    expect(() => act('w_ffffffff')).toThrow(UserError);
  });
});
