import { Audit } from '../../lib/audit.ts';
import { writeRoute } from '../_netkit/mutate.ts';
import { done, each, fail, field, postedIds, report, validId, validIp, validMac } from '../_netkit/util.ts';

export const dhcpApi = writeRoute({
  save: async (ctx, fd) => {
    const r = ctx.driver();
    const id = field(fd, 'id');
    const addr = field(fd, 'address');
    const mac = field(fd, 'mac').toUpperCase();
    const server = field(fd, 'server');
    if (!validId(id) || !validIp(addr, false) || !validMac(mac, false) || !/^[\w. -]{0,40}$/.test(server)) return fail(ctx.t('Check the IP address and MAC address.'));
    const attrs: Record<string, string> = { address: addr, 'mac-address': mac, comment: field(fd, 'comment') };
    if (server !== '') attrs.server = server;
    if (id !== '') await r.set('/ip/dhcp-server/lease', id, attrs);
    else await r.add('/ip/dhcp-server/lease', attrs);
    Audit.log('dhcp.save', `${addr} ${mac}`);
    return done(ctx.t('Lease saved.'));
  },

  action: async (ctx, fd) => {
    const r = ctx.driver();
    const act = field(fd, 'action');
    const ids = postedIds(fd);
    let res;
    switch (act) {
      case 'static':
        res = await each(ids, (id) => r.command('/ip/dhcp-server/lease/make-static', { numbers: id }));
        break;
      case 'remove':
        res = await each(ids, (id) => r.remove('/ip/dhcp-server/lease', id));
        break;
      case 'enable':
      case 'disable':
        res = await each(ids, (id) => r.set('/ip/dhcp-server/lease', id, { disabled: act === 'disable' ? 'yes' : 'no' }));
        break;
      default:
        return fail(ctx.t('Unknown action.'));
    }
    return report(ctx, res, 'dhcp.' + act);
  },
});
