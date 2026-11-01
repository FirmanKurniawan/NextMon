import { batchOf, expiryOf } from '../../lib/voucher.ts';
import { parseMeta } from '../../lib/scripts.ts';
import { statusOf } from '../_kit/hotspot.ts';
import type { UserState } from '../_kit/hotspot.ts';
import type { AppContext } from '../types.ts';

export type UserRow = Record<string, string> & { _status: UserState; _exp: string };

const USER_PROPS = ['name', 'password', 'profile', 'comment', 'uptime', 'bytes-in', 'bytes-out', 'limit-uptime', 'limit-bytes-total', 'mac-address', 'disabled', 'server'];

/** Users + profiles + active sessions in ONE round trip, filtered like HotspotController::users(). */
export async function listUsers(ctx: AppContext, f: { q: string; profile: string; batch: string; status: string }) {
  const got = await ctx.driver().printMany({
    users: ['/ip/hotspot/user', {}, USER_PROPS],
    profiles: ['/ip/hotspot/user/profile', {}, ['name', 'on-login']],
    active: ['/ip/hotspot/active', {}, ['user']],
  });
  let all = got.users ?? [];
  if (!ctx.can('write')) all = all.map((u) => ({ ...u, password: '' })); // viewers / resellers must not read voucher passwords
  const online = new Set((got.active ?? []).map((a) => a.user ?? ''));
  const batches = new Set<string>();
  for (const u of all) {
    const b = batchOf(u.comment ?? '');
    if (b) batches.add(b);
  }
  const q = f.q.toLowerCase();
  const rows: UserRow[] = [];
  for (const u of all) {
    if (u.name === 'default-trial') continue;
    if (q && !`${u.name} ${u.comment ?? ''}`.toLowerCase().includes(q)) continue;
    if (f.profile && (u.profile ?? '') !== f.profile) continue;
    if (f.batch && batchOf(u.comment ?? '') !== f.batch) continue;
    const st = statusOf(u, online.has(u.name ?? ''));
    if (f.status && st !== f.status) continue;
    rows.push({ ...u, _status: st, _exp: expiryOf(u.comment ?? '') });
  }
  const profInfo: Record<string, ReturnType<typeof parseMeta>> = {};
  for (const p of got.profiles ?? []) profInfo[p.name ?? ''] = parseMeta(p['on-login'] ?? '');
  return { rows, profiles: (got.profiles ?? []).map((p) => p.name ?? ''), batches: [...batches].sort(), profInfo };
}
