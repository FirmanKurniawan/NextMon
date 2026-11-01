import { Audit } from '../../lib/audit.ts';
import { getSettings } from '../../lib/store.ts';
import { zonedParts } from '../../lib/sales.ts';
import { jsonResponse } from '../../server/guard.ts';
import type { ApiRoute } from '../types.ts';
import { csvCell, filtered, filterOf } from './filter.ts';

const p2 = (n: number) => String(n).padStart(2, '0');
const field = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

/** GET /json/orders/export?status&gateway&q&from&to : CSV of the filtered orders (formula-injection safe). */
export const ordersApi: ApiRoute = {
  cap: 'write',
  async GET(_ctx, req, rest) {
    if (rest[0] !== 'export') return jsonResponse({ ok: false, error: 'not found' }, 404);
    const f = filterOf(Object.fromEntries(new URL(req.url).searchParams));
    const rows = await filtered(f);
    const tz = String(getSettings().timezone || 'UTC');
    const when = (ts: number) => {
      const p = zonedParts(ts, tz);
      return `${p.y}-${p2(p.mo)}-${p2(p.d)} ${p2(p.h)}:${p2(p.mi)}:${p2(p.s)}`;
    };
    const lines = [['order', 'created', 'paid_at', 'status', 'package', 'profile', 'amount', 'name', 'phone', 'email', 'gateway', 'gateway_ref', 'voucher', 'fulfil', 'flag'].join(',')];
    for (const o of rows) {
      lines.push(
        [o.id, when(o.created), o.paid_at ? when(o.paid_at) : '', o.status, o.package.label, o.package.profile, o.amount, o.customer.name ?? '', o.customer.phone ?? '', o.customer.email ?? '', o.gateway, o.ref, o.voucher?.user ?? '', o.fulfil ?? '', o.flag ?? '']
          .map((v) => field(csvCell(v)))
          .join(','),
      );
    }
    const p = zonedParts(Math.floor(Date.now() / 1000), tz);
    const fname = `orders-${p.y}${p2(p.mo)}${p2(p.d)}-${p2(p.h)}${p2(p.mi)}${p2(p.s)}.csv`;
    Audit.log('shop.export', fname);
    return new Response('﻿' + lines.join('\r\n') + '\r\n', {
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${fname}"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    });
  },
};
