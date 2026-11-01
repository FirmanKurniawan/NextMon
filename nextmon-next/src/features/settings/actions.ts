'use server';
import { Users } from '../../lib/users.ts';
import { ApiKeys } from '../../lib/apikeys.ts';
import { Audit } from '../../lib/audit.ts';
import { changePassword, deleteUser, saveUser } from '../../lib/staff.ts';
import { saveSettings } from '../../lib/store.ts';
import { act, str } from './action.ts';
import type { ActionResult } from './result.ts';

const validTz = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz !== '';
  } catch {
    return false;
  }
};

export async function saveSettingsAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return act('admin', '/settings', fd, (ctx) => {
    const tz = str(fd, 'timezone', 64);
    const login = str(fd, 'login_url', 500);
    const cors = str(fd, 'status_cors', 2000)
      .split(',')
      .map((o) => o.trim())
      .filter((o) => /^https?:\/\/[A-Za-z0-9.\-:[\]]+\/?$/.test(o))
      .join(',')
      .slice(0, 500);
    saveSettings({
      lang: fd.get('lang') === 'en' ? 'en' : 'id',
      timezone: validTz(tz) ? tz : 'Asia/Jakarta',
      currency: [...str(fd, 'currency', 40)].slice(0, 6).join('') || 'Rp',
      hotspot_name: [...str(fd, 'hotspot_name', 200)].slice(0, 60).join(''),
      login_url: /^https?:\/\/[^\s"<>\\]+$/i.test(login) ? login : 'http://hotspot.local/login',
      max_qty: Math.max(1, Math.min(2000, Math.trunc(Number(fd.get('max_qty'))) || 500)),
      live_report: fd.get('live_report') === '1',
      status_cors: cors,
    });
    Audit.log('settings.save');
    void ctx;
    return { ok: true, msg: 'Settings saved.' };
  });
}

export async function changePasswordAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return act('view', '/settings', fd, async (ctx) => {
    const me = Users.byId(ctx.user.id);
    if (!me) return { ok: false, msg: 'User not found.' };
    return changePassword(me, ctx.session.hash, { current: str(fd, 'current', 1100), next: str(fd, 'new', 1100), next2: str(fd, 'new2', 1100) });
  });
}

export async function saveUserAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return act('admin', '/settings', fd, (ctx) => saveUser(ctx.user, ctx.workspace.id, { id: str(fd, 'id', 40), username: str(fd, 'username', 64), role: str(fd, 'role', 20), password: str(fd, 'password', 1100) }));
}

export async function deleteUserAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return act('admin', '/settings', fd, (ctx) => deleteUser(ctx.user, ctx.workspace.id, str(fd, 'id', 40)));
}

export async function createKeyAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return act('admin', '/settings', fd, () => {
    const { rec, key } = ApiKeys.create(str(fd, 'name', 100), str(fd, 'scope', 10));
    Audit.log('apikey.create', `${rec.name} (${rec.scope})`);
    return { ok: true, msg: 'API key created. Copy it now - it is shown only once.', key };
  });
}

export async function revokeKeyAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return act('admin', '/settings', fd, () => {
    const id = str(fd, 'id', 40);
    if (ApiKeys.revoke(id)) Audit.log('apikey.delete', id);
    return { ok: true, msg: 'API key revoked.' };
  });
}
