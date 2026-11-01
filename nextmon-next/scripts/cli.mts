// Admin CLI: `npm run cli -- <command>`  (Node 22.18+/24 runs TypeScript directly)
//   rekey    rotate the encryption key and re-encrypt every stored secret (stop the server first!)
//   doctor   print data dir, key source, workspace/user counts
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const cmd = process.argv[2] ?? 'help';

async function loadSources(): Promise<void> {
  await import('../src/lib/routers.ts'); // registers the router-password source
  const dir = path.resolve('src', 'features');
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const p = path.join(dir, f, 'secrets.ts'); // features with their own secrets register a SecretSource here
    if (fs.existsSync(p)) await import(pathToFileURL(p).href);
  }
}

if (cmd === 'rekey') {
  await loadSources();
  const { Crypto } = await import('../src/lib/crypto.ts');
  const n = Crypto.rotate();
  console.log(`OK: ${n} secret(s) re-encrypted. The previous key was kept next to the key file as *.bak-<time> - delete it after verifying.`);
} else if (cmd === 'doctor') {
  const { Env } = await import('../src/lib/env.ts');
  const { Workspace } = await import('../src/lib/workspace.ts');
  const { Users } = await import('../src/lib/users.ts');
  console.log('data dir      :', Env.dataDir());
  console.log('key source    :', Env.secretFromEnv() ? 'NEXTMON_SECRET (env)' : 'key file in data dir');
  console.log('workspaces    :', Workspace.all().length);
  console.log('users         :', Users.all().length);
} else {
  console.log('usage: npm run cli -- rekey | doctor');
  process.exit(cmd === 'help' ? 0 : 1);
}
