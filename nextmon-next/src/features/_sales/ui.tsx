import type { ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import type { TFn } from '../../lib/i18n.ts';

/** Same markup as the PHP helpers page_head() / empty_state() / badge() / pager(). */
export function PageHead({ title, desc, children }: { title: string; desc?: string; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1 className="page-title">{title}</h1>
        {desc ? <p className="page-desc">{desc}</p> : null}
      </div>
      {children ? <div className="page-actions">{children}</div> : null}
    </div>
  );
}

export function Empty({ icon, title, text, children }: { icon: string; title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={32} />
      <h3>{title}</h3>
      {text ? <p>{text}</p> : null}
      {children}
    </div>
  );
}

export function Badge({ kind = 'neutral', children }: { kind?: string; children: ReactNode }) {
  return <span className={'badge badge-' + kind}>{children}</span>;
}

export { default as NoRouter } from '../_kit/NoRouter';

export const paginate = <T,>(rows: T[], per: number, raw: string | string[] | undefined): { page: T[]; pg: number; pages: number } => {
  const pages = Math.max(1, Math.ceil(rows.length / per));
  const pg = Math.max(1, Math.min(pages, Number.parseInt(String(Array.isArray(raw) ? raw[0] : raw ?? '1'), 10) || 1));
  return { page: rows.slice((pg - 1) * per, pg * per), pg, pages };
};

export const qs = (o: Record<string, string | number | undefined | null>): string => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? '?' + s : '';
};

export function Pager({ t, path, query, pg, pages, total }: { t: TFn; path: string; query: Record<string, string>; pg: number; pages: number; total: number }) {
  if (pages <= 1) {
    return (
      <div className="pager">
        <span>{t(':n rows', { ':n': total })}</span>
      </div>
    );
  }
  const link = (p: number, label: ReactNode, dis: boolean) => (
    <a className="btn btn-sm" href={path + qs({ ...query, page: p })} {...(dis ? { 'aria-disabled': true, tabIndex: -1 } : {})}>
      {label}
    </a>
  );
  return (
    <div className="pager">
      <span>
        {t('Page :p of :n', { ':p': pg, ':n': pages })} &middot; {t(':n rows', { ':n': total })}
      </span>
      <div className="row">
        {link(Math.max(1, pg - 1), <>&lsaquo; {t('Prev')}</>, pg <= 1)}
        {link(Math.min(pages, pg + 1), <>{t('Next')} &rsaquo;</>, pg >= pages)}
      </div>
    </div>
  );
}

/** First value of a search param. */
export const sp = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));
