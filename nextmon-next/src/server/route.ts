/** Resolves a request path to what the shell needs (title, <body data-page>, scripts) using the feature registry. */
import { Features } from '../features/registry.ts';
import type { NavItem } from '../features/types.ts';

const SCRIPTS: Record<string, string> = {
  charts: '/assets/js/charts.js',
  qr: '/assets/js/qr.js',
  pages: '/assets/js/pages.js',
  'next-live': '/assets/next/live.js',
};

export type Route = { title: string; pageKey: string; scripts: string[] };

export function resolveRoute(pathname: string, nav: NavItem[]): Route | null {
  const m = Features.matchPage(pathname);
  if (!m) return null;
  const key = m.page.page ?? nav.find((n) => n.href === m.page.path)?.key ?? m.feature.id;
  const extra = (m.page.scripts ?? []).map((s) => SCRIPTS[s] ?? (s.startsWith('/assets/') ? s : ''));
  return { title: m.page.title, pageKey: key, scripts: ['/assets/js/app.js', ...extra.filter(Boolean)] };
}
