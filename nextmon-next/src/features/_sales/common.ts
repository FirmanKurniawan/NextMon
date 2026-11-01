import { Cache } from '../../lib/cache.ts';
import type { Driver } from '../../lib/driver.ts';
import { Reseller } from '../../lib/reseller.ts';
import { Scripts } from '../../lib/scripts.ts';
import { zonedParts } from '../../lib/sales.ts';
import { getSettings } from '../../lib/store.ts';
import type { AppContext } from '../types.ts';

/** True when the current router is shared with this workspace read-only (every write control must be disabled). */
export const isRo = (ctx: AppContext): boolean => !!ctx.router && ctx.router.shared && ctx.router.mode === 'ro';

export const tzOf = (): string => String(getSettings().timezone || 'UTC');
export const currencyOf = (): string => String(getSettings().currency || 'Rp');

const p2 = (n: number) => String(n).padStart(2, '0');
/** Y-m-d of unix `ts` in the workspace timezone. */
export function dayKey(ts: number, tz = tzOf()): string {
  const p = zonedParts(ts, tz);
  return `${p.y}-${p2(p.mo)}-${p2(p.d)}`;
}
/** "d/m/Y H:i" in the workspace timezone (receipt time). */
export function receiptTime(ts: number, tz = tzOf()): string {
  const p = zonedParts(ts, tz);
  return `${p2(p.d)}/${p2(p.mo)}/${p.y} ${p2(p.h)}:${p2(p.mi)}`;
}

/** Same key the dashboard uses, so a delete/sale invalidates both. */
export const salesKey = (ctx: AppContext): string => Cache.scope(ctx.workspace.id, 'sales', ctx.router?.id ?? '');

export type Pkg = { name: string; price: string; validity: string; rate: string };

/** [name => customer base price] of router profiles that carry a price (best effort: empty when the router is unreachable). */
export async function profilePrices(r: Driver): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  try {
    for (const p of await r.print('/ip/hotspot/user/profile', {}, ['name', 'on-login'])) {
      if (p.name === 'default') continue;
      out[p.name ?? ''] = Reseller.basePrice(Scripts.parseMeta(p['on-login'] ?? ''));
    }
  } catch {
    // listed without profiles
  }
  return out;
}
