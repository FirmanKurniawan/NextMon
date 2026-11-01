/** Small server-rendered building blocks that match the PHP helpers (page_head, empty_state, badge, pager) and its markup. */
import type { ReactNode } from 'react';
import { Icon } from '../../components/Icon';

export function NetAssets() {
  // React 19 hoists the stylesheet into <head>; net-forms.js (progressive form posting + flash toasts) is loaded via feature `scripts`.
  return <link rel="stylesheet" href="/assets/css/mod-network.css" precedence="default" />;
}

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

export function Badge({ kind = 'neutral', children }: { kind?: 'ok' | 'err' | 'warn' | 'info' | 'neutral'; children: ReactNode }) {
  return <span className={`badge badge-${kind}`}>{children}</span>;
}

export function Pager({ page, pages, total, params, path, t }: { page: number; pages: number; total: number; params: Record<string, string>; path: string; t: (k: string, p?: Record<string, string | number>) => string }) {
  if (pages <= 1)
    return (
      <div className="pager">
        <span>{t(':n rows', { ':n': total })}</span>
      </div>
    );
  const href = (p: number) => {
    const q = new URLSearchParams({ ...params, page: String(p) });
    return `${path}?${q.toString()}`;
  };
  return (
    <div className="pager">
      <span>
        {t('Page :p of :n', { ':p': page, ':n': pages })} &middot; {t(':n rows', { ':n': total })}
      </span>
      <div className="row">
        <a className="btn btn-sm" href={href(Math.max(1, page - 1))} aria-disabled={page <= 1 ? 'true' : undefined} tabIndex={page <= 1 ? -1 : undefined}>
          &lsaquo; {t('Prev')}
        </a>
        <a className="btn btn-sm" href={href(Math.min(pages, page + 1))} aria-disabled={page >= pages ? 'true' : undefined} tabIndex={page >= pages ? -1 : undefined}>
          {t('Next')} &rsaquo;
        </a>
      </div>
    </div>
  );
}

/** Modal header + footer pieces used by every edit dialog. */
export function ModalHead({ id, title, t }: { id: string; title: string; t: (k: string) => string }) {
  return (
    <div className="modal-h">
      <h2 id={id}>{title}</h2>
      <button type="button" className="btn btn-ghost btn-icon" data-close aria-label={t('Close')}>
        <Icon name="x" />
      </button>
    </div>
  );
}
export function ModalFoot({ t, ok }: { t: (k: string) => string; ok?: string }) {
  return (
    <div className="modal-f">
      <button type="button" className="btn" data-close>
        {t('Cancel')}
      </button>
      <button className="btn btn-primary">{ok ?? t('Save')}</button>
    </div>
  );
}

/** Notice shown when the router is shared read-only: write controls are rendered disabled. */
export function RoNotice({ t }: { t: (k: string) => string }) {
  return (
    <div className="alert warn" style={{ marginBottom: 'var(--s4)' }}>
      <Icon name="alert" size={18} />
      <div>{t('This router is shared read-only: changes are disabled.')}</div>
    </div>
  );
}

export { default as NoRouter } from '../_kit/NoRouter';
