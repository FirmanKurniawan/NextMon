/**
 * Staff management for a workspace owner (Settings > Users and roles). Rules mirror SettingsController of the PHP edition:
 * owners hand out STAFF roles only, only the platform admin creates owner accounts, only users of the ACTIVE workspace can be
 * touched (whatever id is posted), the last admin can not be demoted, staff count is limited by the workspace plan, and a password
 * reset signs the user out everywhere. All messages are English keys for t(); call inside ctx.run().
 */
import { Audit } from './audit.ts';
import { Sessions } from './sessions.ts';
import { Security } from './security.ts';
import { hashPassword, USERNAME_RE, verifyPassword } from './password.ts';
import { can, isRole, Users } from './users.ts';
import type { Role, User } from './users.ts';
import { Workspace } from './workspace.ts';

/** Roles an owner can hand out (the PHP `Auth::ROLES`). */
export const ASSIGNABLE_ROLES = ['admin', 'operator', 'reseller', 'viewer'] as const;

export type Result = { ok: true; msg: string; params?: Record<string, string | number> } | { ok: false; msg: string; params?: Record<string, string | number> };
const err = (msg: string, params?: Record<string, string | number>): Result => ({ ok: false, msg, params });

const adminCount = (ws: string) => Users.inWorkspace(ws).filter((u) => u.role === 'admin' || u.role === 'platform').length;

/** Staff accounts allowed by the plan (0 = unlimited) and how many exist (the owner does not count). */
export function staffUsage(ws: string): { used: number; max: number } {
  return { used: Math.max(0, Users.inWorkspace(ws).length - 1), max: Workspace.limits(ws).staff };
}

export async function saveUser(actor: User, ws: string, input: { id: string; username: string; role: string; password: string }): Promise<Result> {
  const { id, username, role, password } = input;
  const target = id ? Users.inWorkspace(ws).find((u) => u.id === id) : undefined;
  // editing the platform owner: the role field is ignored (it keeps the platform role)
  if (target?.role !== 'platform' && (!(ASSIGNABLE_ROLES as readonly string[]).includes(role) || !isRole(role))) return err('Unknown role.');
  // an owner hands out STAFF roles only; owner (admin) accounts are created by the platform admin
  if (role === 'admin' && !can(actor, 'platform') && (!id || target?.role !== 'admin')) return err('Only the platform admin can create owner accounts.');

  if (!id) {
    if (!USERNAME_RE.test(username) || password.length < 8) return err('Username 3-32 chars and password 8+ chars required.');
    const pe = Security.passwordError(password, username);
    if (pe) return err(pe);
    if (Users.find(username)) return err('Username already exists.');
    const { used, max } = staffUsage(ws);
    if (max !== 0 && used >= max) return err('Your plan allows at most :n staff accounts.', { ':n': max });
    const u = await Users.create({ username, password, role: role as Role, workspace: ws, name: username });
    if (!u) return err('Username already exists.');
    Audit.log('user.create', `${username} (${role})`);
    return { ok: true, msg: 'User saved.' };
  }

  if (!target) return err('User not found.');
  if (target.role === 'platform' && !can(actor, 'platform')) return err('Only a platform admin can change this account.');
  const newRole: Role = target.role === 'platform' ? 'platform' : (role as Role); // the platform owner keeps the platform role
  if ((target.role === 'admin' || target.role === 'platform') && newRole !== 'admin' && newRole !== 'platform' && adminCount(ws) <= 1) return err('Cannot demote the last admin.');
  let hash: string | undefined;
  if (password !== '') {
    const pe = password.length < 8 ? 'Password must be at least 8 characters.' : Security.passwordError(password, target.username);
    if (pe) return err(pe);
    hash = await hashPassword(password);
  }
  Users.update(target.id, { role: newRole, ...(hash ? { hash } : {}) });
  if (hash) Sessions.destroyAllFor(target.id); // admin reset: the old password's sessions must die
  Audit.log('user.update', `${target.username} (${newRole})`);
  return { ok: true, msg: 'User saved.' };
}

export function deleteUser(actor: User, ws: string, id: string): Result {
  if (id === actor.id) return err('You cannot delete yourself.');
  const target = Users.inWorkspace(ws).find((u) => u.id === id); // never delete a user of another workspace
  if (!target) return err('User not found.');
  if (target.role === 'platform' && !can(actor, 'platform')) return err('Only a platform admin can change this account.');
  Users.remove(target.id);
  Sessions.destroyAllFor(target.id);
  Audit.log('user.delete', target.id);
  return { ok: true, msg: 'User deleted.' };
}

/** Change the caller's own password; signs out the other devices. `currentHash` = the session that stays. */
export async function changePassword(user: User, currentHash: string, input: { current: string; next: string; next2: string }): Promise<Result> {
  const v = await verifyPassword(input.current, user.hash);
  if (!v.ok) return err('Current password is wrong.');
  if (input.next.length < 8 || input.next !== input.next2) return err('New password must be 8+ characters and match the confirmation.');
  const pe = Security.passwordError(input.next, user.username);
  if (pe) return err(pe);
  Users.update(user.id, { hash: await hashPassword(input.next) });
  Sessions.destroyAllFor(user.id, currentHash);
  Audit.log('password.change');
  return { ok: true, msg: 'Password changed.' };
}
