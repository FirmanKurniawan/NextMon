/**
 * Users (global collection `users`). Roles: platform | admin (workspace owner) | operator | reseller | viewer.
 * Capabilities are always evaluated INSIDE the active workspace; `platform` is the only cross-workspace capability.
 */
import { randomHex } from './crypto.ts';
import { hashPassword } from './password.ts';
import { Store } from './store.ts';

export const ROLES = ['platform', 'admin', 'operator', 'reseller', 'viewer'] as const;
export type Role = (typeof ROLES)[number];
export type Cap = 'view' | 'sell' | 'write' | 'admin' | 'platform';

export const CAPS: Record<Role, readonly Cap[]> = {
  platform: ['view', 'sell', 'write', 'admin', 'platform'],
  admin: ['view', 'sell', 'write', 'admin'],
  operator: ['view', 'sell', 'write'],
  reseller: ['view', 'sell'],
  viewer: ['view'],
};

export type User = {
  id: string;
  username: string;
  name: string;
  hash: string;
  role: Role;
  /** the workspace this user belongs to (platform admins: their personal workspace, default `main`) */
  workspace: string;
  disabled?: boolean;
  created: number;
};

export function can(user: { role: string } | null | undefined, cap: Cap): boolean {
  if (!user) return false;
  return (CAPS[user.role as Role] ?? []).includes(cap);
}

export const isRole = (r: string): r is Role => (ROLES as readonly string[]).includes(r);

const usersDoc = () => Store.global('users');

export const Users = {
  all(): User[] {
    return usersDoc().read<User[]>([]);
  },
  count(): number {
    return Users.all().length;
  },
  hasUsers(): boolean {
    return Users.count() > 0;
  },
  find(username: string): User | null {
    const u = username.toLowerCase();
    return Users.all().find((x) => x.username.toLowerCase() === u) ?? null;
  },
  byId(id: string): User | null {
    return Users.all().find((x) => x.id === id) ?? null;
  },
  inWorkspace(ws: string): User[] {
    return Users.all().filter((u) => u.workspace === ws);
  },

  /**
   * Create a user atomically. Returns the user, or null when the username is taken (or `onlyIfEmpty` and users already exist).
   * Never creates `platform` users unless `allowPlatform` (first-run setup / CLI only).
   */
  async create(
    input: { username: string; password: string; role: Role; workspace: string; name?: string },
    opts: { onlyIfEmpty?: boolean; allowPlatform?: boolean } = {},
  ): Promise<User | null> {
    if (input.role === 'platform' && !opts.allowPlatform) throw new Error('platform users cannot be created here');
    const hash = await hashPassword(input.password);
    const user: User = {
      id: randomHex(6),
      username: input.username,
      name: input.name || input.username,
      hash,
      role: input.role,
      workspace: input.workspace,
      created: Math.floor(Date.now() / 1000),
    };
    let made = false;
    usersDoc().update<User[]>((list) => {
      if (opts.onlyIfEmpty && list.length) return list;
      if (list.some((x) => x.username.toLowerCase() === input.username.toLowerCase())) return list;
      made = true;
      return [...list, user];
    }, []);
    return made ? user : null;
  },

  update(id: string, patch: Partial<Pick<User, 'name' | 'hash' | 'role' | 'disabled'>>): void {
    usersDoc().update<User[]>((list) => list.map((u) => (u.id === id ? { ...u, ...patch } : u)), []);
  },

  remove(id: string): void {
    usersDoc().update<User[]>((list) => list.filter((u) => u.id !== id), []);
  },

  removeWorkspace(ws: string): number {
    let n = 0;
    usersDoc().update<User[]>((list) => {
      const keep = list.filter((u) => u.workspace !== ws);
      n = list.length - keep.length;
      return keep;
    }, []);
    return n;
  },
};
