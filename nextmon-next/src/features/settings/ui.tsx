/** Small server-side markup helpers (same HTML as the PHP page_head / badge / empty_state helpers). */
import type { ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import type { TFn } from '../../lib/i18n.ts';

export function PageHead({ title, desc, actions }: { title: string; desc?: string; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1 className="page-title">{title}</h1>
        {desc ? <p className="page-desc">{desc}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

export function Badge({ children, kind = 'neutral' }: { children: ReactNode; kind?: 'neutral' | 'ok' | 'warn' | 'err' | 'info' }) {
  return <span className={'badge badge-' + kind}>{children}</span>;
}

export function Empty({ icon, title, text }: { icon: string; title: string; text?: string }) {
  return (
    <div className="empty">
      <Icon name={icon} size={32} />
      <h3>{title}</h3>
      {text ? <p>{text}</p> : null}
    </div>
  );
}

export const Csrf = ({ value }: { value: string }) => <input type="hidden" name="_csrf" value={value} />;

/** yyyy-mm-dd hh:mm[:ss] in the workspace time zone. */
export function stamp(ts: number, tz: string, secs = false): string {
  try {
    const p = new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(ts * 1000));
    return secs ? p : p.slice(0, 16);
  } catch {
    return new Date(ts * 1000).toISOString().slice(0, secs ? 19 : 16).replace('T', ' ');
  }
}

/** "5 min ago" style relative time. */
export const agoStr = (t: TFn, ts: number): string => {
  const d = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (d < 60) return t('just now');
  if (d < 3600) return t(':n min ago', { ':n': Math.floor(d / 60) });
  if (d < 86400) return t(':n h ago', { ':n': Math.floor(d / 3600) });
  return t(':n d ago', { ':n': Math.floor(d / 86400) });
};
