'use server';
import { Crypto, randomHex } from '../../lib/crypto.ts';
import { audit, runAction } from '../../server/guard.ts';
import { withFlash } from '../_sales/flash-helpers.ts';
import { Shop } from './config.ts';
import type { Package } from './config.ts';
import { Payments } from './gateways.ts';

const cut = (s: string, n: number) => Array.from(s).slice(0, n).join('');
const str = (fd: FormData, k: string): string => {
  const v = fd.get(k);
  return typeof v === 'string' ? v : '';
};

/** Parse `pkg[N][field]` / `gw[id][field]` form keys into nested records. */
function nested(fd: FormData, root: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  const re = new RegExp(`^${root}\\[([A-Za-z0-9_-]{1,20})\\]\\[([A-Za-z0-9_]{1,30})\\]$`);
  for (const [k, v] of fd.entries()) {
    const m = re.exec(k);
    if (m && typeof v === 'string') (out[m[1]!] ??= {})[m[2]!] = v;
  }
  return out;
}

/** Save /shop/settings (admin). Secrets are stored encrypted; a blank secret keeps the saved one. Returns the URL to load next. */
export async function saveShopSettings(fd: FormData): Promise<{ to: string }> {
  return runAction({ cap: 'admin' }, fd, (ctx) => {
    const cur = Shop.config();
    const pk: Package[] = [];
    const rows = Object.entries(nested(fd, 'pkg'))
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([, r]) => r);
    for (const row of rows) {
      const profile = cut((row.profile ?? '').trim(), 60);
      const price = Number((row.price ?? '').replace(/\D/g, '')) || 0;
      if (profile === '' || price <= 0 || pk.length >= 12) continue;
      pk.push({
        id: /^p[a-f0-9]{6}$/.test(row.id ?? '') ? row.id! : 'p' + randomHex(3),
        profile,
        price: Math.min(price, 100_000_000),
        label: cut((row.label ?? '').trim(), 40),
        badge: cut((row.badge ?? '').trim(), 16),
        desc: cut((row.desc ?? '').trim(), 100),
        active: !!row.active,
      });
    }
    const env = str(fd, 'env') === 'production' ? 'production' : 'sandbox';
    let gateway = str(fd, 'gateway');
    let msg = ctx.t('Shop settings saved.');
    let kind: 'ok' | 'err' = 'ok';
    if (!Payments.get(gateway)) gateway = 'manual';
    if (gateway === 'mock' && env !== 'sandbox') {
      gateway = 'manual';
      msg = ctx.t('The demo gateway is only allowed in sandbox mode; gateway reset to manual transfer.');
      kind = 'err';
    }
    const gw: Record<string, Record<string, string>> = { ...cur.gw };
    const posted = nested(fd, 'gw');
    for (const g of Payments.all()) {
      for (const f of g.fields) {
        const v = (posted[g.id]?.[f.key] ?? '').trim();
        if (f.secret) {
          if (v !== '') gw[g.id] = { ...(gw[g.id] ?? {}), [f.key]: Crypto.encrypt(v) };
        } else gw[g.id] = { ...(gw[g.id] ?? {}), [f.key]: cut(v, 80) };
      }
    }
    const int = (k: string, d: number) => Math.trunc(Number(str(fd, k))) || d;
    Shop.save({
      enabled: str(fd, 'enabled') === '1',
      router: cut(str(fd, 'router'), 20),
      title: cut(str(fd, 'title'), 60),
      tagline: cut(str(fd, 'tagline'), 160),
      terms: cut(str(fd, 'terms').trim(), 3000),
      instructions: cut(str(fd, 'instructions').trim(), 1000),
      expiry_minutes: Math.max(5, Math.min(1440, int('expiry_minutes', 30))),
      gateway,
      env,
      require_phone: str(fd, 'require_phone') === '1',
      order_limit: Math.max(1, Math.min(50, int('order_limit', 5))),
      callback_ips: str(fd, 'callback_ips').replace(/[^0-9a-fA-F:./,;\s]/g, ''),
      packages: pk,
      gw,
    });
    audit(ctx, 'shop.settings', `gateway=${gateway} env=${env} packages=${pk.length}`);
    return { to: withFlash('/shop/settings', ctx.csrf, kind, msg) };
  });
}
