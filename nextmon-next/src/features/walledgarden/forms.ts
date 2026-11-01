/** Port of NetworkController walledSave / walledAction / walledDefaults (+ WizardController::applyWalledGarden). */
import { RouterOSError } from '../../lib/routeros.ts';
import { audit } from '../_kit/audit.ts';
import { ids, str, UserError, validId } from '../_kit/forms.ts';
import type { FormRoute } from '../_kit/forms.ts';

const HOST_PATH = '/ip/hotspot/walled-garden';
const IP_PATH = '/ip/hotspot/walled-garden/ip';

const pathOf = (kind: string) => (kind === 'ip' ? IP_PATH : HOST_PATH);
const backOf = (kind: string) => '/walledgarden' + (kind === 'ip' ? '#ip' : '');
export const isOff = (row: Record<string, string | undefined>): boolean => ['true', 'yes'].includes(row.disabled ?? '');

/** Recommended walled garden hosts (docs/mikrotik-scripts/08). */
export const walledDefaults = (portal: string): string[] => [...(portal !== '' ? [portal] : []), '*.midtrans.com', '*.xendit.co', '*.tripay.co.id', 'captive.apple.com', 'connectivitycheck.gstatic.com'];

export const walledForms: Record<string, FormRoute> = {
  'walledgarden/save': {
    cap: 'write',
    back: '/walledgarden',
    async run({ ctx, fd }) {
      const t = ctx.t;
      const r = ctx.driver();
      const kind = str(fd, 'kind') === 'ip' ? 'ip' : 'host';
      const id = str(fd, 'id');
      const server = str(fd, 'server');
      const comment = str(fd, 'comment');
      const back = backOf(kind);
      if (!validId(id) || !/^[\w.\- ]{0,40}$/.test(server)) throw new UserError(t('Check the entry.'), back);
      let attrs: Record<string, string>;
      let label: string;
      if (kind === 'host') {
        const host = str(fd, 'dst_host').toLowerCase();
        const action = str(fd, 'action', 'allow');
        if (!/^[a-z0-9*?][a-z0-9.\-*?_]{0,100}$/.test(host) || !['allow', 'deny'].includes(action)) throw new UserError(t('Enter a valid host name (wildcards * and ? allowed).'), back);
        attrs = { 'dst-host': host, action, comment };
        if (server !== '') attrs.server = server;
        label = host;
      } else {
        const addr = str(fd, 'dst_address');
        const proto = str(fd, 'protocol', 'tcp');
        const port = str(fd, 'dst_port');
        const action = str(fd, 'action', 'accept');
        if (!/^[0-9A-Fa-f:./]{3,60}$/.test(addr) || !['', 'tcp', 'udp', 'icmp'].includes(proto) || !/^(\d{1,5}(-\d{1,5})?(,\d{1,5}(-\d{1,5})?)*)?$/.test(port) || !['accept', 'drop', 'reject'].includes(action)) {
          throw new UserError(t('Check address, protocol and port.'), back);
        }
        attrs = { 'dst-address': addr, action, comment };
        if (proto !== '') attrs.protocol = proto;
        if (port !== '') attrs['dst-port'] = port;
        if (server !== '') attrs.server = server;
        label = addr;
      }
      if (id !== '') await r.set(pathOf(kind), id, attrs);
      else await r.add(pathOf(kind), attrs);
      audit('walled.save', `${kind} ${label}`);
      return { to: back, msg: t('Entry saved.') };
    },
  },

  'walledgarden/action': {
    cap: 'write',
    back: '/walledgarden',
    async run({ ctx, fd }) {
      const t = ctx.t;
      const r = ctx.driver();
      const kind = str(fd, 'kind') === 'ip' ? 'ip' : 'host';
      const path = pathOf(kind);
      const back = backOf(kind);
      const act = str(fd, 'action');
      if (!['remove', 'enable', 'disable', 'toggle'].includes(act)) throw new UserError(t('Unknown action.'), '/walledgarden');
      const list = [...new Set([...ids(fd, 'ids[]'), ...ids(fd, 'ids')])];
      const byId = new Map<string, Record<string, string | undefined>>();
      if (act === 'toggle' && list.length > 0) for (const w of await r.print(path)) byId.set(w['.id'] ?? '', w);
      // one failure does not abort the rest
      let ok = 0;
      let bad = 0;
      let err = '';
      for (const id of list) {
        try {
          if (act === 'remove') await r.remove(path, id);
          else if (act === 'toggle') await r.set(path, id, { disabled: isOff(byId.get(id) ?? {}) ? 'no' : 'yes' });
          else await r.set(path, id, { disabled: act === 'disable' ? 'yes' : 'no' });
          ok++;
        } catch (e) {
          if (!(e instanceof RouterOSError)) throw e;
          bad++;
          err = e.message;
        }
      }
      audit('walled.' + act, `${ok} ok, ${bad} failed`);
      if (ok === 0 && bad === 0) throw new UserError(t('Nothing selected.'), back);
      const msg = t('Done: :n items.', { ':n': ok }) + (bad ? ' ' + t(':n failed: :e', { ':n': bad, ':e': err }) : '');
      return { to: back, msg, type: bad ? 'err' : 'ok' };
    },
  },

  'walledgarden/defaults': {
    cap: 'write',
    back: '/walledgarden',
    async run({ ctx, fd }) {
      const t = ctx.t;
      const r = ctx.driver();
      const portal = str(fd, 'portal').toLowerCase();
      if (portal !== '' && !/^[a-z0-9.-]{1,100}$/.test(portal)) throw new UserError(t('Enter a valid host name (wildcards * and ? allowed).'));
      const have = new Set((await r.print(HOST_PATH, {}, ['dst-host'])).map((x) => x['dst-host'] ?? ''));
      const add = [...new Set(walledDefaults(portal))].filter((h) => !have.has(h));
      await r.addMany(
        HOST_PATH,
        add.map((h) => ({ 'dst-host': h, action: 'allow', comment: 'nextmon' })),
      );
      audit('walled.defaults', String(add.length));
      return { to: '/walledgarden', msg: t('Defaults applied: :n new entries.', { ':n': add.length }) };
    },
  },
};
