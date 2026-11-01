/**
 * Router management rules (port of nextmon-php RoutersController). Pure library calls - must run inside the workspace context
 * (ctx.run). Throws UserError with English keys; the action layer translates them.
 */
import { Audit } from '../../lib/audit.ts';
import { Context } from '../../lib/context.ts';
import { Routers, RouterError } from '../../lib/routers.ts';
import type { RouterView } from '../../lib/routers.ts';
import { Share } from '../../lib/share.ts';
import type { ShareMode } from '../../lib/share.ts';
import { WS_ID_RE } from '../../lib/store.ts';
import { Workspace } from '../../lib/workspace.ts';
import { UserError } from './util.ts';

export type RouterForm = {
  id?: string;
  name?: string;
  session?: string;
  type?: string;
  host?: string;
  port?: string | number;
  ssl?: boolean;
  verify_tls?: boolean;
  user?: string;
  pass?: string;
  hotspot_name?: string;
};

/** Read the router form (dialog fields) from a FormData. */
export function routerForm(fd: FormData): RouterForm {
  const s = (k: string) => (typeof fd.get(k) === 'string' ? (fd.get(k) as string) : '');
  return {
    id: s('id').trim(),
    name: s('name').trim(),
    session: s('session').trim(),
    type: s('type'),
    host: s('host').trim(),
    port: s('port').trim(),
    ssl: s('ssl') === '1',
    verify_tls: s('verify_tls') === '1',
    user: s('user').trim(),
    pass: s('pass'),
    hotspot_name: s('hotspot_name').trim(),
  };
}

const actorName = () => Context.current().actor?.username ?? '';

export function saveRouter(f: RouterForm): string {
  if (f.id && Routers.get(f.id)?.shared) throw new UserError('A shared router can only be changed by its owner.');
  const name = (f.name ?? '').slice(0, 40);
  if (!name) throw new UserError('Name is required.');
  const type = f.type === 'demo' ? 'demo' : 'real';
  if (type === 'real' && !/^[A-Za-z0-9.\-:]+$/.test(f.host ?? '')) throw new UserError('Invalid host.');
  const session = (f.session ?? '').replace(/[^A-Za-z0-9_-]/g, '');
  try {
    Routers.save({
      id: f.id || undefined,
      name,
      session: session || undefined,
      type,
      host: f.host ?? '',
      port: Number(f.port) || undefined,
      ssl: !!f.ssl,
      verify_tls: !!f.ssl && !!f.verify_tls,
      user: f.user ?? '',
      pass: f.pass ?? '',
      hotspot_name: f.hotspot_name ?? '',
    });
  } catch (e) {
    if (e instanceof RouterError && e.message.startsWith('Router limit')) {
      throw new UserError('Router limit reached for this account (:n).', { ':n': Workspace.limits(Workspace.id()).routers });
    }
    throw e;
  }
  Audit.log(f.id ? 'router.edit' : 'router.add', name);
  return 'Router saved.';
}

export function deleteRouter(id: string): string {
  const r = Routers.get(id);
  if (!r) throw new UserError('Router not found.');
  if (r.shared) throw new UserError('A shared router can only be changed by its owner.');
  if (Routers.list().filter((x) => !x.shared).length <= 1) throw new UserError('At least one router must remain.');
  Routers.remove(id);
  Audit.log('router.delete', id);
  return 'Router deleted.';
}

/** "Try demo mode": give an empty workspace its own simulated router. */
export function tryDemo(): RouterView {
  const r = Routers.ensureDemo();
  Audit.log('router.demo', r.id);
  return r;
}

export function shareRouter(f: { router: string; to: string; mode: string }): string {
  const ws = Workspace.id();
  const r = Routers.get(f.router);
  if (!r || r.shared) throw new UserError('Router not found.');
  if (r.type === 'demo') throw new UserError('A demo router cannot be shared.');
  const ref = f.to.trim();
  const target = Workspace.bySlug(ref) ?? (WS_ID_RE.test(ref) ? Workspace.get(ref) : null);
  if (!target || target.id === ws) throw new UserError('Unknown target workspace.');
  const mode: ShareMode = f.mode === 'rw' ? 'rw' : 'ro';
  Share.grant(ws, r.id, target.id, mode, actorName());
  Audit.log('share.grant', `${r.id} -> ${target.slug} (${mode})`);
  return 'Router shared.';
}

/**
 * Revoke by `share` id (owner of the rule), or `router` + `to` slug (owner), or `router` alone (a recipient dropping a router that
 * was shared with it).
 */
export function revokeShare(f: { share?: string; router?: string; to?: string }): string {
  const ws = Workspace.id();
  let owner = ws;
  let id = (f.share ?? '').trim();
  const router = (f.router ?? '').trim();
  if (!id && router) {
    const target = f.to ? Workspace.bySlug(f.to.trim()) : null;
    if (target) id = Share.outgoing(ws).find((s) => s.router === router && s.to === target.id)?.id ?? '';
    if (!id && !f.to) {
      const incoming = Share.for(router, ws);
      if (incoming) {
        id = incoming.id;
        owner = incoming.owner;
      }
    }
  }
  if (id && owner === ws && !Share.outgoing(ws).some((s) => s.id === id)) {
    // maybe a rule addressed to us (recipient revoking by share id)
    const inc = Share.incoming(ws).find((s) => s.id === id);
    if (inc) owner = inc.owner;
  }
  if (!id || !Share.revoke(owner, id)) throw new UserError('Share not found.');
  Audit.log('share.revoke', id);
  return 'Share removed.';
}

export type OutgoingShare = { id: string; router: string; routerName: string; toName: string; toSlug: string; mode: ShareMode };

/** Shares this workspace granted (for the "Shared with others" list). */
export function outgoingShares(): OutgoingShare[] {
  const ws = Workspace.id();
  const names = new Map(Routers.list().filter((r) => !r.shared).map((r) => [r.id, r.name]));
  return Share.outgoing(ws).flatMap((s) => {
    const to = Workspace.get(s.to);
    const routerName = names.get(s.router);
    return to && routerName ? [{ id: s.id, router: s.router, routerName, toName: to.name, toSlug: to.slug, mode: s.mode }] : [];
  });
}

/** Display name of the workspace that owns a shared router. */
export function ownerName(r: RouterView): string {
  return Workspace.get(r.owner)?.name ?? r.owner;
}
