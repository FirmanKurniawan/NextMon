'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Audit } from '../../lib/audit.ts';
import { Auth, Csrf } from '../../lib/auth.ts';
import { Context } from '../../lib/context.ts';
import { I18n } from '../../lib/i18n.ts';
import { Net } from '../../lib/net.ts';
import { Sessions } from '../../lib/sessions.ts';
import type { User } from '../../lib/users.ts';
import { anonLang } from '../../server/context.ts';
import { setSessionCookie } from '../../server/cookies.ts';
import { localPath } from '../../server/guard.ts';
import type { FormState } from '../../components/AuthForm';

async function startSession(user: User, auditAction: string): Promise<void> {
  const h = await headers();
  const ip = Net.clientIp(h);
  const lang = await anonLang();
  const { token } = Sessions.create(user, user.workspace, { ip, ua: h.get('user-agent') ?? '', lang });
  await setSessionCookie(token);
  Context.run({ ws: user.workspace, ip, actor: { id: user.id, username: user.username, role: user.role, workspace: user.workspace } }, () => Audit.log(auditAction, user.username));
}

export async function loginAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const lang = await anonLang();
  const t = I18n.translator(lang);
  const username = String(fd.get('username') ?? '');
  const h = await headers();
  const ip = Net.clientIp(h);
  if (!Csrf.verifyPre('login', fd.get('_csrf'))) return { error: t('Security token invalid or expired. Reload the page and try again.'), username };
  if (Net.hit('login-page', ip, 120, 60)) return { error: t('Too many attempts. Try again in :m min.', { ':m': 1 }), username };
  const r = await Auth.attempt(username, String(fd.get('password') ?? ''), ip);
  if (!r.ok) return { error: t(r.message, r.params), username };
  await startSession(r.user, 'login');
  redirect(localPath(fd.get('next')));
}

export async function setupAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const t = I18n.translator(await anonLang());
  const username = String(fd.get('username') ?? '');
  const h = await headers();
  const ip = Net.clientIp(h);
  if (!Csrf.verifyPre('setup', fd.get('_csrf'))) return { error: t('Security token invalid or expired. Reload the page and try again.'), username };
  if (Net.hit('setup', ip, 30, 600)) return { error: t('Too many attempts. Try again in :m min.', { ':m': 10 }), username };
  const r = await Auth.setup({ username, password: String(fd.get('password') ?? ''), password2: String(fd.get('password2') ?? ''), token: String(fd.get('token') ?? '') });
  if (!r.ok) return { error: t(r.message), username };
  await startSession(r.user, 'login');
  redirect('/');
}
