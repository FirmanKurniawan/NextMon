/**
 * Authentication: login with rate limiting, first-run setup, capability checks, CSRF tokens.
 *
 * Roles -> capabilities (always evaluated inside the active workspace):
 *   platform: view sell write admin platform | admin (workspace owner): view sell write admin | operator: view sell write
 *   reseller: view sell | viewer: view
 *
 * LOGIN RATE LIMIT (global doc `login_attempts`, 10-minute lock): three independent counters per attempt -
 *   user+IP (5)  : the normal "5 wrong passwords" lock
 *   IP (20)      : password spraying from one address across many usernames
 *   username (30): distributed guessing - a botnet rotating IPs against ONE account (the "per-username lock")
 * Attempts are RESERVED (counted) before the password is checked and attempts for the same username are serialised in-process, so
 * 1000 parallel guesses can not all slip in before the first lock is recorded. A success clears user+IP and username counters.
 * Unknown users are verified against a dummy hash (same work, same message).
 */
import crypto from 'node:crypto';
import { Audit } from './audit.ts';
import { Context } from './context.ts';
import { hmac, safeEqual } from './crypto.ts';
import { Env } from './env.ts';
import { hashPassword, passwordError, USERNAME_RE, verifyPassword } from './password.ts';
import { singleton } from './singleton.ts';
import { Store } from './store.ts';
import { can as canRole, Users } from './users.ts';
import type { Cap, User } from './users.ts';
import { Workspace, WorkspaceError } from './workspace.ts';

export { can, ROLES } from './users.ts';
export type { Cap, Role, User } from './users.ts';

const MAX_FAILS = 5;
const LOCK_SECONDS = 600;

type Attempt = { n: number; t: number; until?: number };

/** In-process serialisation per key (no two password checks for the same username run concurrently). */
const chains = singleton('loginChains', () => new Map<string, Promise<unknown>>());
async function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  chains.set(key, run);
  try {
    return await run;
  } finally {
    if (chains.get(key) === run) chains.delete(key);
  }
}

export type LoginResult = { ok: true; user: User } | { ok: false; message: string; params?: Record<string, string | number> };

export const Auth = {
  MAX_FAILS,
  LOCK_SECONDS,

  hasUsers: () => Users.hasUsers(),

  /**
   * Check credentials. Does NOT create the session (the server layer does, setting the cookie). `ip` is the vetted client IP.
   * Messages are English keys for t().
   */
  async attempt(rawUsername: string, password: string, ip: string): Promise<LoginResult> {
    const username = rawUsername.trim().slice(0, 64);
    const uname = username.toLowerCase();
    return serial('login:' + uname, async () => {
      const keys: [string, number][] = [
        [`u:${uname}|${ip}`, MAX_FAILS],
        [`ip:${ip}`, MAX_FAILS * 4],
        [`g:${uname}`, MAX_FAILS * 6],
      ];
      const t = Math.floor(Date.now() / 1000);
      let lockedFor = 0;
      // reserve the attempt (count it now); report an active lock instead of checking the password
      Store.global('login_attempts').update<Record<string, Attempt>>((a) => {
        for (const [k, e] of Object.entries(a)) if (t - e.t > 86400) delete a[k];
        for (const [k] of keys) {
          const e = a[k];
          if (e?.until && e.until > t) lockedFor = Math.max(lockedFor, e.until - t);
        }
        if (lockedFor) return a;
        for (const [k, max] of keys) {
          let e = a[k] ?? { n: 0, t };
          if (t - e.t > LOCK_SECONDS) e = { n: 0, t };
          e.n++;
          if (e.n >= max) e.until = t + LOCK_SECONDS;
          a[k] = e;
        }
        return a;
      }, {});
      if (lockedFor) return { ok: false, message: 'Too many attempts. Try again in :m min.', params: { ':m': Math.ceil(lockedFor / 60) } };

      const u = USERNAME_RE.test(username) ? Users.find(username) : null;
      const v = await verifyPassword(password, u?.hash);
      const ok = v.ok && !!u && !u.disabled;
      if (!ok || !u) {
        const shown = username.replace(/\p{C}/gu, '').slice(0, 40); // may be a mistyped password: short, no control chars
        Audit.log('login.fail', shown);
        return { ok: false, message: 'Wrong username or password.' };
      }
      Store.global('login_attempts').update<Record<string, Attempt>>((a) => {
        delete a[keys[0]![0]];
        delete a[keys[2]![0]];
        return a;
      }, {});
      if (v.needsRehash) Users.update(u.id, { hash: await hashPassword(password) });
      const ws = Workspace.get(u.workspace);
      if (!ws) return { ok: false, message: 'Wrong username or password.' };
      if (ws.status === 'suspended' && u.role !== 'platform') {
        Context.run({ ws: ws.id }, () => Audit.log('login.suspended', u.username));
        return { ok: false, message: 'This account is suspended. Contact the administrator.' };
      }
      return { ok: true, user: u };
    });
  },

  /** First-run: the SETUP TOKEN (when NEXTMON_SETUP_TOKEN is set) must match. */
  setupTokenOk(given: string | null | undefined): boolean {
    const want = Env.setupToken();
    if (!want) return true;
    return !!given && safeEqual(want, given);
  },

  /**
   * Create the platform admin + workspace "main" (with a Demo Router) atomically; fails when any user already exists.
   * Messages are English keys for t().
   */
  async setup(input: { username: string; password: string; password2: string; token?: string | null }): Promise<{ ok: true; user: User } | { ok: false; message: string }> {
    if (Users.hasUsers()) return { ok: false, message: 'Setup is already completed.' };
    if (!Auth.setupTokenOk(input.token)) return { ok: false, message: 'Setup is locked. Open /setup?token=... with the value of NEXTMON_SETUP_TOKEN.' };
    if (!USERNAME_RE.test(input.username)) return { ok: false, message: 'Username: 3-32 letters, digits, dot, dash or underscore.' };
    const pe = passwordError(input.password, input.username);
    if (pe) return { ok: false, message: pe };
    if (input.password !== input.password2) return { ok: false, message: 'Passwords do not match.' };
    try {
      const { owner, workspace } = await Workspace.create({
        name: 'Main',
        slug: 'main',
        owner: { username: input.username, password: input.password },
        ownerRole: 'platform',
        demo: true,
        onlyIfEmpty: true,
      });
      Context.run({ ws: workspace.id, actor: { id: owner.id, username: owner.username, role: owner.role, workspace: workspace.id } }, () => Audit.log('setup', 'platform admin created'));
      return { ok: true, user: owner };
    } catch (e) {
      if (e instanceof WorkspaceError) return { ok: false, message: e.message };
      throw e;
    }
  },

  can: canRole as (u: { role: string } | null | undefined, cap: Cap) => boolean,
};

// ---- CSRF ----------------------------------------------------------------------------------------------

export const Csrf = {
  /** Compare a submitted token with the session token (constant time). */
  verify(given: unknown, expected: string): boolean {
    return typeof given === 'string' && given.length > 0 && given.length < 200 && expected.length > 0 && safeEqual(given, expected);
  },

  /**
   * Stateless signed token for PRE-LOGIN forms (/login, /setup) where there is no session yet: "<exp>.<nonce>.<hmac>", valid 2 hours.
   * (The Origin check in middleware is the primary login-CSRF defence; this adds a per-page token on top.)
   */
  pre(purpose: string, ttlSec = 7200): string {
    const exp = Math.floor(Date.now() / 1000) + ttlSec;
    const nonce = crypto.randomBytes(9).toString('base64url');
    return `${exp}.${nonce}.${hmac('csrf-pre:' + purpose, `${exp}.${nonce}`)}`;
  },
  verifyPre(purpose: string, token: unknown): boolean {
    if (typeof token !== 'string') return false;
    const [exp, nonce, mac] = token.split('.');
    if (!exp || !nonce || !mac || Number(exp) < Date.now() / 1000) return false;
    return safeEqual(mac, hmac('csrf-pre:' + purpose, `${exp}.${nonce}`));
  },
};
