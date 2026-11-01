/**
 * API keys for /api/v1 (per workspace, document `apikeys`) + the global index key-hash -> workspace so a request that carries only
 * the key can find its tenant. Only sha256(key) is stored; the key is shown once at creation. Same model as the PHP edition.
 */
import { randomHex, safeEqual, sha256 } from './crypto.ts';
import { Store } from './store.ts';
import { Workspace } from './workspace.ts';

export type ApiKey = { id: string; name: string; scope: 'read' | 'write'; hash: string; prefix: string; created: number; last: number };

const index = () => Store.global('apikey_index');
const now = () => Math.floor(Date.now() / 1000);

export const ApiKeys = {
  /** Keys of the active workspace (never includes the secret; `hash` is the digest). */
  list(): ApiKey[] {
    return Store.read<ApiKey[]>('apikeys', []);
  },

  /** Create a key in the active workspace. Returns the stored record and the plain key (only chance to see it). */
  create(name: string, scope: string): { rec: ApiKey; key: string } {
    const key = 'kl_' + randomHex(20);
    const rec: ApiKey = {
      id: randomHex(4),
      name: (name.trim() || 'key').slice(0, 40),
      scope: scope === 'write' ? 'write' : 'read',
      hash: sha256(key),
      prefix: key.slice(0, 7),
      created: now(),
      last: 0,
    };
    Store.update<ApiKey[]>('apikeys', (l) => [...l, rec], []);
    index().update<Record<string, string>>((m) => ({ ...m, [rec.hash]: Workspace.id() }), {});
    return { rec, key };
  },

  /** Revoke a key of the ACTIVE workspace by id (an id of another workspace simply is not found). */
  revoke(id: string): ApiKey | null {
    const hit = ApiKeys.list().find((k) => k.id === id) ?? null;
    if (!hit) return null;
    Store.update<ApiKey[]>('apikeys', (l) => l.filter((k) => k.id !== id), []);
    index().update<Record<string, string>>((m) => {
      const { [hit.hash]: _gone, ...rest } = m;
      return rest;
    }, {});
    return hit;
  },

  /**
   * Resolve a presented key. The index tells the workspace; the key must ALSO exist in that workspace's own list (constant-time
   * compare, no early exit). Returns the record, the workspace, or a reason. Does not set any context: callers use Workspace.run(ws).
   */
  authenticate(raw: string): { ok: true; ws: string; key: ApiKey } | { ok: false; reason: 'invalid' | 'suspended' } {
    if (!raw || raw.length > 200) return { ok: false, reason: 'invalid' };
    const h = sha256(raw);
    const ws = index().read<Record<string, string>>({})[h];
    if (!ws || !Workspace.get(ws)) return { ok: false, reason: 'invalid' };
    if (Workspace.get(ws)!.status !== 'active') return { ok: false, reason: 'suspended' };
    const hit = Workspace.run(ws, () => {
      let found: ApiKey | null = null;
      for (const k of ApiKeys.list()) if (safeEqual(k.hash, h)) found = k;
      return found;
    });
    return hit ? { ok: true, ws, key: hit } : { ok: false, reason: 'invalid' };
  },

  /** "Last used" is shown to the minute: do not rewrite the document on every call. Call inside the key's workspace. */
  touch(key: ApiKey): void {
    if (now() - key.last < 60) return;
    Store.update<ApiKey[]>('apikeys', (l) => l.map((k) => (k.id === key.id ? { ...k, last: now() } : k)), []);
  },

  /** Drop index entries that point at a workspace that no longer exists (called opportunistically; cheap). */
  prune(): void {
    index().update<Record<string, string>>((m) => Object.fromEntries(Object.entries(m).filter(([, ws]) => Workspace.get(ws))), {});
  },
};
