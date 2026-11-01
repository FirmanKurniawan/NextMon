/**
 * Password hashing with scrypt (node:crypto, memory-hard; the bcrypt-equivalent available without native deps).
 *
 * Format:  scrypt$<log2N>$<r>$<p>$<salt b64>$<hash b64>     e.g. scrypt$16$8$1$....$....
 * Parameters (new hashes): N = 2^16 (64 MiB), r = 8, p = 1, 16-byte random salt, 64-byte output - OWASP "scrypt" guidance range
 * (N=2^16,r=8,p=2 or N=2^17,r=8,p=1); we take p=1 and compensate by running it on libuv's thread pool (async API) so the event
 * loop is never blocked (~100-150 ms per hash on a laptop). The parameters live inside every hash, so they can be raised later:
 * verify() reports needsRehash and the login flow upgrades the stored hash transparently. verify() refuses absurd parameters
 * (N > 2^20) coming from a tampered record (DoS guard). Comparison is constant-time. Max password length 1024 bytes.
 */
import crypto from 'node:crypto';
import { Env } from './env.ts';

const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXLOG2N = 20;

function scrypt(pw: string, salt: Buffer, log2n: number, r: number, p: number): Promise<Buffer> {
  const N = 2 ** log2n;
  return new Promise((resolve, reject) => {
    crypto.scrypt(pw.normalize('NFKC'), salt, KEYLEN, { N, r, p, maxmem: 256 * N * r + 64 * 1024 * 1024 }, (e, k) => (e ? reject(e) : resolve(k)));
  });
}

export async function hashPassword(pw: string, log2n = Env.scryptLog2N()): Promise<string> {
  const salt = crypto.randomBytes(16);
  const h = await scrypt(pw, salt, log2n, R, P);
  return `scrypt$${log2n}$${R}$${P}$${salt.toString('base64')}$${h.toString('base64')}`;
}

export type VerifyResult = { ok: boolean; needsRehash: boolean };

// verified against when the user does not exist, so timing does not reveal valid usernames
let dummy: Promise<string> | null = null;
export const dummyHash = () => (dummy ??= hashPassword('nextmon-dummy-password', Env.scryptLog2N()));

export async function verifyPassword(pw: string, stored: string | undefined): Promise<VerifyResult> {
  const hash = stored && stored.startsWith('scrypt$') ? stored : await dummyHash();
  const known = hash === stored;
  const parts = hash.split('$');
  const log2n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (parts.length !== 6 || !Number.isInteger(log2n) || log2n < 10 || log2n > MAXLOG2N || r < 1 || r > 16 || p < 1 || p > 4) {
    return { ok: false, needsRehash: false };
  }
  if (pw.length > 1024) return { ok: false, needsRehash: false };
  const want = Buffer.from(parts[5]!, 'base64');
  const got = await scrypt(pw, Buffer.from(parts[4]!, 'base64'), log2n, r, p);
  const ok = known && want.length === got.length && crypto.timingSafeEqual(want, got);
  return { ok, needsRehash: ok && (log2n < Env.scryptLog2N() || r !== R || p !== P) };
}

export const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;

export type PasswordPolicy = { min: number; upper: boolean; digit: boolean; symbol: boolean; noUsername: boolean };
export const DEFAULT_POLICY: PasswordPolicy = { min: 8, upper: false, digit: false, symbol: false, noUsername: true };

/** Human-readable problem (English key for t()), or null when the password satisfies the policy. */
export function passwordError(pw: string, username = '', policy: PasswordPolicy = DEFAULT_POLICY): string | null {
  if (pw.includes('\0')) return 'Password contains an invalid character.';
  if (Buffer.byteLength(pw) > 1024) return 'Password is too long.';
  if ([...pw].length < Math.max(8, policy.min)) return 'Password must be at least 8 characters.';
  if (policy.upper && !(/\p{Lu}/u.test(pw) && /\p{Ll}/u.test(pw))) return 'Password must contain both upper and lower case letters.';
  if (policy.digit && !/\d/.test(pw)) return 'Password must contain a digit.';
  if (policy.symbol && !/[^\p{L}\d]/u.test(pw)) return 'Password must contain a symbol.';
  if (policy.noUsername && username && pw.toLowerCase().includes(username.toLowerCase())) return 'Password must not contain the username.';
  return null;
}
