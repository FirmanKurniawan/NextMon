// Admin CLI: `npm run cli -- <command>`  (Node 22.18+/24 runs TypeScript directly). Same command names as the PHP edition's bin/nextmon.php.
//   doctor            data dir, key source, workspace/user counts
//   storage:status    SQLite file, schema version, integrity, documents and log sizes
//   storage:vacuum    checkpoint the WAL and VACUUM
//   tenant:status     multi-tenant state (workspaces, users, platform admins)
//   tenant:list       workspaces with status, slug, owner and limits
//   cache:clear       the Next edition keeps its speed caches in server memory only: nothing on disk to clear (restart the server)
//   crypto:rotate     new data key; re-encrypts router passwords, Telegram token, gateway keys (alias: rekey; stop the server first!)
//   cron              run the scheduler once: [--job=poll,stock,backup] [--workspace=ID] [--force] [--list] [--quiet]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const cmd = process.argv[2] ?? 'help';
const args = process.argv.slice(3);
const flag = (n: string): boolean => args.includes('--' + n);
const opt = (n: string): string | undefined => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const out = (s: string): void => console.log(s);

async function loadSources(): Promise<void> {
  await import('../src/lib/routers.ts'); // registers the router-password source
  const dir = path.resolve('src', 'features');
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const p = path.join(dir, f, 'secrets.ts'); // features with their own secrets register a SecretSource here
    if (fs.existsSync(p)) await import(pathToFileURL(p).href);
  }
}

const size = (f: string): number => (fs.existsSync(f) ? fs.statSync(f).size : 0);
const USAGE = 'usage: npm run cli -- doctor|storage:status|storage:vacuum|tenant:status|tenant:list|cache:clear|crypto:rotate|rekey|cron';

if (cmd === 'rekey' || cmd === 'crypto:rotate') {
  await loadSources();
  const { Crypto } = await import('../src/lib/crypto.ts');
  const n = Crypto.rotate();
  out(`OK: ${n} secret(s) re-encrypted. The previous key was kept next to the key file as *.bak-<time> - delete it after verifying.`);
} else if (cmd === 'doctor') {
  const { Env } = await import('../src/lib/env.ts');
  const { Workspace } = await import('../src/lib/workspace.ts');
  const { Users } = await import('../src/lib/users.ts');
  out('data dir      : ' + Env.dataDir());
  out('key source    : ' + (Env.secretFromEnv() ? 'NEXTMON_SECRET (env)' : 'key file in data dir'));
  out('workspaces    : ' + Workspace.all().length);
  out('users         : ' + Users.all().length);
} else if (cmd === 'storage:status') {
  const { db } = await import('../src/lib/db.ts');
  const d = db();
  const first = (sql: string): unknown => Object.values(d.st(sql).get() ?? {})[0];
  out('file       : ' + d.file + ` (${size(d.file)} bytes, wal ${size(d.file + '-wal')})`);
  out('schema     : v' + first('PRAGMA user_version') + '   journal: ' + first('PRAGMA journal_mode') + '   integrity: ' + first('PRAGMA integrity_check'));
  out('documents  : ' + (d.st('SELECT name FROM docs ORDER BY name').all().map((r) => String(r.name)).join(', ') || '-'));
  for (const r of d.st('SELECT name, COUNT(*) AS n FROM logs GROUP BY name ORDER BY name').all()) out(`log ${String(r.name).padEnd(24)} ${r.n} rows`);
  out('sessions   : ' + first('SELECT COUNT(*) AS n FROM sessions'));
} else if (cmd === 'storage:vacuum') {
  const { db } = await import('../src/lib/db.ts');
  const d = db();
  const before = size(d.file) + size(d.file + '-wal');
  d.st('PRAGMA wal_checkpoint(TRUNCATE)').get();
  d.st('VACUUM').run();
  out(`Vacuumed: ${before} -> ${size(d.file) + size(d.file + '-wal')} bytes`);
} else if (cmd === 'tenant:status') {
  const { Workspace } = await import('../src/lib/workspace.ts');
  const { Users } = await import('../src/lib/users.ts');
  const ws = Workspace.all();
  const users = Users.all();
  const row = (k: string, v: string | number): void => out(k.padEnd(26) + ' ' + v);
  row('workspaces', ws.length);
  row('active', ws.filter((w) => (w.status ?? 'active') === 'active').length);
  row('suspended', ws.filter((w) => w.status === 'suspended').length);
  row('users', users.length);
  row('platform admins', users.filter((u) => u.role === 'platform').map((u) => u.username).join(', ') || '-');
  row('workspace "main"', ws.some((w) => w.slug === 'main') ? 'yes' : 'no');
} else if (cmd === 'tenant:list') {
  const { Workspace } = await import('../src/lib/workspace.ts');
  const { Users } = await import('../src/lib/users.ts');
  for (const w of Workspace.all()) {
    const owner = Users.inWorkspace(w.id).find((u) => u.role === 'admin' || u.role === 'platform')?.username ?? '-';
    out(`${w.id.padEnd(12)} ${w.slug.padEnd(20)} ${(w.status ?? 'active').padEnd(10)} owner=${owner} limits=${JSON.stringify(Workspace.limits(w.id))}`);
  }
} else if (cmd === 'cache:clear') {
  out('Nothing to clear on disk: the Next edition keeps its speed caches in server memory only (restart the server to drop them).');
} else if (cmd === 'cron') {
  const { Workspace } = await import('../src/lib/workspace.ts');
  const { JOBS } = await import('../src/features/monitor/logic.ts');
  const { run, schedState } = await import('../src/features/scheduler/run.ts');
  if (flag('help')) {
    out('Usage: npm run cli -- cron [--job=poll,stock,backup] [--workspace=ID] [--force] [--list] [--quiet]');
    process.exit(0);
  }
  if (flag('list')) {
    for (const w of Workspace.all()) {
      const st = Workspace.run(w.id, () => schedState());
      out(`${w.id} (${w.slug}, ${w.status ?? 'active'})`);
      for (const j of JOBS) {
        const s = st.jobs?.[j];
        out(`  ${j.padEnd(8)} last=${s?.last ? new Date(s.last * 1000).toISOString().replace('T', ' ').slice(0, 19) : 'never'} ok=${s ? (s.ok ? 'yes' : 'NO') : '-'} ${s?.msg ?? ''}`);
      }
    }
    process.exit(0);
  }
  await loadSources();
  const job = opt('job');
  const only = job ? job.split(',').filter((j) => (JOBS as readonly string[]).includes(j)) : [];
  const wsId = opt('workspace');
  const res = await run({ only, force: flag('force'), source: 'cli', workspaces: wsId && Workspace.get(wsId) ? [wsId] : null });
  if (res.locked) {
    if (!flag('quiet')) console.error('Another scheduler run is still active (lock held).');
    process.exit(3);
  }
  let fail = false;
  for (const j of res.jobs) {
    fail = fail || !j.ok;
    if (!flag('quiet')) out(`[${new Date().toTimeString().slice(0, 8)}] ${j.ws} ${j.job.padEnd(7)} ${j.ran ? (j.ok ? 'ok' : 'FAILED') : 'skipped'}${j.ran ? ` (${j.ms} ms) ${j.msg}` : ' - ' + j.msg}`);
  }
  process.exit(fail ? 1 : 0);
} else {
  out(USAGE);
  process.exit(cmd === 'help' ? 0 : 1);
}
