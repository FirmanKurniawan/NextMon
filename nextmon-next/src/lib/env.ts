/**
 * Environment / configuration. Everything is read lazily (functions, not constants) so tests can change process.env.
 *
 * NEXTMON_DATA               data directory (SQLite db, secret.key, per-workspace files). Default ./data
 * NEXTMON_DEMO               1 = every router entry uses the simulated router
 * NEXTMON_SETUP_TOKEN        when set, /setup?token=... must match before the first admin can be created
 * NEXTMON_BASE_URL           canonical public origin (https://host[:port]); Host + Origin are validated against it
 * NEXTMON_ALLOWED_HOSTS      extra allowed Host values (comma separated) when BASE_URL is not set
 * NEXTMON_TRUSTED_PROXIES    comma separated IPs/CIDRs whose X-Forwarded-* headers are honoured (loopback always)
 * NEXTMON_SESSION_IDLE_MIN   idle timeout in minutes (default 480, 0 = off)
 * NEXTMON_ALLOW_PRIVATE_WEBHOOK  1 = SSRF guard allows private targets
 * NEXTMON_SECRET             optional base64 32-byte key (instead of data/secret.key); disables key rotation
 * NEXTMON_SCRYPT_LOG2N       scrypt cost exponent for new password hashes (default 16; tests lower it)
 */
import path from 'node:path';

const truthy = (v: string | undefined) => ['1', 'true', 'yes', 'on'].includes((v ?? '').trim().toLowerCase());

export const Env = {
  dataDir(): string {
    return path.resolve(process.env.NEXTMON_DATA?.trim() || path.join(process.cwd(), 'data'));
  },
  demoForced(): boolean {
    return truthy(process.env.NEXTMON_DEMO);
  },
  setupToken(): string {
    return process.env.NEXTMON_SETUP_TOKEN ?? '';
  },
  baseUrl(): URL | null {
    const v = (process.env.NEXTMON_BASE_URL ?? '').trim();
    if (!v) return null;
    try {
      const u = new URL(v);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
    } catch {
      return null;
    }
  },
  allowedHosts(): string[] {
    return (process.env.NEXTMON_ALLOWED_HOSTS ?? '')
      .split(/[\s,;]+/)
      .filter(Boolean)
      .map((h) => h.toLowerCase());
  },
  trustedProxies(): string[] {
    const extra = (process.env.NEXTMON_TRUSTED_PROXIES ?? '').split(/[\s,;]+/).filter(Boolean);
    return ['127.0.0.0/8', '::1', ...extra];
  },
  sessionIdleMinutes(): number {
    const n = Number(process.env.NEXTMON_SESSION_IDLE_MIN ?? 480);
    return Number.isFinite(n) ? Math.max(0, Math.min(43200, Math.trunc(n))) : 480;
  },
  allowPrivateTargets(): boolean {
    return truthy(process.env.NEXTMON_ALLOW_PRIVATE_WEBHOOK);
  },
  secretFromEnv(): string {
    return (process.env.NEXTMON_SECRET ?? '').trim();
  },
  isProd(): boolean {
    return process.env.NODE_ENV === 'production';
  },
  scryptLog2N(): number {
    const n = Number(process.env.NEXTMON_SCRYPT_LOG2N ?? 16);
    return Number.isInteger(n) && n >= 10 && n <= 20 ? n : 16;
  },
};
