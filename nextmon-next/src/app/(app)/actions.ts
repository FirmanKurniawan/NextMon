'use server';
import { redirect } from 'next/navigation';
import { Audit } from '../../lib/audit.ts';
import { Routers } from '../../lib/routers.ts';
import { Sessions } from '../../lib/sessions.ts';
import { sessionToken } from '../../server/context.ts';
import { clearSessionCookie } from '../../server/cookies.ts';
import { localPath, runAction } from '../../server/guard.ts';
import { withFlash } from '../../features/_sales/flash-helpers.ts';
import { switchWorkspace } from '../../features/platform/logic.ts';
import { UserError } from '../../features/routers/util.ts';

/** Choose the router the whole UI works on (stored in the server-side session). Only routers visible to this workspace are accepted. */
export async function selectRouterAction(fd: FormData): Promise<void> {
  await runAction({}, fd, (ctx) => {
    const id = String(fd.get('router') ?? '');
    if (Routers.get(id)) Sessions.setRouter(ctx.session.hash, id);
  });
  redirect(localPath(fd.get('back')));
}

/**
 * Platform admin only: switch the ACTIVE workspace of this session ("impersonate"), or go home ("", "home" or the own workspace).
 * Same rules as the PHP WorkspaceSwitchController: the target is looked up in the registry by id or slug (the form value is only a
 * request), the selected router is reset, entry/exit are audited in the target workspace AND the platform log, then it lands on "/".
 */
export async function switchWorkspaceAction(fd: FormData): Promise<void> {
  const err = await runAction({ cap: 'platform' }, fd, (ctx) => {
    try {
      switchWorkspace(ctx.session.hash, ctx.user, ctx.workspace.id, String(fd.get('workspace') ?? ''));
      return '';
    } catch (e) {
      if (e instanceof UserError) return ctx.t(e.message);
      throw e;
    }
  });
  if (err) {
    const csrf = String(fd.get('_csrf') ?? '');
    redirect(withFlash(localPath(fd.get('back')), csrf, 'err', err));
  }
  redirect('/');
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
