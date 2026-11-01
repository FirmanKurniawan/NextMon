/**
 * Router sharing between workspaces (global collection `shares`). The owner workspace shares one router with another workspace
 * in mode `ro` (read only: enforced by the ReadOnly driver decorator) or `rw`. Revocable. The recipient NEVER sees the router
 * password: only routers.ts (server side) resolves the owner's credentials when building a driver.
 */
import { randomHex } from './crypto.ts';
import { Store, WS_ID_RE } from './store.ts';

export type ShareMode = 'ro' | 'rw';
export type ShareRule = { id: string; router: string; owner: string; to: string; mode: ShareMode; created: number; by: string };

const doc = () => Store.global('shares');

export const Share = {
  /** Rule that gives workspace `to` access to router `routerId` owned by `owner`, or null. */
  for(routerId: string, to: string, owner?: string): ShareRule | null {
    return doc().read<ShareRule[]>([]).find((s) => s.router === routerId && s.to === to && (!owner || s.owner === owner)) ?? null;
  },
  /** Routers other workspaces share with `to`. */
  incoming(to: string): ShareRule[] {
    return doc().read<ShareRule[]>([]).filter((s) => s.to === to);
  },
  /** Rules created by `owner` (to manage / revoke). */
  outgoing(owner: string): ShareRule[] {
    return doc().read<ShareRule[]>([]).filter((s) => s.owner === owner);
  },
  /** Create or update a share. The caller MUST have verified that `routerId` belongs to `owner`. */
  grant(owner: string, routerId: string, to: string, mode: ShareMode, by: string): ShareRule {
    if (!WS_ID_RE.test(owner) || !WS_ID_RE.test(to) || owner === to) throw new Error('invalid share target');
    let rule!: ShareRule;
    doc().update<ShareRule[]>((list) => {
      const i = list.findIndex((s) => s.router === routerId && s.owner === owner && s.to === to);
      rule = { id: i >= 0 ? list[i]!.id : randomHex(5), router: routerId, owner, to, mode, created: Math.floor(Date.now() / 1000), by };
      if (i >= 0) {
        const c = [...list];
        c[i] = rule;
        return c;
      }
      return [...list, rule];
    }, []);
    return rule;
  },
  revoke(owner: string, shareId: string): boolean {
    let found = false;
    doc().update<ShareRule[]>((list) => {
      const keep = list.filter((s) => !(s.id === shareId && s.owner === owner));
      found = keep.length !== list.length;
      return keep;
    }, []);
    return found;
  },
  /** Drop every share of a router (router deleted). */
  revokeRouter(owner: string, routerId: string): void {
    doc().update<ShareRule[]>((list) => list.filter((s) => !(s.owner === owner && s.router === routerId)), []);
  },
};

