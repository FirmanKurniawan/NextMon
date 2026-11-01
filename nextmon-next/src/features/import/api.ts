/** CSV downloads of the import/export page (port of ImportController template / export / errors). */
import { HttpError } from '../../server/guard.ts';
import { audit } from '../_kit/audit.ts';
import type { ApiRoute } from '../types.ts';
import * as Imp from './data.ts';
import type { RowError } from './data.ts';

const BOM = String.fromCharCode(0xfeff);
const pad = (n: number) => String(n).padStart(2, '0');

function send(name: string, body: string): Response {
  return new Response(BOM + body, {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store' },
  });
}

export const importApi: ApiRoute = {
  cap: 'write',
  async GET(ctx, req, rest) {
    const t = ctx.t;
    const now = new Date();
    const q = new URL(req.url).searchParams;
    const head = Object.values(Imp.COLS).map((c) => c[0]);
    switch (rest[0]) {
      case 'template':
        return send('nextmon-users-template.csv', Imp.csvLine(head, ',') + Imp.csvLine(['all', 'abc123', 'abc123', '1Jam', '', '', '', `vc-100-${pad(now.getMonth() + 1)}.${pad(now.getDate())}.${pad(now.getFullYear() % 100)}-sample`, 'no'], ','));

      case 'export': {
        const sep = q.get('sep') === 'semicolon' ? ';' : ',';
        const prof = q.get('profile') ?? '';
        const needle = (q.get('q') ?? '').toLowerCase();
        const stats = q.get('stats') === '1';
        const props = [...Object.keys(Imp.COLS), ...(stats ? Object.keys(Imp.STATS) : [])];
        let body = Imp.csvLine(stats ? [...head, ...Object.values(Imp.STATS)] : head, sep);
        let n = 0;
        for (const u of await ctx.driver().print('/ip/hotspot/user', {}, props)) {
          if ((u.name ?? '') === 'default-trial') continue;
          if (prof !== '' && (u.profile ?? '') !== prof) continue;
          if (needle !== '' && !`${u.name ?? ''} ${u.comment ?? ''}`.toLowerCase().includes(needle)) continue;
          body += Imp.csvLine(
            props.map((k) => {
              let v = u[k] ?? '';
              if (k === 'disabled') v = v === 'true' || v === 'yes' ? 'yes' : 'no';
              else if (k === 'mac-address' && v === '00:00:00:00:00:00') v = '';
              else if ((k === 'limit-uptime' || k === 'limit-bytes-total') && ['0', '0s', '1s'].includes(v)) v = '';
              else if (k === 'server' && v === '') v = 'all';
              return Imp.out(v);
            }),
            sep,
          );
          n++;
        }
        audit('users.export', n + ' users');
        return send(`hotspot-users-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.csv`, body);
      }

      case 'errors': {
        const token = q.get('t') ?? '';
        let list: RowError[];
        const res = Imp.loadResult(token, ctx.session.hash);
        const j = res ? null : Imp.load(token, ctx.session.hash);
        if (res) list = res.rowErrors;
        else if (j) list = j.rows.filter((r) => r.st === 'error').map((r) => ({ line: r.line, name: r.d.name ?? '', error: r.err.join('; ') }));
        else throw new HttpError(404, t('Import session expired. Upload the file again.'));
        let body = Imp.csvLine([t('Line'), t('Name'), t('Error')], ',');
        for (const e of list) body += Imp.csvLine([e.line, Imp.out(String(e.name)), e.error], ',');
        return send(`import-errors-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.csv`, body);
      }
    }
    throw new HttpError(404, 'not found');
  },
};
