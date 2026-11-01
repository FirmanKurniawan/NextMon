'use server';
import { redirect } from 'next/navigation';
import { localPath, runAction } from '../../server/guard.ts';
import { respond, str, UserError } from '../routers/util.ts';
import type { ActionResult } from '../routers/util.ts';
import { createAccount, deleteAccount, resetOwnerPassword, saveLimits, setStatus, switchWorkspace } from './logic.ts';

export async function createAccountAction(fd: FormData): Promise<ActionResult> {
  return runAction({ cap: 'platform' }, fd, (ctx) => respond(ctx, async () => ctx.t('Account created: :s', { ':s': await createAccount(fd) })));
}

export async function setStatusAction(fd: FormData): Promise<ActionResult> {
  return runAction({ cap: 'platform' }, fd, (ctx) => respond(ctx, () => setStatus(str(fd, 'id'), str(fd, 'status'))));
}

export async function saveLimitsAction(fd: FormData): Promise<ActionResult> {
  return runAction({ cap: 'platform' }, fd, (ctx) => respond(ctx, () => saveLimits(str(fd, 'id'), fd)));
}

export async function resetPasswordAction(fd: FormData): Promise<ActionResult> {
  return runAction({ cap: 'platform' }, fd, (ctx) => respond(ctx, () => resetOwnerPassword(str(fd, 'id'), String(fd.get('password') ?? ''))));
}

export async function deleteAccountAction(fd: FormData): Promise<ActionResult> {
  return runAction({ cap: 'platform' }, fd, (ctx) => respond(ctx, () => deleteAccount(str(fd, 'id'), ctx.workspace.id)));
}

/** Enter a workspace (the impersonation banner shows in the shell) or go back to the own one. */
export async function enterWorkspaceAction(fd: FormData): Promise<void> {
  const failed = await runAction({ cap: 'platform' }, fd, (ctx) => {
    try {
      switchWorkspace(ctx.session.hash, ctx.user, ctx.workspace.id, str(fd, 'workspace'));
      return false;
    } catch (e) {
      if (e instanceof UserError) return true;
      throw e;
    }
  });
  // a failure is only reachable by tampering (targets are chosen from the registry): just return to the list
  redirect(failed ? localPath(fd.get('back'), '/platform/accounts') : '/');
}
