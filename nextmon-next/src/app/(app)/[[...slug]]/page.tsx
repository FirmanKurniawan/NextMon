import { forbidden, notFound } from 'next/navigation';
import { Features } from '../../../features/registry.ts';
import Onboarding from '../../../features/routers/Onboarding';
import { requireContext } from '../../../server/guard.ts';

export const dynamic = 'force-dynamic';

/**
 * The ONE page route of the authenticated app. It dispatches to the feature registry (src/features/<name>/feature.ts):
 * capability check -> lazy-load the feature's server component -> render it inside ctx.run() (workspace set by the server).
 */
export default async function FeaturePageRoute({ params, searchParams }: { params: Promise<{ slug?: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext();
  const { slug = [] } = await params;
  const m = Features.matchPage('/' + slug.map((s) => decodeURIComponent(s)).join('/'));
  if (!m) notFound();
  if (!ctx.can(m.page.cap ?? 'view')) forbidden(); // HTTP 403 (app/(app)/forbidden.tsx), like the PHP edition
  // first-run state: an account without any router gets "Add router" / "Try demo mode" instead of an empty dashboard
  if (!ctx.router && m.page.path === '/') return <Onboarding ctx={ctx} addHref="/routers" />;
  const mod = await m.page.component();
  const props = { ctx, params: m.params, searchParams: await searchParams };
  // The component runs inside the workspace context. (Async child components rendered later must call ctx.run themselves.)
  return await ctx.run(async () => await mod.default(props));
}
