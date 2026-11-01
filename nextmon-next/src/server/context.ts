/**
 * Server-side request context. getContext() turns the session cookie into an AppContext: the user, the ACTIVE workspace (from the
 * server-side session, never from the client), CSRF token, client IP, language, current router. Everything that touches tenant data
 * must run inside ctx.run(() => ...) which establishes the workspace for Store (fail-closed otherwise).
 */
import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { Context } from '../lib/context.ts';
import { Net } from '../lib/net.ts';
import { Sessions } from '../lib/sessions.ts';
import type { SessionRec } from '../lib/sessions.ts';
import { can as canRole } from '../lib/users.ts';
import type { Cap, User } from '../lib/users.ts';
import { Workspace } from '../lib/workspace.ts';
import type { WorkspaceRec } from '../lib/workspace.ts';
import { getSettings } from '../lib/store.ts';
import { I18n, isLang } from '../lib/i18n.ts';
import type { Lang, TFn } from '../lib/i18n.ts';
import { Routers } from '../lib/routers.ts';
import type { RouterView } from '../lib/routers.ts';
import type { Driver } from '../lib/driver.ts';
import { Env } from '../lib/env.ts';
import '../features/registry.ts'; // registers feature dictionaries before any t() call

export const COOKIE_HOST = '__Host-nm_sid';
export const COOKIE_PLAIN = 'nm_sid';
export const LANG_COOKIE = 'klang'; // same name as the PHP edition (shared offline.js reads it)

export type AppContext = {
  user: User;
  workspace: WorkspaceRec;
  session: SessionRec;
  /** per-session CSRF token: render it in <input name="_csrf"> / send it as X-CSRF-Token */
  csrf: string;
  ip: string;
  lang: Lang;
  t: TFn;
  /** a platform admin working inside a workspace that is not their own */
  impersonating: boolean;
  router: RouterView | null;
  /** simulated router in use (demo router or NEXTMON_DEMO=1) */
  demo: boolean;
  can(cap: Cap): boolean;
  /** Run fn with this workspace/actor active. ALL Store / Routers access must happen inside. */
  run<T>(fn: () => T): T;
  /** Driver of the current router (call inside run()); throws when the workspace has no router. */
  driver(): Driver;
};

export function clientIp(h: Headers): string {
  return Net.clientIp(h);
}

export async function sessionToken(): Promise<string | undefined> {
  const c = await cookies();
  return c.get(COOKIE_HOST)?.value ?? c.get(COOKIE_PLAIN)?.value;
}

export const getContext = cache(async (): Promise<AppContext | null> => {
  const token = await sessionToken();
  const r = Sessions.resolve(token);
  if (!r) return null;
  const h = await headers();
  const c = await cookies();
  const ip = clientIp(h);
  const { user, workspace, session } = r;
  const ws = workspace.id;
  const impersonating = user.role === 'platform' && user.workspace !== ws;
  const cookieLang = c.get(LANG_COOKIE)?.value;
  const stored = Workspace.run(ws, () => getSettings().lang);
  const lang: Lang = isLang(session.lang) ? session.lang : isLang(cookieLang) ? cookieLang : isLang(stored) ? stored : 'id';
  const router = Workspace.run(ws, () => Routers.current(session.router));
  const actor = { id: user.id, username: user.username, role: user.role, workspace: user.workspace };
  const run = <T,>(fn: () => T): T => Context.run({ ws, actor, ip, lang, impersonating, routerId: router?.id }, fn);
  return {
    user,
    workspace,
    session,
    csrf: session.csrf,
    ip,
    lang,
    t: I18n.translator(lang),
    impersonating,
    router,
    demo: Env.demoForced() || router?.type === 'demo',
    can: (cap) => canRole(user, cap),
    run,
    driver: () => {
      if (!router) throw new Error('No router configured');
      return Routers.driver(router.id);
    },
  };
});

/** Language for pages without a session (login/setup): cookie > Accept-Language > platform default. */
export async function anonLang(): Promise<Lang> {
  const c = await cookies();
  const h = await headers();
  return I18n.pick(c.get(LANG_COOKIE)?.value, h.get('accept-language'), 'id');
}
