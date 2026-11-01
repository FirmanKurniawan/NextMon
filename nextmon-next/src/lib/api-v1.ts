/**
 * REST API for integrations: /api/v1/<resource>, authenticated with an API key (header X-API-Key or "Authorization: Bearer").
 * Mirrors ApiController of the PHP edition. The key identifies the tenant (global index -> workspace); everything then runs
 * inside the workspace context, so a key can never reach another workspace. `?router=ID` picks a router visible to that workspace.
 */
import { Audit } from './audit.ts';
import { ApiKeys } from './apikeys.ts';
import { Cache } from './cache.ts';
import { Context } from './context.ts';
import type { Driver } from './driver.ts';
import { Net } from './net.ts';
import { QuotaError } from './quota.ts';
import { Routers } from './routers.ts';
import { RouterOSError } from './routeros.ts';
import { Sales } from './sales.ts';
import { Scripts } from './scripts.ts';
import { getSettings } from './store.ts';
import { IFACE_RE } from './traffic-hub.ts';
import { Voucher } from './voucher.ts';
import { dashboardData } from '../features/dashboard/data.ts';

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });

export function presentedKey(h: Headers): string {
  const k = h.get('x-api-key')?.trim() ?? '';
  if (k) return k;
  const m = /^Bearer\s+(\S+)/i.exec(h.get('authorization') ?? '');
  return m?.[1] ?? '';
}

export async function readBody(req: Request): Promise<Record<string, unknown>> {
  if (req.method !== 'POST') return Object.fromEntries(new URL(req.url).searchParams);
  const text = await req.text();
  if (text.length > 256 * 1024) return {};
  try {
    const j = JSON.parse(text);
    if (j && typeof j === 'object' && !Array.isArray(j)) return j as Record<string, unknown>;
  } catch {
    /* fall through to form encoding */
  }
  return Object.fromEntries(new URLSearchParams(text));
}

export async function handleV1(req: Request, rest: string[]): Promise<Response> {
  const name = rest[0] ?? '';
  if (!name) return json({ ok: false, error: 'not found' }, 404);
  const ip = Net.clientIp(req.headers);
  const auth = ApiKeys.authenticate(presentedKey(req.headers));
  if (!auth.ok) {
    if (auth.reason === 'suspended') return json({ ok: false, error: 'workspace suspended' }, 403);
    // throttle guessing; keys are 160-bit random so this is mostly about log/CPU noise
    if (Net.hit('apifail', ip, 30, 600)) return json({ ok: false, error: 'too many attempts' }, 429, { 'retry-after': '600' });
    return json({ ok: false, error: 'invalid api key' }, 401);
  }
  if (Net.hit('apikey', auth.key.id, 600, 60)) return json({ ok: false, error: 'rate limited' }, 429, { 'retry-after': '60' });
  const actor = { id: 'key:' + auth.key.id, username: 'api:' + auth.key.name, role: 'api', workspace: auth.ws };
  return Context.run({ ws: auth.ws, ip, actor }, async () => {
    ApiKeys.touch(auth.key);
    const url = new URL(req.url);
    const rid = url.searchParams.get('router') || Routers.list()[0]?.id || '';
    if (!rid || !Routers.get(rid)) return json({ ok: false, error: 'unknown router' }, 404);
    try {
      const out = await resource(name, req, Routers.driver(rid), rid, await readBody(req), auth.key.scope === 'write', auth.ws);
      return json(out, out.ok === false ? 400 : 200);
    } catch (e) {
      if (e instanceof RouterOSError) return json({ ok: false, error: e.message }, 502);
      if (e instanceof QuotaError) return json({ ok: false, error: e.message, used: e.used, limit: e.limit }, 429); // daily voucher limit
      console.error('[nextmon] api/v1 error', e);
      return json({ ok: false, error: 'Server error' }, 500);
    }
  });
}

export async function resource(name: string, req: Request, r: Driver, rid: string, input: Record<string, unknown>, canWrite: boolean, ws: string): Promise<Record<string, unknown>> {
  const limit = Math.max(1, Math.min(1000, Number(input.limit) || 200));
  const settings = getSettings();
  const tz = String(settings.timezone || 'UTC');
  switch (name) {
    case 'dashboard':
    case 'status': {
      const cur = Routers.get(rid)!;
      return (await dashboardData(r, { ws, routerId: rid, ns: `${cur.owner}:${rid}`, tz, currency: String(settings.currency) })) as Record<string, unknown>;
    }
    case 'traffic': {
      const iface = String(input.interface ?? 'ether1');
      if (!IFACE_RE.test(iface)) return { ok: false, error: 'bad interface' };
      const row = (await r.command('/interface/monitor-traffic', { interface: iface, once: true }))[0] ?? {};
      return { ok: true, t: Math.floor(Date.now() / 1000), rx: Number(row['rx-bits-per-second'] ?? 0), tx: Number(row['tx-bits-per-second'] ?? 0) };
    }
    case 'interfaces':
      return { ok: true, data: await r.print('/interface', {}, ['name', 'type', 'running']) };
    case 'health': {
      const g = await r.printMany({ res: ['/system/resource'], health: ['/system/health'] });
      return { ok: true, resource: g.res?.[0] ?? {}, health: g.health?.[0] ?? {} };
    }
    case 'logs': {
      const rows = (await r.print('/log', {}, ['time', 'topics', 'message'])).filter((x) => (x.topics ?? '').toLowerCase().includes('hotspot'));
      return { ok: true, data: rows.reverse().slice(0, 20) };
    }
    case 'users': {
      const q = String(input.q ?? '').toLowerCase();
      const profile = String(input.profile ?? '');
      let rows = await r.print('/ip/hotspot/user', profile ? { profile } : {}, ['name', 'profile', 'comment', 'uptime', 'bytes-in', 'bytes-out', 'limit-uptime', 'disabled']);
      if (q) rows = rows.filter((x) => `${x.name ?? ''} ${x.comment ?? ''}`.toLowerCase().includes(q));
      return { ok: true, total: rows.length, data: rows.slice(0, limit) };
    }
    case 'profiles': {
      const rows = await r.print('/ip/hotspot/user/profile', {}, ['name', 'rate-limit', 'shared-users', 'on-login']);
      return { ok: true, data: rows.map(({ 'on-login': onLogin, ...p }) => ({ ...p, meta: Scripts.parseMeta(onLogin ?? '') })) };
    }
    case 'active':
      return { ok: true, data: await r.print('/ip/hotspot/active') };
    case 'hosts':
      return { ok: true, data: await r.print('/ip/hotspot/host') };
    case 'sales': {
      const all = await Sales.fetch(r, Cache.scope(ws, 'sales', rid), tz);
      const period = String(input.period ?? 'month');
      const p = Sales.zonedParts(Math.floor(Date.now() / 1000), tz);
      const pad = (n: number) => String(n).padStart(2, '0');
      const def: Record<string, string> = { day: `${p.y}-${pad(p.mo)}-${pad(p.d)}`, month: `${p.y}-${pad(p.mo)}`, year: String(p.y), all: '' };
      const rows = Sales.filter(all, period, String(input.value ?? def[period] ?? ''), String(input.profile ?? ''), tz);
      return { ok: true, total: Sales.sum(rows), count: rows.length, data: rows.slice(0, limit) };
    }
    case 'vouchers': {
      if (req.method !== 'POST') return { ok: false, error: 'POST required' };
      if (!canWrite) return { ok: false, error: 'forbidden: key scope is read-only' };
      if (!input.profile) return { ok: false, error: 'profile required' };
      const res = await Voucher.generate(r, {
        profile: String(input.profile),
        qty: Number(input.qty ?? 1),
        prefix: String(input.prefix ?? ''),
        length: Number(input.length ?? 6),
        charset: String(input.charset ?? 'lowernum'),
        mode: String(input.mode ?? 'vc'),
        batch: String(input.batch ?? 'api'),
      });
      Audit.log('api.vouchers', `${res.items.length} x ${String(input.profile)}`);
      return { ok: true, comment: res.comment, data: res.items.map(([user, password]) => ({ user, password })) };
    }
    case 'kick': {
      if (req.method !== 'POST' || !canWrite) return { ok: false, error: 'POST + write scope required' };
      const user = String(input.user ?? '');
      const rows = await r.print('/ip/hotspot/active', { user }, ['user']);
      for (const a of rows) await r.remove('/ip/hotspot/active', String(a['.id']));
      Audit.log('api.kick', user);
      return { ok: true, kicked: rows.length };
    }
  }
  return { ok: false, error: 'unknown resource' };
}
