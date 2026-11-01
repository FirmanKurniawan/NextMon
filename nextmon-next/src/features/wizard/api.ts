import { Audit } from '../../lib/audit.ts';
import type { ApiRoute } from '../types.ts';
import { buildZip } from './zip.ts';
import { readTemplateFile, TEMPLATE_DIR_NAME, templateDir, templateFiles } from './template.ts';

/** GET /api/json/wizard/template.zip - the hotspot login template as hotspot-nextmon.zip. */
export const wizardApi: ApiRoute = {
  cap: 'admin',
  GET(ctx, _req, rest) {
    if (rest[0] !== 'template.zip') return { ok: false, error: 'not found' };
    const dir = templateDir();
    if (!dir) return { ok: false, error: ctx.t('Template folder or the PHP zip extension is not available.') };
    const zip = buildZip(Object.keys(templateFiles(dir)).map((rel) => ({ name: `${TEMPLATE_DIR_NAME}/${rel}`, data: readTemplateFile(dir, rel) })));
    Audit.log('wizard.template.zip');
    return new Response(new Uint8Array(zip), {
      headers: { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="hotspot-nextmon.zip"', 'content-length': String(zip.length), 'cache-control': 'no-store' },
    });
  },
};
