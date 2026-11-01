import { Icon } from '../../components/Icon';
import { getContext } from '../../server/context.ts';

/** HTTP 403 page (rendered inside the shell by forbidden() from the page route), same text as the PHP error view. */
export default async function Forbidden() {
  const ctx = await getContext();
  const t = ctx?.t ?? ((s: string) => s);
  return (
    <div className="card glass" style={{ maxWidth: 640, margin: 'var(--s6) auto' }}>
      <div className="card-b">
        <div className="empty">
          <Icon name="shield" size={32} />
          <h3>403 {t('Forbidden')}</h3>
          <p>{t('Your role cannot access this page.')}</p>
          <div className="row" style={{ justifyContent: 'center', marginTop: 'var(--s3)' }}>
            <a className="btn btn-primary" href="/">
              {t('Back to dashboard')}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
