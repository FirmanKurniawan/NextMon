import { redirect } from 'next/navigation';
import AuthForm from '../../../components/AuthForm';
import { Auth, Csrf } from '../../../lib/auth.ts';
import { Env } from '../../../lib/env.ts';
import { I18n } from '../../../lib/i18n.ts';
import { Users } from '../../../lib/users.ts';
import { anonLang } from '../../../server/context.ts';
import { setupAction } from '../actions.ts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Create admin account' };

/** First run only: creates the platform admin + workspace "main". With NEXTMON_SETUP_TOKEN set, /setup?token=... is required. */
export default async function SetupPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  if (Users.hasUsers()) redirect('/login');
  const { token } = await searchParams;
  const t = I18n.translator(await anonLang());
  const locked = !Auth.setupTokenOk(token);
  return (
    <AuthForm
      mode="setup"
      action={setupAction}
      csrf={Csrf.pre('setup')}
      token={token}
      demo={Env.demoForced()}
      initialError={locked ? t('Setup is locked. Open /setup?token=... with the value of NEXTMON_SETUP_TOKEN.') : undefined}
      labels={{
        title: t('Create admin account'),
        subtitle: t('First run: choose the administrator credentials. There is no default password.'),
        username: t('Username'),
        password: t('Password'),
        password2: t('Repeat password'),
        hint: t('At least 8 characters.'),
        submit: t('Create account'),
        demoNote: t('Demo mode is on: a simulated router is used.'),
        locked: '',
      }}
    />
  );
}
