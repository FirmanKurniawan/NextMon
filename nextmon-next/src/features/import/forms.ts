/** Port of ImportController preview / commit / cancel. */
import { check, QuotaError, release, reserve } from '../../lib/quota.ts';
import { audit } from '../_kit/audit.ts';
import { str, UserError } from '../_kit/forms.ts';
import type { FormRoute } from '../_kit/forms.ts';
import * as Imp from './data.ts';
import type { PreviewRow, Result, RowError, RowState } from './data.ts';

const BACK = '/import';
const CHUNK = 100; // rows per pipelined burst (RouterOS.PIPE_CHUNK in the PHP edition)

export const importForms: Record<string, FormRoute> = {
  'import/preview': {
    cap: 'write',
    back: BACK,
    async run({ ctx, fd }) {
      const t = ctx.t;
      const f = fd.get('csv');
      if (!(f instanceof File) || (f.size === 0 && f.name === '')) throw new UserError(t('Choose a CSV file first.'));
      if (f.size > Imp.MAX_BYTES) throw new UserError(t('File is too large (max :n MB).', { ':n': Imp.MAX_BYTES / 1048576 }));
      if (!/\.(csv|txt)$/i.test(f.name)) throw new UserError(t('Only .csv files are accepted.'));
      const mode = str(fd, 'mode') === 'overwrite' ? 'overwrite' : 'skip';
      const { map, rows: raw, error } = Imp.parseCsv(Imp.decodeCsv(new Uint8Array(await f.arrayBuffer())), t);
      if (map === null || error !== '') throw new UserError(error || t('The file is empty.'));
      if (raw.length === 0) throw new UserError(t('The file has a header but no data rows.'));
      const rc = await Imp.routerContext(ctx.driver());
      const seen = new Map<string, number>();
      const rows: PreviewRow[] = [];
      const counts: Record<RowState, number> = { new: 0, update: 0, skip: 0, error: 0 };
      for (const r of raw) {
        const { d, err } = Imp.checkRow(r.cells, map, rc, t);
        const name = d.name ?? '';
        if (err.length === 0 && seen.has(name)) err.push(t('Duplicate of line :n in this file.', { ':n': seen.get(name)! }));
        if (err.length === 0 && name !== '') seen.set(name, r.line);
        const exists = name !== '' && rc.existing.has(name);
        const st: RowState = err.length ? 'error' : exists ? (mode === 'overwrite' ? 'update' : 'skip') : 'new';
        counts[st]++;
        rows.push({ line: r.line, st, exists, d, err });
      }
      const token = Imp.create(ctx.session.hash, { rows, mode, counts, file: f.name.slice(0, 120), router: ctx.router?.id ?? '', cols: map.filter(Boolean), fatal: error });
      audit('users.import.preview', `${f.name}: ${JSON.stringify(counts)}`);
      return { to: '/import/preview?t=' + token };
    },
  },

  'import/commit': {
    cap: 'write',
    back: BACK,
    async run({ ctx, fd }) {
      const t = ctx.t;
      const token = str(fd, 't');
      const j = Imp.load(token, ctx.session.hash);
      if (!j) throw new UserError(t('Import session expired. Upload the file again.'));
      if (j.router !== (ctx.router?.id ?? '')) throw new UserError(t('The selected router changed since the preview. Upload the file again.'), '/import/preview?t=' + token);
      const mode = str(fd, 'mode') === 'overwrite' ? 'overwrite' : 'skip';
      const dry = str(fd, 'dry') === '1';
      const r = ctx.driver();
      const existing = new Map<string, string>();
      for (const u of await r.print('/ip/hotspot/user', {}, ['name'])) existing.set(u.name ?? '', u['.id'] ?? '');
      // daily voucher limit: the whole file is refused when the new users would not fit (a dry run only checks, a real run reserves)
      const fresh = new Set<string>();
      for (const row of j.rows) {
        const nm = row.d.name ?? '';
        if (row.st !== 'error' && nm !== '' && !existing.has(nm)) fresh.add(nm);
      }
      let quota: ReturnType<typeof reserve> = null;
      try {
        if (dry) check(fresh.size);
        else quota = reserve(fresh.size);
      } catch (e) {
        if (e instanceof QuotaError) throw new UserError(t(e.key, e.params), '/import/preview?t=' + token);
        throw e;
      }
      const res: Result = { added: 0, updated: 0, skipped: 0, errors: 0, dry, mode, file: j.file, ts: Math.floor(Date.now() / 1000), rowErrors: [] };
      // Router writes are queued and sent pipelined; per-row error reporting is kept. A name that appears twice in the file
      // flushes the queue first so the second row sees the id of the first (same result as a row-by-row loop).
      type Q = { idx: number; line: number; name: string; attrs: Record<string, string> };
      let sets: (Q & { id: string })[] = [];
      let adds: Q[] = [];
      let pend = new Set<string>();
      const errs: [number, RowError][] = [];
      const fail = (x: Q, message: string) => {
        res.errors++;
        errs.push([x.idx, { line: x.line, name: x.name, error: message }]);
      };
      const flush = async () => {
        if (sets.length) {
          let out: { err: string | null }[];
          try {
            out = await r.setTry(
              '/ip/hotspot/user',
              sets.map((x): [string, Record<string, string>] => [x.id, x.attrs]),
            );
          } catch (e) {
            out = sets.map(() => ({ err: e instanceof Error ? e.message : String(e) })); // transport failure: every queued row reports it
          }
          sets.forEach((x, i) => (out[i]?.err ? fail(x, out[i]!.err!) : res.updated++));
          sets = [];
        }
        if (adds.length) {
          let out: { id: string; err: string | null }[];
          try {
            out = await r.addTry(
              '/ip/hotspot/user',
              adds.map((x) => x.attrs),
            );
          } catch (e) {
            out = adds.map(() => ({ id: '', err: e instanceof Error ? e.message : String(e) }));
          }
          adds.forEach((x, i) => {
            if (out[i]?.err) fail(x, out[i]!.err!);
            else {
              existing.set(x.name, out[i]?.id ?? '');
              res.added++;
            }
          });
          adds = [];
        }
        pend = new Set();
      };
      try {
        for (const [idx, row] of j.rows.entries()) {
          const d = row.d;
          const name = d.name ?? '';
          if (row.st === 'error') {
            res.errors++;
            errs.push([idx, { line: row.line, name, error: row.err.join('; ') }]);
            continue;
          }
          if (pend.has(name)) await flush();
          const id = existing.get(name);
          if (id !== undefined && mode === 'skip') {
            res.skipped++;
            continue;
          }
          if (id !== undefined) {
            const attrs = Object.fromEntries(Object.entries(d).filter(([k, v]) => k !== 'name' && k !== 'server' && v !== ''));
            if (!dry && Object.keys(attrs).length) {
              sets.push({ idx, line: row.line, name, id, attrs });
              pend.add(name);
            } else res.updated++;
          } else {
            const attrs: Record<string, string> = Object.fromEntries(Object.entries(d).filter(([, v]) => v !== ''));
            if (attrs.server === 'all') delete attrs.server;
            if (attrs.disabled === 'no') delete attrs.disabled;
            attrs.profile ??= 'default';
            if (!dry) {
              adds.push({ idx, line: row.line, name, attrs });
              pend.add(name);
            } else res.added++;
          }
          if (sets.length + adds.length >= CHUNK) await flush();
        }
      } finally {
        await flush(); // also when the loop was cut short by an exception: whatever was queued still goes out
        release(quota, fresh.size - res.added); // rows that failed / were skipped / never ran give their units back
      }
      res.rowErrors = errs.sort((a, b) => a[0] - b[0]).map((e) => e[1]);
      Imp.saveResult(token, res);
      if (!dry) Imp.dropRows(token); // passwords no longer need to sit in the store (a dry run keeps them for the real run)
      audit(dry ? 'users.import.dry' : 'users.import', `${j.file}: +${res.added} ~${res.updated} skip ${res.skipped} err ${res.errors}`);
      return { to: '/import/result?t=' + token };
    },
  },

  'import/cancel': {
    cap: 'write',
    back: BACK,
    run({ ctx, fd }) {
      const token = str(fd, 't');
      if (Imp.load(token, ctx.session.hash) || Imp.loadResult(token, ctx.session.hash)) Imp.drop(token);
      return { to: BACK };
    },
  },
};
