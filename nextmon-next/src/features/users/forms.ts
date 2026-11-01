import { guard, QuotaError } from '../../lib/quota.ts';
import { audit } from '../_kit/audit.ts';
import { arr, backTo, raw, str, UserError } from '../_kit/forms.ts';
import type { FormRoute } from '../_kit/forms.ts';
import { checkTimeLimit } from '../_kit/hotspot.ts';

const BACK = '/hotspot/users';
const ACTIONS = ['delete', 'enable', 'disable', 'kick', 'reset'];

export const userForms: Record<string, FormRoute> = {
  'hotspot/users/save': {
    cap: 'write',
    back: BACK,
    async run({ ctx, fd }) {
      const t = ctx.t;
      const r = ctx.driver();
      const id = str(fd, 'id');
      const name = str(fd, 'name');
      if (!/^[\w.\-@]{1,64}$/.test(name)) throw new UserError(t('Invalid username.'));
      const attrs: Record<string, string> = {
        name,
        password: raw(fd, 'password'),
        profile: str(fd, 'profile', 'default'),
        comment: str(fd, 'comment'),
        'limit-uptime': str(fd, 'limit_uptime').toLowerCase(),
        'limit-bytes-total': str(fd, 'limit_bytes'),
        'mac-address': str(fd, 'mac'),
      };
      const err = await checkTimeLimit(r, attrs.profile!, attrs['limit-uptime']!, t);
      if (err) throw new UserError(err);
      if (id !== '') {
        if (!/^\*[0-9A-Fa-f]+$/.test(id)) throw new UserError(t('Invalid username.'));
        attrs.disabled = str(fd, 'disabled') === '1' ? 'yes' : 'no';
        // RouterOS "unset" values, so clearing a field in the form really clears it
        if (attrs['limit-uptime'] === '') attrs['limit-uptime'] = '0s';
        if (attrs['limit-bytes-total'] === '') attrs['limit-bytes-total'] = '0';
        if (attrs['mac-address'] === '') attrs['mac-address'] = '00:00:00:00:00:00';
        await r.set('/ip/hotspot/user', id, attrs);
        audit('user.edit', name);
      } else {
        for (const k of Object.keys(attrs)) if (attrs[k] === '') delete attrs[k];
        try {
          await guard(1, () => r.add('/ip/hotspot/user', attrs)); // counts toward the daily voucher limit
        } catch (e) {
          if (e instanceof QuotaError) throw new UserError(t(e.key, e.params));
          throw e;
        }
        audit('user.add', name);
      }
      return { to: backTo(fd, BACK), msg: t('User saved.') };
    },
  },

  'hotspot/users/action': {
    cap: 'write',
    back: BACK,
    async run({ ctx, fd }) {
      const t = ctx.t;
      const r = ctx.driver();
      const idsIn = arr(fd, 'ids[]')
        .concat(arr(fd, 'ids'))
        .filter((i) => /^\*[0-9A-Fa-f]+$/.test(i));
      const act = str(fd, 'action');
      if (idsIn.length === 0) throw new UserError(t('Nothing selected.'));
      if (!ACTIONS.includes(act)) throw new UserError(t('Unknown action.'));
      const need = act === 'delete' || act === 'kick';
      const got = await r.printMany({ users: ['/ip/hotspot/user', {}, ['name']], ...(need ? { active: ['/ip/hotspot/active', {}, ['user']] } : {}) });
      const names = new Map((got.users ?? []).map((u) => [u['.id'] ?? '', u.name ?? '']));
      const activeBy = new Map<string, string[]>();
      for (const a of got.active ?? []) activeBy.set(a.user ?? '', [...(activeBy.get(a.user ?? '') ?? []), a['.id'] ?? '']);
      const kick: string[] = [];
      const del: string[] = [];
      const toggle: [string, Record<string, string>][] = [];
      const reset: Record<string, string>[] = [];
      for (const id of idsIn) {
        const nm = names.get(id) ?? '';
        if (act === 'delete') {
          kick.push(...(activeBy.get(nm) ?? []));
          del.push(id);
        } else if (act === 'enable' || act === 'disable') toggle.push([id, { disabled: act === 'disable' ? 'yes' : 'no' }]);
        else if (act === 'kick') kick.push(...(activeBy.get(nm) ?? []));
        else reset.push({ numbers: id });
      }
      // active sessions first (a deleted user must not stay online), then the users; each kind in one pipelined burst
      await r.removeMany('/ip/hotspot/active', [...new Set(kick)]);
      await r.removeMany('/ip/hotspot/user', del);
      await r.setMany('/ip/hotspot/user', toggle);
      await r.commandMany('/ip/hotspot/user/reset-counters', reset);
      audit('user.' + act, idsIn.length + ' users');
      return { to: backTo(fd, BACK), msg: t('Done: :n users.', { ':n': idsIn.length }) };
    },
  },
};
