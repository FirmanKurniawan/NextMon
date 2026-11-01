import { Icon } from '../../components/Icon';
import { getContext } from '../../server/context.ts';

export default async function NotFound() {
  const ctx = await getContext();
  const t = ctx?.t ?? ((s: string) => s);
  return (
    <div className="empty">
      <Icon name="alert" size={32} />
      <h3>404</h3>
      <p>{t('Page not found.')}</p>
      <a className="btn btn-primary" href="/">
        {t('Dashboard')}
      </a>
    </div>
  );
}
