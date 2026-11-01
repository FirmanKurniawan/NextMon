/** Router backup/export + app settings export (port of BackupController). POST create; GET /api/json/backup?type=... downloads. */
import { Audit } from '../../lib/audit.ts';
import * as AB from '../../lib/appbackup.ts';
import { Net } from '../../lib/net.ts';
import { Routers } from '../../lib/routers.ts';
import { getSettings } from '../../lib/store.ts';
import { Users } from '../../lib/users.ts';
import { HttpError } from '../../server/guard.ts';
import { writeRoute } from '../_netkit/mutate.ts';
import { field, done, fail } from '../_netkit/util.ts';
import type { AppContext } from '../types.ts';
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

/** Translated message of a BackupError, or a generic one (details stay in the server log). */
function msg(ctx: AppContext, e: unknown): string {
  return e instanceof AB.BackupError ? ctx.t(e.key, e.params) : ctx.t('Server error');
}
const limited = (ctx: AppContext, bucket: string, max: number): boolean => Net.hit(bucket, `${ctx.workspace.id}|${ctx.user.id}`, max, 600);
const tooMany = (ctx: AppContext) => fail(ctx.t('Too many attempts. Try again in :m min.', { ':m': 10 }));

export const backupApi = writeRoute(
  {
    // ---- app data restore (owner only): 1. check the file, 2. confirm -------------------------------------------------
    'restore/preview': {
      cap: 'admin',
      run: async (ctx, fd) => {
        if (limited(ctx, 'backup-restore', 12)) return tooMany(ctx);
        const f = fd.get('file');
        if (!(f instanceof File) || (f.size === 0 && f.name === '')) return fail(ctx.t('Choose a backup file first.'));
        if (f.size > AB.MAX_BYTES) return fail(ctx.t('File is too large (max :n MB).', { ':n': AB.MAX_BYTES / 1048576 }));
        try {
          const parsed = AB.parseBackup(new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(await f.arrayBuffer())));
          AB.stash(parsed, f.name, ctx.user.id);
          Audit.log('backup.restore.preview', f.name.slice(0, 80));
          return { ok: true, message: ctx.t('File checked. Review what will be replaced below.'), reload: true };
        } catch (e) {
          if (e instanceof AB.BackupError) Audit.log('backup.restore.rejected', e.message.slice(0, 200));
          else console.error('[nextmon] backup preview failed', e);
          return fail(msg(ctx, e));
        }
      },
    },
    'restore/cancel': {
      cap: 'admin',
      run: (ctx) => {
        AB.discard();
        return done(ctx.t('Restore cancelled. Nothing was changed.'));
      },
    },
    'restore/apply': {
      cap: 'admin',
      run: (ctx, fd) => {
        if (limited(ctx, 'backup-restore', 12)) return tooMany(ctx);
        const data = AB.pendingData(ctx.user.id, field(fd, 'token'));
        if (!data) return fail(ctx.t('The restore preview expired. Upload the file again.'));
        if (field(fd, 'confirm').toUpperCase() !== 'RESTORE') return fail(ctx.t('Type RESTORE to confirm.'));
        const sel = fd.getAll('c[]').map(String).filter((c) => Object.hasOwn(AB.COLLECTIONS, c));
        try {
          const r = AB.applyBackup(data, sel);
          AB.discard();
          Audit.log('backup.restore', `${r.applied.join(',')} safety=${r.safety}`);
          return done(ctx.t('Restore complete: :c. Previous data saved as :f', { ':c': r.applied.join(', '), ':f': r.safety }));
        } catch (e) {
          if (e instanceof AB.BackupError) Audit.log('backup.restore.failed', e.message.slice(0, 200));
          else console.error('[nextmon] restore failed', e);
          return fail(msg(ctx, e));
        }
      },
    },
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
      const day = stamp();
      if (type === 'appdata' || type === 'safety') {
        // workspace app data: owner only
        if (!ctx.can('admin')) throw new HttpError(403, 'Forbidden');
        if (type === 'appdata') {
          if (limited(ctx, 'backup-export', 10)) throw new HttpError(429, ctx.t('Too many attempts. Try again in :m min.', { ':m': 10 }));
          const secrets = u.searchParams.get('secrets') === '1';
          const body = AB.exportBackup(secrets);
          Audit.log('backup.export', secrets ? 'with encrypted secrets' : 'no secrets');
          return send(`nextmon-data-${stamp(new Date(), true)}.json`, 'application/json', body);
        }
        const name = u.searchParams.get('name') ?? '';
        const body = AB.safetyBody(name);
        if (body === null) throw new HttpError(404, ctx.t('File not found.'));
        Audit.log('backup.safety.download', name);
        return send(name + '.json', 'application/json', body);
      }
      const r = ctx.driver();
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

