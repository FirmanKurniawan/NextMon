'use server';
import { redirect } from 'next/navigation';
import { Audit } from '../../lib/audit.ts';
import { Context } from '../../lib/context.ts';
import { Routers } from '../../lib/routers.ts';
import { Sessions } from '../../lib/sessions.ts';
import { Workspace } from '../../lib/workspace.ts';
import { sessionToken } from '../../server/context.ts';
import { clearSessionCookie } from '../../server/cookies.ts';
import { localPath, runAction } from '../../server/guard.ts';

/** Choose the router the whole UI works on (stored in the server-side session). Only routers visible to this workspace are accepted. */
export async function selectRouterAction(fd: FormData): Promise<void> {
  await runAction({}, fd, (ctx) => {
    const id = String(fd.get('router') ?? '');
    if (Routers.get(id)) Sessions.setRouter(ctx.session.hash, id);
  });
  redirect(localPath(fd.get('back')));
}

/**
 * Platform admin only: switch the ACTIVE workspace of this session ("impersonate"). The id from the form is only a request - it is
 * validated against the registry and the caller's `platform` capability; the switch is audited in the platform log.
 */
export async function switchWorkspaceAction(fd: FormData): Promise<void> {
  await runAction({ cap: 'platform' }, fd, (ctx) => {
    const target = Workspace.get(String(fd.get('workspace') ?? ''));
    if (!target) return;
    Sessions.setWorkspace(ctx.session.hash, target.id);
    Context.run({ ws: target.id, impersonating: target.id !== ctx.user.workspace }, () => Audit.log('platform.switch', `${ctx.user.username} -> ${target.slug}`));
  });
  redirect(localPath(fd.get('back')));
}

export async function logoutAction(fd: FormData): Promise<void> {
  await runAction({}, fd, async (ctx) => {
    Audit.log('logout', ctx.user.username);
    const token = await sessionToken();
    if (token) Sessions.destroy(token);
  });
  await clearSessionCookie();
  redirect('/login');
}
