import { Audit } from '../../lib/audit.ts';
import { Reseller } from '../../lib/reseller.ts';
import { jsonResponse } from '../../server/guard.ts';
import type { ApiRoute } from '../types.ts';
import { loadSales, reportFilters, summarize } from './data.ts';

const BOM = '\uFEFF';
const HEAD = ['Date', 'Time', 'User', 'Price', 'IP', 'MAC', 'Validity', 'Profile', 'Comment'];
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const csvField = (v: string | number) => {
  const s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

/** GET /json/reports/export?period&value&profile&format=csv|xls  (CSV / Excel-readable HTML table, formula-injection safe). */
export const reportsApi: ApiRoute = {
  cap: 'view',
  async GET(ctx, req, rest) {
    if (rest[0] !== 'export') return jsonResponse({ ok: false, error: 'not found' }, 404);
    if (!ctx.router) return jsonResponse({ ok: false, error: ctx.t('No router configured') }, 400);
    const q = Object.fromEntries(new URL(req.url).searchParams);
    const f = reportFilters(q);
    const { rows } = summarize(await loadSales(ctx), f);
    const fmt = q.format === 'xls' ? 'xls' : 'csv';
    const fname = `nextmon-sales-${f.value || 'all'}.${fmt}`;
    Audit.log('report.export', fname);
    const cells = (x: (typeof rows)[number]) => [x.date, x.time, x.user, Math.trunc(x.price), x.ip, x.mac, x.validity, x.profile, x.comment];
    const headers = { 'content-disposition': `attachment; filename="${fname}"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
    if (fmt === 'csv') {
      const lines = [HEAD.map(csvField).join(',')];
      for (const x of rows) lines.push(cells(x).map((c) => csvField(typeof c === 'number' ? c : Reseller.cell(c))).join(','));
      return new Response(BOM + lines.join('\r\n') + '\r\n', { headers: { ...headers, 'content-type': 'text/csv; charset=utf-8' } });
    }
    let h = `${BOM}<html><head><meta charset="utf-8"></head><body><table border="1"><tr>${HEAD.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>`;
    for (const x of rows) h += '<tr>' + cells(x).map((c) => `<td>${esc(Reseller.cell(String(c)))}</td>`).join('') + '</tr>';
    h += '</table></body></html>';
    return new Response(h, { headers: { ...headers, 'content-type': 'application/vnd.ms-excel; charset=utf-8' } });
  },
};
