import { notFound } from 'next/navigation';
import { Icon } from '../../../components/Icon';
import { Features } from '../../../features/registry.ts';
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
  if (!ctx.can(m.page.cap ?? 'view')) {
    return (
      <div className="empty">
        <Icon name="shield" size={32} />
        <h3>{ctx.t('Forbidden')}</h3>
        <p>{ctx.t('Your role cannot access this page.')}</p>
      </div>
    );
  }
  const mod = await m.page.component();
  const props = { ctx, params: m.params, searchParams: await searchParams };
  // The component runs inside the workspace context. (Async child components rendered later must call ctx.run themselves.)
  return await ctx.run(async () => await mod.default(props));
}
