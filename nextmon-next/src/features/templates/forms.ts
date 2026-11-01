/** Port of VoucherController templateSave / templateDelete. */
import { sanitizeTemplateHtml } from '../../lib/sanitize.ts';
import { audit } from '../_kit/audit.ts';
import { raw, str, UserError } from '../_kit/forms.ts';
import type { FormRoute } from '../_kit/forms.ts';
import { deleteTemplate, saveTemplate } from '../vouchers/data.ts';

const BACK = '/vouchers/templates';
const clamp = (v: string, lo: number, hi: number, d: number) => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};

export const templateForms: Record<string, FormRoute> = {
  'vouchers/templates/save': {
    cap: 'write',
    back: BACK,
    run({ ctx, fd }) {
      const name = str(fd, 'name').slice(0, 40);
      const html = raw(fd, 'html');
      if (name === '' || html === '') throw new UserError(ctx.t('Name and HTML are required.'), BACK);
      // templates are plain markup + CSS: rebuilt through the allow-list sanitiser (a regex blacklist is bypassable)
      saveTemplate(str(fd, 'id'), name, sanitizeTemplateHtml(html.slice(0, 60000)), clamp(str(fd, 'w', '70'), 20, 300, 70), clamp(str(fd, 'h', '40'), 10, 300, 40));
      audit('template.save', name);
      return { to: BACK, msg: ctx.t('Template saved.') };
    },
  },

  'vouchers/templates/delete': {
    cap: 'write',
    back: BACK,
    run({ ctx, fd }) {
      deleteTemplate(str(fd, 'id'));
      audit('template.delete', str(fd, 'id'));
      return { to: BACK, msg: ctx.t('Template deleted.') };
    },
  },
};
