import { audit } from '../_kit/audit.ts';
import { ids } from '../_kit/forms.ts';
import type { FormRoute } from '../_kit/forms.ts';

const BACK = '/hotspot/hosts';

/** Port of HotspotController::hostRemove(). */
export const hostForms: Record<string, FormRoute> = {
  'hotspot/hosts/remove': {
    cap: 'write',
    back: BACK,
    async run({ ctx, fd }) {
      const list = [...new Set([...ids(fd, 'ids[]'), ...ids(fd, 'ids')])];
      await ctx.driver().removeMany('/ip/hotspot/host', list);
      audit('host.remove', String(list.length));
      return { to: BACK, msg: ctx.t('Done: :n hosts.', { ':n': list.length }) };
    },
  },
};
