import { Workspace } from '../src/lib/workspace.ts';
import { Users } from '../src/lib/users.ts';
import type { User } from '../src/lib/users.ts';

/** Create a platform admin + 'main' workspace. */
export async function bootstrapPlatform(): Promise<{ ws: string; platform: User }> {
  const { workspace, owner } = await Workspace.create({ name: 'Main', slug: 'main', owner: { username: 'root', password: 'rootpass123' }, ownerRole: 'platform', demo: true });
  return { ws: workspace.id, platform: owner };
}

/** Create a tenant workspace with an owner (and a Demo Router). */
export async function makeTenant(slug: string, password = 'ownerpass123') {
  const { workspace, owner } = await Workspace.create({ name: slug.toUpperCase(), slug, owner: { username: 'owner-' + slug, password }, demo: true });
  return { ws: workspace.id, owner };
}

export async function addStaff(ws: string, username: string, role: 'operator' | 'reseller' | 'viewer', password = 'staffpass123') {
  const u = await Users.create({ username, password, role, workspace: ws });
  if (!u) throw new Error('staff create failed');
  return u;
}
