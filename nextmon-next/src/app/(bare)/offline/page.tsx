import { Icon } from '../../../components/Icon';
import { I18n } from '../../../lib/i18n.ts';
import { anonLang } from '../../../server/context.ts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Offline' };

/** GET /offline: dynamic twin of the PHP offline view (the service worker itself falls back to the static /offline.html). */
export default async function OfflinePage() {
  const t = I18n.translator(await anonLang());
  return (
    <main className="auth-wrap">
      <div className="auth-card glass">
        <div className="empty">
          <Icon name="wifi" size={32} />
          <h3>{t('You are offline')}</h3>
          <p>{t('NextMON needs a connection to your server. Reconnect and try again.')}</p>
          <a className="btn btn-primary" href="/">
            {t('Retry')}
          </a>
        </div>
      </div>
    </main>
  );
}
