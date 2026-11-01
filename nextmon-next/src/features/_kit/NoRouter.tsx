import { Icon } from '../../components/Icon';
import type { TFn } from '../../lib/i18n.ts';
import { getContext } from '../../server/context.ts';
import Onboarding from '../routers/Onboarding';

/**
 * Shown by every router-bound page of an account without routers: the onboarding card ("Add router" / "Try demo mode") instead
 * of a bare "No router configured". Async server component: it reads the request context itself so pages only pass `t`.
 */
export default async function NoRouter({ t }: { t: TFn }) {
  const ctx = await getContext();
  if (!ctx) {
    return (
      <div className="empty">
        <Icon name="router" size={32} />
        <h3>{t('No router configured')}</h3>
      </div>
    );
  }
  return <Onboarding ctx={ctx} addHref="/routers" />;
}
