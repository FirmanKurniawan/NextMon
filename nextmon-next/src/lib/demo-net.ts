/**
 * Demo data + commands for the network module (PPPoE, DHCP, ARP, walled garden, services, users, NTP). Port of nextmon-php DemoNet.php.
 * Tables are added lazily to existing demo databases.
 */
import { RouterOSError } from './routeros.ts';
import type { Attrs, Row } from './driver.ts';

export type DemoDb = { n: number; boot: number; identity: string; t: Record<string, Row[]> };
export type Rng = (a: number, b: number) => number;

const TABLES = [
  '/ppp/profile', '/ppp/secret', '/ppp/active', '/ip/dhcp-server/lease', '/ip/arp', '/ip/hotspot/walled-garden',
  '/ip/hotspot/walled-garden/ip', '/system/ntp/client', '/user/group', '/user', '/ip/service', '/certificate',
];

export function nid(db: DemoDb): string {
  db.n++;
  return '*' + db.n.toString(16).toUpperCase();
}

/** Seeded Park-Miller style PRNG returning mt_rand-like inclusive ranges (deterministic seed data). */
export function seeded(seed: number): Rng {
  let s = seed >>> 0 || 1;
  return (a, b) => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return a + Math.floor(r * (b - a + 1));
  };
}
export const liveRand: Rng = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

export function mac(r: Rng): string {
  const m: string[] = [];
  for (let i = 0; i < 6; i++) m.push(r(0, 255).toString(16).toUpperCase().padStart(2, '0'));
  m[0] = '02';
  return m.join(':');
}

/** "nov/01/2026 10:00:00" style (lowercase month) in the given zone. */
export type DateFmt = (ts: number) => string;

const md5ish = (s: string) => {
  // tiny deterministic 8-hex tag (PHP used substr(md5(...),0,8)); not security relevant (demo passwords)
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
};

/** @returns true when something was added (caller saves) */
export function ensureNet(db: DemoDb, dateFmt: DateFmt, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!db.t) return false;
  let changed = false;
  if (!db.t['/ip/hotspot/profile']) {
    db.t['/ip/hotspot/profile'] = [{ '.id': nid(db), name: 'hsprof1', 'hotspot-address': '10.5.50.1', 'html-directory': 'hotspot', 'login-by': 'cookie,http-chap,http-pap', 'use-radius': 'false' }];
    changed = true;
  }
  if (!TABLES.some((t) => !db.t[t])) return changed;
  const r = seeded(4242);
  const T = db.t;

  T['/ppp/profile'] = [];
  for (const p of [['default', '', '', ''], ['default-encryption', '', '', ''], ['pppoe-5M', '10.20.0.1', 'pppoe-pool', '5M/5M'], ['pppoe-10M', '10.20.0.1', 'pppoe-pool', '10M/10M'], ['pppoe-20M', '10.20.0.1', 'pppoe-pool', '20M/20M']] as const) {
    T['/ppp/profile']!.push({ '.id': nid(db), name: p[0], 'local-address': p[1], 'remote-address': p[2], 'rate-limit': p[3], 'only-one': p[0] === 'default' ? 'default' : 'yes', default: ['default', 'default-encryption'].includes(p[0]) ? 'true' : 'false' });
  }
  const names = ['budi.santoso', 'siti.rahma', 'agus.wijaya', 'dewi.lestari', 'rudi.hartono', 'ani.suryani', 'joko.susilo', 'rina.marlina', 'eko.prasetyo', 'sri.wahyuni', 'bambang.s', 'lilis.k', 'hendra.g', 'yanti.p', 'tono.w', 'maya.s', 'andi.f', 'nur.aini', 'dedi.k', 'fitri.h', 'rizal.m', 'wati.s'];
  const profs = ['pppoe-5M', 'pppoe-10M', 'pppoe-20M'];
  T['/ppp/secret'] = [];
  T['/ppp/active'] = [];
  names.forEach((n, i) => {
    const m = mac(r);
    const dis = i === 6 || i === 15;
    T['/ppp/secret']!.push({
      '.id': nid(db), name: n, password: md5ish(n + 'x'), service: 'pppoe', profile: profs[i % 3]!, 'caller-id': '', 'local-address': '',
      'remote-address': i % 7 === 0 ? '10.20.1.' + (10 + i) : '', disabled: dis ? 'true' : 'false',
      comment: (i % 4 === 0 ? 'Blok ' + String.fromCharCode(65 + (i % 5)) + ' no.' + (3 + i) : '') + (dis ? ' (nunggak)' : ''),
      'last-logged-out': dateFmt(nowSec - r(3600, 86400 * 5)),
    });
    if (!dis && i % 3 !== 2) {
      T['/ppp/active']!.push({
        '.id': nid(db), name: n, service: 'pppoe', 'caller-id': m, address: '10.20.0.' + (10 + i),
        uptime: `${r(0, 6)}d${r(0, 23)}h${r(0, 59)}m`, encoding: 'MPPE128 stateless', 'session-id': '0x81' + r(0, 16777215).toString(16).toUpperCase().padStart(6, '0'), radius: 'false',
      });
    }
  });

  T['/ip/dhcp-server/lease'] = [];
  const hosts = ['android-3f9a', 'iPhone-Budi', 'DESKTOP-K2L9', 'Galaxy-A14', 'OPPO-A57', 'redmi-note-11', 'laptop-kasir', 'cctv-dvr', 'printer-epson', 'iPad-Siti', 'HUAWEI-P30', 'realme-8', 'vivo-y21', 'TV-LG', 'android-91bc', ''];
  const statics: Record<string, string> = { 'printer-epson': 'Printer kasir', 'cctv-dvr': 'CCTV', 'laptop-kasir': 'Laptop kasir' };
  hosts.forEach((h, i) => {
    const st = h in statics;
    const ip = '10.5.50.' + (st ? 2 + ['printer-epson', 'cctv-dvr', 'laptop-kasir'].indexOf(h) : 120 + i);
    T['/ip/dhcp-server/lease']!.push({
      '.id': nid(db), address: ip, 'mac-address': mac(r), 'client-id': '', server: 'dhcp-hotspot', 'host-name': h,
      status: i % 7 === 6 ? 'waiting' : 'bound', dynamic: st ? 'false' : 'true', disabled: 'false', blocked: 'false',
      'expires-after': i % 7 === 6 ? '' : `${r(0, 9)}h${r(1, 59)}m${r(1, 59)}s`, 'last-seen': r(1, 50) + 'm', comment: st ? statics[h]! : '',
    });
  });

  T['/ip/arp'] = [];
  for (const l of T['/ip/dhcp-server/lease']!) {
    if (l.status === 'waiting') continue;
    T['/ip/arp']!.push({ '.id': nid(db), address: l.address!, 'mac-address': l['mac-address']!, interface: 'bridge-hotspot', dynamic: l.dynamic!, complete: 'true', disabled: 'false', published: 'false', invalid: 'false', comment: l.comment! });
  }
  T['/ip/arp']!.push({ '.id': nid(db), address: '36.80.0.1', 'mac-address': mac(r), interface: 'ether1', dynamic: 'true', complete: 'true', disabled: 'false', published: 'false', invalid: 'false', comment: 'gateway ISP' });
  T['/ip/arp']!.push({ '.id': nid(db), address: '10.5.50.250', 'mac-address': mac(r), interface: 'bridge-hotspot', dynamic: 'false', complete: 'true', disabled: 'false', published: 'false', invalid: 'false', comment: 'AP lantai 2' });

  T['/ip/hotspot/walled-garden'] = [];
  [['captive.apple.com', 'captive portal iOS'], ['connectivitycheck.gstatic.com', 'captive portal Android'], ['*.midtrans.com', 'nextmon'], ['*.xendit.co', 'nextmon'], ['nextmon.example.com', 'nextmon'], ['*.whatsapp.net', 'WA tanpa login']].forEach((w, i) => {
    T['/ip/hotspot/walled-garden']!.push({ '.id': nid(db), 'dst-host': w[0]!, action: 'allow', server: '', dynamic: 'false', disabled: i === 5 ? 'true' : 'false', comment: w[1]! });
  });
  T['/ip/hotspot/walled-garden/ip'] = [
    { '.id': nid(db), 'dst-address': '10.5.50.1', protocol: 'tcp', 'dst-port': '8080', action: 'accept', server: '', dynamic: 'false', disabled: 'false', comment: 'Server NextMON' },
    { '.id': nid(db), 'dst-address': '8.8.8.8', protocol: 'udp', 'dst-port': '53', action: 'accept', server: '', dynamic: 'false', disabled: 'false', comment: 'DNS publik' },
  ];

  T['/system/ntp/client'] = [{ enabled: 'true', mode: 'unicast', servers: 'id.pool.ntp.org', 'primary-ntp': '103.31.249.1', 'secondary-ntp': '', status: 'synchronized' }];
  T['/user/group'] = [
    { '.id': nid(db), name: 'read', policy: 'local,telnet,ssh,read,test,winbox,password,web,sniff,sensitive,api,romon,rest-api' },
    { '.id': nid(db), name: 'write', policy: 'local,telnet,ssh,read,write,test,winbox,password,web,sniff,sensitive,api,romon,rest-api' },
    { '.id': nid(db), name: 'full', policy: 'local,telnet,ssh,ftp,reboot,read,write,policy,test,winbox,password,web,sniff,sensitive,api,romon,rest-api' },
  ];
  T['/user'] = [{ '.id': nid(db), name: 'admin', group: 'full', address: '', 'last-logged-in': dateFmt(nowSec - 7200), disabled: 'false', comment: 'system default user' }];
  T['/ip/service'] = [];
  for (const s of [['telnet', 23, 'true'], ['ftp', 21, 'false'], ['www', 80, 'false'], ['ssh', 22, 'false'], ['www-ssl', 443, 'true'], ['api', 8728, 'false'], ['winbox', 8291, 'false'], ['api-ssl', 8729, 'true']] as const) {
    T['/ip/service']!.push({ '.id': nid(db), name: s[0], port: String(s[1]), address: '', certificate: '', disabled: s[2], invalid: 'false' });
  }
  T['/certificate'] = [];
  T['/system/scheduler'] ??= [];
  return true;
}

/** Extra commands. Returns null when the path is not handled here. */
export function netCommand(db: DemoDb, p: string, attrs: Attrs): Row[] | null {
  switch (p) {
    case '/ip/dhcp-server/lease/make-static': {
      const id = String(attrs['.id'] ?? attrs.numbers ?? '');
      const l = db.t['/ip/dhcp-server/lease']?.find((x) => x['.id'] === id);
      if (!l) throw new RouterOSError('no such item');
      l.dynamic = 'false';
      return [];
    }
    case '/system/ntp/client/set': {
      const cur = (db.t['/system/ntp/client'] ??= [{}])[0]!;
      for (const [k, v] of Object.entries(attrs)) cur[k] = v === true ? 'yes' : String(v);
      if (attrs.enabled === 'yes' || attrs.enabled === true) {
        cur.enabled = 'true';
        cur.status = 'synchronized';
      }
      return [];
    }
    case '/system/clock/set':
    case '/system/script/run':
      return [];
    case '/certificate/sign': {
      for (const c of db.t['/certificate'] ?? []) {
        if (c.name === (attrs.number ?? attrs['.id']) || c['.id'] === attrs['.id']) {
          c.trusted = 'true';
          c['private-key'] = 'true';
        }
      }
      return [];
    }
  }
  return null;
}
