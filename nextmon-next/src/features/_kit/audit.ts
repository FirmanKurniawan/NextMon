import { Audit } from '../../lib/audit.ts';

/** Audit entry for the request in progress (handlers run inside ctx.run(): actor, IP, workspace and router come from the context). */
export const audit = (action: string, detail = ''): void => Audit.log(action, detail);
