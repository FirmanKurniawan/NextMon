/**
 * Scheduler (port of nextmon-php Scheduler.php + cron.php): runs the monitor jobs (poll, stock, backup) of every ACTIVE workspace,
 * each inside Workspace.run so data never mixes. Two triggers: the in-process timer (startScheduler, booted from
 * instrumentation-node.ts) and the authenticated endpoint /api/public/cron (token = platform or workspace cron token).
 * One run at a time per process (a flag kept on globalThis).
 */
import { timingSafeEqual } from 'node:crypto';
import { Audit } from '../../lib/audit.ts';
import { Store, getSettings } from '../../lib/store.ts';
import { singleton } from '../../lib/singleton.ts';
import { Workspace } from '../../lib/workspace.ts';
import { backupDue, config, hex, JOBS, runJob } from '../monitor/logic.ts';
import type { JobName } from '../monitor/logic.ts';

export { JOBS };
export type JobState = { last: number; ok: boolean; msg: string; ms: number; runs: number; source: string };
export type SchedState = { jobs?: Partial<Record<JobName, JobState>>; last_tick?: number; last_source?: string };
export type JobRow = { ws: string; job: string; ran: boolean; ok: boolean; msg: string; ms: number };

const lock = singleton('scheduler.lock', () => ({ busy: false }));

export const schedState = (): SchedState => Store.read<SchedState>('scheduler', {});

const same = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Token that lets the cron endpoint run every workspace (global `platform` doc). */
export function platformCronToken(): string {
  let tok = '';
  Store.global('platform').update<Record<string, unknown>>((p) => {
    if (!p.cron_token) p = { ...p, cron_token: hex() };
    tok = String(p.cron_token);
    return p;
  }, {});
  return tok;
}

/** ['*'] = every active workspace (platform token), [id] = the workspace whose own token it is, null = invalid. Suspended ones never match. */
export function tokenScope(given: string): string[] | null {
  if (given === '') return null;
  let hit: string[] | null = same(platformCronToken(), given) ? ['*'] : null;
  for (const w of Workspace.all()) {
    if ((w.status ?? 'active') !== 'active') continue;
    // no early exit: same work wherever (or whether) a token matches
    const t = Workspace.run(w.id, () => Store.read<{ cron_token?: string }>('monitor', {}).cron_token ?? '');
    if (t !== '' && same(t, given) && hit === null) hit = [w.id];
  }
  return hit;
}

export function due(job: JobName, last: Partial<JobState>, now: number): boolean {
  const c = config();
  const lastRun = last.last ?? 0;
  switch (job) {
    case 'poll':
      return now - lastRun >= Math.max(1, c.poll_min) * 60 - 20;
    case 'stock':
      return now - lastRun >= Math.max(1, c.stock_min) * 60 - 20;
    case 'backup':
      return backupDue(c, lastRun, now, String(getSettings().timezone || 'UTC'));
  }
}

/** The job loop for the ACTIVE workspace. */
export async function runWorkspace(ws: string, only: string[], force: boolean, source: string): Promise<JobRow[]> {
  const out: JobRow[] = [];
  const now = Math.floor(Date.now() / 1000);
  for (const job of JOBS) {
    if (only.length && !only.includes(job)) continue;
    const js = schedState().jobs?.[job] ?? {};
    if (!force && !due(job, js, now)) {
      out.push({ ws, job, ran: false, ok: true, msg: 'not due', ms: 0 });
      continue;
    }
    const t0 = Date.now();
    let msg: string;
    let ok = true;
    try {
      msg = await runJob(job);
    } catch (e) {
      msg = (e as Error).message;
      ok = false;
      console.error(`[nextmon-cron] ${ws} ${job}:`, e);
    }
    const ms = Date.now() - t0;
    const at = Math.floor(Date.now() / 1000);
    Store.update<SchedState>('scheduler', (s) => ({ ...s, last_tick: at, jobs: { ...(s.jobs ?? {}), [job]: { last: at, ok, msg: msg.slice(0, 400), ms, runs: ((js as Partial<JobState>).runs ?? 0) + 1, source } } }), {});
    out.push({ ws, job, ran: true, ok, msg, ms });
  }
  Store.update<SchedState>('scheduler', (s) => ({ ...s, last_tick: Math.floor(Date.now() / 1000), last_source: source }), {});
  return out;
}

/** Run the due jobs of every ACTIVE workspace (or of `workspaces`). `locked` = another run is in progress in this process. */
export async function run(opts: { only?: string[]; force?: boolean; source?: string; workspaces?: string[] | null } = {}): Promise<{ locked: boolean; jobs: JobRow[] }> {
  if (lock.busy) return { locked: true, jobs: [] };
  lock.busy = true;
  const out: JobRow[] = [];
  try {
    const active = Workspace.all()
      .filter((w) => (w.status ?? 'active') === 'active')
      .map((w) => w.id);
    const ids = opts.workspaces ? active.filter((id) => opts.workspaces!.includes(id)) : active;
    for (const ws of ids) {
      try {
        out.push(...(await Workspace.run(ws, () => runWorkspace(ws, opts.only ?? [], !!opts.force, opts.source ?? 'timer'))));
      } catch (e) {
        console.error(`[nextmon-cron] workspace ${ws}:`, e);
        out.push({ ws, job: '*', ran: true, ok: false, msg: (e as Error).message, ms: 0 });
      }
    }
  } finally {
    lock.busy = false;
  }
  return { locked: false, jobs: out };
}

/** Run jobs for ONE workspace from the UI ("Run now"), audited. Shares the lock with the timer. */
export async function runNow(ws: string, only: string[]): Promise<{ locked: boolean; jobs: JobRow[] }> {
  const r = await run({ only, force: true, source: 'ui', workspaces: [ws] });
  if (!r.locked) Audit.log('monitor.run', only.join(',') || 'all');
  return r;
}

/** Start the in-process timer once (every minute; each job decides itself whether it is due). */
export function startScheduler(): void {
  const s = singleton('scheduler.timer', () => ({ started: false }));
  if (s.started || process.env.NEXTMON_SCHEDULER === '0' || process.env.NODE_ENV === 'test' || process.env.VITEST) return;
  s.started = true;
  const tick = () => void run({ source: 'timer' }).catch((e) => console.error('[nextmon-cron] tick failed', e));
  setTimeout(tick, 20_000).unref();
  setInterval(tick, 60_000).unref();
}
