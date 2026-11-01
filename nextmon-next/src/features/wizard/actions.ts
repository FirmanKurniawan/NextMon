'use server';
import { headers } from 'next/headers';
import { Env } from '../../lib/env.ts';
import { runAction } from '../../server/guard.ts';
import { respond, UserError } from '../routers/util.ts';
import type { ActionResult } from '../routers/util.ts';
import { runStep, adoptGeneratedUser } from './logic.ts';

/** Portal host default: the configured public origin, else the Host the admin is browsing with. */
export async function portalHost(): Promise<string> {
  const base = Env.baseUrl();
  if (base) return base.hostname;
  const h = (await headers()).get('host') ?? '';
  return h.replace(/:\d+$/, '').toLowerCase();
}

export async function runWizardAction(fd: FormData): Promise<ActionResult> {
  const portal = await portalHost();
  return runAction({ cap: 'admin' }, fd, (ctx) =>
    respond(ctx, async () => {
      if (!ctx.router) throw new UserError('This account has no router yet. Ask the account owner to add one.');
      await runStep(fd, { driver: ctx.driver(), router: ctx.router, demo: ctx.demo, t: ctx.t, portal });
    }),
  );
}

export async function useWizardUserAction(fd: FormData): Promise<ActionResult> {
  return runAction({ cap: 'admin' }, fd, (ctx) =>
    respond(ctx, () => {
      if (!ctx.router) throw new UserError('Nothing to switch, or confirmation missing.');
      return adoptGeneratedUser(ctx.router.id, fd.get('confirm') === '1');
    }),
  );
}
