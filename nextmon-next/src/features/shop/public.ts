/**
 * Public (login-free) shop logic: tenant resolution, order creation, order page data, payment webhook, demo pay page.
 * No Next.js imports so route handlers, server actions and tests share it.
 *
 * Tenant rules (docs/MULTITENANT.md, public pages): the ONLY client-supplied selector is the workspace SLUG (`?w=slug`, default
 * slug `main`). `GET /shop/order` resolves the workspace from the order id and then checks the TOKEN; a wrong id/token yields a
 * neutral "not found" with no branding and no workspace data. `/pay/callback` uses `?w=slug` (the webhook URL we hand out),
 * falling back to the workspace encoded in the order id inside the payload; authenticity = the gateway signature.
 * Names, headers and cookies are never read to pick a workspace.
 */
import { createHash } from 'node:crypto';
import { Audit } from '../../lib/audit.ts';
import { Context } from '../../lib/context.ts';
import { safeEqual } from '../../lib/crypto.ts';
import { getSettings } from '../../lib/store.ts';
import { Workspace } from '../../lib/workspace.ts';
import { Reseller } from '../../lib/reseller.ts';
import { Orders } from '../orders/orders.ts';
import type { Order } from '../orders/orders.ts';
import { PaymentError, Payments } from './gateways.ts';
import type { Gateway, Hdrs } from './gateways.ts';
import { Shop } from './config.ts';
import type { ShopConfig } from './config.ts';
import { mockSign } from './gateways.ts';

export type Why = 'unknown' | 'suspended';
export type Resolved = { ws: string } | { why: Why };

/** Workspace of a slug (empty = `main`). Suspended and unknown workspaces are told apart (503 vs 404) but never reveal data. */
export function resolveSlug(ref: string | null | undefined): Resolved {
  const slug = String(ref ?? '').trim().toLowerCase();
  const w = Workspace.bySlug(slug === '' ? 'main' : slug);
  if (!w) return { why: 'unknown' };
  return w.status === 'suspended' ? { why: 'suspended' } : { ws: w.id };
}

export function resolveId(id: string | null): Resolved {
  if (!id) return { why: 'unknown' };
  const w = Workspace.get(id);
  if (!w) return { why: 'unknown' };
  return w.status === 'suspended' ? { why: 'suspended' } : { ws: w.id };
}

/** Run fn as workspace `ws` with the visitor's IP in the context (audit rows carry it). */
export function inWorkspace<T>(ws: string, ip: string, fn: () => T): T {
  return Workspace.run(ws, () => Context.run({ ip }, fn));
}

export const cap = (s: string, n: number): string => Array.from(s).slice(0, n).join('');

// ---- storefront -------------------------------------------------------------------------------------

export type Look = { lang: unknown; currency: string; tz: string; wq: string; slug: string };
export const look = (): Look => {
  const s = getSettings();
  const id = Workspace.id();
  return { lang: s.lang, currency: String(s.currency || 'Rp'), tz: String(s.timezone || 'UTC'), wq: Shop.wQuery(), slug: Workspace.get(id)?.slug ?? '' };
};

export type StoreView = { c: ShopConfig; title: string; packages: ReturnType<typeof Shop.activePackages>; ref: string } & Look;
/** `ref` = the referral code from the link when it names an active reseller of this workspace, else '' (echoed into the order form). */
export function storeView(ref = ''): StoreView {
  const c = Shop.config();
  return { c, title: Shop.title(c), packages: c.enabled ? Shop.activePackages(c) : [], ref: Reseller.byRef(ref)?.code ?? '', ...look() };
}

export type CreateInput = { name: string; phone: string; email: string; package: string; terms: string; website: string; ref?: string; ip: string; origin: string; host: string };
export type Old = { name: string; phone: string; email: string; package: string };
export type CreateOut = { ok: true; to: string } | { ok: false; error: string; old: Old };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?\d{8,15}$/;

/** POST /shop/order. `error` is an English message key (the caller translates it). Runs inside the shop's workspace. */
export async function createOrder(i: CreateInput): Promise<CreateOut> {
  const c = Shop.config();
  const home = Shop.homePath();
  const name = cap(i.name.replace(/\s+/g, ' ').trim(), 60);
  const phone = i.phone.replace(/[^0-9+]/g, '');
  const email = cap(i.email, 100);
  const old: Old = { name, phone, email, package: i.package };
  const fail = (error: string): CreateOut => ({ ok: false, error, old });
  if (!c.enabled) return fail('The shop is currently closed.');
  if (i.website !== '') return { ok: true, to: home }; // honeypot: humans never fill this
  if (Shop.hit('order', i.ip, Math.max(1, Math.trunc(c.order_limit)), 600)) return fail('Too many orders from your connection. Please wait a few minutes.');
  if (Orders.countPending() >= 300) return fail('The shop is busy right now. Please try again shortly.');
  const pkg = Shop.package(c, i.package);
  if (!pkg) return fail('Please choose a package.');
  if (Array.from(name).length < 2) return fail('Please enter your name.');
  if ((c.require_phone && !PHONE_RE.test(phone)) || (phone !== '' && !PHONE_RE.test(phone))) return fail('Please enter a valid phone number.');
  if (email !== '' && !EMAIL_RE.test(email)) return fail('The email address looks invalid.');
  if (c.terms.trim() !== '' && i.terms !== '1') return fail('Please accept the terms to continue.');
  const gw = Payments.get(c.gateway);
  const router = Shop.router(c);
  if (!gw || !router || (c.gateway === 'mock' && c.env !== 'sandbox')) return fail('The shop is not configured yet.');

  // Referral: attribution only. Unknown / inactive code = ignored silently. Commission needs a PAID, verified order total.
  const hit = Reseller.byRef(i.ref ?? '');
  let o = Orders.create(pkg, { name, phone, email }, c.gateway, Math.trunc(c.expiry_minutes), router.id, hit);
  try {
    const r = await gw.create(o, Shop.gwCfg(c, c.gateway), {
      return_url: i.origin + Shop.orderPath(o),
      callback_url: Shop.callbackUrl(i.origin, c.gateway),
      expiry_min: Math.trunc(c.expiry_minutes),
      item_name: `${Shop.title(c)} - ${o.package.label}`,
      host: i.host,
      mock_url: `${i.origin}/pay/callback?mock=${encodeURIComponent(o.id)}&t=${encodeURIComponent(o.token)}`,
    });
    o =
      (await Orders.update(o.id, (x) => {
        x.ref = r.ref;
        x.pay_url = r.pay_url;
        x.pay_info = r.info;
      })) ?? o;
  } catch (e) {
    console.error(`[nextmon-shop] create failed ${o.id}: ${(e as Error).message}`);
    await Orders.update(o.id, (x) => {
      x.status = 'failed';
      Orders.note(x, 'system', 'Gateway create failed: ' + (e as Error).message);
    });
    return fail('Could not start the payment. Please try again later.');
  }
  Audit.log('shop.order', `${o.id} ${o.package.label} ${o.amount} ${o.gateway}`);
  return { ok: true, to: Shop.orderPath(o, o.pay_url !== '' ? '&go=1' : '') };
}

// ---- order page -------------------------------------------------------------------------------------

export type OrderPage = { ws: string; c: ShopConfig; title: string; o: Order; view: ReturnType<typeof Orders.publicView>; gw: Gateway | null; routerSession: string } & Look;

/**
 * Order + token check. Anything wrong (bad id, unknown/suspended workspace, wrong token) returns null: the caller then renders
 * the neutral not-found page without touching any workspace data. Must be called OUTSIDE a workspace context; `fn` receives the
 * page data inside it (so it can render with t() etc.).
 */
export async function loadOrder(id: string, token: string, ip: string): Promise<OrderPage | null> {
  const ws = resolveId(Orders.workspaceOf(id));
  if (!('ws' in ws) || !Orders.valid(id)) return null;
  return inWorkspace(ws.ws, ip, async () => {
    let o = Orders.get(id);
    if (!o || !safeEqual(String(o.token), token)) return null;
    if (o.status === 'pending' && o.expires < Math.floor(Date.now() / 1000)) {
      o = await Orders.update(id, (x) => {
        if (x.status === 'pending' && x.expires < Math.floor(Date.now() / 1000)) x.status = 'expired';
      });
    }
    if (o && o.status === 'paid' && !o.voucher && Math.floor(Date.now() / 1000) - (o.retry_at ?? 0) > 15) o = (await Orders.retryFulfil(id)) ?? o;
    if (!o) return null;
    const c = Shop.config();
    const rv = Shop.routerOf(c, o.router);
    return {
      ws: ws.ws,
      c,
      title: Shop.title(c),
      o,
      view: Orders.publicView(o),
      gw: Payments.get(o.gateway),
      ...look(),
      routerSession: rv && !rv.shared ? rv.session || rv.id : '',
    };
  });
}

// ---- demo pay page ----------------------------------------------------------------------------------

export type MockPage = { ws: string; c: ShopConfig; title: string; o: Order; ts: number; sigPaid: string; sigFail: string } & Look;
export function loadMock(id: string, token: string, ip: string): MockPage | null {
  const r = resolveId(Orders.workspaceOf(id));
  if (!('ws' in r) || !Orders.valid(id)) return null;
  return inWorkspace(r.ws, ip, () => {
    const c = Shop.config();
    const o = Orders.get(id);
    if (!o || o.gateway !== 'mock' || c.env !== 'sandbox' || !safeEqual(String(o.token), token)) return null;
    const ts = Math.floor(Date.now() / 1000);
    const secret = Shop.mockSecret();
    return { ws: r.ws, c, title: Shop.title(c), o, ts, sigPaid: mockSign(o.id, 'paid', Math.trunc(o.amount), ts, secret), sigFail: mockSign(o.id, 'failed', Math.trunc(o.amount), ts, secret), ...look() };
  });
}

// ---- payment webhook --------------------------------------------------------------------------------

export type CallbackIn = { slug: string; mock: string; g: string; ip: string; headers: Hdrs; raw: string };
export type CallbackOut = { status: number; body: Record<string, unknown>; redirect?: string };

/** POST /pay/callback. Authenticity = the gateway signature/token (never a session; CSRF-exempt by design). */
export async function handleCallback(i: CallbackIn): Promise<CallbackOut> {
  const slugRes = i.slug.trim() !== '' ? resolveSlug(i.slug) : null;
  let res: Resolved;
  if (slugRes && ('ws' in slugRes || slugRes.why === 'suspended')) res = slugRes;
  else {
    // no (known) slug: the workspace encoded in the order id of the payload, else the default `main` when no slug was given
    const byOrder = Orders.workspaceOf(`${i.mock} ${i.raw}`);
    res = byOrder ? resolveId(byOrder) : i.slug.trim() === '' ? resolveSlug('') : { why: 'unknown' };
  }
  if (!('ws' in res)) return res.why === 'suspended' ? { status: 503, body: { ok: false, error: 'unavailable' } } : { status: 404, body: { ok: false, error: 'not found' } };

  return inWorkspace(res.ws, i.ip, async () => {
    const c = Shop.config();
    if (Shop.hit('callback', i.ip, 200, 600)) return { status: 429, body: { ok: false, error: 'rate limited' } };
    if (!Shop.ipAllowed(i.ip, c.callback_ips)) {
      Audit.log('shop.callback.ip_denied', i.ip);
      return { status: 403, body: { ok: false, error: 'forbidden' } };
    }
    let gw: Gateway | null = null;
    if (i.g !== '') gw = Payments.get(i.g);
    else gw = Payments.all().find((g) => g.hasWebhook && g.id !== 'mock' && g.detect(i.headers, i.raw)) ?? null;
    if (!gw || !gw.hasWebhook) return { status: 400, body: { ok: false, error: 'unknown gateway' } };
    let ev;
    try {
      ev = gw.parseCallback(i.headers, i.raw, Shop.gwCfg(c, gw.id));
    } catch (e) {
      if (!(e instanceof PaymentError)) throw e;
      Audit.log('shop.callback.reject', `${gw.id}: ${e.message}`);
      return { status: 403, body: { ok: false, error: 'invalid' } };
    }
    const o = Orders.get(ev.order_id);
    if (!o) return { status: 404, body: { ok: false, error: 'order not found' } };
    const fp = createHash('sha256').update(`${gw.id}|${i.raw}`).digest('hex');
    const [ok, message] = await Orders.applyEvent(o.id, ev, fp, gw.id);
    if (gw.id === 'mock' && new URLSearchParams(i.raw).has('mock_ui')) return { status: 303, body: { ok, message }, redirect: Shop.orderPath(o) };
    return { status: 200, body: { ok, message } };
  });
}

/** Read-only token check that yields the shop title (page <title>); null when anything is off. No side effects. */
export function peekTitle(id: string, token: string, ip: string): string | null {
  const ws = resolveId(Orders.workspaceOf(id));
  if (!('ws' in ws) || !Orders.valid(id)) return null;
  return inWorkspace(ws.ws, ip, () => {
    const o = Orders.get(id);
    return o && safeEqual(String(o.token), token) ? Shop.title(Shop.config()) : null;
  });
}
