/**
 * Navigation registry. Sidebar, drawer, mobile tab bar and the command palette all read this one structure.
 * Items come from the features' `nav` arrays (src/features/<name>/feature.ts); nothing here is edited to add a page.
 */
import { Features } from '../features/registry.ts';
import type { NavItem } from '../features/types.ts';
import type { Cap } from '../lib/users.ts';

export type NavGroup = { group: string; items: NavItem[] };

/** Known groups first, in this order; unknown groups follow alphabetically. (Same groups as the PHP edition + Platform.) */
export const GROUP_ORDER = ['Overview', 'Hotspot', 'Sales', 'Network', 'System', 'Platform'] as const;

export function allNavItems(): NavItem[] {
  return Features.all().flatMap((f) => f.nav ?? []);
}

/** Navigation visible to a user: items filtered by capability, grouped, ordered. Empty groups are dropped. */
export function buildNav(can: (cap: Cap) => boolean): NavGroup[] {
  const groups = new Map<string, NavItem[]>();
  for (const it of allNavItems()) {
    if (!can(it.cap ?? 'view')) continue;
    if (!groups.has(it.group)) groups.set(it.group, []);
    groups.get(it.group)!.push(it);
  }
  const rank = (g: string) => {
    const i = (GROUP_ORDER as readonly string[]).indexOf(g);
    return i < 0 ? 100 : i;
  };
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([group, items]) => ({ group, items: [...items].sort((x, y) => (x.order ?? 100) - (y.order ?? 100) || x.label.localeCompare(y.label)) }));
}

/** Up to 4 items for the mobile bottom tab bar. */
export function tabItems(nav: NavGroup[]): NavItem[] {
  return nav
    .flatMap((g) => g.items)
    .filter((i) => i.tab !== undefined)
    .sort((a, b) => a.tab! - b.tab!)
    .slice(0, 4);
}

/** Group and title for the breadcrumb of the current page key. */
export function groupOf(nav: NavGroup[], key: string): string {
  return nav.find((g) => g.items.some((i) => i.key === key))?.group ?? '';
}
