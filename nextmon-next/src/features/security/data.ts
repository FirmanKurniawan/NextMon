/** Session listing rules of Settings > Security (pure-ish helpers, used by page + actions + tests). Call inside ctx.run(). */
import { Sessions } from '../../lib/sessions.ts';
import type { SessionRec } from '../../lib/sessions.ts';
import { Users } from '../../lib/users.ts';

/** Sessions visible to the caller: owners see every session of the workspace's users, everyone else only their own. */
export function visibleSessions(ws: string, uid: string, admin: boolean): SessionRec[] {
  const ids = admin ? Users.inWorkspace(ws).map((u) => u.id) : [uid];
  return ids.flatMap((id) => Sessions.listFor(id)).sort((a, b) => b.last - a.last);
}
