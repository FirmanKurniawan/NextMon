import { audit } from '../_kit/audit.ts';
import { ids } from '../_kit/forms.ts';
import type { FormRoute } from '../_kit/forms.ts';

const BACK = '/hotspot/active';

export const activeForms: Record<string, FormRoute> = {
  'hotspot/active/kick': {
    cap: 'write',
    back: BACK,
    async run({ ctx, fd }) {
      const list = [...new Set([...ids(fd, 'ids[]'), ...ids(fd, 'ids')])];
      await ctx.driver().removeMany('/ip/hotspot/active', list);
      audit('active.kick', list.length + ' sessions');
      return { to: BACK, msg: ctx.t('Disconnected :n sessions.', { ':n': list.length }) };
    },
  },
};
