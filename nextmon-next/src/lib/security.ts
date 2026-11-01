/**
 * Security policy of a workspace (password rules + idle session timeout) and helpers for the sessions / login-history views.
 * Stored in the workspace settings under `security`; the platform doc may carry a base policy that a workspace overrides.
 * Same model as the PHP edition (Security.php).
 */
import { Context } from './context.ts';
import { Env } from './env.ts';
import type { PasswordPolicy } from './password.ts';
import { passwordError } from './password.ts';
import { Store, WS_ID_RE } from './store.ts';

export type SecurityPolicy = { pw_min: number; pw_upper: boolean; pw_digit: boolean; pw_symbol: boolean; pw_no_username: boolean; timeout_min: number };

const clamp = (n: unknown, lo: number, hi: number, def: number) => {
  const v = Math.trunc(Number(n));
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def;
};

function merge(stored: Record<string, unknown>, base: Record<string, unknown>): SecurityPolicy {
  const p = { pw_min: 8, pw_upper: false, pw_digit: false, pw_symbol: false, pw_no_username: true, timeout_min: Env.sessionIdleMinutes(), ...base, ...stored };
  return {
    pw_min: clamp(p.pw_min, 8, 64, 8),
    pw_upper: !!p.pw_upper,
    pw_digit: !!p.pw_digit,
    pw_symbol: !!p.pw_symbol,
    pw_no_username: !!p.pw_no_username,
    timeout_min: clamp(p.timeout_min, 0, 43200, 480),
  };
}

const platformBase = (): Record<string, unknown> => (Store.global('platform').read<{ security?: Record<string, unknown> }>({}).security ?? {}) as Record<string, unknown>;

export const Security = {
  /** Effective policy of the active workspace (call inside ctx.run). */
  policy(): SecurityPolicy {
    const settings = Store.read<{ security?: Record<string, unknown> }>('settings', {});
    return merge(settings.security ?? {}, platformBase());
  },

  save(input: Partial<Record<keyof SecurityPolicy, unknown>>): SecurityPolicy {
    const next = {
      pw_min: clamp(input.pw_min, 8, 64, 8),
      pw_upper: !!input.pw_upper,
      pw_digit: !!input.pw_digit,
      pw_symbol: !!input.pw_symbol,
      pw_no_username: !!input.pw_no_username,
      timeout_min: clamp(input.timeout_min, 0, 43200, 0),
    };
    Store.update<Record<string, unknown>>('settings', (cur) => ({ ...cur, security: { ...((cur.security as object) ?? {}), ...next } }), {});
    return next;
  },

  /** Idle timeout in SECONDS for a workspace (0 = off). Used by Sessions.resolve for every request. */
  idleSeconds(ws: string): number {
    if (!WS_ID_RE.test(ws)) return Env.sessionIdleMinutes() * 60;
    return Context.run({ ws }, () => Security.policy().timeout_min) * 60;
  },

  /** English-key problem with the password under the active workspace policy, or null. */
  passwordError(pw: string, username = ''): string | null {
    const p = Security.policy();
    const pol: PasswordPolicy = { min: p.pw_min, upper: p.pw_upper, digit: p.pw_digit, symbol: p.pw_symbol, noUsername: p.pw_no_username };
    return passwordError(pw, username, pol);
  },

  /** "Chrome / Windows" style label for a user agent. */
  uaLabel(ua: string): string {
    if (!ua) return '-';
    const low = ua.toLowerCase();
    const first = (m: [string, string][], def: string) => m.find(([k]) => low.includes(k.toLowerCase()))?.[1] ?? def;
    const b = first([['Edg', 'Edge'], ['OPR', 'Opera'], ['Firefox', 'Firefox'], ['Chrome', 'Chrome'], ['Safari', 'Safari'], ['curl', 'curl']], 'Browser');
    const os = first([['Windows', 'Windows'], ['Android', 'Android'], ['iPhone', 'iOS'], ['iPad', 'iOS'], ['Mac OS', 'macOS'], ['Linux', 'Linux']], '');
    return b + (os ? ' / ' + os : '');
  },

  /** Sign-in / sign-out / password events from the audit log (active workspace), newest first. `username` restricts to one user. */
  loginHistory(username: string | null, n = 60): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    for (const a of Store.tail<Record<string, unknown>>('audit.log', 5000)) {
      const act = String(a.action ?? '');
      if (!/^(login|logout|session\.|password\.)/.test(act)) continue;
      if (username !== null) {
        const who = act.startsWith('login.fail') ? String(a.detail ?? '') : String(a.user ?? '');
        if (who.toLowerCase() !== username.toLowerCase()) continue;
      }
      out.push(a);
      if (out.length >= n) break;
    }
    return out;
  },
};
