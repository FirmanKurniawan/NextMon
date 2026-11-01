/**
 * DemoDriver: in-memory mock of a MikroTik router with the same Driver contract as the real client (port of nextmon-php Demo.php).
 * State is persisted as a per-workspace document (`demo.<routerId>`), so changes survive restarts and are isolated per tenant.
 * Includes streaming (`/interface/monitor-traffic`, `/tool/torch`, `/log/print follow`) so the SSE traffic path works without a device.
 */
import { BaseDriver, normPath } from './driver.ts';
import type { Attrs, Row } from './driver.ts';
import { ensureNet, liveRand, mac as mkMac, netCommand, nid, seeded } from './demo-net.ts';
import type { DemoDb, Rng } from './demo-net.ts';
import { RouterOSError } from './routeros.ts';
import type { StreamHandle, StreamHandlers } from './routeros.ts';
import { onLogin } from './scripts.ts';
import { Sales } from './sales.ts';
import { singleton } from './singleton.ts';
import { Store } from './store.ts';
import { Workspace } from './workspace.ts';

const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number) => String(n).padStart(2, '0');

const cache = () => singleton('demoDbs', () => new Map<string, DemoDb>());

export class DemoDriver extends BaseDriver {
  readonly demo = true;
  private ws: string;
  private rid: string;
  private tz: string;
  private db: DemoDb;
  private timers = new Set<NodeJS.Timeout>();

  constructor(ws: string, routerId: string, tz = 'Asia/Jakarta') {
    super();
    this.ws = ws;
    this.rid = routerId;
    this.tz = tz;
    const k = `${ws}:${routerId}`;
    const c = cache();
    let db = c.get(k);
    let fresh = false;
    if (!db) {
      const stored = Workspace.run(ws, () => Store.read<DemoDb | null>('demo.' + routerId, null));
      if (stored && typeof stored.boot === 'number') db = stored;
      else {
        db = this.seed();
        fresh = true;
      }
      c.set(k, db);
    }
    this.db = db;
    if (ensureNet(this.db, (t) => this.dateTime(t)) || fresh) this.save();
  }

  /** Forget the persisted + cached state (reset a demo router). */
  static reset(ws: string, routerId: string): void {
    cache().delete(`${ws}:${routerId}`);
    Workspace.run(ws, () => Store.delete('demo.' + routerId));
  }

  private save(): void {
    Workspace.run(this.ws, () => Store.write('demo.' + this.rid, this.db));
  }

  private nid(): string {
    return nid(this.db);
  }

  private dateTime(ts: number): string {
    const p = Sales.zonedParts(ts, this.tz);
    return `${MON[p.mo - 1]}/${pad(p.d)}/${p.y} ${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`;
  }
  private dateOnly(ts: number): string {
    const p = Sales.zonedParts(ts, this.tz);
    return `${MON[p.mo - 1]}/${pad(p.d)}/${p.y}`;
  }

  private static boolStr(v: unknown): string {
    return ['yes', 'true', '1'].includes(String(v)) ? 'true' : 'false';
  }
  private static str(v: unknown): string {
    return v === true ? 'yes' : v === false ? 'no' : String(v);
  }

  // ---- Driver --------------------------------------------------------------------------------------

  async print(path: string, query: Attrs = {}, props: string[] = []): Promise<Row[]> {
    const p = normPath(path);
    switch (p) {
      case '/system/resource':
        return [this.resource()];
      case '/system/health': {
        const t = Date.now() / 1000;
        return [{ voltage: '24.1', temperature: String(38 + Math.trunc(4 * Math.sin(t / 90))), 'cpu-temperature': String(48 + Math.trunc(5 * Math.sin(t / 60))) }];
      }
      case '/system/identity':
        return [{ name: this.db.identity }];
      case '/system/clock': {
        const now = Math.floor(Date.now() / 1000);
        const pp = Sales.zonedParts(now, this.tz);
        return [{ date: this.dateOnly(now), time: `${pad(pp.h)}:${pad(pp.mi)}:${pad(pp.s)}`, 'time-zone-name': this.tz }];
      }
      case '/ip/hotspot/active':
        this.jitter();
        break;
      case '/log':
        this.db.t['/log'] = this.logs();
        break;
    }
    let rows = this.db.t[p] ?? [];
    for (const [k, v] of Object.entries(query)) rows = rows.filter((r) => String(r[k] ?? '') === String(v));
    rows = rows.map((r) => ({ ...r }));
    if (props.length) {
      const keep = new Set(['.id', ...props]);
      rows = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => keep.has(k))));
    }
    return rows;
  }

  async add(path: string, attrs: Attrs): Promise<string> {
    const p = normPath(path);
    const row: Row = { '.id': this.nid() };
    for (const [k, v] of Object.entries(attrs)) row[k] = DemoDriver.str(v);
    if (p === '/ip/hotspot/user') {
      for (const [k, v] of Object.entries({ uptime: '0s', 'bytes-in': '0', 'bytes-out': '0', disabled: 'false', 'limit-uptime': '', 'mac-address': '', comment: '', 'limit-bytes-total': '' })) row[k] ??= v;
    }
    if (['/queue/simple', '/ip/hotspot/ip-binding', '/ip/firewall/address-list'].includes(p)) {
      row.disabled ??= 'false';
      row.comment ??= '';
    }
    (this.db.t[p] ??= []).push(row);
    this.save();
    return row['.id']!;
  }

  async set(path: string, id: string, attrs: Attrs): Promise<void> {
    const p = normPath(path);
    const row = (this.db.t[p] ?? []).find((r) => r['.id'] === id || (id !== '' && r.name === id));
    if (!row) throw new RouterOSError('no such item');
    for (const [k, v] of Object.entries(attrs)) {
      const s = DemoDriver.str(v);
      row[k] = k === 'disabled' ? DemoDriver.boolStr(s) : s;
    }
    this.save();
  }

  async remove(path: string, id: string): Promise<void> {
    const p = normPath(path);
    const before = (this.db.t[p] ?? []).length;
    this.db.t[p] = (this.db.t[p] ?? []).filter((r) => r['.id'] !== id);
    if (before === this.db.t[p]!.length) throw new RouterOSError('no such item');
    this.save();
  }

  async command(path: string, attrs: Attrs = {}, query: Attrs = {}): Promise<Row[]> {
    const p = normPath(path);
    switch (p) {
      case '/interface/monitor-traffic':
        return [this.trafficRow(String(attrs.interface ?? 'ether1'))];
      case '/tool/ping': {
        const n = Math.max(1, Math.min(10, Number(attrs.count ?? 4) || 4));
        const rows: Row[] = [];
        let recv = 0;
        for (let i = 0; i < n; i++) {
          const lost = liveRand(0, 19) === 0;
          recv += lost ? 0 : 1;
          const row: Row = { seq: String(i), host: String(attrs.address ?? ''), sent: String(i + 1), received: String(recv), 'packet-loss': String(Math.trunc((100 * (i + 1 - recv)) / (i + 1))) };
          if (!lost) Object.assign(row, { size: '56', ttl: '58', time: liveRand(8, 34) + 'ms' });
          else row.status = 'timeout';
          rows.push(row);
        }
        return rows;
      }
      case '/tool/traceroute': {
        const rows: Row[] = [];
        let ms = 1;
        ['10.5.50.1', '36.80.0.1', '36.80.12.9', '180.240.190.5', '103.28.12.1', String(attrs.address ?? '8.8.8.8')].forEach((ip, i) => {
          ms += liveRand(2, 9);
          rows.push({ hop: String(i + 1), address: ip, loss: '0', sent: '3', last: ms + 'ms', avg: ms + '.2', best: ms - 1 + '.0', worst: ms + 2 + '.1' });
        });
        return rows;
      }
      case '/tool/torch':
        return this.torchRows();
      case '/system/backup/save': {
        await this.add('/file', { name: String(attrs.name ?? 'backup') + '.backup', type: 'backup', size: String(liveRand(90000, 220000)), 'creation-time': this.dateTime(Math.floor(Date.now() / 1000)) });
        return [];
      }
      case '/export': {
        await this.add('/file', { name: String(attrs.file ?? 'export') + '.rsc', type: 'script', size: '18342', 'creation-time': this.dateTime(Math.floor(Date.now() / 1000)), contents: '# demo export\n/ip hotspot user profile\nadd name=1Jam rate-limit=2M/2M\n' });
        return [{ ret: `# NEXTMON DEMO EXPORT ${new Date().toISOString()}\n/system identity set name=${this.db.identity}\n/ip hotspot user profile\nadd name=1Jam rate-limit=2M/2M shared-users=1\n` }];
      }
      case '/ip/hotspot/user/reset-counters': {
        for (const u of this.db.t['/ip/hotspot/user'] ?? []) {
          if (u['.id'] === attrs.numbers) Object.assign(u, { uptime: '0s', 'bytes-in': '0', 'bytes-out': '0' });
        }
        this.save();
        return [];
      }
    }
    const net = netCommand(this.db, p, attrs);
    if (net) {
      this.save();
      return net;
    }
    void query;
    return [];
  }

  /** Streaming commands, one sample per second. */
  stream(path: string, attrs: Attrs, h: StreamHandlers): StreamHandle {
    const p = normPath(path);
    let stopped = false;
    let resolveDone!: () => void;
    const done = new Promise<void>((r) => (resolveDone = r));
    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      this.timers.delete(timer);
      try {
        h.onEnd?.();
      } finally {
        resolveDone();
      }
    };
    let logSeq = 0;
    const tick = () => {
      if (stopped) return;
      try {
        if (p === '/interface/monitor-traffic') h.onRow(this.trafficRow(String(attrs.interface ?? 'ether1')));
        else if (p === '/tool/torch') for (const r of this.torchRows()) h.onRow(r);
        else if (p === '/log/print') h.onRow({ '.id': '*F' + logSeq++, time: new Date().toTimeString().slice(0, 8), topics: 'hotspot,account,info', message: 'demo log line ' + logSeq });
        else {
          stop();
          return;
        }
      } catch {
        /* subscriber error */
      }
    };
    const timer = setInterval(tick, 1000);
    timer.unref?.();
    this.timers.add(timer);
    queueMicrotask(tick); // first sample immediately
    return { done, cancel: async () => stop() };
  }

  override close(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers.clear();
  }

  // ---- generated data ------------------------------------------------------------------------------

  private trafficRow(iface: string): Row {
    const t = Date.now() / 1000;
    const base = iface === 'ether1' ? 6.0e6 : 3.0e6;
    const j = () => liveRand(-10, 10) / 100;
    return {
      name: iface,
      'rx-bits-per-second': String(Math.trunc(base * (1.2 + Math.sin(t / 7) * 0.5 + j()))),
      'tx-bits-per-second': String(Math.trunc(base * 0.4 * (1.2 + Math.cos(t / 9) * 0.5 + j()))),
    };
  }

  private torchRows(): Row[] {
    const dst = ['142.250.4.', '157.240.7.', '104.18.22.'];
    return (this.db.t['/ip/hotspot/active'] ?? []).slice(0, 7).map((a, i) => ({
      'src-address': a.address ?? '',
      'dst-address': dst[i % 3]! + liveRand(1, 250),
      'ip-protocol': 'tcp',
      tx: String(liveRand(20000, 900000)),
      rx: String(liveRand(100000, 4000000)),
    }));
  }

  private resource(): Row {
    const t = Date.now() / 1000;
    const up = Math.max(60, Math.floor(t - this.db.boot));
    const d = Math.floor(up / 86400);
    const hh = Math.floor((up % 86400) / 3600);
    const m = Math.floor((up % 3600) / 60);
    const total = 268435456;
    return {
      uptime: (d ? d + 'd' : '') + hh + 'h' + m + 'm',
      version: '6.49.13 (long-term)',
      'build-time': 'Feb/07/2025 08:21:40',
      'free-memory': String(Math.trunc(total * (0.55 + 0.05 * Math.sin(t / 120)))),
      'total-memory': String(total),
      cpu: 'MIPS 1004Kc V2.9',
      'cpu-count': '4',
      'cpu-frequency': '880',
      'cpu-load': String(Math.trunc(14 + 10 * Math.sin(t / 20) + liveRand(0, 6))),
      'free-hdd-space': '9437184',
      'total-hdd-space': '16777216',
      'architecture-name': 'mipsbe',
      'board-name': 'RB750Gr3 (demo)',
      platform: 'MikroTik',
    };
  }

  private jitter(): void {
    for (const a of this.db.t['/ip/hotspot/active'] ?? []) {
      a['bytes-in'] = String((Number(a['bytes-in']) || 0) + liveRand(1000, 90000));
      a['bytes-out'] = String((Number(a['bytes-out']) || 0) + liveRand(5000, 400000));
    }
  }

  private logs(): Row[] {
    const msgs = ['logged in', 'logged out: user request', 'trying to log in by mac-cookie', 'logged out: session timeout', 'login failed: invalid username or password'];
    const r = seeded(7);
    const users = this.db.t['/ip/hotspot/user'] ?? [];
    const now = Math.floor(Date.now() / 1000);
    const rows: Row[] = [];
    for (let i = 0; i < 60; i++) {
      const t = now - i * 137;
      const u = users[r(0, Math.max(0, users.length - 1))]?.name ?? 'guest';
      const pp = Sales.zonedParts(t, this.tz);
      rows.push({ '.id': '*L' + i, time: `${pad(pp.h)}:${pad(pp.mi)}:${pad(pp.s)}`, topics: 'hotspot,account,info,debug', message: `${u} (10.5.50.${r(10, 250)}): ${msgs[r(0, 4)]}` });
    }
    return rows.reverse();
  }

  private seed(): DemoDb {
    const r: Rng = seeded(42);
    const now = Math.floor(Date.now() / 1000);
    const db: DemoDb = { n: 0, boot: now - 86400 * 12 - 3600 * 5, identity: 'MikroTik-Demo', t: {} };
    const id = () => nid(db);
    const code = (len: number) => {
      const c = 'abcdefghjkmnpqrstuvwxyz23456789';
      let o = '';
      for (let i = 0; i < len; i++) o += c[r(0, c.length - 1)];
      return o;
    };
    const mac = () => mkMac(r);

    const profiles: [string, number, string, string][] = [['1Jam', 2000, '1h', '2M/2M'], ['3Jam', 4000, '3h', '3M/3M'], ['1Hari', 5000, '1d', '3M/3M'], ['7Hari', 25000, '7d', '5M/5M'], ['30Hari', 80000, '30d', '10M/10M']];
    db.t['/ip/hotspot/user/profile'] = [{ '.id': id(), name: 'default', 'shared-users': '1', 'rate-limit': '', 'on-login': '', default: 'true' }];
    for (const p of profiles) {
      db.t['/ip/hotspot/user/profile']!.push({ '.id': id(), name: p[0], 'shared-users': '1', 'rate-limit': p[3], 'on-login': onLogin('remc', String(p[1]), p[2], String(p[1]), true, false, p[0]), 'parent-queue': 'none', 'address-pool': 'dhcp_hotspot' });
    }

    db.t['/ip/hotspot/user'] = [];
    const used: string[] = [];
    const dayStr = (ts: number) => {
      const p = Sales.zonedParts(ts, this.tz);
      return `${pad(p.mo)}.${pad(p.d)}.${pad(p.y % 100)}`;
    };
    for (let i = 0; i < 42; i++) {
      const name = code(6);
      const pr = profiles[r(0, 4)]!;
      const batch = i < 20 ? 'batchA' : 'batchB';
      const isUsed = i % 3 === 0;
      db.t['/ip/hotspot/user']!.push({
        '.id': id(), name, password: i % 2 ? name : code(6), profile: pr[0],
        comment: (isUsed ? this.dateTime(now + 86400) + ' ' : '') + (i % 2 ? 'vc' : 'up') + '-' + r(100, 999) + '-' + dayStr(now) + '-' + batch,
        uptime: isUsed ? `${r(1, 3)}h${r(1, 59)}m` : '0s',
        'bytes-in': isUsed ? String(r(10000000, 900000000)) : '0', 'bytes-out': isUsed ? String(r(1000000, 90000000)) : '0',
        'limit-uptime': '', 'limit-bytes-total': '', 'mac-address': isUsed ? mac() : '', disabled: i === 7 ? 'true' : 'false',
      });
      if (isUsed) used.push(name);
    }

    db.t['/ip/hotspot/active'] = [];
    db.t['/ip/hotspot/host'] = [];
    used.slice(0, 9).forEach((u, i) => {
      const ip = '10.5.50.' + (20 + i);
      const m = mac();
      db.t['/ip/hotspot/active']!.push({
        '.id': id(), server: 'hotspot1', user: u, address: ip, 'mac-address': m, 'login-by': 'cookie,http-chap',
        uptime: `${r(1, 59)}m${r(1, 59)}s`, 'session-time-left': r(1, 20) + 'h', 'idle-time': r(0, 40) + 's',
        'bytes-in': String(r(1000000, 90000000)), 'bytes-out': String(r(100000, 9000000)),
      });
      db.t['/ip/hotspot/host']!.push({ '.id': id(), 'mac-address': m, address: ip, 'to-address': ip, server: 'hotspot1', authorized: 'true', bypassed: 'false', comment: '' });
    });
    for (let i = 0; i < 4; i++) {
      const ip = '10.5.50.' + (100 + i);
      db.t['/ip/hotspot/host']!.push({ '.id': id(), 'mac-address': mac(), address: ip, 'to-address': ip, server: 'hotspot1', authorized: 'false', bypassed: 'false', comment: '' });
    }
    db.t['/ip/hotspot/ip-binding'] = [
      { '.id': id(), 'mac-address': '', address: '10.5.50.2', 'to-address': '', server: 'all', type: 'bypassed', disabled: 'false', comment: 'Printer kasir' },
      { '.id': id(), 'mac-address': '', address: '10.5.50.3', 'to-address': '', server: 'all', type: 'bypassed', disabled: 'false', comment: 'CCTV' },
    ];

    // sales (Mikhmon format), 45 days
    db.t['/system/script'] = [];
    const today0 = Sales.zonedToTs(...(((p) => [p.y, p.mo, p.d] as const)(Sales.zonedParts(now, this.tz))), 0, 0, 0, this.tz);
    for (let d = 0; d < 45; d++) {
      const n = r(2, 9);
      for (let k = 0; k < n; k++) {
        const ts = today0 - d * 86400 + r(7 * 3600, 22 * 3600);
        if (ts > now) continue;
        const pr = profiles[r(0, 4)]!;
        const pp = Sales.zonedParts(ts, this.tz);
        db.t['/system/script']!.push({
          '.id': id(),
          name: Sales.recordName({ ts, user: code(6), price: pr[1], ip: '10.5.50.' + r(10, 250), mac: mac(), validity: pr[2], profile: pr[0], comment: 'vc-' + r(100, 999) + '-demo' }, this.tz),
          owner: `${MON[pp.mo - 1]}${pp.y}`, source: this.dateOnly(ts), comment: 'mikhmon',
        });
      }
    }

    db.t['/interface'] = [
      { '.id': id(), name: 'ether1', type: 'ether', running: 'true', disabled: 'false', 'mac-address': mac(), comment: 'WAN' },
      { '.id': id(), name: 'ether2', type: 'ether', running: 'true', disabled: 'false', 'mac-address': mac(), comment: 'LAN' },
      { '.id': id(), name: 'bridge-hotspot', type: 'bridge', running: 'true', disabled: 'false', 'mac-address': mac(), comment: '' },
      { '.id': id(), name: 'wlan1', type: 'wlan', running: 'true', disabled: 'false', 'mac-address': mac(), comment: 'AP' },
    ];
    db.t['/ip/hotspot'] = [{ '.id': id(), name: 'hotspot1', interface: 'bridge-hotspot', profile: 'hsprof1', disabled: 'false' }];
    db.t['/queue/simple'] = [
      { '.id': id(), name: 'Kasir', target: '10.5.50.2/32', 'max-limit': '10M/10M', bytes: '1203334/9903321', disabled: 'false', comment: '' },
      { '.id': id(), name: 'CCTV', target: '10.5.50.3/32', 'max-limit': '2M/2M', bytes: '90233/4403112', disabled: 'false', comment: '' },
      { '.id': id(), name: 'Guest-All', target: '10.5.50.0/24', 'max-limit': '40M/40M', bytes: '7203334/39903321', disabled: 'true', comment: 'Total limit' },
    ];
    db.t['/ip/firewall/address-list'] = [
      { '.id': id(), list: 'nextmon-block', address: '10.5.50.77', timeout: '', disabled: 'false', comment: 'torrent abuse' },
      { '.id': id(), list: 'nextmon-block', address: '10.5.50.91', timeout: '1d', disabled: 'false', comment: '' },
      { '.id': id(), list: 'trusted', address: '10.5.50.2', timeout: '', disabled: 'false', comment: 'kasir' },
    ];
    db.t['/ip/firewall/filter'] = [];
    db.t['/file'] = [{ '.id': id(), name: 'auto-backup.backup', type: 'backup', size: '143360', 'creation-time': this.dateTime(now - 86400 * 2) }];
    db.t['/log'] = [];
    db.t['/system/scheduler'] = [];
    return db;
  }
}
