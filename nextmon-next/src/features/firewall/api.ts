import { Audit } from '../../lib/audit.ts';
import { validDuration } from '../../lib/scripts.ts';
import { writeRoute } from '../_netkit/mutate.ts';
import { done, each, fail, field, postedIds, report } from '../_netkit/util.ts';

export const BLOCK_LIST = 'nextmon-block';

export const firewallApi = writeRoute({
  add: async (ctx, fd) => {
    const r = ctx.driver();
    const list = field(fd, 'list', BLOCK_LIST);
    const addr = field(fd, 'address');
    const timeout = field(fd, 'timeout').toLowerCase();
    if (!/^[\w-]{1,40}$/.test(list) || !/^[0-9A-Fa-f:./-]+$/.test(addr) || !validDuration(timeout)) return fail(ctx.t('Check list name, address and timeout.'));
    const attrs: Record<string, string> = { list, address: addr, comment: field(fd, 'comment') };
    if (timeout !== '') attrs.timeout = timeout;
    await r.add('/ip/firewall/address-list', attrs);
    Audit.log('firewall.add', `${list} ${addr}`);
    return done(ctx.t('Address added.'));
  },

  remove: async (ctx, fd) => {
    const r = ctx.driver();
    const res = await each(postedIds(fd), (id) => r.remove('/ip/firewall/address-list', id));
    return report(ctx, res, 'firewall.remove');
  },

  /** Create the drop rule for list nextmon-block (forward chain). Admin only, like the PHP route. */
  rule: {
    cap: 'admin',
    run: async (ctx) => {
      const r = ctx.driver();
      if (!(await r.print('/ip/firewall/filter', { comment: BLOCK_LIST }, ['comment'])).length) {
        await r.add('/ip/firewall/filter', { chain: 'forward', 'src-address-list': BLOCK_LIST, action: 'drop', comment: BLOCK_LIST });
      }
      Audit.log('firewall.rule', BLOCK_LIST);
      return done(ctx.t('Drop rule installed. Move it above the hotspot rules if traffic still passes.'));
    },
  },
});
