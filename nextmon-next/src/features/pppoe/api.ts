import { Audit } from '../../lib/audit.ts';
import type { Driver } from '../../lib/driver.ts';
import { writeRoute } from '../_netkit/mutate.ts';
import { done, each, fail, field, postedIds, raw, report, validId, validIp, validMac } from '../_netkit/util.ts';

const SERVICES = ['any', 'pppoe', 'pptp', 'l2tp', 'sstp', 'ovpn'];
const PROFILE_RE = /^[\w.-]{1,40}$/;
const ADDR_RE = /^[\w./-]{0,40}$/;

/** Drop every live session of a secret name. */
async function kick(r: Driver, name: string): Promise<void> {
  for (const a of await r.print('/ppp/active', { name }, ['name'])) await r.remove('/ppp/active', a['.id']!);
}

export const pppoeApi = writeRoute({
  'secret/save': async (ctx, fd) => {
    const r = ctx.driver();
    const id = field(fd, 'id');
    const name = field(fd, 'name');
    const pass = raw(fd, 'password');
    const service = field(fd, 'service', 'pppoe');
    const profile = field(fd, 'profile', 'default');
    const caller = field(fd, 'caller_id').toUpperCase();
    const local = field(fd, 'local_address');
    const remote = field(fd, 'remote_address');
    if (!validId(id) || !/^[\w.@-]{1,64}$/.test(name) || !SERVICES.includes(service) || !PROFILE_RE.test(profile) || !validMac(caller) || !validIp(local) || !validIp(remote) || (id === '' && (pass === '' || pass.length > 64)) || /[\r\n"]/.test(pass)) {
      return fail(ctx.t('Check name, password, profile, MAC, and IP addresses.'));
    }
    const attrs: Record<string, string> = { name, service, profile, 'caller-id': caller, 'local-address': local, 'remote-address': remote, comment: field(fd, 'comment') };
    if (pass !== '') attrs.password = pass;
    if (id !== '') await r.set('/ppp/secret', id, attrs);
    else await r.add('/ppp/secret', attrs);
    Audit.log('ppp.secret.save', name);
    return done(ctx.t('Secret saved.'));
  },

  'secret/action': async (ctx, fd) => {
    const r = ctx.driver();
    const act = field(fd, 'action');
    const ids = postedIds(fd);
    const profile = field(fd, 'profile');
    const names = new Map<string, string>();
    if (['remove', 'kick', 'disable'].includes(act)) {
      for (const s of await r.print('/ppp/secret', {}, ['name'])) if (ids.includes(s['.id']!)) names.set(s['.id']!, s.name ?? '');
    }
    let res;
    switch (act) {
      case 'enable':
      case 'disable':
        res = await each(ids, (id) => r.set('/ppp/secret', id, { disabled: act === 'disable' ? 'yes' : 'no' }));
        // a disabled secret only blocks the next login: drop live sessions too
        if (act === 'disable') await each([...names.values()], (n) => kick(r, n));
        break;
      case 'remove':
        res = await each(ids, async (id) => {
          const n = names.get(id);
          if (n) await kick(r, n);
          await r.remove('/ppp/secret', id);
        });
        break;
      case 'kick':
        res = await each(ids, (id) => kick(r, names.get(id) ?? ''));
        break;
      case 'setprofile':
        if (!PROFILE_RE.test(profile)) return fail(ctx.t('Choose a profile.'));
        res = await each(ids, (id) => r.set('/ppp/secret', id, { profile }));
        break;
      default:
        return fail(ctx.t('Unknown action.'));
    }
    return report(ctx, res, 'ppp.secret.' + act);
  },

  'active/kick': async (ctx, fd) => {
    const r = ctx.driver();
    return report(ctx, await each(postedIds(fd), (id) => r.remove('/ppp/active', id)), 'ppp.active.kick');
  },

  'profile/save': async (ctx, fd) => {
    const r = ctx.driver();
    const id = field(fd, 'id');
    const name = field(fd, 'name');
    const rate = field(fd, 'rate_limit');
    const onlyOne = field(fd, 'only_one', 'default');
    const local = field(fd, 'local_address');
    const remote = field(fd, 'remote_address');
    if (!validId(id) || !PROFILE_RE.test(name) || (rate !== '' && !/^\d+[kMG]?(\/\d+[kMG]?)?( .+)?$/.test(rate)) || !ADDR_RE.test(local) || !ADDR_RE.test(remote) || !['default', 'yes', 'no'].includes(onlyOne)) {
      return fail(ctx.t('Check name, rate limit (example 5M/5M) and addresses.'));
    }
    const attrs = { name, 'local-address': local, 'remote-address': remote, 'rate-limit': rate, 'only-one': onlyOne };
    if (id !== '') await r.set('/ppp/profile', id, attrs);
    else await r.add('/ppp/profile', attrs);
    Audit.log('ppp.profile.save', name);
    return done(ctx.t('Profile saved.'));
  },

  'profile/delete': async (ctx, fd) => {
    const r = ctx.driver();
    const id = field(fd, 'id');
    const row = validId(id, false) ? (await r.print('/ppp/profile', { '.id': id }))[0] : undefined;
    if (!row) return fail(ctx.t('Profile not found.'));
    if (['default', 'default-encryption'].includes(row.name ?? '') || row.default === 'true') return fail(ctx.t('Built-in profiles cannot be deleted.'));
    if ((await r.print('/ppp/secret', { profile: row.name ?? '' }, ['name'])).length) return fail(ctx.t('Profile is still used by secrets. Move them to another profile first.'));
    await r.remove('/ppp/profile', id);
    Audit.log('ppp.profile.delete', row.name ?? '');
    return done(ctx.t('Profile deleted.'));
  },
});
