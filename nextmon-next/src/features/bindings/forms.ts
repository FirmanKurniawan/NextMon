import { audit } from '../_kit/audit.ts';
import { ids, str, UserError, validId } from '../_kit/forms.ts';
import type { FormRoute } from '../_kit/forms.ts';

const BACK = '/hotspot/bindings';
const PATH = '/ip/hotspot/ip-binding';

export const bindingForms: Record<string, FormRoute> = {
  'hotspot/bindings/save': {
    cap: 'write',
    back: BACK,
    async run({ ctx, fd }) {
      const t = ctx.t;
      const type = ['regular', 'bypassed', 'blocked'].includes(str(fd, 'type')) ? str(fd, 'type') : 'regular';
      const attrs: Record<string, string> = { type, comment: str(fd, 'comment') };
      for (const [k, f] of [
        ['mac-address', 'mac'],
        ['address', 'address'],
        ['to-address', 'to_address'],
        ['server', 'server'],
      ] as const) {
        if (str(fd, f) !== '') attrs[k] = str(fd, f);
      }
      if (!attrs['mac-address'] && !attrs.address) throw new UserError(t('MAC or address is required.'));
      const id = str(fd, 'id');
      if (!validId(id)) throw new UserError(t('Check the entry.'));
      const r = ctx.driver();
      if (id !== '') await r.set(PATH, id, attrs);
      else await r.add(PATH, attrs);
      audit('binding.save', `${attrs['mac-address'] ?? ''} ${attrs.address ?? ''}`);
      return { to: BACK, msg: t('Binding saved.') };
    },
  },

  'hotspot/bindings/action': {
    cap: 'write',
    back: BACK,
    async run({ ctx, fd }) {
      const act = str(fd, 'action');
      if (!['remove', 'enable', 'disable'].includes(act)) throw new UserError(ctx.t('Unknown action.'));
      const list = [...new Set([...ids(fd, 'ids[]'), ...ids(fd, 'ids')])];
      const r = ctx.driver();
      if (act === 'remove') await r.removeMany(PATH, list);
      else await r.setMany(PATH, list.map((id): [string, Record<string, string>] => [id, { disabled: act === 'disable' ? 'yes' : 'no' }]));
      audit('binding.' + act, String(list.length));
      return { to: BACK, msg: ctx.t('Done: :n bindings.', { ':n': list.length }) };
    },
  },
};
