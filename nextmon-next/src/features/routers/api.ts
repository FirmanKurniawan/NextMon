import { Net } from '../../lib/net.ts';
import { Routers } from '../../lib/routers.ts';
import { Audit } from '../../lib/audit.ts';
import type { ApiRoute } from '../types.ts';

const f = (fd: FormData, k: string) => (typeof fd.get(k) === 'string' ? (fd.get(k) as string) : '');

/** POST /json/routers/test (multipart form of the router dialog): test a connection with posted, unsaved values. */
export const routersApi: ApiRoute = {
  cap: 'admin',
  async POST(ctx, req, rest) {
    if (rest[0] !== 'test') return { ok: false, error: 'not found' };
    if (Net.hit('router-test', ctx.session.hash, 20, 60)) return { ok: false, error: ctx.t('Too many attempts. Try again in :m min.', { ':m': 1 }), message: ctx.t('Too many attempts. Try again in :m min.', { ':m': 1 }) };
    const fd = await req.formData();
    const id = f(fd, 'id').trim();
    if (id && Routers.get(id)?.shared) return { ok: false, message: ctx.t('A shared router can only be changed by its owner.') };
    const portRaw = f(fd, 'port').trim();
    const r = await Routers.test({
      id: id || undefined,
      type: f(fd, 'type') === 'demo' ? 'demo' : 'real',
      host: f(fd, 'host').trim(),
      port: portRaw === '' ? 8728 : Number(portRaw),
      ssl: f(fd, 'ssl') === '1',
      verify_tls: f(fd, 'verify_tls') === '1',
      user: f(fd, 'user').trim(),
      pass: f(fd, 'pass'),
    });
    Audit.log('router.test', `${f(fd, 'host').trim().slice(0, 80)} ${r.ok ? 'ok' : 'fail'}`);
    return { ok: r.ok, message: ctx.t(r.message) };
  },
};
