/**
 * Append-only audit log. Workspace actions go to the workspace's `audit.log`; events outside any workspace (failed logins before the
 * user is known) and actions of a platform admin inside someone else's workspace also go to the global `platform_audit`.
 * Actor / IP / router come from the request Context - callers only say WHAT happened.
 */
import { Context } from './context.ts';
import { Store } from './store.ts';

export type AuditRow = {
  ts: number;
  user: string;
  actor: string;
  workspace: string;
  ip: string;
  router: string;
  action: string;
  detail: string;
  impersonating?: boolean;
};

const CTRL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

export const Audit = {
  log(action: string, detail = ''): void {
    const c = Context.current();
    const row: AuditRow = {
      ts: Math.floor(Date.now() / 1000),
      user: c.actor?.username ?? '-',
      actor: c.actor?.id ?? '-',
      workspace: c.ws ?? '',
      ip: c.ip ?? '-',
      router: c.routerId ?? '',
      action,
      detail: detail.replace(CTRL, '').slice(0, 500),
    };
    if (c.impersonating) row.impersonating = true;
    if (c.ws) Store.append('audit.log', row);
    if (!c.ws || c.impersonating) Store.global('platform_audit').append(row);
  },

  /** Newest first (active workspace). */
  tail(n = 300): AuditRow[] {
    return Store.tail<AuditRow>('audit.log', n);
  },

  platformTail(n = 300): AuditRow[] {
    return Store.global('platform_audit').rows<AuditRow>(n);
  },
};
