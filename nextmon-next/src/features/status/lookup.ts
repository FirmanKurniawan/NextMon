/**
 * Public voucher status (port of nextmon-php StatusController). No Next.js imports.
 * The tenant is found from the router SESSION name (every active workspace is searched); a duplicated session name needs the
 * `?w=slug` hint, otherwise it is treated as unknown (never guessed). Only the workspace's OWN routers are visible, never shared ones.
 */
import { Context } from '../../lib/context.ts';
import { Net } from '../../lib/net.ts';
import { Routers } from '../../lib/routers.ts';
import type { RouterView } from '../../lib/routers.ts';
import { getSettings } from '../../lib/store.ts';
import { expiryOf } from '../../lib/voucher.ts';
import { Workspace } from '../../lib/workspace.ts';
import type { WorkspaceRec } from '../../lib/workspace.ts';

export type StatusRes = {
  user: string;
  profile: string;
  status: 'new' | 'online' | 'used' | 'expired' | 'disabled';
  uptime: string;
  limit_uptime: string;
  time_left: string;
  expires: string;
  bytes_in: number;
  bytes_out: number;
};

export type SessionHit = { ws: WorkspaceRec; router: RouterView };

/** Active workspace + own router whose session name matches (case-insensitive); `slugHint` disambiguates. */
export function bySession(session: string, slugHint = ''): SessionHit | null {
  const s = session.trim();
  if (s === '') return null;
  const hint = slugHint.trim().toLowerCase();
  const hits: SessionHit[] = [];
  for (const w of Workspace.all()) {
    if (w.status === 'suspended') continue;
    Workspace.run(w.id, () => {
      for (const r of Routers.list()) {
        if (!r.shared && (r.session || r.id).toLowerCase() === s.toLowerCase()) hits.push({ ws: w, router: r });
      }
    });
  }
  const pick = hint !== '' ? hits.filter((h) => h.ws.slug === hint) : hits;
  return pick.length === 1 ? pick[0]! : null;
}

/** Anti-enumeration + router protection: 40 lookups / 10 min per client IP and a global ceiling. Returns true when limited. */
export function limited(ip: string): boolean {
  const perIp = Net.hit('status', ip, 40, 600);
  const all = Net.hit('status-all', '*', 1500, 600);
  return perIp || all;
}

/** Runs inside the hit's workspace. */
export async function lookup(router: RouterView, userIn: string): Promise<StatusRes | null> {
  const r = Routers.driver(router.id);
  let user = userIn;
  const q = (u: string) => r.printMany({ u: ['/ip/hotspot/user', { name: u }], a: ['/ip/hotspot/active', { user: u }] });
  let got = await q(user);
  if (!got.u!.length) {
    // a code printed in groups ("3c7 ta6") typed with its gap: try the raw code
    const flat = user.replace(/[\s\u00A0\u2009\u202F-]+/gu, "");
    if (flat !== '' && flat !== user) {
      user = flat;
      got = await q(user);
    }
  }
  const u = got.u![0];
  if (!u) return null;
  const act = got.a![0];
  let exp = expiryOf(String(u.comment ?? ''));
  if (exp === '') exp = (await r.print('/system/scheduler', { name: user }, ['next-run']))[0]?.['next-run'] ?? '';
  const limit = String(u['limit-uptime'] ?? '');
  let status: StatusRes['status'] = 'new';
  if (u.disabled === 'true') status = 'disabled';
  else if (limit === '1s') status = 'expired';
  else if (act) status = 'online';
  else if ((u.uptime ?? '0s') !== '0s') status = 'used';
  return {
    user,
    profile: u.profile ?? '',
    status,
    uptime: u.uptime ?? '0s',
    limit_uptime: limit,
    time_left: act?.['session-time-left'] ?? '',
    expires: exp,
    bytes_in: Number(u['bytes-in'] ?? 0) || 0,
    bytes_out: Number(u['bytes-out'] ?? 0) || 0,
  };
}

export type StatusPage = { brand: string; known: boolean; res: StatusRes | null; err: string };

/** Everything the page needs. `err` is an English message key. Call OUTSIDE a workspace context. */
export async function statusPage(session: string, user: string, slugHint: string, ip: string): Promise<StatusPage> {
  const hit = bySession(session, slugHint);
  if (!hit) return { brand: 'NextMON', known: false, res: null, err: user !== '' ? 'Unknown session name.' : '' };
  return Workspace.run(hit.ws.id, () =>
    Context.run({ ip }, async (): Promise<StatusPage> => {
      const brand = hit.router.hotspot_name || 'NextMON';
      if (user === '') return { brand, known: true, res: null, err: '' };
      if (limited(ip)) return { brand, known: true, res: null, err: 'Too many requests. Please wait a few minutes.' };
      try {
        const res = await lookup(hit.router, user);
        return { brand, known: true, res, err: res ? '' : 'Voucher not found.' };
      } catch {
        return { brand, known: true, res: null, err: 'Status service is temporarily unavailable.' };
      }
    }),
  );
}

/** /status.json */
export async function statusJson(session: string, user: string, slugHint: string, ip: string, origin: string): Promise<{ status: number; body: Record<string, unknown>; cors: string }> {
  const hit = bySession(session, slugHint);
  if (!hit || user === '') return { status: 400, body: { ok: false, error: 'bad request' }, cors: '' };
  return Workspace.run(hit.ws.id, () =>
    Context.run({ ip }, async () => {
      const allowed: string[] = [];
      for (const r of Routers.list()) {
        if (!r.shared && r.host) allowed.push('http://' + r.host, 'https://' + r.host);
      }
      for (const o of String(getSettings().status_cors ?? '').split(',')) {
        const v = o.trim().replace(/\/+$/, '');
        if (v !== '') allowed.push(v);
      }
      const cors = origin !== '' && allowed.includes(origin) ? origin : '';
      if (limited(ip)) return { status: 429, body: { ok: false, error: 'rate limited' }, cors };
      try {
        const res = await lookup(hit.router, user);
        return res ? { status: 200, body: { ok: true, data: res }, cors } : { status: 404, body: { ok: false, error: 'not found' }, cors };
      } catch {
        return { status: 503, body: { ok: false, error: 'unavailable' }, cors };
      }
    }),
  );
}
