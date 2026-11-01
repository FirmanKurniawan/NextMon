'use server';
import { Audit } from '../../lib/audit.ts';
import { Security } from '../../lib/security.ts';
import { Sessions } from '../../lib/sessions.ts';
import { act, str } from '../settings/action.ts';
import type { ActionResult } from '../settings/result.ts';
import { visibleSessions } from './data.ts';

const P = '/settings/security';

export async function savePolicyAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return act('admin', P, fd, () => {
    const pol = Security.save({
      pw_min: Number(fd.get('pw_min')),
      pw_upper: fd.get('pw_upper') === '1',
      pw_digit: fd.get('pw_digit') === '1',
      pw_symbol: fd.get('pw_symbol') === '1',
      pw_no_username: fd.get('pw_no_username') === '1',
      timeout_min: Number(fd.get('timeout_min')),
    });
    Audit.log('security.policy', JSON.stringify(pol));
    return { ok: true, msg: 'Security settings saved.' };
  });
}

export async function revokeSessionAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return act('view', P, fd, (ctx) => {
    const h = str(fd, 'sid', 100);
    const hit = visibleSessions(ctx.workspace.id, ctx.user.id, ctx.can('admin')).find((s) => s.hash === h);
    if (!hit) return { ok: false, msg: 'Session not found.' };
    if (h === ctx.session.hash) return { ok: false, msg: 'This is your current session. Use Sign out instead.' };
    Sessions.destroyHash(h);
    Audit.log('session.revoke', hit.uid);
    return { ok: true, msg: 'Session signed out.' };
  });
}

export async function revokeOthersAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return act('view', P, fd, (ctx) => {
    const n = Sessions.destroyAllFor(ctx.user.id, ctx.session.hash);
    Audit.log('session.revoke_others', String(n));
    return { ok: true, msg: ':n other sessions signed out.', params: { ':n': n } };
  });
}
