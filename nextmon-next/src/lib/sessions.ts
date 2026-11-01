/**
 * Server-side login sessions (table `sessions`). The browser only holds an opaque random token in an HttpOnly cookie; the database
 * stores sha256(token), so a stolen database can not be replayed. Each session carries its own CSRF token (double-submit with the
 * `X-CSRF-Token` header / hidden `_csrf` field) and the ACTIVE workspace - set by the server only (login, platform switch).
 *
 * Idle timeout (NEXTMON_SESSION_IDLE_MIN, default 8 h; 0 = off) and an absolute lifetime of 30 days. Activity is written at most once
 * a minute. A session also dies when its user is deleted/disabled or its workspace is suspended.
 */
import { db } from './db.ts';
import type { Row } from './db.ts';
import { Env } from './env.ts';
import { randomHex, randomToken, sha256 } from './crypto.ts';
import { Users } from './users.ts';
import type { User } from './users.ts';
import { Workspace } from './workspace.ts';
import type { WorkspaceRec } from './workspace.ts';

export const ABSOLUTE_MAX_SECONDS = 30 * 86400;
const TOUCH_EVERY = 60;

export type SessionRec = { hash: string; uid: string; ws: string; csrf: string; created: number; last: number; ip: string; ua: string; router: string; lang: string };

const now = () => Math.floor(Date.now() / 1000);
const toRec = (r: Row): SessionRec => ({
  hash: String(r.id_hash), uid: String(r.uid), ws: String(r.ws), csrf: String(r.csrf), created: Number(r.created), last: Number(r.last),
  ip: String(r.ip), ua: String(r.ua), router: String(r.router), lang: String(r.lang),
});

export type Resolved = { session: SessionRec; user: User; workspace: WorkspaceRec };

export const Sessions = {
  /** New session; returns the cookie token. Caller has already authenticated the user. */
  create(user: User, ws: string, info: { ip: string; ua: string; lang?: string }): { token: string; csrf: string } {
    const token = randomToken(32);
    const csrf = randomHex(24);
    const t = now();
    db()
      .st('INSERT INTO sessions(id_hash, uid, ws, csrf, created, last, ip, ua, router, lang) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(sha256(token), user.id, ws, csrf, t, t, info.ip.slice(0, 64), info.ua.slice(0, 200), '', info.lang ?? '');
    // opportunistic cleanup of dead sessions
    if (Math.random() < 0.05) Sessions.sweep();
    return { token, csrf };
  },

  /**
   * Validate a cookie token. Returns null for unknown / expired / revoked sessions (and deletes the expired ones).
   * `touch=false` re-validates without counting as activity (long-lived SSE connections must not keep a session alive).
   */
  resolve(token: string | undefined, touch = true): Resolved | null {
    if (!token || token.length < 20 || token.length > 200) return null;
    const hash = sha256(token);
    const row = db().st('SELECT * FROM sessions WHERE id_hash = ?').get(hash);
    if (!row) return null;
    const s = toRec(row);
    const t = now();
    const idle = Env.sessionIdleMinutes() * 60;
    if (t - s.created > ABSOLUTE_MAX_SECONDS || (idle > 0 && t - s.last > idle)) {
      Sessions.destroyHash(hash);
      return null;
    }
    const user = Users.byId(s.uid);
    const workspace = Workspace.get(s.ws);
    // the active workspace must be the user's own unless they are a platform admin (never trust the stored value blindly)
    if (!user || user.disabled || !workspace || (user.role !== 'platform' && user.workspace !== s.ws)) {
      Sessions.destroyHash(hash);
      return null;
    }
    if (workspace.status === 'suspended' && user.role !== 'platform') {
      Sessions.destroyHash(hash);
      return null;
    }
    if (touch && t - s.last >= TOUCH_EVERY) {
      db().st('UPDATE sessions SET last = ? WHERE id_hash = ?').run(t, hash);
      s.last = t;
    }
    return { session: s, user, workspace };
  },

  destroy(token: string): void {
    Sessions.destroyHash(sha256(token));
  },
  destroyHash(hash: string): void {
    db().st('DELETE FROM sessions WHERE id_hash = ?').run(hash);
  },
  destroyAllFor(uid: string, exceptHash?: string): number {
    const r = exceptHash
      ? db().st('DELETE FROM sessions WHERE uid = ? AND id_hash <> ?').run(uid, exceptHash)
      : db().st('DELETE FROM sessions WHERE uid = ?').run(uid);
    return Number(r.changes);
  },
  destroyWorkspace(ws: string): void {
    db().st('DELETE FROM sessions WHERE ws = ?').run(ws);
  },
  listFor(uid: string): SessionRec[] {
    return db().st('SELECT * FROM sessions WHERE uid = ? ORDER BY last DESC').all(uid).map(toRec);
  },
  count(): number {
    return Number(db().st('SELECT COUNT(*) AS c FROM sessions').get()?.c ?? 0);
  },

  /** Platform admin switches workspace (the caller verified the role and wrote an audit row). */
  setWorkspace(hash: string, ws: string): void {
    db().st('UPDATE sessions SET ws = ?, router = ? WHERE id_hash = ?').run(ws, '', hash);
  },
  setRouter(hash: string, routerId: string): void {
    db().st('UPDATE sessions SET router = ? WHERE id_hash = ?').run(routerId, hash);
  },
  setLang(hash: string, lang: string): void {
    db().st('UPDATE sessions SET lang = ? WHERE id_hash = ?').run(lang, hash);
  },

  sweep(): number {
    const t = now();
    const idle = Env.sessionIdleMinutes() * 60;
    let n = Number(db().st('DELETE FROM sessions WHERE created < ?').run(t - ABSOLUTE_MAX_SECONDS).changes);
    if (idle > 0) n += Number(db().st('DELETE FROM sessions WHERE last < ?').run(t - idle).changes);
    return n;
  },
};
