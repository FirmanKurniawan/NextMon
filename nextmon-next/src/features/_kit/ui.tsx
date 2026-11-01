/** Server-side twins of the PHP helpers page_head(), empty_state(), badge(), pager(), user_status_badge(): identical markup/classes. */
import type { ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import type { TFn } from '../../lib/i18n.ts';
import type { AppContext } from '../types.ts';
import Flash from './FlashToast';

export function PageHead({ title, desc, children }: { title: string; desc?: string; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1 className="page-title">{title}</h1>
        {desc ? <p className="page-desc">{desc}</p> : null}
      </div>
      {children ? <div className="page-actions">{children}</div> : null}
      <Flash />
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

export function NoRouter({ t }: { t: TFn }) {
  return <Empty icon="router" title={t('No router configured')} />;
}

export function Badge({ kind = 'neutral', children }: { kind?: string; children: ReactNode }) {
  return <span className={`badge badge-${kind}`}>{children}</span>;
}

const ST: Record<string, [string, string]> = { online: ['Online', 'ok'], used: ['Used', 'info'], new: ['Unused', 'neutral'], expired: ['Expired', 'warn'], disabled: ['Disabled', 'err'] };
export function UserStatusBadge({ st, t }: { st: string; t: TFn }) {
  const [l, k] = ST[st] ?? [st, 'neutral'];
  return <Badge kind={k}>{t(l)}</Badge>;
}

export function CsrfField({ ctx }: { ctx: AppContext }) {
  return <input type="hidden" name="_csrf" value={ctx.csrf} />;
}

export function Pager({ pg, pages, total, params, t }: { pg: number; pages: number; total: number; params: Record<string, string | string[] | undefined>; t: TFn }) {
  if (pages <= 1) {
    return (
      <div className="pager">
        <span>{t(':n rows', { ':n': total })}</span>
      </div>
    );
  }
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (k !== 'page' && typeof v === 'string' && v !== '') q.set(k, v);
    q.set('page', String(p));
    return '?' + q.toString();
  };
  return (
    <div className="pager">
      <span>
        {t('Page :p of :n', { ':p': pg, ':n': pages })} &middot; {t(':n rows', { ':n': total })}
      </span>
      <div className="row">
        <a className="btn btn-sm" href={href(Math.max(1, pg - 1))} aria-disabled={pg <= 1 ? 'true' : undefined} tabIndex={pg <= 1 ? -1 : undefined}>
          &lsaquo; {t('Prev')}
        </a>
        <a className="btn btn-sm" href={href(Math.min(pages, pg + 1))} aria-disabled={pg >= pages ? 'true' : undefined} tabIndex={pg >= pages ? -1 : undefined}>
          {t('Next')} &rsaquo;
        </a>
      </div>
    </div>
  );
}

export function paginate<T>(rows: T[], page: unknown, per = 100): { rows: T[]; pg: number; pages: number } {
  const pages = Math.max(1, Math.ceil(rows.length / per));
  const pg = Math.max(1, Math.min(pages, Number.parseInt(String(page ?? '1'), 10) || 1));
  return { rows: rows.slice((pg - 1) * per, pg * per), pg, pages };
}

/** First value of a query parameter. */
export const qp = (sp: Record<string, string | string[] | undefined>, k: string): string => {
  const v = sp[k];
  return (Array.isArray(v) ? v[0] : v) ?? '';
};

/** Notice for a router shared read-only (write controls are hidden). */
export function RoNotice({ t }: { t: TFn }) {
  return (
    <div className="alert warn" style={{ marginBottom: 'var(--s4)' }}>
      <Icon name="alert" size={18} />
      <div>{t('This router is shared read-only: changes are disabled.')}</div>
    </div>
  );
}

/** JSON for a <script type="application/json"> element ("<" etc. neutralised so "</script>" can never end it). */
export const safeJson = (v: unknown): string => JSON.stringify(v).replace(/</g, '\u003c').replace(/>/g, '\u003e').replace(/&/g, '\u0026').replace(/\u2028/g, '\u2028').replace(/\u2029/g, '\u2029');

export function JsonData({ id, data }: { id: string; data: unknown }) {
  return <script type="application/json" id={id} dangerouslySetInnerHTML={{ __html: safeJson(data) }} />;
}

/** Page-specific stylesheet from the shared assets (React 19 hoists it into <head>). */
export function Css({ href }: { href: string }) {
  return <link rel="stylesheet" href={href} precedence="default" />;
}
