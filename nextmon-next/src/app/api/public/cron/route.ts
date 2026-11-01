import { Net } from '../../../../lib/net.ts';
import { run, tokenScope } from '../../../../features/scheduler/run.ts';
import { JOBS } from '../../../../features/monitor/logic.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const text = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });

/**
 * GET|POST /api/public/cron?token=SECRET[&job=poll,stock,backup] (or header X-Cron-Token) - web trigger for the scheduler, like
 * nextmon-php public/cron.php. Platform token = every active workspace; a workspace token = that workspace only.
 */
async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const given = req.headers.get('x-cron-token') ?? url.searchParams.get('token') ?? '';
  const scope = tokenScope(given);
  if (scope === null) {
    // brute-force throttle (the token is 128-bit, this is about noise)
    if (Net.hit('cronfail', Net.clientIp(req.headers), 10, 600)) return text('too many attempts\n', 429);
    await new Promise((r) => setTimeout(r, 1000));
    return text('forbidden\n', 403);
  }
  const job = (url.searchParams.get('job') ?? '').split(',').filter((j) => (JOBS as readonly string[]).includes(j));
  const res = await run({ only: job, source: 'web', workspaces: scope[0] === '*' ? null : scope });
  if (res.locked) return text('locked\n', 423);
  let fail = false;
  let out = '';
  for (const j of res.jobs) {
    fail = fail || !j.ok;
    out += `${j.ws} ${j.job} ${j.ran ? (j.ok ? 'ok' : 'FAILED') : 'skipped'}${j.ran ? ' ' + j.ms + 'ms' : ''}\n`;
  }
  return text(out, fail ? 500 : 200);
}

export const GET = handle;
export const POST = handle;
