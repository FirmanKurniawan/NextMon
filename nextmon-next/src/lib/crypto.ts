/**
 * AES-256-GCM for secrets at rest (router passwords, tokens). Wire format = PHP edition: "v1:" + base64(iv12 | tag16 | ciphertext),
 * so a data dir can be moved between editions.
 *
 * Key: data/secret.key (base64 of 32 random bytes), created EXCLUSIVELY ('wx', mode 0600) so two racing first requests can never
 * end up with different keys; or env NEXTMON_SECRET (then rotation is disabled). Back the key file up separately from the db.
 *
 * Rotation (`npm run cli -- rekey`): secrets are discovered through registered SecretSources (routers.ts registers the router
 * passwords of every workspace; features register theirs). Everything is decrypted with the OLD key first, the old key is kept as
 * secret.key.bak-<time> (0600), then everything is re-encrypted - a failure before the swap changes nothing.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Env } from './env.ts';
import { singleton } from './singleton.ts';

export type SecretRef = { value: string; save(newEncrypted: string): void };
export type SecretSource = { name: string; list(): SecretRef[] };

const state = () => singleton('crypto', () => ({ key: null as Buffer | null, keyFile: '', sources: new Map<string, SecretSource>() }));

function keyPath(): string {
  return path.join(Env.dataDir(), 'secret.key');
}

function loadKey(): Buffer {
  const s = state();
  const env = Env.secretFromEnv();
  if (env) {
    const k = Buffer.from(env, 'base64');
    if (k.length !== 32) throw new Error('NEXTMON_SECRET must be base64 of exactly 32 bytes');
    return k;
  }
  const f = keyPath();
  if (s.key && s.keyFile === f) return s.key;
  fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o770 });
  try {
    const fd = fs.openSync(f, 'wx', 0o600); // exclusive create: loser of the race gets EEXIST
    try {
      fs.writeSync(fd, crypto.randomBytes(32).toString('base64'));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  }
  let raw = '';
  for (let i = 0; i < 40; i++) {
    // the winner of the race may still be writing
    raw = fs.readFileSync(f, 'utf8').trim();
    if (raw) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  try {
    if (process.platform !== 'win32' && fs.statSync(f).mode & 0o077) fs.chmodSync(f, 0o600);
  } catch {
    /* ignore */
  }
  const k = Buffer.from(raw, 'base64');
  if (k.length !== 32) throw new Error('data/secret.key is corrupt');
  s.key = k;
  s.keyFile = f;
  return k;
}

function encryptWith(key: Buffer, plain: string): string {
  if (plain === '') return '';
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return 'v1:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

function decryptWith(key: Buffer, blob: string): string {
  if (!blob || !blob.startsWith('v1:')) return '';
  const raw = Buffer.from(blob.slice(3), 'base64');
  if (raw.length < 29) return '';
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  } catch {
    return '';
  }
}

export const Crypto = {
  reset(): void {
    const s = state();
    s.key = null;
    s.keyFile = '';
  },

  encrypt(plain: string): string {
    return encryptWith(loadKey(), plain);
  },

  /** Returns '' for empty / tampered / foreign input (never throws on bad data). */
  decrypt(blob: string): string {
    return decryptWith(loadKey(), blob);
  },

  registerSecretSource(src: SecretSource): void {
    state().sources.set(src.name, src);
  },

  /** Re-encrypt every registered secret with a fresh key. Returns the number of values re-encrypted. */
  rotate(): number {
    if (Env.secretFromEnv()) throw new Error('Key rotation is not available when NEXTMON_SECRET is used');
    const oldKey = loadKey();
    const refs: { ref: SecretRef; plain: string }[] = [];
    for (const src of state().sources.values()) {
      for (const ref of src.list()) {
        if (ref.value) refs.push({ ref, plain: decryptWith(oldKey, ref.value) });
      }
    }
    const f = keyPath();
    const bak = `${f}.bak-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
    fs.copyFileSync(f, bak);
    try {
      fs.chmodSync(bak, 0o600);
    } catch {
      /* ignore */
    }
    const newKey = crypto.randomBytes(32);
    const tmp = f + '.new';
    fs.writeFileSync(tmp, newKey.toString('base64'), { mode: 0o600 });
    fs.renameSync(tmp, f);
    Crypto.reset();
    let n = 0;
    for (const { ref, plain } of refs) {
      if (plain === '') continue; // undecryptable with the old key: leave untouched rather than destroy it
      ref.save(encryptWith(newKey, plain));
      n++;
    }
    return n;
  },
};

/** Constant-time string comparison (length leak only). */
export function safeEqual(a: string, b: string): boolean {
  const x = crypto.createHash('sha256').update(a).digest();
  const y = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(x, y) && a.length === b.length;
}

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const randomHex = (bytes: number) => crypto.randomBytes(bytes).toString('hex');
export function hmac(secretPart: string, data: string): string {
  return crypto.createHmac('sha256', Buffer.concat([loadKey(), Buffer.from(secretPart)])).update(data).digest('base64url');
}
