import { Audit } from '../../lib/audit.ts';
import { writeRoute } from '../_netkit/mutate.ts';
import { done, each, fail, field, postedIds, report, validId } from '../_netkit/util.ts';

export const queuesApi = writeRoute({
  save: async (ctx, fd) => {
    const r = ctx.driver();
    const name = field(fd, 'name');
    const target = field(fd, 'target');
    const max = field(fd, 'max_limit', '0/0');
    const id = field(fd, 'id');
    if (!validId(id) || !/^[\w. -]{1,40}$/.test(name) || !/^[0-9A-Fa-f:./,]+$/.test(target) || !/^\d+[kMG]?\/\d+[kMG]?$/.test(max)) {
      return fail(ctx.t('Check name, target (IP/CIDR) and max-limit (example 5M/5M).'));
    }
    const attrs = { name, target, 'max-limit': max, comment: field(fd, 'comment') };
    if (id !== '') await r.set('/queue/simple', id, attrs);
    else await r.add('/queue/simple', attrs);
    Audit.log('queue.save', name);
    return done(ctx.t('Queue saved.'));
  },

  action: async (ctx, fd) => {
    const r = ctx.driver();
    const act = field(fd, 'action');
    if (!['remove', 'enable', 'disable'].includes(act)) return fail(ctx.t('Unknown action.'));
    const res = await each(postedIds(fd), (id) => (act === 'remove' ? r.remove('/queue/simple', id) : r.set('/queue/simple', id, { disabled: act === 'disable' ? 'yes' : 'no' })));
    return report(ctx, res, 'queue.' + act);
  },
});
