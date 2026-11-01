// Per-test-file isolated data dir (inside the project: the system temp drive may be full) + cheap scrypt for fast tests.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { afterAll } from 'vitest';

const base = path.resolve(process.cwd(), '.test-tmp');
const dir = path.join(base, crypto.randomBytes(5).toString('hex'));
fs.mkdirSync(dir, { recursive: true });
process.env.NEXTMON_DATA = dir;
process.env.NEXTMON_SCRYPT_LOG2N = '12';
delete process.env.NEXTMON_DEMO;
delete process.env.NEXTMON_SETUP_TOKEN;
delete process.env.NEXTMON_BASE_URL;
delete process.env.NEXTMON_SECRET;

afterAll(async () => {
  const { closeDb } = await import('../src/lib/db.ts');
  closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
  try {
    fs.rmdirSync(base); // only succeeds when empty
  } catch {
    /* other test files still running */
  }
});
