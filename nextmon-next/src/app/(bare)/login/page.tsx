import { redirect } from 'next/navigation';
import AuthForm from '../../../components/AuthForm';
import { Csrf } from '../../../lib/auth.ts';
import { Env } from '../../../lib/env.ts';
import { I18n } from '../../../lib/i18n.ts';
import { Users } from '../../../lib/users.ts';
import { anonLang, getContext } from '../../../server/context.ts';
import { localPath } from '../../../server/guard.ts';
import { loginAction } from '../actions.ts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (!Users.hasUsers()) redirect('/setup');
  const sp = await searchParams;
  const next = localPath(sp.next, '/');
  if (await getContext()) redirect(next);
  const t = I18n.translator(await anonLang());
  return (
    <AuthForm
      mode="login"
      action={loginAction}
      csrf={Csrf.pre('login')}
      next={next === '/' ? undefined : next}
      demo={Env.demoForced()}
      labels={{
        title: t('Sign in'),
        subtitle: t('Manage your MikroTik hotspot.'),
        username: t('Username'),
        password: t('Password'),
        password2: t('Repeat password'),
        hint: t('At least 8 characters.'),
        submit: t('Sign in'),
        demoNote: t('Demo mode is on: a simulated router is used.'),
        locked: '',
      }}
    />
  );
}
