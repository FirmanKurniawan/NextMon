import { Audit } from '../../lib/audit.ts';
import { Reseller } from '../../lib/reseller.ts';
import { Users } from '../../lib/users.ts';
import { jsonResponse } from '../../server/guard.ts';
import type { ApiRoute } from '../types.ts';
import { ledgerFilters } from './ui.tsx';

const stamp = () => new Date().toISOString().replace(/\D/g, '').slice(0, 14).replace(/^(\d{8})/, '$1-');

function csvResponse(rows: ReturnType<typeof Reseller.rows>, names: Record<string, string>, name: string) {
  return new Response(Reseller.csv(rows, names), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}-${stamp()}.csv"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}

/**
 * GET /json/resellers/ledger (admin) and /json/resellers/wallet (the reseller's own rows; uid is forced from the session, so a
 * reseller can never export somebody else's ledger). CSV export, same filters as the pages.
 */
export const resellersApi: ApiRoute = {
  cap: 'sell',
  async GET(ctx, req, rest) {
    const q = Object.fromEntries(new URL(req.url).searchParams);
    const users = Users.inWorkspace(ctx.workspace.id);
    const names = Object.fromEntries(users.map((u) => [u.id, u.username]));
    if (rest[0] === 'ledger') {
      if (!ctx.can('admin')) return jsonResponse({ ok: false, error: 'forbidden' }, 403);
      const rows = Reseller.rows(ledgerFilters(q));
      Audit.log('reseller.ledger.export', `${rows.length} rows`);
      return csvResponse(rows, names, 'wallet-ledger');
    }
    if (rest[0] === 'wallet') {
      if (!Reseller.isReseller(ctx.user)) return jsonResponse({ ok: false, error: 'forbidden' }, 403);
      const rows = Reseller.rows(ledgerFilters(q, ctx.user.id));
      Audit.log('wallet.export', `${rows.length} rows`);
      return csvResponse(rows, names, 'my-wallet');
    }
    return jsonResponse({ ok: false, error: 'not found' }, 404);
  },
};
