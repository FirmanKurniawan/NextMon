/** Router backup/export + app settings export (port of BackupController). POST create; GET /api/json/backup?type=... downloads. */
import { Audit } from '../../lib/audit.ts';
import { Routers } from '../../lib/routers.ts';
import { getSettings } from '../../lib/store.ts';
import { Users } from '../../lib/users.ts';
import { HttpError } from '../../server/guard.ts';
import { writeRoute } from '../_netkit/mutate.ts';
import { field } from '../_netkit/util.ts';
import { exportText } from '../monitor/logic.ts';

const pad = (n: number) => String(n).padStart(2, '0');
function stamp(d = new Date(), time = false): string {
  const day = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  return time ? `${day}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}` : day;
}

/** Spreadsheet formula guard (the CSV importer strips the leading apostrophe again). */
export function cell(v: string): string {
  return v !== '' && '=+-@\t\r'.includes(v[0]!) && !/^[+-]?\d+([.,]\d+)?$/.test(v) ? `'${v}` : v;
}
export const csvLine = (cols: string[]): string => cols.map((c) => (/[",\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',');

const send = (name: string, mime: string, body: string, bom = false): Response =>
  new Response(bom ? '﻿' + body : body, {
    headers: { 'content-type': `${mime}; charset=utf-8`, 'content-disposition': `attachment; filename="${name.replace(/[^A-Za-z0-9_.-]/g, '_')}"`, 'cache-control': 'no-store' },
  });

export const backupApi = writeRoute(
  {
    create: async (ctx, fd) => {
      const r = ctx.driver();
      const name = 'nextmon-' + stamp(new Date(), true);
      let msg: string;
      if (field(fd, 'type') === 'rsc') {
        await r.command('/export', { file: name });
        msg = ctx.t('Export created on router: :f', { ':f': name + '.rsc' });
      } else {
        await r.command('/system/backup/save', { name });
        msg = ctx.t('Backup created on router: :f', { ':f': name + '.backup' });
      }
      Audit.log('backup.create', name);
      return { ok: true, message: msg, reload: true };
    },
  },
  {
    cap: 'write',
    getCap: 'write',
    async get(ctx, req) {
      const u = new URL(req.url);
      const type = u.searchParams.get('type') ?? '';
      const r = ctx.driver();
      const day = stamp();
      Audit.log('backup.download', type);
      switch (type) {
        case 'users': {
          const props = ['name', 'password', 'profile', 'comment', 'limit-uptime', 'limit-bytes-total', 'mac-address', 'disabled'];
          const rows = await r.print('/ip/hotspot/user', {}, props);
          const lines = [csvLine(props), ...rows.map((x) => csvLine(props.map((p) => cell(x[p] ?? ''))))];
          return send(`nextmon-users-${day}.csv`, 'text/csv', lines.join('\r\n') + '\r\n', true);
        }
        case 'profiles':
          return send(`nextmon-profiles-${day}.json`, 'application/json', JSON.stringify(await r.print('/ip/hotspot/user/profile'), null, 2));
        case 'rsc': {
          // best effort: RouterOS may return the export text as "ret" values
          const txt = exportText(await r.command('/export'));
          if (txt.trim() === '') throw new HttpError(502, ctx.t('The router did not return export text over the API. Create the export on the router and fetch the file via FTP/Winbox.'));
          return send(`nextmon-export-${day}.rsc`, 'text/plain', txt);
        }
        case 'file': {
          const name = (u.searchParams.get('name') ?? '').replace(/^.*[\\/]/, '');
          // only the backup/export files listed on the page, never user.dat & co
          if (!/^[A-Za-z0-9_.-]{1,100}\.(rsc|backup)$/.test(name)) throw new HttpError(400, ctx.t('Unknown export type.'));
          const rows = await r.print('/file', { name }, ['name', 'contents']);
          if (!rows[0] || rows[0].contents === undefined) throw new HttpError(502, ctx.t('File contents are not available over the API (binary or too large). Download it via FTP/Winbox.'));
          return send(name, 'application/octet-stream', rows[0].contents);
        }
        case 'app': {
          // NextMON's own settings without secrets
          const routers = Routers.list()
            .filter((x) => !x.shared)
            .map((x) => ({ ...x, has_password: undefined }));
          const users = Users.inWorkspace(ctx.workspace.id).map((x) => ({ username: x.username, role: x.role }));
          const s = { ...getSettings() } as Record<string, unknown>;
          if (s.telegram) s.telegram = { ...(s.telegram as Record<string, unknown>), token: undefined };
          return send(`nextmon-app-${day}.json`, 'application/json', JSON.stringify({ routers, users, settings: s }, null, 2));
        }
      }
      throw new HttpError(400, ctx.t('Unknown export type.'));
    },
  },
);

