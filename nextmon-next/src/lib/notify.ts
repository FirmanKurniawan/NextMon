/**
 * Telegram bot + generic webhook notifications (per workspace). Failures never break the request that triggered them.
 * The bot token is stored encrypted (Crypto, takes part in `rekey` via features/notifications/secrets.ts). The webhook URL is
 * user supplied, so it goes through the SSRF guard (Net.checkOutboundUrl) and the connection is PINNED to the vetted address
 * (defeats DNS rebinding); redirects are never followed. Events: sale | voucher | router | login.
 */
import http from 'node:http';
import https from 'node:https';
import { Crypto } from './crypto.ts';
import { Net } from './net.ts';
import { getSettings, saveSettings, Store } from './store.ts';
import { Workspace } from './workspace.ts';

export const EVENTS = ['sale', 'voucher', 'router', 'login'] as const;
export type NotifyEvent = (typeof EVENTS)[number];

export type Telegram = { enabled?: boolean; token?: string; chat_id?: string; events?: string[] };
export type LogRow = { ts: number; event: string; text: string; result: string; ok: boolean };

const TIMEOUT_MS = 5000;
const MAX_BODY = 64 * 1024;

/** POST JSON; `pin` = the vetted IP to connect to (the URL host is still used for Host/SNI). Resolves { ok, msg }, never throws. */
export function postJson(url: string, payload: unknown, pin?: string): Promise<{ ok: boolean; msg: string }> {
  return new Promise((resolve) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return resolve({ ok: false, msg: 'invalid URL' });
    }
    const body = JSON.stringify(payload);
    const lib = u.protocol === 'https:' ? https : http;
    const family = pin && pin.includes(':') ? 6 : 4;
    const req = lib.request(
      u,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'user-agent': 'NextMON' },
        timeout: TIMEOUT_MS,
        ...(pin
          ? {
              lookup: ((_h: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) =>
                opts?.all ? cb(null, [{ address: pin, family }]) : cb(null, pin, family)) as never,
            }
          : {}),
      },
      (res) => {
        let n = 0;
        res.on('data', (c: Buffer) => {
          n += c.length;
          if (n > MAX_BODY) res.destroy();
        });
        res.on('error', () => undefined);
        res.on('close', () => {
          const code = res.statusCode ?? 0;
          resolve({ ok: code >= 200 && code < 300, msg: 'HTTP ' + code });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e: Error & { code?: string }) => resolve({ ok: false, msg: e.code || e.message || 'request failed' }));
    req.end(body);
  });
}

const cfg = () => {
  const s = getSettings();
  return { tg: (s.telegram ?? {}) as Telegram, hook: String(s.webhook_url ?? '') };
};

export const Notify = {
  config: cfg,

  log(n = 30): LogRow[] {
    return Store.tail<LogRow>('notify.log', n);
  },

  /**
   * Save the channels. A blank token keeps the stored one. A webhook URL that fails the SSRF guard is dropped and reported in `note`.
   */
  async save(input: { enabled: boolean; token: string; chat_id: string; webhook_url: string; events: string[] }): Promise<{ note: string }> {
    const old = cfg().tg;
    let hook = input.webhook_url.trim().slice(0, 500);
    let note = '';
    if (hook !== '' && /^https?:\/\//i.test(hook)) {
      const chk = await Net.checkOutboundUrl(hook);
      if (!chk.ok) {
        note = chk.error;
        hook = '';
      }
    } else hook = '';
    saveSettings({
      telegram: {
        enabled: input.enabled,
        token: input.token !== '' ? Crypto.encrypt(input.token) : (old.token ?? ''),
        chat_id: input.chat_id.trim().slice(0, 40),
        events: input.events.filter((e): e is NotifyEvent => (EVENTS as readonly string[]).includes(e)),
      },
      webhook_url: hook,
    });
    return { note };
  },

  /** Send only if the event type is subscribed and a channel is on. Fire-and-forget: never throws. */
  event(event: NotifyEvent, text: string): void {
    if (!Workspace.idOrNull()) return; // no tenant in scope: nobody to notify
    const { tg, hook } = cfg();
    if (!(tg.events ?? []).includes(event) || (!tg.enabled && hook === '')) return;
    void Notify.send(text, event).catch(() => undefined);
  },

  /** Send to the configured channels (optionally only some). Returns the combined outcome and writes the delivery log. */
  async send(text: string, event = 'test', only?: ('telegram' | 'webhook')[]): Promise<{ ok: boolean; msg: string }> {
    Workspace.id(); // fail closed: channels and log are per workspace
    const { tg, hook } = cfg();
    const results: string[] = [];
    let ok = false;
    if ((!only || only.includes('telegram')) && tg.enabled && tg.token && tg.chat_id) {
      const token = Crypto.decrypt(tg.token);
      if (token !== '') {
        const r = await postJson(`https://api.telegram.org/bot${token}/sendMessage`, { chat_id: tg.chat_id, text });
        results.push('telegram: ' + (r.ok ? 'ok' : r.msg.split(token).join('***')));
        ok = ok || r.ok;
      }
    }
    if ((!only || only.includes('webhook')) && hook !== '' && /^https?:\/\//i.test(hook)) {
      const chk = await Net.checkOutboundUrl(hook);
      const r = chk.ok ? await postJson(hook, { event, text, ts: Math.floor(Date.now() / 1000), app: 'nextmon' }, chk.addresses[0]) : { ok: false, msg: 'blocked: ' + chk.error };
      results.push('webhook: ' + (r.ok ? 'ok' : r.msg));
      ok = ok || r.ok;
    }
    if (!results.length) results.push('no channel configured');
    const msg = results.join('; ');
    Store.append('notify.log', { ts: Math.floor(Date.now() / 1000), event, text: text.slice(0, 300), result: msg, ok });
    return { ok, msg };
  },
};
