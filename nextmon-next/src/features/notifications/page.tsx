import { Icon } from '../../components/Icon';
import { Notify } from '../../lib/notify.ts';
import { getSettings } from '../../lib/store.ts';
import type { PageProps } from '../types.ts';
import ActionForm from '../settings/ActionForm';
import { Badge, Csrf, Empty, PageHead, stamp } from '../settings/ui.tsx';
import { saveNotificationsAction, testNotificationAction } from './actions.ts';

const EVENTS: [string, string][] = [
  ['sale', 'POS sales'],
  ['voucher', 'Voucher batches generated'],
  ['router', 'Router connection errors'],
  ['login', 'Failed logins'],
];

/** Notifications: Telegram + webhook channels, test message, recent deliveries. Port of views/notifications.php. */
export default function NotificationsPage({ ctx }: PageProps) {
  const t = ctx.t;
  const { tg, hook } = Notify.config();
  const ev = tg.events ?? [];
  const log = Notify.log(30);
  const tz = getSettings().timezone;
  const csrf = <Csrf value={ctx.csrf} />;
  return (
    <>
      <PageHead title={t('Notifications')} desc={t('Send alerts to a Telegram chat and/or a generic webhook.')} />
      <div className="grid">
        <section className="card glass col-6">
          <div className="card-h">
            <h2>{t('Channels')}</h2>
          </div>
          <ActionForm action={saveNotificationsAction} className="card-b stack">
            {csrf}
            <label className="switch">
              <input type="checkbox" name="enabled" value="1" defaultChecked={!!tg.enabled} />
              <span className="track" />
              <span>{t('Enable Telegram')}</span>
            </label>
            <div className="field">
              <label htmlFor="n-token">{t('Bot token')}</label>
              <input className="input mono" id="n-token" name="token" type="password" autoComplete="off" placeholder={tg.token ? t('(saved - leave blank to keep)') : '123456:ABC...'} />
              <p className="help">{t('Stored encrypted. Create a bot with @BotFather.')}</p>
            </div>
            <div className="field">
              <label htmlFor="n-chat">{t('Chat ID')}</label>
              <input className="input mono" id="n-chat" name="chat_id" defaultValue={tg.chat_id ?? ''} placeholder="-1001234567890" />
            </div>
            <div className="field">
              <label htmlFor="n-hook">{t('Webhook URL (optional)')}</label>
              <input className="input mono" id="n-hook" name="webhook_url" type="url" defaultValue={hook} placeholder="https://example.com/hook" />
              <p className="help">{t('Receives JSON: event, text, ts.')}</p>
            </div>
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="label">{t('Send notifications for')}</legend>
              <div className="stack" style={{ gap: 'var(--s1)', marginTop: 'var(--s2)' }}>
                {EVENTS.map(([k, l]) => (
                  <label className="check" key={k}>
                    <input type="checkbox" name="events" value={k} defaultChecked={ev.includes(k)} />
                    {t(l)}
                  </label>
                ))}
              </div>
            </fieldset>
            <div>
              <button className="btn btn-primary">{t('Save')}</button>
            </div>
          </ActionForm>
          <ActionForm action={testNotificationAction} className="card-b" style={{ paddingTop: 0 }}>
            {csrf}
            <button className="btn">
              <Icon name="bell" size={16} />
              {t('Send test message')}
            </button>
          </ActionForm>
        </section>
        <section className="card glass col-6">
          <div className="card-h">
            <h2>{t('Recent deliveries')}</h2>
          </div>
          {log.length === 0 ? (
            <Empty icon="bell" title={t('Nothing sent yet')} />
          ) : (
            <div className="table-wrap" style={{ maxHeight: 480 }}>
              <table className="tbl resp">
                <thead>
                  <tr>
                    <th>{t('Time')}</th>
                    <th>{t('Event')}</th>
                    <th>{t('Result')}</th>
                  </tr>
                </thead>
                <tbody>
                  {log.map((l, i) => (
                    <tr key={i}>
                      <td data-label={t('Time')} className="mono nowrap">
                        {stamp(l.ts, tz).slice(5)}
                      </td>
                      <td data-label={t('Event')}>
                        <Badge>{l.event}</Badge>
                      </td>
                      <td data-label={t('Result')} className="wrap">
                        {l.ok ? <Badge kind="ok">{t('Sent')}</Badge> : <Badge kind="err">{t('Failed')}</Badge>} <span className="muted">{l.result}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
