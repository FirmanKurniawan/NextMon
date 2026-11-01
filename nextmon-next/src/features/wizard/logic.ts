/**
 * Router setup wizard (port of nextmon-php WizardController). Every step builds a list of "ops" (label + the equivalent RouterOS CLI
 * + an optional apply function). Preview only lists them; apply runs them, logs each one and stops at the first hard failure.
 * Live-router behaviour is as unverified as in the PHP edition (only the demo driver and a fake server are exercised by tests).
 * All router access goes through the Driver passed in (ctx.driver()). Call inside the workspace context (ctx.run).
 */
import { Audit } from '../../lib/audit.ts';
import { Context } from '../../lib/context.ts';
import { Crypto } from '../../lib/crypto.ts';
import type { Driver } from '../../lib/driver.ts';
import { RouterOSError } from '../../lib/driver.ts';
import { Routers } from '../../lib/routers.ts';
import type { TFn } from '../../lib/i18n.ts';
import { Scripts } from '../../lib/scripts.ts';
import { Store } from '../../lib/store.ts';
import { Voucher } from '../../lib/voucher.ts';
import { isTrue } from '../_netkit/util.ts';
import { TEMPLATE_DIR_NAME, templateDir, templateFiles } from './template.ts';
import { UserError } from '../routers/util.ts';

export const STEPS = ['check', 'user', 'services', 'scripts', 'walled', 'ntp', 'template'] as const;
export type Step = (typeof STEPS)[number];
export const isStep = (s: string): s is Step => (STEPS as readonly string[]).includes(s);

export type Status = 'ok' | 'warn' | 'err' | 'plan' | 'skip';
export type Params = {
  server_ip: string;
  level: string;
  api_user: string;
  ssl: string;
  portal: string;
  ntp_servers: string;
  tz: string;
  mode: string;
  lock_user: string;
  html_dir: string;
  hs_profile: string;
};
export type OpRow = { label: string; cli: string; detail: string; status: Status; msg: string };
export type WizardOut = { router: string; step: Step; mode: 'preview' | 'apply'; rows: OpRow[] };
export type Cred = { router: string; user: string; pass: string; ts: number };
export type LogRow = { ts: number; router: string; step: string; label: string; cli: string; status: string; msg: string; user: string };

type Op = {
  label: string;
  cli: string;
  fn: ((d: Driver) => Promise<[Status, string] | string | void>) | null;
  ack: string | null;
  note: string;
  stop: boolean;
  detail: string;
};

// ---- per-user state (replaces the PHP session): last params, last output, generated credential ----------------------

type State = { params?: Record<string, Partial<Params>>; out?: Record<string, WizardOut>; cred?: Record<string, Cred> };
const doc = () => Store.read<State>('wizard', {});
const CRED_TTL = 3600;

const uid = () => Context.current().actor?.id ?? '-';

export function savedParams(): Partial<Params> {
  return doc().params?.[uid()] ?? {};
}
export function savedOut(router: string): WizardOut | null {
  const o = doc().out?.[uid()];
  return o && o.router === router ? o : null;
}
export function savedCred(router: string): { user: string } | null {
  const c = doc().cred?.[uid()];
  return c && c.router === router && Date.now() / 1000 - c.ts < CRED_TTL ? { user: c.user } : null;
}
const put = (k: keyof State, v: unknown) =>
  Store.update<State>('wizard', (cur) => ({ ...cur, [k]: { ...((cur[k] as object) ?? {}), [uid()]: v } }), {});

export function logRows(router: string): LogRow[] {
  return Store.tail<LogRow>('wizard.log', 200).filter((l) => l.router === router);
}

// ---- parameters ------------------------------------------------------------------------------------------------------

export const defaults = (portal = ''): Params => ({
  server_ip: '',
  level: 'op',
  api_user: 'nextmon',
  ssl: '',
  portal,
  ntp_servers: 'id.pool.ntp.org',
  tz: 'Asia/Jakarta',
  mode: 'remc',
  lock_user: '1',
  html_dir: TEMPLATE_DIR_NAME,
  hs_profile: '',
});

export const pageParams = (portal: string): Params => ({ ...defaults(portal), ...savedParams() });

const val = (fd: FormData, k: string, def: string) => {
  const v = fd.get(k);
  return typeof v === 'string' ? v.trim() : def;
};

/** Validate the posted wizard parameters (blank keeps the saved value, like PHP). Throws UserError. */
export function readParams(fd: FormData, portal = ''): Params {
  const d = pageParams(portal);
  const g = (k: keyof Params) => val(fd, k, d[k]);
  const p: Params = {
    server_ip: g('server_ip'),
    level: g('level'),
    api_user: g('api_user'),
    ssl: val(fd, 'ssl', ''),
    portal: g('portal').toLowerCase(),
    ntp_servers: g('ntp_servers'),
    tz: g('tz'),
    mode: val(fd, 'ol_mode', d.mode),
    lock_user: val(fd, 'lock_user', ''),
    html_dir: g('html_dir'),
    hs_profile: g('hs_profile'),
  };
  if (p.server_ip !== '' && !/^[0-9A-Fa-f:.]{2,45}(\/\d{1,3})?$/.test(p.server_ip)) throw new UserError('Server address must be an IP or CIDR, for example 192.168.88.10 or 192.168.88.0/24.');
  if (!['op', 'ro'].includes(p.level) || !/^[A-Za-z0-9_.-]{1,32}$/.test(p.api_user)) throw new UserError('Check the API user name (letters, digits, - _ .).');
  if (p.portal !== '' && !/^[a-z0-9.\-*]{1,100}$/.test(p.portal)) throw new UserError('Enter a valid host name (wildcards * and ? allowed).');
  if (!/^[A-Za-z0-9.-]+(,[A-Za-z0-9.-]+)*$/.test(p.ntp_servers) || (p.tz !== '' && !/^[A-Za-z_]+(\/[A-Za-z_\-+0-9]+){0,2}$/.test(p.tz))) throw new UserError('Check the NTP servers and time zone.');
  if (!(Scripts.MODES as readonly string[]).includes(p.mode) || !/^[A-Za-z0-9_\-/]{1,40}$/.test(p.html_dir) || (p.hs_profile !== '' && !/^[\w.\- ]{1,40}$/.test(p.hs_profile))) {
    throw new UserError('Check the on-login mode and the template folder name.');
  }
  return p;
}

/** Hide secrets before anything goes to the log. */
export const mask = (s: string): string => s.replace(/(password=)("[^"]*"|\S+)/gi, '$1"***"');

// ---- CLI builders ----------------------------------------------------------------------------------------------------

const q = (v: string): string => (/^[\w./:,\-*@]+$/.test(v) ? v : '"' + v.replace(/[\\"$]/g, (c) => '\\' + c) + '"');

export function cli(path: string, verb: string, a: Record<string, string> = {}, find = ''): string {
  let s = path.replace(/\//g, ' ').trim() + ' ' + verb;
  if (find !== '') s += ` [find ${find}]`;
  for (const [k, v] of Object.entries(a)) s += ` ${k}=${q(v)}`;
  return '/' + s;
}

const op = (label: string, cliText: string, fn: Op['fn'], ack: string | null = null, note = '', stop = true, detail = ''): Op => ({ label, cli: cliText, fn, ack, note, stop, detail });

async function idOf(d: Driver, path: string, name: string): Promise<string | null> {
  return (await d.print(path, { name }, ['name']))[0]?.['.id'] ?? null;
}

// ---- step builders ---------------------------------------------------------------------------------------------------

const opsCheck = (t: TFn): Op[] => [
  op(t('Read system resource'), '/system resource print', async (d) => {
    const x = (await d.print('/system/resource'))[0] ?? {};
    const ver = String(x.version ?? '?');
    const m = /^(\d+)\.(\d+)/.exec(ver);
    const old = !!m && (Number(m[1]) < 6 || (Number(m[1]) === 6 && Number(m[2]) < 43));
    return [old ? 'warn' : 'ok', `${x['board-name'] ?? '?'} / RouterOS ${ver} / uptime ${x.uptime ?? '?'} / CPU ${x['cpu-load'] ?? '?'}%${old ? ' - ' + t('older than 6.43: legacy login is used') : ''}`];
  }),
  op(t('Read identity'), '/system identity print', async (d) => String((await d.print('/system/identity'))[0]?.name ?? '?')),
  op(t('Find hotspot servers'), '/ip hotspot print', async (d) => {
    const h = await d.print('/ip/hotspot', {}, ['name', 'interface']);
    return h.length ? ['ok', h.map((x) => `${x.name ?? ''} (${x.interface ?? ''})`).join(', ')] : ['warn', t('No hotspot server configured yet. Run /ip hotspot setup on the router first.')];
  }),
  op(t('Check API services'), '/ip service print', async (d) => {
    const o: string[] = [];
    for (const s of await d.print('/ip/service', {}, ['name', 'port', 'address', 'disabled'])) {
      if (s.name === 'api' || s.name === 'api-ssl') o.push(`${s.name}:${s.port} ${isTrue(s.disabled) ? 'disabled' : 'enabled'}${(s.address ?? '') !== '' ? ' from ' + s.address : ' from any'}`);
    }
    return o.join('; ') || 'n/a';
  }),
  op(t('Check clock / NTP'), '/system clock print; /system ntp client print', async (d) => {
    const c = (await d.print('/system/clock'))[0] ?? {};
    const n = (await d.print('/system/ntp/client'))[0] ?? {};
    const on = isTrue(n.disabled) ? false : isTrue(n.enabled);
    return [on ? 'ok' : 'warn', `${c.date ?? '?'} ${c.time ?? ''} ${c['time-zone-name'] ?? ''} / NTP ${on ? 'on (' + (n.status ?? '') + ')' : 'OFF - voucher expiry needs correct time'}`];
  }),
  op(t('Look for an existing NextMON API user'), '/user print where name~"nextmon"', async (d) => {
    const u = (await d.print('/user', {}, ['name', 'group', 'address'])).filter((x) => (x.name ?? '').startsWith('nextmon'));
    return u.length ? u.map((x) => `${x.name} (${x.group ?? ''})`).join('; ') : t('none yet');
  }),
];

async function opsUser(d: Driver, p: Params, t: TFn, routerId: string): Promise<Op[]> {
  const ro = p.level === 'ro';
  const gname = ro ? 'nextmon-ro' : 'nextmon-op';
  const policy = ro ? 'read,api' : 'read,write,api,test,policy';
  const gid = await idOf(d, '/user/group', gname);
  const uid2 = await idOf(d, '/user', p.api_user);
  const ops: Op[] = [];
  const gAttrs = { name: gname, policy, comment: 'NextMON ' + (ro ? 'read-only' : 'operator') };
  ops.push(
    gid
      ? op(t('Update group :g', { ':g': gname }), cli('/user/group', 'set', { policy }, 'name=' + gname), async (x) => {
          await x.set('/user/group', gid, { policy });
          return 'updated';
        })
      : op(t('Create group :g', { ':g': gname }), cli('/user/group', 'add', gAttrs), async (x) => {
          await x.add('/user/group', gAttrs);
          return 'created';
        }),
  );
  const uAttrs: Record<string, string> = { name: p.api_user, group: gname, comment: 'NextMON API' };
  if (p.server_ip !== '') uAttrs.address = p.server_ip;
  const gen = (): string => {
    const pw = Voucher.code(24, 'mixed');
    put('cred', { router: routerId, user: p.api_user, pass: Crypto.encrypt(pw), ts: Math.floor(Date.now() / 1000) } satisfies Cred);
    return pw;
  };
  if (!uid2) {
    ops.push(
      op(
        t('Create user :u', { ':u': p.api_user }),
        cli('/user', 'add', { ...uAttrs, password: '<random 24 chars>' }),
        async (x) => {
          const pw = gen();
          await x.add('/user', { ...uAttrs, password: pw });
          return t('Created. The generated password is stored for this session only; use "Use this user in NextMON" below, or note it from the router.');
        },
        null,
        t('A random 24-character password is generated when you apply.'),
      ),
    );
  } else {
    ops.push(
      op(
        t('User :u already exists', { ':u': p.api_user }),
        cli('/user', 'set', { ...uAttrs, password: '<random 24 chars>' }, 'name=' + p.api_user),
        async (x) => {
          const pw = gen();
          await x.set('/user', uid2, { ...uAttrs, password: pw });
          return t('Password reset and group/address updated.');
        },
        'resetuser',
        t('Needs the extra confirmation: this resets the password of the existing user and may disconnect the program using it.'),
        false,
      ),
    );
  }
  if (p.server_ip === '') ops[0]!.note = `${ops[0]!.note} ${t('No server address given: the user will be allowed from anywhere. Fill "NextMON server address" to restrict it.')}`.trim();
  return ops;
}

async function opsServices(d: Driver, p: Params, t: TFn): Promise<Op[]> {
  const ops: Op[] = [];
  const addr = p.server_ip;
  const apiId = await idOf(d, '/ip/service', 'api');
  const attrs: Record<string, string> = { disabled: 'no', port: '8728' };
  if (addr !== '') attrs.address = addr;
  ops.push(
    op(
      t('Enable API (8728)'),
      cli('/ip/service', 'set', attrs, 'name=api'),
      async (x) => {
        if (!apiId) throw new RouterOSError('service api not found');
        await x.set('/ip/service', apiId, attrs);
        return 'ok';
      },
      addr !== '' ? 'lockout' : null,
      addr !== '' ? t('Restricting the API to :a locks NextMON out if NextMON connects from another address. Needs the extra confirmation.', { ':a': addr }) : t('No address restriction (any source). Recommended: set the NextMON server address.'),
    ),
  );
  if (p.ssl === '1') {
    const have = (n: string) => idOf(d, '/certificate', n);
    if (!(await have('nextmon-api'))) {
      const ca = { name: 'nextmon-ca', 'common-name': 'nextmon-ca', 'days-valid': '3650', 'key-usage': 'key-cert-sign,crl-sign' };
      const ce = { name: 'nextmon-api', 'common-name': 'nextmon-api', 'days-valid': '3650' };
      if (!(await have('nextmon-ca'))) {
        ops.push(op(t('Create certificate authority'), cli('/certificate', 'add', ca), async (x) => (await x.add('/certificate', ca), 'ok')));
        ops.push(op(t('Sign CA (can take up to a minute)'), '/certificate sign nextmon-ca', async (x) => (await x.command('/certificate/sign', { number: 'nextmon-ca' }), 'signed')));
      }
      ops.push(op(t('Create API certificate'), cli('/certificate', 'add', ce), async (x) => (await x.add('/certificate', ce), 'ok')));
      ops.push(op(t('Sign API certificate'), '/certificate sign nextmon-api ca=nextmon-ca', async (x) => (await x.command('/certificate/sign', { number: 'nextmon-api', ca: 'nextmon-ca' }), 'signed')));
    }
    const sslId = await idOf(d, '/ip/service', 'api-ssl');
    const sa: Record<string, string> = { disabled: 'no', port: '8729', certificate: 'nextmon-api', ...(addr !== '' ? { address: addr } : {}) };
    ops.push(
      op(
        t('Enable API-SSL (8729)'),
        cli('/ip/service', 'set', sa, 'name=api-ssl'),
        async (x) => {
          if (!sslId) throw new RouterOSError('service api-ssl not found');
          await x.set('/ip/service', sslId, sa);
          return 'ok';
        },
        addr !== '' ? 'lockout' : null,
      ),
    );
  }
  return ops;
}

export const CLEANUP_SOURCE = `:local purge false
:foreach s in=[/system scheduler find where name~"^kl-exp-"] do={
  :local n [/system scheduler get $s name]
  :local u [:pick $n 7 [:len $n]]
  :if ([:len [/ip hotspot user find where name=$u]]=0) do={
    /system scheduler remove $s
    :log info ("nextmon-cleanup: orphan scheduler removed " . $n)
  }
}
:if ($purge) do={
  :foreach i in=[/ip hotspot user find where limit-uptime=1s] do={
    :local u [/ip hotspot user get $i name]
    :if ([:len [/ip hotspot active find where user=$u]]=0) do={
      /ip hotspot user remove $i
      :log info ("nextmon-cleanup: expired user removed " . $u)
    }
  }
}`;

async function opsScripts(d: Driver, p: Params, t: TFn, fd: FormData): Promise<Op[]> {
  const ops: Op[] = [];
  const sid = await idOf(d, '/system/script', 'nextmon-cleanup');
  ops.push(
    op(
      sid ? t('Update expiry cleanup script') : t('Install expiry cleanup script'),
      cli('/system/script', sid ? 'set' : 'add', { name: 'nextmon-cleanup', policy: 'read,write,policy,test', source: '<see below>' }),
      async (x) => {
        const a = { source: CLEANUP_SOURCE, policy: 'read,write,policy,test' };
        if (sid) await x.set('/system/script', sid, a);
        else await x.add('/system/script', { name: 'nextmon-cleanup', ...a });
        return 'ok';
      },
      null,
      t('Removes orphan expiry schedulers (docs/mikrotik-scripts/02).'),
      true,
      CLEANUP_SOURCE,
    ),
  );
  const kid = await idOf(d, '/system/scheduler', 'nextmon-cleanup');
  const sch = { interval: '1h', 'start-time': 'startup', 'on-event': '/system script run nextmon-cleanup', policy: 'read,write,policy,test', comment: 'nextmon' };
  ops.push(
    op(kid ? t('Update cleanup scheduler') : t('Add cleanup scheduler (hourly)'), cli('/system/scheduler', kid ? 'set' : 'add', { name: 'nextmon-cleanup', ...sch }), async (x) => {
      if (kid) await x.set('/system/scheduler', kid, sch);
      else await x.add('/system/scheduler', { name: 'nextmon-cleanup', ...sch });
      return 'ok';
    }),
  );
  const sel = fd.getAll('profiles[]').map(String);
  for (const pr of await d.print('/ip/hotspot/user/profile', {}, ['name', 'on-login'])) {
    const n = String(pr.name);
    if (!sel.includes(n) || ['default', 'default-encryption'].includes(n)) continue;
    const price = (String(fd.get(`price[${n}]`) ?? '0').replace(/[^0-9]/g, '') || '0');
    const vl = String(fd.get(`validity[${n}]`) ?? '').trim().toLowerCase();
    if (!Scripts.validDuration(vl)) throw new UserError('Invalid validity for profile :p (example 1d, 3h, 30d).', { ':p': n });
    const script = Scripts.onLogin(p.mode, price, vl, price, p.lock_user === '1', false, n);
    const had = (pr['on-login'] ?? '').trim() !== '';
    const pid = pr['.id']!;
    ops.push(
      op(
        t('Install on-login script on profile :p', { ':p': n }),
        cli('/ip/hotspot/user/profile', 'set', { 'on-login': '<see below>' }, 'name=' + n),
        async (x) => {
          await x.set('/ip/hotspot/user/profile', pid, { 'on-login': script });
          return 'ok';
        },
        had ? 'overwrite' : null,
        had ? t('This profile already has an on-login script. Replacing it changes pricing/expiry behaviour. Needs the extra confirmation.') : '',
        false,
        script,
      ),
    );
  }
  return ops;
}

/** Recommended walled garden hosts (docs/mikrotik-scripts/08). */
export function walledDefaults(portal: string): string[] {
  return [...(portal !== '' ? [portal] : []), '*.midtrans.com', '*.xendit.co', '*.tripay.co.id', 'captive.apple.com', 'connectivitycheck.gstatic.com'];
}

async function opsWalled(d: Driver, p: Params, t: TFn): Promise<Op[]> {
  const have = (await d.print('/ip/hotspot/walled-garden', {}, ['dst-host'])).map((x) => x['dst-host']);
  return walledDefaults(p.portal).map((h) => {
    const a = { 'dst-host': h, action: 'allow', comment: 'nextmon' };
    if (have.includes(h)) return op(t('Already present: :h', { ':h': h }), cli('/ip/hotspot/walled-garden', 'add', a), null, null, t('Nothing to do.'));
    return op(t('Allow :h without login', { ':h': h }), cli('/ip/hotspot/walled-garden', 'add', a), async (x) => (await x.add('/ip/hotspot/walled-garden', a), 'ok'), null, '', false);
  });
}

async function opsNtp(d: Driver, p: Params, t: TFn): Promise<Op[]> {
  const n = (await d.print('/system/ntp/client'))[0] ?? {};
  const on = isTrue(n.enabled);
  const ops: Op[] = [op(t('Show current NTP/SNTP state'), '/system ntp client print', async () => [on ? 'ok' : 'warn', `enabled=${on ? 'yes' : 'no'} status=${n.status ?? '?'} servers=${n.servers ?? n['primary-ntp'] ?? '?'}`])];
  if (!on) {
    const key = 'servers' in n ? 'servers' : 'server-dns-names' in n ? 'server-dns-names' : 'primary-ntp';
    const a: Record<string, string> = { enabled: 'yes', [key]: p.ntp_servers };
    ops.push(
      op(
        t('Enable NTP client'),
        cli('/system/ntp/client', 'set', a),
        async (x) => {
          if (key === 'primary-ntp' && !/^\d{1,3}(\.\d{1,3}){3}$/.test(p.ntp_servers)) throw new RouterOSError(t('This RouterOS version needs an IP address for primary-ntp. Enter an NTP server IP.'));
          await x.command('/system/ntp/client/set', a);
          return 'ok';
        },
        null,
        t('Voucher expiry is calculated from the router clock.'),
      ),
    );
  }
  if (p.tz !== '') {
    ops.push(
      op(
        t('Set time zone :z', { ':z': p.tz }),
        cli('/system/clock', 'set', { 'time-zone-name': p.tz }),
        async (x) => (await x.command('/system/clock/set', { 'time-zone-name': p.tz }), 'ok'),
        'tz',
        t('Changing the time zone shifts the router clock; needs the extra confirmation.'),
        false,
      ),
    );
  }
  return ops;
}

async function opsTemplate(d: Driver, p: Params, t: TFn, demo: boolean): Promise<Op[]> {
  const dir = p.html_dir;
  const tdir = templateDir();
  const files = tdir ? Object.keys(templateFiles(tdir)) : [];
  const found = async (x: Driver) => (await x.print('/file', {}, ['name'])).some((f) => f.name === `${dir}/login.html` || f.name === `flash/${dir}/login.html`);
  const ops: Op[] = [];
  if (demo) {
    ops.unshift(
      op(
        t('Demo only: pretend the files were uploaded'),
        '# (demo router has no FTP)',
        async (x) => {
          for (const rel of files.length ? files : ['login.html']) await x.add('/file', { name: `${dir}/${rel}`, type: 'file', size: '1000', 'creation-time': new Date().toISOString() });
          return 'ok';
        },
        null,
        t('Simulation for the demo router only.'),
        false,
      ),
    );
  }
  ops.push(
    op(t('Check that :f is on the router', { ':f': `${dir}/login.html` }), `/file print where name="${dir}/login.html"`, async (x) => ((await found(x)) ? ['ok', t('Found.')] : ['warn', t('Not found yet. Upload the folder first (see the instructions), then check again.')]), null, '', false),
  );
  if (p.hs_profile !== '') {
    const pid = await idOf(d, '/ip/hotspot/profile', p.hs_profile);
    ops.push(
      op(
        t('Point hotspot profile :p to the template', { ':p': p.hs_profile }),
        cli('/ip/hotspot/profile', 'set', { 'html-directory': dir }, 'name=' + p.hs_profile),
        async (x) => {
          if (!pid) throw new RouterOSError('hotspot profile not found');
          if (!(await found(x))) throw new RouterOSError(t('Template files not found on the router; upload them first.'));
          await x.set('/ip/hotspot/profile', pid, { 'html-directory': dir });
          return t('Done. Guests now see the NextMON login page.');
        },
        'htmldir',
        t('This changes the live login page for all guests. Needs the extra confirmation.'),
      ),
    );
  }
  return ops;
}

async function buildOps(step: Step, d: Driver, p: Params, t: TFn, fd: FormData, routerId: string, demo: boolean): Promise<Op[]> {
  switch (step) {
    case 'check':
      return opsCheck(t);
    case 'user':
      return opsUser(d, p, t, routerId);
    case 'services':
      return opsServices(d, p, t);
    case 'scripts':
      return opsScripts(d, p, t, fd);
    case 'walled':
      return opsWalled(d, p, t);
    case 'ntp':
      return opsNtp(d, p, t);
    case 'template':
      return opsTemplate(d, p, t, demo);
  }
}

// ---- run -------------------------------------------------------------------------------------------------------------

/** Preview or apply one wizard step on the current router. Result is stored for the page to show. */
export async function runStep(
  fd: FormData,
  env: { driver: Driver; router: { id: string; shared: boolean; mode: string }; demo: boolean; t: TFn; portal: string },
): Promise<void> {
  const step = String(fd.get('step') ?? '');
  const mode = fd.get('mode') === 'apply' ? 'apply' : 'preview';
  if (!isStep(step)) throw new UserError('Unknown action.');
  if (mode === 'apply' && step !== 'check' && fd.get('confirm') !== '1') throw new UserError('Tick the confirmation box before applying.');
  if (mode === 'apply' && env.router.shared && env.router.mode === 'ro') throw new UserError('This shared router is read-only.');
  const { t } = env;
  const p = readParams(fd, env.portal);
  put('params', p);
  const ops = await buildOps(step, env.driver, p, t, fd, env.router.id, env.demo);
  const rows: OpRow[] = [];
  let halt = false;
  const who = Context.current().actor?.username ?? '';
  for (const o of ops) {
    const row: OpRow = { label: o.label, cli: o.cli, detail: o.detail, status: 'plan', msg: o.note };
    if (mode === 'apply') {
      if (halt) {
        row.status = 'skip';
        row.msg = t('Skipped because an earlier command failed.');
      } else if (o.ack && !fd.get('ack_' + o.ack)) {
        row.status = 'skip';
        row.msg = t('Not applied: tick the extra confirmation for this command.');
      } else if (o.fn === null) {
        row.status = 'skip';
      } else {
        try {
          const x = await o.fn(env.driver);
          if (Array.isArray(x)) [row.status, row.msg] = x;
          else {
            row.status = 'ok';
            row.msg = String(x ?? '');
          }
        } catch (e) {
          if (!(e instanceof RouterOSError) && !(e instanceof Error)) throw e;
          row.status = 'err';
          row.msg = e.message;
          halt = o.stop;
        }
      }
      Store.append('wizard.log', { ts: Math.floor(Date.now() / 1000), router: env.router.id, step, label: o.label, cli: mask(o.cli), status: row.status, msg: mask(row.msg.slice(0, 300)), user: who } satisfies LogRow);
    }
    rows.push(row);
  }
  if (mode === 'apply') {
    Store.prune('wizard.log', 1000);
    Audit.log('wizard.' + step, `${rows.filter((r) => r.status === 'ok').length} ok`);
  }
  put('out', { router: env.router.id, step, mode, rows } satisfies WizardOut);
}

/** Use the generated least-privilege API user for this router from now on. */
export function adoptGeneratedUser(routerId: string, confirm: boolean): string {
  const c = doc().cred?.[uid()];
  const r = Routers.get(routerId);
  if (!c || !r || c.router !== r.id || !confirm || Date.now() / 1000 - c.ts >= CRED_TTL) throw new UserError('Nothing to switch, or confirmation missing.');
  if (r.shared) throw new UserError('A shared router can only be changed by its owner.');
  Routers.save({ id: r.id, name: r.name, session: r.session, type: r.type, host: r.host, port: r.port, ssl: r.ssl, verify_tls: r.verify_tls, user: c.user, pass: Crypto.decrypt(c.pass), hotspot_name: r.hotspot_name });
  Store.update<State>('wizard', (cur) => {
    const cred = { ...(cur.cred ?? {}) };
    delete cred[uid()];
    return { ...cur, cred };
  }, {});
  Audit.log('wizard.switch-user', `${r.id} -> ${c.user}`);
  return 'NextMON now connects with the least-privilege user. Use Routers > Test to confirm.';
}
