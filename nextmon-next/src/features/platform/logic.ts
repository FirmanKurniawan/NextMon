/**
 * Platform admin rules (port of nextmon-php PlatformController + WorkspaceSwitchController): workspaces ("accounts") list, create,
 * suspend / reactivate, limits, owner password reset, delete, and entering a workspace. Capability `platform` is enforced by the
 * action / page guards; every write is recorded in the global platform audit log. Call inside ctx.run().
 */
import { ApiKeys } from '../../lib/apikeys.ts';
import { Audit } from '../../lib/audit.ts';
import { Context } from '../../lib/context.ts';
import { hashPassword } from '../../lib/password.ts';
import { Security } from '../../lib/security.ts';
import { Sessions } from '../../lib/sessions.ts';
import { Store, WS_ID_RE } from '../../lib/store.ts';
import { Users } from '../../lib/users.ts';
import type { User } from '../../lib/users.ts';
import { DEFAULT_LIMITS, SLUG_RE, Workspace } from '../../lib/workspace.ts';
import type { Limits, WorkspaceRec } from '../../lib/workspace.ts';
import { UserError } from '../routers/util.ts';

export const LIMIT_KEYS = ['routers', 'staff', 'vouchers_per_day', 'log_rows'] as const;

/** Row in the global platform audit log (same shape as Audit rows). */
export function platformLog(action: string, detail = ''): void {
  const c = Context.current();
  Store.global('platform_audit').append({
    ts: Math.floor(Date.now() / 1000),
    user: c.actor?.username ?? '-',
    actor: c.actor?.id ?? '-',
    workspace: c.ws ?? '',
    ip: c.ip ?? '-',
    router: '',
    action,
    detail: detail.slice(0, 500),
  });
}

/** Limits from posted fields: empty / non-numeric = no override (platform default applies). */
export function limitsFrom(fd: FormData): Partial<Limits> {
  const l: Partial<Limits> = {};
  for (const k of LIMIT_KEYS) {
    const v = String(fd.get(k) ?? '').trim();
    if (/^\d{1,9}$/.test(v)) l[k] = Number(v);
  }
  return l;
}

export const platformDefaults = (): Limits => ({ ...DEFAULT_LIMITS, ...(Store.global('platform').read<{ default_limits?: Partial<Limits> }>({}).default_limits ?? {}) });

/** The owner of a workspace = its first admin account. */
export function ownerOf(ws: string): User | null {
  return (
    Users.inWorkspace(ws)
      .filter((u) => u.role === 'admin' || u.role === 'platform')
      .sort((a, b) => a.created - b.created)[0] ?? null
  );
}

export type AccountRow = WorkspaceRec & { owner_name: string; user_count: number; router_count: number; eff: Limits };

export function accountRows(): AccountRow[] {
  return Workspace.all().map((w) => ({
    ...w,
    owner_name: ownerOf(w.id)?.username ?? '',
    user_count: Users.inWorkspace(w.id).length,
    router_count: Workspace.run(w.id, () => Store.read<unknown[]>('routers', []).length),
    eff: Workspace.limits(w.id),
  }));
}

const known = (id: string): WorkspaceRec => {
  const w = WS_ID_RE.test(id) ? Workspace.get(id) : null;
  if (!w) throw new UserError('Workspace not found.');
  return w;
};

export const slugify = (name: string): string =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 31)
    .replace(/-+$/, '');

export async function createAccount(fd: FormData): Promise<string> {
  const name = String(fd.get('name') ?? '').trim().slice(0, 60);
  if (!name) throw new UserError('Name is required.');
  const slug = String(fd.get('slug') ?? '').trim().toLowerCase() || slugify(name);
  if (!SLUG_RE.test(slug)) throw new UserError('Invalid slug (3-32 chars: a-z, 0-9, dash).');
  const owner = String(fd.get('owner') ?? '').trim();
  const password = String(fd.get('password') ?? '');
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(owner)) throw new UserError('Owner username: 3-32 letters, digits, dot, dash or underscore.');
  if (Users.find(owner)) throw new UserError('Username already exists.');
  // a new workspace starts with the platform base policy: evaluate it in a not-yet-existing workspace
  const pe = Workspace.run('w_00000000', () => Security.passwordError(password, owner));
  if (pe) throw new UserError(pe);
  const { workspace } = await Workspace.create({ name, slug, owner: { username: owner, password }, limits: limitsFrom(fd) });
  platformLog('workspace.create', `${workspace.id} ${workspace.slug}`);
  return workspace.slug;
}

export function setStatus(id: string, status: string): string {
  const w = known(id);
  const st = status === 'suspended' ? 'suspended' : 'active';
  Workspace.setStatus(w.id, st);
  platformLog(st === 'suspended' ? 'workspace.suspend' : 'workspace.activate', w.id);
  return st === 'suspended' ? 'Account suspended.' : 'Account reactivated.';
}

export function saveLimits(id: string, fd: FormData): string {
  const w = known(id);
  const limits = limitsFrom(fd); // an empty field removes the override
  Workspace.update(w.id, { limits });
  platformLog('workspace.limits', `${w.id} ${JSON.stringify(limits)}`);
  return 'Limits saved.';
}

export async function resetOwnerPassword(id: string, pw: string): Promise<string> {
  const w = known(id);
  const owner = ownerOf(w.id);
  if (!owner) throw new UserError('User not found.');
  const pe = Workspace.run(w.id, () => Security.passwordError(pw, owner.username));
  if (pe) throw new UserError(pe);
  Users.update(owner.id, { hash: await hashPassword(pw) });
  Sessions.destroyAllFor(owner.id); // sessions of the old password must die
  platformLog('workspace.reset_password', `${w.id} ${owner.username}`);
  return 'Owner password reset.';
}

export function deleteAccount(id: string, activeWs: string): string {
  const w = known(id);
  if (Users.inWorkspace(w.id).some((u) => u.role === 'platform')) throw new UserError('This workspace cannot be deleted (main, or it holds a platform admin).');
  if (w.id === activeWs) throw new UserError('Leave this workspace before deleting it.');
  Workspace.delete(w.id);
  ApiKeys.prune();
  platformLog('workspace.delete', w.id);
  return 'Account deleted.';
}

/**
 * Enter a workspace (or return to the admin own one when `to` is "", "home" or the home workspace id / slug). The target comes from
 * the registry only; the session active workspace is changed server-side. Audited in the platform log and in the target workspace.
 */
export function switchWorkspace(session: string, user: User, from: string, to: string): { target: WorkspaceRec; home: boolean } {
  const ref = to.trim();
  const home = Workspace.get(user.workspace);
  const target = ref === '' || ref === 'home' ? home : ((WS_ID_RE.test(ref) ? Workspace.get(ref) : null) ?? Workspace.bySlug(ref));
  if (!target) throw new UserError('Workspace not found.');
  const leaving = target.id === user.workspace;
  Sessions.setWorkspace(session, target.id); // also clears the selected router
  platformLog('platform.switch', `${from} -> ${target.id}`);
  Context.run({ ws: target.id, impersonating: !leaving }, () => Audit.log(leaving ? 'platform.leave' : 'platform.enter', `${from} -> ${target.id}`));
  return { target, home: leaving };
}
