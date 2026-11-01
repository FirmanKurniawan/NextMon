/**
 * Router monitor (port of nextmon-php Monitor.php): poll (latency/uptime/CPU/RAM/active users), rolling history, alert rules with
 * debounce, stock/expiry checks and scheduled /export backups. Driven by the scheduler (features/scheduler) or "run now" in the UI.
 * Every function expects an ACTIVE workspace (Workspace.run) - all data goes through Store.
 */
import { Audit } from '../../lib/audit.ts';
import type { Driver, Row } from '../../lib/driver.ts';
import { Env } from '../../lib/env.ts';
import { I18n } from '../../lib/i18n.ts';
import type { TFn } from '../../lib/i18n.ts';
import { Notify } from '../../lib/notify.ts';
import { Routers } from '../../lib/routers.ts';
import type { RouterView } from '../../lib/routers.ts';
import { seconds, parseMeta } from '../../lib/scripts.ts';
import { getSettings, Store } from '../../lib/store.ts';
import { expiryOf } from '../../lib/voucher.ts';

export const HIST_MAX = 2100; // ~7 days at 5 min
export const CHANNELS = ['telegram', 'webhook'] as const;

export type Rules = {
  offline_after: number;
  recover_after: number;
  remind_min: number;
  cpu_high: number;
  cpu_samples: number;
  mem_high: number;
  mem_samples: number;
  stock_default: number;
  stock_per: Record<string, number>;
  expiring_hours: number;
  cooldown_min: number;
};
export type BackupCfg = { freq: 'off' | 'daily' | 'weekly'; at: string; dow: number; keep: number; binary: boolean };
export type Enabled = { offline: boolean; cpu: boolean; mem: boolean; stock: boolean; expiring: boolean; backup: boolean };
export type MonitorCfg = {
  poll_min: number;
  stock_min: number;
  ping_target: string;
  channels: string[];
  cron_token: string;
  sim_down: string[];
  enabled: Enabled;
  rules: Rules;
  backup: BackupCfg;
};
export type Point = { ts: number; ok: 0 | 1; lat?: number; net?: number | null; cpu?: number; mem?: number; up?: number; act?: number; info?: string; err?: string };
export type RState = {
  online: boolean;
  fails: number;
  goods: number;
  since: number;
  cpu_n: number;
  mem_n: number;
  alerts: Record<string, number>;
  last?: Point;
  last_check?: number;
  last_err?: string;
  first_fail?: number;
  down_since?: number;
  stock?: Record<string, number>;
  stock_ts?: number;
  expiring?: number;
};
export type AlertRow = { ts: number; router: string; name: string; rule: string; level: string; text: string; sent: boolean; result: string };
export type StoredBackup = { file: string; ts: number; size: number; text: string };

export const DEFAULTS: MonitorCfg = {
  poll_min: 5,
  stock_min: 30,
  ping_target: '1.1.1.1',
  channels: ['telegram', 'webhook'],
  cron_token: '',
  sim_down: [],
  enabled: { offline: true, cpu: true, mem: true, stock: true, expiring: true, backup: true },
  rules: { offline_after: 2, recover_after: 2, remind_min: 120, cpu_high: 85, cpu_samples: 3, mem_high: 90, mem_samples: 3, stock_default: 10, stock_per: {}, expiring_hours: 48, cooldown_min: 60 },
  backup: { freq: 'daily', at: '03:00', dow: 0, keep: 7, binary: false },
};

export const hex = (bytes = 16): string => Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(bytes))).toString('hex');

export function config(): MonitorCfg {
  const st = Store.read<Partial<MonitorCfg>>('monitor', {});
  return { ...DEFAULTS, ...st, enabled: { ...DEFAULTS.enabled, ...(st.enabled ?? {}) }, rules: { ...DEFAULTS.rules, ...(st.rules ?? {}) }, backup: { ...DEFAULTS.backup, ...(st.backup ?? {}) } };
}

export function saveConfig(patch: Partial<MonitorCfg>): void {
  Store.update<Partial<MonitorCfg>>('monitor', (cur) => ({ ...cur, ...patch }), {});
}

/** The workspace's cron token; created on first use. */
export function token(): string {
  const c = Store.read<Partial<MonitorCfg>>('monitor', {});
  if (c.cron_token) return c.cron_token;
  const tok = hex();
  saveConfig({ cron_token: tok });
  return tok;
}

// ---- helpers ------------------------------------------------------------------------------------------------

export const safe = (s: string): string => s.replace(/[^A-Za-z0-9_.-]/g, '_');
const tr = (): TFn => I18n.translator(getSettings().lang === 'en' ? 'en' : 'id');

export function fmtDur(s: number): string {
  if (s < 60) return `${s}s`;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${d ? d + 'd ' : ''}${h || d ? h + 'h ' : ''}${m}m`;
}

/** "12ms", "12ms345us", "345us", "1s20ms" => ms (null when it has no time). */
export function parseMs(v: string): number | null {
  const all = [...v.matchAll(/(\d+)(ms|us|s)/g)];
  if (!all.length) return null;
  const mul: Record<string, number> = { s: 1000, ms: 1, us: 0.001 };
  return all.reduce((t, m) => t + Number(m[1]) * mul[m[2]!]!, 0);
}

/** Routers this workspace owns (shared ones are polled by their owner). */
export const ownRouters = (): RouterView[] => Routers.list().filter((r) => !r.shared);
export const isDemo = (r: Pick<RouterView, 'type'>): boolean => Env.demoForced() || r.type === 'demo';

export const state = (): Record<string, RState> => Store.read<Record<string, RState>>('monitor-state', {});
function patchState(rid: string, s: RState): void {
  Store.update<Record<string, RState>>('monitor-state', (all) => ({ ...all, [rid]: s }), {});
}
export const history = (rid: string, since = 0): Point[] => {
  const h = Store.read<Point[]>('monitor-hist-' + safe(rid), []);
  return since > 0 ? h.filter((p) => p.ts >= since) : h;
};

/** Run a promise with a time limit. */
export function within<T>(p: Promise<T>, ms: number, what = 'timeout'): Promise<T> {
  let timer: NodeJS.Timeout;
  const t = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(what)), ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

// ---- alerts -------------------------------------------------------------------------------------------------

export async function alert(rid: string, rule: string, level: 'err' | 'warn' | 'ok' | 'info', text: string): Promise<void> {
  const c = config();
  const name = Routers.get(rid)?.name ?? rid;
  const prefix = { err: '[!] ', warn: '[!] ', ok: '[OK] ', info: '' }[level];
  const msg = `${prefix}NextMON - ${name}: ${text}`;
  let sent = false;
  let res = '-';
  if (c.channels.length) {
    const r = await Notify.send(msg, 'monitor:' + rule, c.channels.filter((x): x is 'telegram' | 'webhook' => x === 'telegram' || x === 'webhook'));
    sent = r.ok;
    res = r.msg;
  }
  Store.append('alerts.log', { ts: Math.floor(Date.now() / 1000), router: rid, name, rule, level, text, sent, result: res });
}
export const alertLog = (n = 200): AlertRow[] => Store.tail<AlertRow>('alerts.log', n);

function cool(st: RState, key: string, secs: number, now = Math.floor(Date.now() / 1000)): boolean {
  if (now - (st.alerts[key] ?? 0) < secs) return false;
  st.alerts[key] = now;
  return true;
}

// ---- poll ---------------------------------------------------------------------------------------------------

const PING_RE = /^[A-Za-z0-9.\-:]{1,100}$/;

/** Probe one router. */
export async function probe(cfg: RouterView, c: MonitorCfg): Promise<Point> {
  const ts = Math.floor(Date.now() / 1000);
  const t0 = Date.now();
  try {
    if (isDemo(cfg) && c.sim_down.includes(cfg.id)) throw new Error('Simulated outage (demo)');
    const r = Routers.driver(cfg.id);
    const res = (await within(r.print('/system/resource'), 15000))[0] ?? {};
    let lat = Date.now() - t0;
    if (r.demo) lat = Math.floor(11 + 6 * Math.abs(Math.sin(ts / 900)) + Math.random() * 10);
    const act = (await within(r.print('/ip/hotspot/active', {}, ['user']), 15000)).length;
    let net: number | null = null;
    if (c.ping_target !== '' && PING_RE.test(c.ping_target)) {
      try {
        const ms: number[] = [];
        for (const row of await within(r.command('/tool/ping', { address: c.ping_target, count: '2' }), 12000)) {
          const v = parseMs(row.time ?? '');
          if (v !== null) ms.push(v);
        }
        net = ms.length ? Math.round((ms.reduce((a, b) => a + b, 0) / ms.length) * 10) / 10 : null;
      } catch {
        net = null;
      }
    }
    const tot = Number(res['total-memory'] ?? 0);
    return {
      ts,
      ok: 1,
      lat,
      net,
      cpu: Math.trunc(Number(res['cpu-load'] ?? 0)),
      mem: tot > 0 ? Math.round((100 * (tot - Number(res['free-memory'] ?? 0))) / tot) : 0,
      up: seconds(res.uptime ?? ''),
      act,
      info: `${res['board-name'] ?? ''} ${res.version ?? ''}`.trim(),
    };
  } catch (e) {
    return { ts, ok: 0, err: String((e as Error).message).slice(0, 160) };
  }
}

/** Apply thresholds with debounce; returns the updated per-router state. */
export async function evaluate(rid: string, prev: Partial<RState>, p: Point, c: MonitorCfg): Promise<RState> {
  const t = tr();
  const R = c.rules;
  const E = c.enabled;
  const cd = Math.max(1, R.cooldown_min) * 60;
  const st: RState = { online: true, fails: 0, goods: 0, since: p.ts, cpu_n: 0, mem_n: 0, ...prev, alerts: { ...(prev.alerts ?? {}) } };
  st.last = p;
  st.last_check = p.ts;
  if (p.ok) {
    st.fails = 0;
    if (!st.online) {
      st.goods++;
      if (st.goods >= Math.max(1, R.recover_after)) {
        const down = st.down_since ? p.ts - st.down_since : 0;
        st.online = true;
        st.since = p.ts;
        delete st.down_since;
        delete st.alerts.offline;
        if (E.offline) await alert(rid, 'online', 'ok', t('Router is back online after :d.', { ':d': fmtDur(down) }));
      }
    }
    for (const [m, label] of [['cpu', 'CPU'], ['mem', 'RAM']] as const) {
      const limit = R[`${m}_high` as 'cpu_high' | 'mem_high'];
      const need = Math.max(1, R[`${m}_samples` as 'cpu_samples' | 'mem_samples']);
      const nk = `${m}_n` as 'cpu_n' | 'mem_n';
      const v = p[m] ?? 0;
      if (limit > 0 && v >= limit) {
        st[nk]++;
        if (E[m] && st[nk] >= need && cool(st, m, cd)) await alert(rid, m, 'warn', t(':l is high: :v% (threshold :t%).', { ':l': label, ':v': v, ':t': limit }));
      } else {
        if (st[nk] >= need && E[m]) await alert(rid, m, 'ok', t(':l back to normal: :v%.', { ':l': label, ':v': v }));
        st[nk] = 0;
        delete st.alerts[m];
      }
    }
  } else {
    st.goods = 0;
    st.fails++;
    st.last_err = p.err ?? '';
    if (st.fails === 1) st.first_fail = p.ts;
    if (st.online && st.fails >= Math.max(1, R.offline_after)) {
      st.online = false;
      st.down_since = st.first_fail ?? p.ts;
      st.alerts.offline = p.ts;
      if (E.offline) await alert(rid, 'offline', 'err', t('Router is unreachable (:n failed checks): :e', { ':n': st.fails, ':e': p.err ?? '' }));
    } else if (!st.online && E.offline && R.remind_min > 0 && cool(st, 'offline', R.remind_min * 60)) {
      await alert(rid, 'offline', 'err', t('Router still offline for :d.', { ':d': fmtDur(p.ts - (st.down_since ?? p.ts)) }));
    }
  }
  return st;
}

/** A demo router starts with a day of simulated history so the charts are not empty. */
function demoBackfill(cfg: RouterView): void {
  const key = 'monitor-hist-' + safe(cfg.id);
  if (!isDemo(cfg) || Store.read<Point[]>(key, []).length) return;
  const now = Math.floor(Date.now() / 1000);
  const pts: Point[] = [];
  const up0 = 86400 * 12 + 3600 * 5;
  let seed = 99;
  const rnd = (a: number, b: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return a + (seed % (b - a + 1));
  };
  for (let i = 287; i >= 1; i--) {
    const ts = now - i * 300;
    if (i >= 108 && i <= 111) {
      pts.push({ ts, ok: 0, err: 'connection timed out' }); // a short outage ~9 h ago
      continue;
    }
    const hour = new Date(ts * 1000).getHours();
    const busy = Math.max(0, Math.sin(((hour - 8) / 24) * 2 * Math.PI * 1.1));
    const spike = i % 61 === 0 ? rnd(40, 90) : 0;
    pts.push({
      ts,
      ok: 1,
      lat: Math.trunc(10 + 4 * busy + rnd(0, 8) + spike),
      net: Math.round((18 + 6 * busy + rnd(0, 90) / 10) * 10) / 10,
      cpu: Math.trunc(Math.min(97, 8 + 30 * busy + rnd(0, 9) + (i > 40 && i < 44 ? 70 : 0))),
      mem: Math.trunc(42 + 8 * busy + rnd(0, 4)),
      up: up0 - i * 300,
      act: Math.trunc(2 + 12 * busy + rnd(0, 3)),
      info: 'RB750Gr3 (demo)',
    });
  }
  Store.write(key, pts);
}

/** Job: poll every router. */
export async function jobPoll(): Promise<string> {
  const c = config();
  const routers = ownRouters();
  let bad = 0;
  for (const cfg of routers) {
    demoBackfill(cfg);
    const p = await probe(cfg, c);
    const st = await evaluate(cfg.id, state()[cfg.id] ?? {}, p, c);
    patchState(cfg.id, st);
    Store.update<Point[]>('monitor-hist-' + safe(cfg.id), (h) => [...h, p].slice(-HIST_MAX), []);
    if (!p.ok) bad++;
  }
  return tr()(':n routers polled, :b unreachable.', { ':n': routers.length, ':b': bad });
}

// ---- stock & expiring ---------------------------------------------------------------------------------------

/** Unused vouchers per profile (profiles created through NextMON/Mikhmon on-login only). */
export async function stockOf(r: Driver): Promise<Record<string, number>> {
  const [users, profiles] = await Promise.all([
    r.print('/ip/hotspot/user', {}, ['name', 'profile', 'uptime', 'disabled', 'limit-uptime', 'comment']),
    r.print('/ip/hotspot/user/profile', {}, ['name', 'on-login']),
  ]);
  const count: Record<string, number> = {};
  for (const p of profiles) {
    if (['default', 'default-encryption'].includes(p.name ?? '') || parseMeta(p['on-login'] ?? '') === null) continue;
    count[p.name ?? ''] = 0;
  }
  for (const u of users) {
    const pn = u.profile ?? '';
    if (pn in count && u.disabled !== 'true' && (u.uptime ?? '0s') === '0s' && (u['limit-uptime'] ?? '') !== '1s' && expiryOf(u.comment ?? '') === '') count[pn]!++;
  }
  return count;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** "jan/05/2026 10:00:00" (RouterOS comment expiry) => epoch seconds, or null. */
export function parseExpiry(e: string): number | null {
  const m = /^([A-Za-z]{3})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2})$/.exec(e);
  const mon = m ? MONTHS.indexOf(m[1]!.toLowerCase()) : -1;
  if (!m || mon < 0) return null;
  return Math.floor(new Date(Number(m[3]), mon, Number(m[2]), Number(m[4]), Number(m[5]), Number(m[6])).getTime() / 1000);
}

export async function expiringOf(r: Driver, hours: number): Promise<{ name: string; profile: string; ts: number }[]> {
  const now = Math.floor(Date.now() / 1000);
  const out: { name: string; profile: string; ts: number }[] = [];
  for (const u of await r.print('/ip/hotspot/user', {}, ['name', 'profile', 'comment', 'disabled', 'limit-uptime'])) {
    const e = expiryOf(u.comment ?? '');
    if (e === '' || u.disabled === 'true' || u['limit-uptime'] === '1s') continue;
    const ts = parseExpiry(e);
    if (ts !== null && ts > now && ts <= now + hours * 3600) out.push({ name: u.name ?? '', profile: u.profile ?? '', ts });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

export async function jobStock(): Promise<string> {
  const c = config();
  const R = c.rules;
  const t = tr();
  const msgs: string[] = [];
  for (const cfg of ownRouters()) {
    const rid = cfg.id;
    const prev = state()[rid];
    const st: RState = { ...{ online: true, fails: 0, goods: 0, since: 0, cpu_n: 0, mem_n: 0 }, ...(prev ?? {}), alerts: { ...(prev?.alerts ?? {}) } };
    if (prev && !prev.online) continue; // offline: the poll job already alerts
    let stock: Record<string, number>;
    let exp: Awaited<ReturnType<typeof expiringOf>>;
    try {
      const r = Routers.driver(rid);
      stock = await stockOf(r);
      exp = await expiringOf(r, R.expiring_hours);
    } catch (e) {
      msgs.push(`${cfg.name}: ${(e as Error).message}`);
      continue;
    }
    st.stock = stock;
    st.stock_ts = Math.floor(Date.now() / 1000);
    st.expiring = exp.length;
    let low = 0;
    for (const [prof, n] of Object.entries(stock)) {
      const min = R.stock_per[prof] ?? R.stock_default;
      const key = 'stock:' + prof;
      if (min > 0 && n < min) {
        low++;
        if (c.enabled.stock && cool(st, key, 86400)) await alert(rid, 'stock', 'warn', t('Low voucher stock for profile :p: :n left (minimum :m).', { ':p': prof, ':n': n, ':m': min }));
      } else delete st.alerts[key];
    }
    if (exp.length && c.enabled.expiring && cool(st, 'expiring', 12 * 3600)) {
      const names = exp.slice(0, 8).map((x) => x.name).join(', ');
      await alert(rid, 'expiring', 'info', t(':n users expire within :h hours: :l', { ':n': exp.length, ':h': R.expiring_hours, ':l': names + (exp.length > 8 ? ', ...' : '') }));
    }
    patchState(rid, st);
    msgs.push(`${cfg.name}: ${low} low, ${exp.length} expiring`);
  }
  return msgs.join('; ') || 'no routers';
}

// ---- backups ------------------------------------------------------------------------------------------------

/** Wall-clock parts of an instant in a time zone. */
export function tzParts(ts: number, tz: string): { sec: number; dow: number } {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(new Date(ts * 1000)).map((x) => [x.type, x.value]));
  return { sec: (Number(p.hour) % 24) * 3600 + Number(p.minute) * 60 + Number(p.second), dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(String(p.weekday)) };
}

/** Is a scheduled backup due? `last` = epoch of the previous run. */
export function backupDue(c: MonitorCfg, last: number, now: number, tz = 'UTC'): boolean {
  const b = c.backup;
  if (b.freq === 'off') return false;
  const m = /^(\d{1,2}):(\d\d)$/.exec(b.at) ?? /^(03):(00)$/.exec('03:00')!;
  const atSec = Number(m[1]) * 3600 + Number(m[2]) * 60;
  let slot = now - (tzParts(now, tz).sec - atSec);
  if (slot > now) slot -= 86400;
  if (b.freq === 'weekly') for (let i = 0; i < 7 && tzParts(slot, tz).dow !== b.dow; i++) slot -= 86400;
  return last < slot;
}

const bkDoc = (rid: string) => 'monitor-backups-' + safe(rid);

/** Stored export files of this workspace's routers, newest first. */
export function backups(): { router: string; name: string; file: string; size: number; ts: number }[] {
  const out: { router: string; name: string; file: string; size: number; ts: number }[] = [];
  for (const cfg of ownRouters()) for (const f of Store.read<StoredBackup[]>(bkDoc(cfg.id), [])) out.push({ router: cfg.id, name: cfg.name, file: f.file, size: f.size, ts: f.ts });
  return out.sort((a, b) => b.ts - a.ts || b.file.localeCompare(a.file));
}
export const backupText = (rid: string, file: string): string | null => Store.read<StoredBackup[]>(bkDoc(rid), []).find((f) => f.file === file)?.text ?? null;

const stamp = (d = new Date()): string => {
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
};
/** Join the text rows an /export returns over the API. */
export const exportText = (rows: Row[]): string => rows.map((r) => r.ret ?? Object.values(r).join(' ')).join('\n') + (rows.length ? '\n' : '');

export async function backupRouter(cfg: RouterView, c: MonitorCfg): Promise<string> {
  const b = c.backup;
  const keep = Math.max(1, b.keep);
  const r = Routers.driver(cfg.id);
  const st = stamp();
  const base = 'nextmon-auto-' + st;
  const ident = (await r.print('/system/identity'))[0]?.name ?? cfg.name;
  let txt = '';
  try {
    txt = exportText(await within(r.command('/export'), 45000));
  } catch {
    txt = '';
  }
  const where: string[] = [];
  if (txt.trim() !== '') {
    const file = `${safe(ident)}-${st}.rsc`;
    Store.update<StoredBackup[]>(bkDoc(cfg.id), (l) => [{ file, ts: Math.floor(Date.now() / 1000), size: Buffer.byteLength(txt), text: txt }, ...l.filter((x) => x.file !== file)].slice(0, keep), []);
    where.push(`local ${file} (${Buffer.byteLength(txt)} B)`);
  } else {
    await r.command('/export', { file: base });
    where.push(`router file ${base}.rsc (export text not available over API; fetch via FTP/SFTP)`);
  }
  if (b.binary) {
    await r.command('/system/backup/save', { name: base });
    where.push(`router file ${base}.backup`);
  }
  // rotate our own files on the router
  const mine = (await r.print('/file', {}, ['name'])).filter((x) => /^nextmon-auto-\d{8}-\d{6}\.(rsc|backup)$/.test(x.name ?? ''));
  for (const ext of ['rsc', 'backup']) {
    const sel = mine.filter((x) => (x.name ?? '').endsWith('.' + ext)).sort((a, z) => (z.name ?? '').localeCompare(a.name ?? ''));
    for (const old of sel.slice(keep)) {
      try {
        await r.remove('/file', old['.id']!);
      } catch {
        /* file may be gone */
      }
    }
  }
  return where.join('; ');
}

export async function jobBackup(): Promise<string> {
  const c = config();
  const t = tr();
  const msgs: string[] = [];
  for (const cfg of ownRouters()) {
    try {
      msgs.push(`${cfg.name}: ${await backupRouter(cfg, c)}`);
    } catch (e) {
      const m = (e as Error).message;
      msgs.push(`${cfg.name}: FAILED ${m}`);
      if (c.enabled.backup) await alert(cfg.id, 'backup', 'err', t('Scheduled backup failed: :e', { ':e': m }));
    }
  }
  return msgs.join('; ') || 'no routers';
}

export const JOBS = ['poll', 'stock', 'backup'] as const;
export type JobName = (typeof JOBS)[number];
export const runJob = (j: JobName): Promise<string> => (j === 'poll' ? jobPoll() : j === 'stock' ? jobStock() : jobBackup());

// ---- chart helpers ------------------------------------------------------------------------------------------

/** Thin the series to at most n buckets (average); a bucket with an outage keeps the first failed point. */
export function downsample(pts: Point[], n = 240): Point[] {
  if (pts.length <= n) return pts;
  const size = Math.ceil(pts.length / n);
  const out: Point[] = [];
  for (let i = 0; i < pts.length; i += size) {
    const chunk = pts.slice(i, i + size);
    const bad = chunk.find((p) => !p.ok);
    if (bad) {
      out.push(bad);
      continue;
    }
    const m: Point = { ts: chunk[Math.floor(chunk.length / 2)]!.ts, ok: 1 };
    for (const k of ['lat', 'net', 'cpu', 'mem', 'act', 'up'] as const) {
      const v = chunk.map((p) => p[k]).filter((z): z is number => typeof z === 'number');
      if (v.length) m[k] = v.reduce((a, b) => a + b, 0) / v.length;
    }
    out.push(m);
  }
  return out;
}

export function audit(action: string, detail = ''): void {
  Audit.log(action, detail);
}
