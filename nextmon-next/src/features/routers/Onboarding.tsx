import { Icon } from '../../components/Icon';
import type { AppContext } from '../types.ts';
import ActionForm from './ActionForm';
import { tryDemoAction } from './actions.ts';

/**
 * First-run state of an empty account: "Add router" or "Try demo mode". `addHref` = link to the routers page (used outside it);
 * without it the button opens the router dialog of the routers page (#dlg-router).
 */
export default function Onboarding({ ctx, addHref }: { ctx: AppContext; addHref?: string }) {
  const t = ctx.t;
  const admin = ctx.can('admin');
  return (
    <section className="card glass" data-onboarding>
      <div className="empty">
        <Icon name="router" size={36} />
        <h3>{t('Welcome to NextMON')}</h3>
        <p>{admin ? t('This account has no router yet. Connect your MikroTik through the RouterOS API, or explore NextMON with a simulated router first.') : t('This account has no router yet. Ask the account owner to add one.')}</p>
        {admin ? (
          <div className="row" style={{ justifyContent: 'center', flexWrap: 'wrap', marginTop: 'var(--s3)' }}>
            {addHref ? (
              <a className="btn btn-primary" href={addHref}>
                <Icon name="plus" size={16} />
                {t('Add router')}
              </a>
            ) : (
              <button className="btn btn-primary" type="button" data-open="#dlg-router" data-new>
                <Icon name="plus" size={16} />
                {t('Add router')}
              </button>
            )}
            <ActionForm action={tryDemoAction}>
              <input type="hidden" name="_csrf" value={ctx.csrf} />
              <button className="btn">
                <Icon name="activity" size={16} />
                {t('Try demo mode')}
              </button>
            </ActionForm>
          </div>
        ) : null}
      </div>
    </section>
  );
}
