/** Monitor write endpoints: /api/json/monitor/<action> (POST) + the stored-backup download (GET). Port of MonitorController. */
import { Audit } from '../../lib/audit.ts';
import { HttpError } from '../../server/guard.ts';
import { writeRoute } from '../_netkit/mutate.ts';
import { done, fail, field } from '../_netkit/util.ts';
import { runNow } from '../scheduler/run.ts';
import { JOBS, alert, backupText, config, hex, isDemo, ownRouters, saveConfig, safe } from './logic.ts';
import type { Enabled, MonitorCfg, Rules } from './logic.ts';
import { Routers } from '../../lib/routers.ts';

const num = (fd: FormData, k: string, min: number, max: number, d: number): number => {
  const n = Math.trunc(Number(field(fd, k, String(d))));
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : d));
};

export const monitorApi = writeRoute(
  {
    save: {
      cap: 'admin',
      run: (ctx, fd) => {
        const c = config();
        const rules: Rules = {
          ...c.rules,
          offline_after: num(fd, 'offline_after', 1, 20, 2),
          recover_after: num(fd, 'recover_after', 1, 20, 2),
          remind_min: num(fd, 'remind_min', 0, 1440, 120),
          cpu_high: num(fd, 'cpu_high', 0, 100, 85),
          cpu_samples: num(fd, 'cpu_samples', 1, 20, 3),
          mem_high: num(fd, 'mem_high', 0, 100, 90),
          mem_samples: num(fd, 'mem_samples', 1, 20, 3),
          stock_default: num(fd, 'stock_default', 0, 100000, 10),
          expiring_hours: num(fd, 'expiring_hours', 1, 720, 48),
          cooldown_min: num(fd, 'cooldown_min', 1, 1440, 60),
          stock_per: {},
        };
        for (const line of field(fd, 'stock_per').split(/\r?\n/)) {
          const m = /^\s*([^=:]{1,60}?)\s*[=:]\s*(\d{1,6})\s*$/.exec(line);
          if (m && m[1] !== '__proto__') rules.stock_per[m[1]!] = Number(m[2]);
        }
        const enabled = Object.fromEntries(Object.keys(c.enabled).map((k) => [k, fd.has(`en[${k}]`)])) as Enabled;
        const channels = fd.getAll('channels[]').map(String).filter((x) => ['telegram', 'webhook'].includes(x));
        const at = field(fd, 'backup_at', '03:00');
        const freq = field(fd, 'backup_freq');
        const target = field(fd, 'ping_target', '1.1.1.1');
        const patch: Partial<MonitorCfg> = {
          poll_min: num(fd, 'poll_min', 1, 60, 5),
          stock_min: num(fd, 'stock_min', 5, 1440, 30),
          ping_target: /^[A-Za-z0-9.\-:]{0,100}$/.test(target) ? target : '1.1.1.1',
          channels,
          enabled,
          rules,
          backup: {
            freq: freq === 'off' || freq === 'weekly' ? freq : 'daily',
            at: /^([01]?\d|2[0-3]):[0-5]\d$/.test(at) ? at : '03:00',
            dow: num(fd, 'backup_dow', 0, 6, 0),
            keep: num(fd, 'backup_keep', 1, 60, 7),
            binary: fd.has('backup_binary'),
          },
        };
        saveConfig(patch);
        Audit.log('monitor.save');
        return done(ctx.t('Saved.'));
      },
    },

    run: async (ctx, fd) => {
      const job = field(fd, 'job');
      const only = job === 'all' ? [] : (JOBS as readonly string[]).includes(job) ? [job] : null;
      if (only === null) return fail(ctx.t('Unknown action.'));
      const res = await runNow(ctx.workspace.id, only);
      if (res.locked) return fail(ctx.t('Another run is in progress. Try again in a moment.'));
      const msg = res.jobs.map((j) => `${j.job}: ${j.ok ? 'ok' : 'FAILED'} - ${j.msg}`).join(' | ');
      return { ok: true, message: msg, reload: true };
    },

    token: {
      cap: 'admin',
      run: (ctx) => {
        saveConfig({ cron_token: hex() });
        Audit.log('monitor.token');
        return done(ctx.t('New cron token generated. Update your cron jobs.'));
      },
    },

    test: {
      cap: 'admin',
      run: async (ctx, fd) => {
        const rid = field(fd, 'router');
        await alert(Routers.get(rid) ? rid : (ctx.router?.id ?? rid), 'test', 'info', ctx.t('Test alert from the Monitor page.'));
        return done(ctx.t('Test alert recorded. See the history and the notification log.'));
      },
    },

    /** Demo only: toggle a simulated outage so alerts can be demonstrated. */
    simulate: {
      cap: 'admin',
      run: (ctx, fd) => {
        const rid = field(fd, 'router');
        const cfg = ownRouters().find((r) => r.id === rid);
        if (!cfg || !isDemo(cfg)) return fail(ctx.t('Only available for demo routers.'));
        const c = config();
        const on = !c.sim_down.includes(rid);
        saveConfig({ sim_down: [...c.sim_down.filter((x) => x !== rid), ...(on ? [rid] : [])] });
        Audit.log('monitor.simulate', rid + (on ? ' down' : ' up'));
        return done(on ? ctx.t('Outage simulated: run a poll a few times to see the alert.') : ctx.t('Outage simulation stopped.'));
      },
    },
  },
  {
    cap: 'write',
    getCap: 'admin',
    /** GET ?router=<id>&file=<name>.rsc - download a stored scheduled export. */
    get: (ctx, req) => {
      const u = new URL(req.url);
      const rid = u.searchParams.get('router') ?? '';
      const file = (u.searchParams.get('file') ?? '').replace(/^.*[\\/]/, '');
      const text = /^[A-Za-z0-9_.-]+\.rsc$/.test(file) && ownRouters().some((r) => r.id === rid) ? backupText(rid, file) : null;
      if (text === null) throw new HttpError(404, ctx.t('File not found.'));
      Audit.log('monitor.backup.download', `${rid}/${file}`);
      return new Response(text, { headers: { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="${safe(file)}"`, 'cache-control': 'no-store' } });
    },
  },
);
