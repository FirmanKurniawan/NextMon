'use server';
import { Audit } from '../../lib/audit.ts';
import { Net } from '../../lib/net.ts';
import { Notify } from '../../lib/notify.ts';
import { act, str } from '../settings/action.ts';
import type { ActionResult } from '../settings/result.ts';

export async function saveNotificationsAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return act('admin', '/notifications', fd, async (ctx) => {
    const { note } = await Notify.save({
      enabled: fd.get('enabled') === '1',
      token: String(fd.get('token') ?? '').slice(0, 200),
      chat_id: str(fd, 'chat_id', 40),
      webhook_url: str(fd, 'webhook_url', 500),
      events: fd.getAll('events').map(String),
    });
    Audit.log('notifications.save');
    if (note) return { ok: false, msg: ctx.t('Saved.') + ' ' + ctx.t('Webhook URL rejected:') + ' ' + note };
    return { ok: true, msg: 'Saved.' };
  });
}

export async function testNotificationAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return act('admin', '/notifications', fd, async (ctx) => {
    // each test makes outbound requests: keep it from being used as a request cannon
    if (Net.hit('notify-test', ctx.workspace.id, 10, 60)) return { ok: false, msg: 'Too many attempts. Try again in :m min.', params: { ':m': 1 } };
    const hhmm = new Date().toISOString().slice(11, 19);
    const r = await Notify.send('NextMON test notification ' + hhmm, 'test');
    return { ok: r.ok, msg: (r.ok ? ctx.t('Test sent: ') : ctx.t('Test failed: ')) + r.msg };
  });
}
