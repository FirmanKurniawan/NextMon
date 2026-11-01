import { Icon } from '../../components/Icon';
import type { AppContext } from '../types.ts';
import ActionForm from './ActionForm';
import { saveRouterAction, shareRouterAction } from './actions.ts';

const CsrfField = ({ ctx }: { ctx: AppContext }) => <input type="hidden" name="_csrf" value={ctx.csrf} />;

/** Add / edit router dialog. Same markup as the PHP view; shared pages.js wires "Test connection" and the real/demo toggle. */
export function RouterDialog({ ctx }: { ctx: AppContext }) {
  const t = ctx.t;
  return (
    <dialog className="modal" id="dlg-router" aria-labelledby="dlg-router-t">
      <ActionForm action={saveRouterAction} closeOnOk data-test-url="/json/routers/test">
        <CsrfField ctx={ctx} />
        <input type="hidden" name="id" />
        <div className="modal-h">
          <h2 id="dlg-router-t">{t('Router')}</h2>
          <button type="button" className="btn btn-ghost btn-icon" data-close aria-label={t('Close')}>
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-b">
          <div className="form-grid">
            <div className="field">
              <label htmlFor="r-name">{t('Name')}</label>
              <input className="input" id="r-name" name="name" required maxLength={40} />
            </div>
            <div className="field">
              <label htmlFor="r-session">{t('Session name')}</label>
              <input className="input" id="r-session" name="session" pattern="[A-Za-z0-9_\-]+" placeholder="cafe-a" />
              <p className="help">{t('Used in the public status URL: /status?session=NAME')}</p>
            </div>
            <div className="field full">
              <label htmlFor="r-type">{t('Mode')}</label>
              <select className="select" id="r-type" name="type" data-toggle-real defaultValue="real">
                <option value="real">{t('Real MikroTik (RouterOS API)')}</option>
                <option value="demo">{t('Demo (simulated data)')}</option>
              </select>
            </div>
            <div className="field" data-real>
              <label htmlFor="r-host">{t('Host / IP')}</label>
              <input className="input" id="r-host" name="host" placeholder="192.168.88.1" inputMode="url" autoCapitalize="off" />
            </div>
            <div className="field" data-real>
              <label htmlFor="r-port">{t('API port')}</label>
              <input className="input" id="r-port" name="port" type="number" defaultValue={8728} min={1} max={65535} />
            </div>
            <div className="field" data-real>
              <label htmlFor="r-user">{t('API username')}</label>
              <input className="input" id="r-user" name="user" autoComplete="off" autoCapitalize="off" />
            </div>
            <div className="field" data-real>
              <label htmlFor="r-pass">{t('API password')}</label>
              <input className="input" id="r-pass" name="pass" type="password" autoComplete="new-password" />
              <p className="help">{t('Stored encrypted (AES-256-GCM). Leave blank to keep the current one.')}</p>
            </div>
            <div className="field full" data-real>
              <label className="switch">
                <input type="checkbox" name="ssl" value="1" />
                <span className="track" />
                <span>{t('Use API-SSL (port 8729)')}</span>
              </label>
            </div>
            <div className="field full" data-real>
              <label className="switch">
                <input type="checkbox" name="verify_tls" value="1" />
                <span className="track" />
                <span>{t('Verify the router certificate (needs a trusted certificate on the router)')}</span>
              </label>
            </div>
            <div className="field full">
              <label htmlFor="r-hs">{t('Hotspot name (shown on vouchers)')}</label>
              <input className="input" id="r-hs" name="hotspot_name" maxLength={60} />
            </div>
            <div className="full" id="test-out" role="status" aria-live="polite" />
          </div>
        </div>
        <div className="modal-f">
          <button type="button" className="btn" data-test-conn>
            {t('Test connection')}
          </button>
          <button type="button" className="btn" data-close>
            {t('Cancel')}
          </button>
          <button className="btn btn-primary">{t('Save')}</button>
        </div>
      </ActionForm>
    </dialog>
  );
}

/** Share one of your routers with another workspace (read-only or read/write). */
export function ShareDialog({ ctx }: { ctx: AppContext }) {
  const t = ctx.t;
  return (
    <dialog className="modal" id="dlg-share" aria-labelledby="dlg-share-t">
      <ActionForm action={shareRouterAction} closeOnOk>
        <CsrfField ctx={ctx} />
        <input type="hidden" name="router" />
        <div className="modal-h">
          <h2 id="dlg-share-t">{t('Share router')}</h2>
          <button type="button" className="btn btn-ghost btn-icon" data-close aria-label={t('Close')}>
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-b">
          <div className="form-grid">
            <div className="field full">
              <label htmlFor="sh-name">{t('Router')}</label>
              <input className="input" id="sh-name" name="router_name" readOnly />
            </div>
            <div className="field">
              <label htmlFor="sh-to">{t('Workspace slug')}</label>
              <input className="input mono" id="sh-to" name="to" required pattern="[a-z0-9][a-z0-9\-]{1,30}" placeholder="warung-budi" autoCapitalize="off" autoComplete="off" />
              <p className="help">{t('The slug of the account that should get access (ask its owner).')}</p>
            </div>
            <div className="field">
              <label htmlFor="sh-mode">{t('Access')}</label>
              <select className="select" id="sh-mode" name="mode" defaultValue="ro">
                <option value="ro">{t('Read-only')}</option>
                <option value="rw">{t('Read/write')}</option>
              </select>
              <p className="help">{t('The other account never sees the router address or password. Sharing again replaces the access level.')}</p>
            </div>
          </div>
        </div>
        <div className="modal-f">
          <button type="button" className="btn" data-close>
            {t('Cancel')}
          </button>
          <button className="btn btn-primary">{t('Share')}</button>
        </div>
      </ActionForm>
    </dialog>
  );
}
