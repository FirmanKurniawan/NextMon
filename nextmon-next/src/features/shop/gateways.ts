/**
 * Payment gateway adapters (port of nextmon-php Payment*.php): Manual, Mock, Midtrans, Tripay, Xendit.
 * Written from the public gateway docs. The webhook VERIFICATION is unit-tested against the documented formulas
 * (tests/unit/shop-signatures.test.ts); the live `create` calls have NEVER been run against the real services.
 * Every outbound call uses Http.request (SSRF guard + pinned connection).
 */
import crypto from 'node:crypto';
import { safeEqual } from '../../lib/crypto.ts';
import { GatewayError, Http } from './http.ts';

export { GatewayError };
/** Thrown by parseCallback when the signature/token is missing or wrong (the webhook is then rejected, nothing is applied). */
export class PaymentError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'PaymentError';
  }
}

export type GwField = { key: string; label: string; secret?: boolean; help?: string };
export type GwOrder = {
  id: string;
  token: string;
  amount: number;
  package: { id: string; label: string; profile: string };
  customer: { name?: string; phone?: string; email?: string };
};
export type CreateCtx = { return_url: string; callback_url: string; expiry_min: number; item_name: string; host: string; mock_url: string };
export type CreateResult = { ref: string; pay_url: string; info: string };
export type CbStatus = 'paid' | 'pending' | 'failed' | 'expired' | 'refunded';
export type CbEvent = { order_id: string; status: CbStatus; amount: number; ref: string };
export type GwCfg = Record<string, string> & { env: 'sandbox' | 'production' };
export type Hdrs = Record<string, string>;

export interface Gateway {
  id: string;
  /** English label (translate with t()) */
  label: string;
  fields: GwField[];
  hasWebhook: boolean;
  create(order: GwOrder, cfg: GwCfg, ctx: CreateCtx): Promise<CreateResult>;
  /** Cheap sniff: does this webhook look like it came from this gateway? (headers are lower-cased) */
  detect(headers: Hdrs, raw: string): boolean;
  /** Verify authenticity (signature/token) and normalise. Throws PaymentError. */
  parseCallback(headers: Hdrs, raw: string, cfg: GwCfg): CbEvent;
}

const hmacHex = (key: string, data: string) => crypto.createHmac('sha256', key).update(data).digest('hex');
const jsonObj = (raw: string): Record<string, unknown> | null => {
  try {
    const j = JSON.parse(raw);
    return j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const cut = (s: string, n: number) => Array.from(s).slice(0, n).join('');
const intOf = (v: unknown) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : 0;
};
const roundInt = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : 0;
};
const compact = <T extends Record<string, unknown>>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v != null)) as Partial<T>;
/** PHP date('Y-m-d H:i:s O') */
function phpDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${sign}${p(Math.floor(a / 60))}${p(a % 60)}`;
}

// ---- Manual ----------------------------------------------------------------------------------------

export const Manual: Gateway = {
  id: 'manual',
  label: 'Manual transfer (admin confirms)',
  fields: [],
  hasWebhook: false,
  async create(order, cfg) {
    return { ref: order.id, pay_url: '', info: str(cfg.instructions) };
  },
  detect: () => false,
  parseCallback() {
    throw new PaymentError('Manual gateway has no webhook');
  },
};

// ---- Mock (testing only: refuses production, otherwise it would hand out free vouchers) ----------------

export function mockSign(orderId: string, status: string, amount: number, ts: number, secret: string): string {
  return hmacHex(secret, `${orderId}|${status}|${amount}|${ts}`);
}

export const Mock: Gateway = {
  id: 'mock',
  label: 'Demo / mock (testing only)',
  fields: [],
  hasWebhook: true,
  async create(order, cfg, ctx) {
    if ((cfg.env ?? 'sandbox') !== 'sandbox') throw new PaymentError('The demo gateway only works in sandbox mode');
    return { ref: 'MOCK-' + order.id, pay_url: ctx.mock_url, info: '' };
  },
  detect(_h, raw) {
    return new URLSearchParams(raw).has('mock_sig');
  },
  parseCallback(_h, raw, cfg) {
    if ((cfg.env ?? 'sandbox') !== 'sandbox') throw new PaymentError('Mock gateway disabled in production');
    const f = new URLSearchParams(raw);
    const secret = str(cfg.secret);
    for (const k of ['order_id', 'status', 'amount', 'ts', 'mock_sig']) if (!f.has(k)) throw new PaymentError('Missing field ' + k);
    const amount = intOf(f.get('amount'));
    const ts = intOf(f.get('ts'));
    const want = mockSign(f.get('order_id')!, f.get('status')!, amount, ts, secret);
    if (secret === '' || !safeEqual(want, f.get('mock_sig')!.toLowerCase())) throw new PaymentError('Bad signature');
    if (Math.abs(Date.now() / 1000 - ts) > 900) throw new PaymentError('Stale callback (replay window 15 min)');
    const st = ({ paid: 'paid', failed: 'failed' } as Record<string, CbStatus>)[f.get('status')!];
    if (!st) throw new PaymentError('Unknown status');
    return { order_id: f.get('order_id')!, status: st, amount, ref: 'MOCK-' + f.get('order_id') };
  },
};

// ---- Midtrans Snap ---------------------------------------------------------------------------------
//  create : POST {app.sandbox.midtrans.com|app.midtrans.com}/snap/v1/transactions, HTTP Basic (server key as user)
//  notify : JSON, signature_key = SHA512(order_id + status_code + gross_amount + server_key)

export function midtransSignature(orderId: string, statusCode: string, grossAmount: string, serverKey: string): string {
  return crypto.createHash('sha512').update(orderId + statusCode + grossAmount + serverKey).digest('hex');
}

export const Midtrans: Gateway = {
  id: 'midtrans',
  label: 'Midtrans Snap',
  fields: [{ key: 'server_key', label: 'Server key', secret: true, help: 'SB-Mid-server-... (sandbox) / Mid-server-... (production)' }],
  hasWebhook: true,
  async create(order, cfg, ctx) {
    const key = str(cfg.server_key);
    if (key === '') throw new PaymentError('Midtrans server key is not set');
    const base = cfg.env === 'production' ? 'https://app.midtrans.com' : 'https://app.sandbox.midtrans.com';
    const c = order.customer;
    const payload = {
      transaction_details: { order_id: order.id, gross_amount: order.amount },
      item_details: [{ id: order.package.id, price: order.amount, quantity: 1, name: cut(ctx.item_name, 50) }],
      customer_details: compact({ first_name: cut(str(c.name), 50), email: str(c.email), phone: str(c.phone) }),
      expiry: { start_time: phpDate(), unit: 'minute', duration: ctx.expiry_min },
      callbacks: { finish: ctx.return_url },
    };
    const r = await Http.request('POST', base + '/snap/v1/transactions', { headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload), basicUser: key });
    const j = r.json;
    if (r.status < 200 || r.status >= 300 || !j || !j.redirect_url) {
      const em = Array.isArray(j?.error_messages) ? str((j!.error_messages as unknown[])[0]) : r.raw;
      throw new PaymentError(`Midtrans error HTTP ${r.status}: ${cut(em, 160)}`);
    }
    return { ref: str(j.token), pay_url: str(j.redirect_url), info: '' };
  },
  detect(_h, raw) {
    const j = jsonObj(raw);
    return !!j && 'signature_key' in j && 'order_id' in j && 'transaction_status' in j;
  },
  parseCallback(_h, raw, cfg) {
    const j = jsonObj(raw);
    if (!j) throw new PaymentError('Invalid JSON');
    for (const k of ['order_id', 'status_code', 'gross_amount', 'signature_key', 'transaction_status']) if (typeof j[k] !== 'string') throw new PaymentError('Missing field ' + k);
    const key = str(cfg.server_key);
    if (key === '' || !safeEqual(midtransSignature(j.order_id as string, j.status_code as string, j.gross_amount as string, key), (j.signature_key as string).toLowerCase())) {
      throw new PaymentError('Bad signature');
    }
    const ts = j.transaction_status as string;
    const fraud = j.fraud_status == null ? 'accept' : str(j.fraud_status);
    let st: CbStatus;
    if (ts === 'settlement' || (ts === 'capture' && fraud === 'accept')) st = 'paid';
    else if (['deny', 'cancel', 'failure'].includes(ts)) st = 'failed';
    else if (ts === 'expire') st = 'expired';
    else if (['refund', 'partial_refund', 'chargeback', 'partial_chargeback'].includes(ts)) st = 'refunded';
    else st = 'pending';
    return { order_id: j.order_id as string, status: st, amount: roundInt(j.gross_amount), ref: str(j.transaction_id) };
  },
};

// ---- Tripay (closed payment) -----------------------------------------------------------------------
//  create  : POST {tripay.co.id/api-sandbox|api}/transaction/create, Bearer api key,
//            signature = HMAC-SHA256(merchant_code + merchant_ref + amount, private_key)
//  webhook : header X-Callback-Signature = HMAC-SHA256(raw JSON body, private_key), X-Callback-Event: payment_status

export const tripayCreateSignature = (merchantCode: string, merchantRef: string, amount: number, privateKey: string) => hmacHex(privateKey, merchantCode + merchantRef + amount);
export const tripayCallbackSignature = (rawBody: string, privateKey: string) => hmacHex(privateKey, rawBody);

export const Tripay: Gateway = {
  id: 'tripay',
  label: 'Tripay',
  fields: [
    { key: 'merchant_code', label: 'Merchant code' },
    { key: 'api_key', label: 'API key', secret: true },
    { key: 'private_key', label: 'Private key', secret: true },
    { key: 'method', label: 'Payment channel code', help: 'e.g. QRIS, BRIVA, MYBVA (see your Tripay channel list)' },
  ],
  hasWebhook: true,
  async create(order, cfg, ctx) {
    for (const k of ['merchant_code', 'api_key', 'private_key', 'method']) if (str(cfg[k]) === '') throw new PaymentError('Tripay setting missing: ' + k);
    const base = cfg.env === 'production' ? 'https://tripay.co.id/api' : 'https://tripay.co.id/api-sandbox';
    const c = order.customer;
    const amount = order.amount;
    const payload: Record<string, string> = {
      method: cfg.method!,
      merchant_ref: order.id,
      amount: String(amount),
      customer_name: str(c.name) || 'Customer',
      customer_email: str(c.email) !== '' ? str(c.email) : 'noreply@' + (ctx.host.replace(/:\d+$/, '') || 'example.com'),
      customer_phone: str(c.phone),
      'order_items[0][name]': cut(ctx.item_name, 60),
      'order_items[0][price]': String(amount),
      'order_items[0][quantity]': '1',
      return_url: ctx.return_url,
      expired_time: String(Math.floor(Date.now() / 1000) + 60 * ctx.expiry_min),
      signature: tripayCreateSignature(cfg.merchant_code!, order.id, amount, cfg.private_key!),
    };
    const r = await Http.request('POST', base + '/transaction/create', {
      headers: { Authorization: 'Bearer ' + cfg.api_key, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(payload).toString(),
    });
    const d = (r.json?.data ?? null) as Record<string, unknown> | null;
    if (!r.json?.success || !d || !d.checkout_url) throw new PaymentError(`Tripay error HTTP ${r.status}: ${cut(str(r.json?.message ?? r.raw), 160)}`);
    return { ref: str(d.reference), pay_url: str(d.checkout_url), info: '' };
  },
  detect: (h) => 'x-callback-signature' in h,
  parseCallback(h, raw, cfg) {
    const key = str(cfg.private_key);
    const sig = str(h['x-callback-signature']).toLowerCase();
    if (key === '' || sig === '' || !safeEqual(tripayCallbackSignature(raw, key), sig)) throw new PaymentError('Bad signature');
    if (h['x-callback-event'] !== undefined && h['x-callback-event'] !== 'payment_status') throw new PaymentError('Unsupported event');
    const j = jsonObj(raw);
    if (!j || !j.merchant_ref || j.status === undefined) throw new PaymentError('Invalid payload');
    const map: Record<string, CbStatus> = { PAID: 'paid', UNPAID: 'pending', EXPIRED: 'expired', FAILED: 'failed', REFUND: 'refunded' };
    const st = map[str(j.status).toUpperCase()] ?? 'pending';
    // what the shop gets = total minus the fee the customer paid on top (UNVERIFIED against live Tripay)
    const amount = intOf(j.total_amount) - intOf(j.fee_customer);
    return { order_id: str(j.merchant_ref), status: st, amount, ref: str(j.reference) };
  },
};

// ---- Xendit Invoice --------------------------------------------------------------------------------
//  create  : POST https://api.xendit.co/v2/invoices, HTTP Basic (secret key as user)
//  webhook : header x-callback-token must equal the "Callback verification token" from the Xendit dashboard

export const xenditTokenValid = (headerToken: string, configured: string) => configured !== '' && headerToken !== '' && safeEqual(configured, headerToken);

export const Xendit: Gateway = {
  id: 'xendit',
  label: 'Xendit Invoice',
  fields: [
    { key: 'secret_key', label: 'Secret API key', secret: true },
    { key: 'callback_token', label: 'Callback verification token', secret: true },
  ],
  hasWebhook: true,
  async create(order, cfg, ctx) {
    const key = str(cfg.secret_key);
    if (key === '') throw new PaymentError('Xendit secret key is not set');
    const isProdKey = key.startsWith('xnd_production_');
    if ((cfg.env === 'production') !== isProdKey) throw new PaymentError('Xendit key does not match the selected environment');
    const c = order.customer;
    const cust = compact({ given_names: str(c.name), mobile_number: str(c.phone) });
    const payload = compact({
      external_id: order.id,
      amount: order.amount,
      currency: 'IDR',
      description: cut(ctx.item_name, 100),
      payer_email: str(c.email),
      invoice_duration: 60 * ctx.expiry_min,
      success_redirect_url: ctx.return_url,
      failure_redirect_url: ctx.return_url,
      ...(Object.keys(cust).length ? { customer: cust } : {}),
    });
    const r = await Http.request('POST', 'https://api.xendit.co/v2/invoices', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), basicUser: key });
    if (r.status < 200 || r.status >= 300 || !r.json?.invoice_url) throw new PaymentError(`Xendit error HTTP ${r.status}: ${cut(str(r.json?.message ?? r.raw), 160)}`);
    return { ref: str(r.json.id), pay_url: str(r.json.invoice_url), info: '' };
  },
  detect: (h) => 'x-callback-token' in h,
  parseCallback(h, raw, cfg) {
    if (!xenditTokenValid(str(h['x-callback-token']), str(cfg.callback_token))) throw new PaymentError('Bad callback token');
    const j = jsonObj(raw);
    if (!j || !j.external_id || j.status === undefined) throw new PaymentError('Invalid payload');
    const map: Record<string, CbStatus> = { PAID: 'paid', SETTLED: 'paid', PENDING: 'pending', EXPIRED: 'expired', FAILED: 'failed' };
    const st = map[str(j.status).toUpperCase()] ?? 'pending';
    return { order_id: str(j.external_id), status: st, amount: roundInt(j.amount), ref: str(j.id) };
  },
};

export const GATEWAYS: Record<string, Gateway> = { manual: Manual, mock: Mock, midtrans: Midtrans, tripay: Tripay, xendit: Xendit };
export const Payments = {
  get: (id: string): Gateway | null => (Object.hasOwn(GATEWAYS, id) ? GATEWAYS[id]! : null),
  all: (): Gateway[] => Object.values(GATEWAYS),
};
