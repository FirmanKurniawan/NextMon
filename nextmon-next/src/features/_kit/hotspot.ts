/** Hotspot domain helpers shared by users/profiles/vouchers/import (pure logic + driver reads; no framework imports). */
import type { Driver } from '../../lib/driver.ts';
import type { TFn } from '../../lib/i18n.ts';
import { MODES, onLogin, parseMeta, seconds, validDuration } from '../../lib/scripts.ts';
import type { Meta } from '../../lib/scripts.ts';

export type UserState = 'disabled' | 'expired' | 'online' | 'used' | 'new';

/** Same rules as HotspotController::statusOf. */
export function statusOf(u: Record<string, string | undefined>, online: boolean): UserState {
  if (u.disabled === 'true' || u.disabled === 'yes') return 'disabled';
  if (u['limit-uptime'] === '1s') return 'expired';
  if (online) return 'online';
  return (u.uptime ?? '0s') !== '0s' ? 'used' : 'new';
}

/** "limit-uptime must not exceed profile validity" (Mikhmon rule). Returns an error text or ''. */
export async function checkTimeLimit(r: Driver, profile: string, limit: string, t: TFn): Promise<string> {
  if (limit === '') return '';
  if (!validDuration(limit)) return t('Time limit format is invalid (example: 1h30m).');
  for (const p of await r.print('/ip/hotspot/user/profile', { name: profile }, ['name', 'on-login'])) {
    const meta = parseMeta(p['on-login'] ?? '');
    if (meta && meta.validity !== '' && seconds(limit) > seconds(meta.validity)) {
      return t('Time limit (:l) must not exceed validity (:v).', { ':l': limit, ':v': meta.validity });
    }
  }
  return '';
}

export type ProfileForm = Partial<Record<'name' | 'mode' | 'validity' | 'rate_limit' | 'shared' | 'price' | 'sprice' | 'lock_user' | 'lock_server' | 'parent_queue' | 'pool', string>>;

/** Builds the RouterOS attrs (incl. generated on-login script) from the profile form, or an error text. */
export function profileAttrs(f: ProfileForm, t: TFn): { attrs: Record<string, string> } | { error: string } {
  const name = (f.name ?? '').trim();
  if (!/^[\w.\- ]{1,40}$/.test(name)) return { error: t('Invalid profile name.') };
  const mode = f.mode || 'none';
  const validity = (f.validity ?? '').trim().toLowerCase();
  if (!(MODES as readonly string[]).includes(mode)) return { error: t('Unknown expired mode.') };
  if (!validDuration(validity)) return { error: t('Validity format is invalid (example: 1d, 12h, 30d).') };
  if (mode !== 'none' && validity === '') return { error: t('Validity is required for this expired mode.') };
  const rate = (f.rate_limit ?? '').trim();
  if (rate !== '' && !/^[0-9A-Za-z/ .]+$/.test(rate)) return { error: t('Invalid rate limit (example: 2M/2M).') };
  const attrs: Record<string, string> = {
    name,
    'rate-limit': rate,
    'shared-users': String(Math.max(1, Number.parseInt(f.shared || '1', 10) || 1)),
    'on-login': onLogin(mode, (f.price ?? '').trim(), validity, (f.sprice ?? '').trim(), f.lock_user === '1', f.lock_server === '1', name),
  };
  const pq = (f.parent_queue ?? '').trim();
  const pool = (f.pool ?? '').trim();
  if (pq) attrs['parent-queue'] = pq;
  if (pool) attrs['address-pool'] = pool;
  return { attrs };
}

export type { Meta };
export { parseMeta };
