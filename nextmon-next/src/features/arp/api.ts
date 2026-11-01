import { Audit } from '../../lib/audit.ts';
import { writeRoute } from '../_netkit/mutate.ts';
import { done, each, fail, field, isTrue, postedIds, report, validId, validIp, validMac } from '../_netkit/util.ts';

export const arpApi = writeRoute({
  save: async (ctx, fd) => {
    const r = ctx.driver();
    const id = field(fd, 'id');
    const addr = field(fd, 'address');
    const mac = field(fd, 'mac').toUpperCase();
    const iface = field(fd, 'interface');
    if (!validId(id) || !validIp(addr, false) || !validMac(mac, false) || !/^[\w.-]{1,40}$/.test(iface)) return fail(ctx.t('Check the IP address, MAC address and interface.'));
    const attrs = { address: addr, 'mac-address': mac, interface: iface, comment: field(fd, 'comment') };
    if (id !== '') await r.set('/ip/arp', id, attrs);
    else await r.add('/ip/arp', attrs);
    Audit.log('arp.save', `${addr} ${mac}`);
    return done(ctx.t('ARP entry saved.'));
  },

  action: async (ctx, fd) => {
    const r = ctx.driver();
    const act = field(fd, 'action');
    const ids = postedIds(fd);
    const byId = new Map((await r.print('/ip/arp')).map((a) => [a['.id']!, a]));
    let skipDyn = 0;
    let res;
    switch (act) {
      case 'static': // pin the current dynamic entry as a static one
        res = await each(ids, async (id) => {
          const a = byId.get(id);
          if (a && isTrue(a.dynamic)) await r.add('/ip/arp', { address: a.address ?? '', 'mac-address': a['mac-address'] ?? '', interface: a.interface ?? '', comment: a.comment ?? '' });
        });
        break;
      case 'remove':
      case 'enable':
      case 'disable': {
        const stat = ids.filter((id) => !isTrue(byId.get(id)?.dynamic ?? 'false'));
        skipDyn = ids.length - stat.length; // RouterOS does not allow editing dynamic entries
        res = await each(stat, (id) => (act === 'remove' ? r.remove('/ip/arp', id) : r.set('/ip/arp', id, { disabled: act === 'disable' ? 'yes' : 'no' })));
        break;
      }
      default:
        return fail(ctx.t('Unknown action.'));
    }
    if (skipDyn > 0 && res.ok + res.bad === 0) return fail(ctx.t('Dynamic entries cannot be changed. Use "Make static" first.'));
    return report(ctx, res, 'arp.' + act);
  },
});
