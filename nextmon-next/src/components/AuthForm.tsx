'use client';
import { useActionState } from 'react';
import { BrandMark, Icon } from './Icon';

export type FormState = { error?: string; username?: string };
type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

export type AuthLabels = {
  title: string;
  subtitle: string;
  username: string;
  password: string;
  password2: string;
  hint: string;
  submit: string;
  demoNote: string;
  locked: string;
};

/** Login / first-run setup card (markup identical to the PHP auth view). The action returns { error } or redirects. */
export default function AuthForm({
  mode,
  action,
  labels,
  csrf,
  next,
  token,
  demo,
  initialError,
}: {
  mode: 'login' | 'setup';
  action: Action;
  labels: AuthLabels;
  csrf: string;
  next?: string;
  token?: string;
  demo: boolean;
  initialError?: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const setup = mode === 'setup';
  const error = state.error ?? initialError;
  return (
    <main className="auth-wrap">
      <form className="auth-card glass" action={formAction} autoComplete="on">
        <input type="hidden" name="_csrf" value={csrf} />
        {next ? <input type="hidden" name="next" value={next} /> : null}
        {token ? <input type="hidden" name="token" value={token} /> : null}
        <div className="brand" style={{ padding: 0 }}>
          <span className="brand-mark">
            <BrandMark size={22} />
          </span>
          <span>NextMON</span>
        </div>
        <h1>{labels.title}</h1>
        <p className="muted" style={{ marginBottom: 'var(--s5)' }}>
          {labels.subtitle}
        </p>
        {error ? (
          <div className="alert err" role="alert" style={{ marginBottom: 'var(--s4)' }}>
            <Icon name="alert" size={18} />
            <div>{error}</div>
          </div>
        ) : null}
        {demo ? (
          <div className="alert info" style={{ marginBottom: 'var(--s4)' }}>
            {labels.demoNote}
          </div>
        ) : null}
        <div className="stack">
          <div className="field">
            <label htmlFor="u">{labels.username}</label>
            <input className="input" id="u" name="username" defaultValue={state.username ?? ''} autoComplete="username" required autoFocus />
          </div>
          <div className="field">
            <label htmlFor="p">{labels.password}</label>
            <input className="input" id="p" type="password" name="password" autoComplete={setup ? 'new-password' : 'current-password'} required minLength={setup ? 8 : undefined} />
          </div>
          {setup ? (
            <div className="field">
              <label htmlFor="p2">{labels.password2}</label>
              <input className="input" id="p2" type="password" name="password2" autoComplete="new-password" required minLength={8} />
              <p className="help">{labels.hint}</p>
            </div>
          ) : null}
          <button className={'btn btn-primary btn-lg' + (pending ? ' loading' : '')} type="submit" disabled={pending}>
            {labels.submit}
          </button>
        </div>
      </form>
    </main>
  );
}
