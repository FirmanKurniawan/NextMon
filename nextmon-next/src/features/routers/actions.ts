'use server';
import { Sessions } from '../../lib/sessions.ts';
import { runAction } from '../../server/guard.ts';
import { deleteRouter, revokeShare, routerForm, saveRouter, shareRouter, tryDemo } from './logic.ts';
import { respond, str } from './util.ts';
import type { ActionResult } from './util.ts';

export async function saveRouterAction(fd: FormData): Promise<ActionResult> {
  return runAction({ cap: 'admin' }, fd, (ctx) => respond(ctx, () => saveRouter(routerForm(fd))));
}

export async function deleteRouterAction(fd: FormData): Promise<ActionResult> {
  return runAction({ cap: 'admin' }, fd, (ctx) => respond(ctx, () => deleteRouter(str(fd, 'id'))));
}

export async function shareRouterAction(fd: FormData): Promise<ActionResult> {
  return runAction({ cap: 'admin' }, fd, (ctx) => respond(ctx, () => shareRouter({ router: str(fd, 'router'), to: str(fd, 'to'), mode: str(fd, 'mode') })));
}

export async function revokeShareAction(fd: FormData): Promise<ActionResult> {
  return runAction({ cap: 'admin' }, fd, (ctx) => respond(ctx, () => revokeShare({ share: str(fd, 'share'), router: str(fd, 'router'), to: str(fd, 'to') })));
}

/** Onboarding: create the workspace's own Demo Router and start using it. */
export async function tryDemoAction(fd: FormData): Promise<ActionResult> {
  return runAction({ cap: 'admin' }, fd, (ctx) =>
    respond(ctx, () => {
      const r = tryDemo();
      Sessions.setRouter(ctx.session.hash, r.id);
      return 'Demo router ready. Explore NextMON with simulated data.';
    }),
  );
}
