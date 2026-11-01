/**
 * Shop configuration (per-workspace document `shop`), package lookup, callback IP allow-list, public link helpers.
 * Port of nextmon-php Shop.php. Gateway secrets are stored AES-GCM encrypted (Crypto) and registered for key rotation in secrets.ts.
 * No Next.js imports here: the order/fulfilment code and the CLI share this module.
 */
import { BlockList, isIP } from 'node:net';
import { Crypto, randomHex } from '../../lib/crypto.ts';
import { Env } from '../../lib/env.ts';
import { Net } from '../../lib/net.ts';
import { Routers } from '../../lib/routers.ts';
import type { RouterView } from '../../lib/routers.ts';
import { getSettings, Store } from '../../lib/store.ts';
import { Workspace } from '../../lib/workspace.ts';
import { Payments } from './gateways.ts';
import type { GwCfg } from './gateways.ts';

export type Package = { id: string; profile: string; price: number; label: string; badge: string; desc: string; active: boolean };
export type ShopConfig = {
  enabled: boolean;
  router: string;
  title: string;
  tagline: string;
  terms: string;
  instructions: string;
  expiry_minutes: number;
  gateway: string;
  env: 'sandbox' | 'production';
  require_phone: boolean;
  order_limit: number;
  callback_ips: string;
  packages: Package[];
  /** gateway id -> field key -> value (secret fields are encrypted) */
  gw: Record<string, Record<string, string>>;
  mock_secret: string;
};

export const SHOP_DEFAULTS: ShopConfig = {
  enabled: false,
  router: '',
  title: '',
  tagline: '',
  terms: '',
  instructions: '',
  expiry_minutes: 30,
  gateway: 'manual',
  env: 'sandbox',
  require_phone: true,
  order_limit: 5,
  callback_ips: '',
  packages: [],
  gw: {},
  mock_secret: '',
};

const normIp = (ip: string) => {
  const s = ip.trim().replace(/^\[|\]$/g, '');
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(s);
  return (m ? m[1]! : s).toLowerCase();
};

export const Shop = {
  config(): ShopConfig {
    const c = { ...SHOP_DEFAULTS, ...Store.read<Partial<ShopConfig>>('shop', {}) } as ShopConfig;
    c.packages = Array.isArray(c.packages) ? c.packages : [];
    c.gw = c.gw && typeof c.gw === 'object' ? c.gw : {};
    return c;
  },

  save(patch: Partial<ShopConfig>): void {
    Store.update<Partial<ShopConfig>>('shop', (cur) => ({ ...cur, ...patch }), {});
  },

  title(c: ShopConfig): string {
    return c.title !== '' ? c.title : String(getSettings().hotspot_name || 'NextMON WiFi');
  },

  /** Active package by id, or null. Price/profile ALWAYS come from here, never from the request. */
  package(c: ShopConfig, id: string): Package | null {
    return c.packages.find((p) => p.id === id && p.active && Number(p.price) > 0 && (p.profile ?? '') !== '') ?? null;
  },

  activePackages(c: ShopConfig): Package[] {
    return c.packages.filter((p) => p.active && Number(p.price) > 0 && (p.profile ?? '') !== '');
  },

  /** Decrypted credentials of one gateway + env (+ mock secret / manual instructions). */
  gwCfg(c: ShopConfig, id: string): GwCfg {
    const out: Record<string, string> = { env: c.env === 'production' ? 'production' : 'sandbox' };
    const g = Payments.get(id);
    if (g) {
      for (const f of g.fields) {
        const v = String(c.gw[id]?.[f.key] ?? '');
        out[f.key] = f.secret ? Crypto.decrypt(v) : v;
      }
    }
    if (id === 'mock') out.secret = Shop.mockSecret();
    if (id === 'manual') out.instructions = c.instructions;
    return out as GwCfg;
  },

  /** Per-install secret of the demo gateway (created on first use, stored encrypted). */
  mockSecret(): string {
    let s = Crypto.decrypt(String(Store.read<Partial<ShopConfig>>('shop', {}).mock_secret ?? ''));
    if (s === '') {
      // atomic: two racing first calls must end with ONE secret
      Store.update<Partial<ShopConfig>>(
        'shop',
        (cur) => {
          const have = Crypto.decrypt(String(cur.mock_secret ?? ''));
          s = have || randomHex(24);
          return have ? cur : { ...cur, mock_secret: Crypto.encrypt(s) };
        },
        {},
      );
    }
    return s;
  },

  /** Router used for new vouchers: the configured one when visible and writable, else the first writable one. */
  router(c: ShopConfig): RouterView | null {
    const all = Routers.list().filter((r) => !r.shared || r.mode === 'rw');
    return all.find((r) => r.id === c.router) ?? all[0] ?? null;
  },

  /** Router of an order (it must still be visible to the workspace), else the shop's router. */
  routerOf(c: ShopConfig, routerId: string): RouterView | null {
    return Routers.list().find((r) => r.id === routerId) ?? Shop.router(c);
  },

  // ---- public links (the workspace is identified by its SLUG; `main` keeps the old slug-less links) -------------------

  wQuery(sep = '?'): string {
    const ws = Workspace.idOrNull();
    if (!ws) return '';
    const slug = Workspace.get(ws)?.slug ?? '';
    return slug === '' || slug === 'main' ? '' : `${sep}w=${encodeURIComponent(slug)}`;
  },

  homePath(): string {
    return '/shop' + Shop.wQuery();
  },

  /** Public origin: pinned NEXTMON_BASE_URL, else the (already validated) Host header. */
  origin(h: Headers): string {
    const base = Env.baseUrl();
    if (base) return base.origin;
    const host = (Net.fromTrustedProxy(h) ? h.get('x-forwarded-host')?.split(',')[0]?.trim() : '') || h.get('host') || 'localhost';
    return `${Net.isHttps(h) ? 'https' : 'http'}://${host}`;
  },

  /** The webhook URL carries the workspace slug (the order id inside the payload carries the workspace too, as a fallback). */
  callbackUrl(origin: string, gw = ''): string {
    const q = (gw !== '' ? '?g=' + encodeURIComponent(gw) : '') + Shop.wQuery(gw !== '' ? '&' : '?');
    return origin + '/pay/callback' + q;
  },

  orderPath(o: { id: string; token: string }, extra = ''): string {
    return `/shop/order?id=${encodeURIComponent(o.id)}&t=${encodeURIComponent(o.token)}${extra}`;
  },

  // ---- limits ------------------------------------------------------------------------------------------------------

  /** Counts one attempt; returns true when OVER the limit (bucket is per workspace + key). */
  hit(bucket: string, key: string, max: number, windowSec: number): boolean {
    return Net.hit('shop-' + bucket, `${Workspace.idOrNull() ?? '-'}|${key}`, max, windowSec);
  },

  /** Is `ip` inside the allow-list (IPv4, IPv4/CIDR or IPv6[/bits] separated by whitespace, comma or semicolon)? Empty list = allow all. */
  ipAllowed(ip: string, list: string): boolean {
    const items = list.trim().split(/[\s,;]+/).filter(Boolean);
    if (!items.length) return true;
    return items.some((it) => Shop.ipMatch(ip, it));
  },

  ipMatch(ip: string, rule: string): boolean {
    const a = normIp(ip);
    if (!rule.includes('/')) return a === normIp(rule);
    const [net, bitsRaw] = rule.split('/', 2) as [string, string];
    const n = normIp(net);
    const fa = isIP(a);
    const fn = isIP(n);
    if (!fa || !fn || fa !== fn) return false;
    const max = fa === 6 ? 128 : 32;
    const bits = Math.max(0, Math.min(max, Math.trunc(Number(bitsRaw)) || 0));
    const bl = new BlockList();
    bl.addSubnet(n, bits, fa === 6 ? 'ipv6' : 'ipv4');
    return bl.check(a, fa === 6 ? 'ipv6' : 'ipv4');
  },
};
