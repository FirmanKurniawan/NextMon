import { audit } from '../_kit/audit.ts';
import { str, UserError, validId } from '../_kit/forms.ts';
import type { FormRoute } from '../_kit/forms.ts';
import { profileAttrs } from '../_kit/hotspot.ts';
import type { ProfileForm } from '../_kit/hotspot.ts';

const BACK = '/hotspot/profiles';

const formOf = (fd: FormData): ProfileForm => ({
  name: str(fd, 'name'),
  mode: str(fd, 'mode', 'none'),
  validity: str(fd, 'validity'),
  rate_limit: str(fd, 'rate_limit'),
  shared: str(fd, 'shared', '1'),
  price: str(fd, 'price'),
  sprice: str(fd, 'sprice'),
  lock_user: str(fd, 'lock_user'),
  lock_server: str(fd, 'lock_server'),
  parent_queue: str(fd, 'parent_queue'),
  pool: str(fd, 'pool'),
});

export const profileForms: Record<string, FormRoute> = {
  'hotspot/profiles/save': {
    cap: 'write',
    back: BACK,
    async run({ ctx, fd }) {
      const t = ctx.t;
      const built = profileAttrs(formOf(fd), t);
      if ('error' in built) throw new UserError(built.error, BACK);
      const id = str(fd, 'id');
      if (!validId(id)) throw new UserError(t('Profile not found.'), BACK);
      const r = ctx.driver();
      if (id !== '') await r.set('/ip/hotspot/user/profile', id, built.attrs);
      else await r.add('/ip/hotspot/user/profile', built.attrs);
      audit(id ? 'profile.edit' : 'profile.add', built.attrs.name ?? '');
      return { to: BACK, msg: t('Profile saved.') };
    },
  },

  'hotspot/profiles/delete': {
    cap: 'write',
    back: BACK,
    async run({ ctx, fd }) {
      const t = ctx.t;
      const id = str(fd, 'id');
      if (id === '' || !validId(id)) throw new UserError(t('Profile not found.'), BACK);
      await ctx.driver().remove('/ip/hotspot/user/profile', id);
      audit('profile.delete', str(fd, 'name'));
      return { to: BACK, msg: t('Profile deleted.') };
    },
  },

  // Preview of the generated on-login script (view cap, like the PHP route); nothing is written.
  'hotspot/profiles/preview': {
    cap: 'view',
    back: BACK,
    json: true,
    run({ ctx, fd }) {
      const built = profileAttrs(formOf(fd), ctx.t);
      if ('error' in built) return { json: { ok: false, error: built.error } };
      return { json: { ok: true, script: built.attrs['on-login'] || '# (no script - mode "none")' } };
    },
  },
};
