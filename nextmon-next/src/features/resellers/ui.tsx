import { Badge } from '../_sales/ui';
import type { TFn } from '../../lib/i18n.ts';
import type { LedgerRow } from '../../lib/reseller.ts';

/** Shop order id carried by a ledger row (shop commission rows), or ''. */
export const orderOf = (r: { meta: Record<string, unknown> }): string => (typeof r.meta?.order === 'string' ? r.meta.order : '');

export function Assets() {
  return <link rel="stylesheet" href="/assets/css/mod-security.css" precedence="default" />;
}

export const TYPE_BADGE: Record<string, string> = { topup: 'ok', sale: 'info', refund: 'warn', commission: 'ok', adjustment: 'neutral' };
export const ucfirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** number_format($n, 0, ',', '.') */
export const num = (n: number) => String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
export const signed = (n: number) => (n > 0 ? '+' : '') + num(n);
/** Decimal without trailing zeros (commission 2.50 -> "2.5"). */
export const pct = (n: number) => String(Math.round(Number(n) * 100) / 100);

export function TypeBadge({ t, type }: { t: TFn; type: LedgerRow['type'] }) {
  return <Badge kind={TYPE_BADGE[type] ?? 'neutral'}>{t(ucfirst(type))}</Badge>;
}

const DATE_RE = /^\d{4}-\d\d-\d\d$/;
/** Ledger filters from the query string (same rules as ResellerController::filters). */
export function ledgerFilters(q: Record<string, string | string[] | undefined>, forceUid?: string) {
  const g = (k: string) => {
    const v = q[k];
    return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
  };
  return {
    uid: forceUid ?? g('uid'),
    type: g('type'),
    q: g('q'),
    from: DATE_RE.test(g('from')) ? g('from') : '',
    to: DATE_RE.test(g('to')) ? g('to') : '',
  };
}
