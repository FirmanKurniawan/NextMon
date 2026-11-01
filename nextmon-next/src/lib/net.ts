/**
 * Network trust helpers: client IP (X-Forwarded-For only from trusted proxies), HTTPS detection, Host validation, fixed-window
 * rate limiting, and the SSRF guard for outbound requests to user-supplied URLs.
 *
 * The TCP peer address is injected by src/instrumentation.ts as the request header `x-nextmon-peer` (ALWAYS overwritten, a client
 * can not set it). If it is missing we do not guess: the peer is "unknown" and forwarded headers are ignored.
 */
import dns from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { Env } from './env.ts';
import { Store } from './store.ts';

export const PEER_HEADER = 'x-nextmon-peer';

type H = Headers | Record<string, string | string[] | undefined>;
function header(h: H, name: string): string {
  if (typeof (h as Headers).get === 'function') return (h as Headers).get(name) ?? '';
  const v = (h as Record<string, string | string[] | undefined>)[name];
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

function norm(ip: string): string {
  const s = ip.trim().replace(/^\[|\]$/g, '');
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(s); // IPv4-mapped IPv6 -> IPv4
  return m ? m[1]! : s;
}

function ruleList(rules: string[]): BlockList {
  const bl = new BlockList();
  for (const r of rules) {
    const [addr, bits] = r.split('/');
    const a = norm(addr ?? '');
    const fam = isIP(a);
    if (!fam) continue;
    try {
      if (bits !== undefined) bl.addSubnet(a, Number(bits), fam === 6 ? 'ipv6' : 'ipv4');
      else bl.addAddress(a, fam === 6 ? 'ipv6' : 'ipv4');
    } catch {
      /* ignore bad rule */
    }
  }
  return bl;
}

export const Net = {
  isTrusted(ip: string, rules: string[] = Env.trustedProxies()): boolean {
    const a = norm(ip);
    const fam = isIP(a);
    return !!fam && ruleList(rules).check(a, fam === 6 ? 'ipv6' : 'ipv4');
  },

  peer(h: H): string {
    return norm(header(h, PEER_HEADER)) || 'unknown';
  },

  fromTrustedProxy(h: H): boolean {
    const p = Net.peer(h);
    return p !== 'unknown' && Net.isTrusted(p);
  },

  /** The client IP used for rate limits and audit rows. */
  clientIp(h: H): string {
    const peer = Net.peer(h);
    if (!Net.fromTrustedProxy(h)) return peer;
    const xff = header(h, 'x-forwarded-for');
    if (!xff) return peer;
    // walk from the right (closest hop), skip our own proxies; the first foreign address is the client
    for (const raw of xff.split(',').map((x) => norm(x)).reverse()) {
      if (!isIP(raw)) return peer; // garbage in the chain: do not guess
      if (!Net.isTrusted(raw)) return raw;
    }
    return peer;
  },

  isHttps(h: H): boolean {
    const base = Env.baseUrl();
    if (base) return base.protocol === 'https:';
    return Net.fromTrustedProxy(h) && header(h, 'x-forwarded-proto').split(',')[0]?.trim().toLowerCase() === 'https';
  },

  /** Is the Host header acceptable? (Host-header injection guard.) */
  hostAllowed(host: string): boolean {
    if (!host || !/^([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(:\d{1,5})?$/.test(host)) return false;
    const base = Env.baseUrl();
    if (!base) return true;
    const h = host.toLowerCase();
    return h === base.host.toLowerCase() || Env.allowedHosts().includes(h);
  },

  /** Does the Origin of a state-changing request match this site? */
  originAllowed(origin: string | null, host: string): boolean {
    if (!origin) return true; // same-origin navigations/fetches without Origin (older browsers); SameSite=Lax cookies still apply
    let o: URL;
    try {
      o = new URL(origin);
    } catch {
      return false;
    }
    const base = Env.baseUrl();
    const ok = [host.toLowerCase(), ...(base ? [base.host.toLowerCase()] : []), ...Env.allowedHosts()];
    return ok.includes(o.host.toLowerCase());
  },

  // ---- rate limiting -------------------------------------------------------------------------------

  /**
   * Fixed-window counter in global doc `rate_limits`. Every call counts as one attempt; returns true when OVER the limit.
   * Expired and surplus entries are pruned so the document cannot grow without bound.
   */
  hit(bucket: string, id: string, max: number, windowSec: number): boolean {
    let over = false;
    type E = { n: number; t: number; w: number };
    Store.global('rate_limits').update<Record<string, E>>((a) => {
      const now = Math.floor(Date.now() / 1000);
      for (const k of Object.keys(a)) if (now - (a[k]!.t ?? 0) > (a[k]!.w ?? 0)) delete a[k];
      const keys = Object.keys(a);
      if (keys.length > 5000) {
        keys.sort((x, y) => (a[x]!.t ?? 0) - (a[y]!.t ?? 0));
        for (const k of keys.slice(0, keys.length - 2500)) delete a[k];
      }
      const k = `${bucket}|${id.slice(0, 80)}`;
      const e = a[k] ?? { n: 0, t: now, w: windowSec };
      e.n++;
      over = e.n > max;
      a[k] = e;
      return a;
    }, {});
    return over;
  },

  // ---- SSRF guard ------------------------------------------------------------------------------------

  /** True when `ip` is a globally routable unicast address (not loopback / private / link-local / CGNAT / reserved / multicast). */
  isPublicIp(ip: string): boolean {
    const a = norm(ip);
    const fam = isIP(a);
    if (!fam) return false;
    if (fam === 6 && /^(0*:)*ffff:/i.test(a)) return false; // any remaining IPv4-mapped form (hex): never public
    return !BLOCKED.check(a, fam === 6 ? 'ipv6' : 'ipv4');
  },

  /**
   * Validate a user-supplied http(s) URL for server-side requests (webhooks, payment callbacks...).
   * Resolves the host and rejects non-public targets; returns the vetted addresses so the caller can PIN the connection to one
   * of them (defeats DNS rebinding). Returns { ok:true, url, addresses } or { ok:false, error }.
   */
  async checkOutboundUrl(url: string): Promise<{ ok: true; url: URL; addresses: string[] } | { ok: false; error: string }> {
    if (url.length > 500 || /[\x00-\x20\x7f\\]/.test(url)) return { ok: false, error: 'invalid URL' };
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return { ok: false, error: 'invalid URL' };
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'only http(s) URLs are allowed' };
    if (u.username || u.password) return { ok: false, error: 'credentials in the URL are not allowed' };
    const host = u.hostname.replace(/^\[|\]$/g, '');
    let addrs: string[];
    if (isIP(host)) addrs = [host];
    else {
      try {
        addrs = (await dns.lookup(host, { all: true })).map((r) => r.address);
      } catch {
        return { ok: false, error: 'host does not resolve' };
      }
    }
    if (!addrs.length) return { ok: false, error: 'host does not resolve' };
    if (!Env.allowPrivateTargets() && addrs.some((x) => !Net.isPublicIp(x))) {
      return { ok: false, error: 'target address is not public (internal addresses are blocked; set NEXTMON_ALLOW_PRIVATE_WEBHOOK=1 to allow)' };
    }
    return { ok: true, url: u, addresses: addrs };
  },
};

const BLOCKED = (() => {
  const bl = new BlockList();
  const v4: [string, number][] = [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
    ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
    ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
  ];
  for (const [a, b] of v4) bl.addSubnet(a, b, 'ipv4');
  const v6: [string, number][] = [
    ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8], ['2001:db8::', 32], ['64:ff9b::', 96], ['100::', 64],
  ];
  for (const [a, b] of v6) bl.addSubnet(a, b, 'ipv6');
  return bl;
})();
