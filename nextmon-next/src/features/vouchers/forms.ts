/** Port of VoucherController generate / quick / deleteBatch / preset*. */
import { Voucher } from '../../lib/voucher.ts';
import { audit } from '../_kit/audit.ts';
import { raw, str, UserError } from '../_kit/forms.ts';
import type { FormRoute } from '../_kit/forms.ts';
import { generateBatch } from './generate.ts';
import { cleanOpts, deletePreset, presets, savePreset, setDefaultPreset } from './data.ts';

const BACK = '/vouchers';

export const voucherForms: Record<string, FormRoute> = {
  'vouchers/generate': {
    cap: 'sell',
    back: BACK,
    run: ({ ctx, fd }) => generateBatch(ctx, fd),
  },

  // Single-voucher quick print: code -> print view of that one user.
  'vouchers/quick': {
    cap: 'sell',
    back: BACK,
    run({ ctx, fd }) {
      const code = str(fd, 'code');
      if (code === '') throw new UserError(ctx.t('Enter a voucher code.'), BACK);
      return { to: '/vouchers/print?user=' + encodeURIComponent(code) };
    },
  },

  'vouchers/delete': {
    cap: 'write',
    back: BACK,
    async run({ ctx, fd }) {
      const r = ctx.driver();
      const tag = str(fd, 'tag');
      const del: string[] = [];
      if (tag !== '') for (const u of await r.print('/ip/hotspot/user', {}, ['name', 'comment'])) if (Voucher.batchOf(u.comment ?? '') === tag) del.push(u['.id'] ?? '');
      await r.removeMany('/ip/hotspot/user', del.filter(Boolean)); // pipelined: 100 removals per round trip
      audit('vouchers.delete', `${tag} (${del.length})`);
      return { to: BACK, msg: ctx.t('Deleted :n users.', { ':n': del.length }) };
    },
  },

  'vouchers/preset/save': {
    cap: 'sell',
    back: BACK,
    json: true,
    run({ ctx, fd }) {
      const name = str(fd, 'name').slice(0, 40);
      let opts: unknown = null;
      try {
        opts = JSON.parse(raw(fd, 'opts') || '{}');
      } catch {
        /* invalid JSON: rejected below */
      }
      if (name === '' || typeof opts !== 'object' || opts === null || Array.isArray(opts)) return { json: { ok: false, error: ctx.t('Name and HTML are required.') }, status: 422 };
      const id = savePreset(name, cleanOpts(opts));
      audit('voucher.preset', name);
      return { json: { ok: true, id, presets: presets() } };
    },
  },

  'vouchers/preset/delete': {
    cap: 'sell',
    back: BACK,
    json: true,
    run({ fd }) {
      deletePreset(str(fd, 'id'));
      return { json: { ok: true, presets: presets() } };
    },
  },

  'vouchers/preset/default': {
    cap: 'write',
    back: BACK,
    json: true,
    run({ fd }) {
      return { json: { ok: setDefaultPreset(str(fd, 'id')) } };
    },
  },
};
