import type { ReactNode } from 'react';
import type { AppContext } from '../server/context.ts';
import { buildNav, groupOf, tabItems } from '../nav/registry.ts';
import type { NavGroup } from '../nav/registry.ts';
import { Workspace } from '../lib/workspace.ts';
import { Routers } from '../lib/routers.ts';
import { logoutAction, selectRouterAction, switchWorkspaceAction } from '../app/(app)/actions.ts';
import { BrandMark, Icon } from './Icon';
import { JS_KEYS, JS_STRINGS } from './shellStrings';
import ClientBoot from './ClientBoot';

const ACCENTS = ['teal', 'blue', 'violet', 'emerald', 'rose'] as const;

/** JSON for a <script type="application/json"> element: neutralise "<" so "</script>" can never terminate it. */
export function safeJson(v: unknown): string {
  return JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function CsrfField({ ctx }: { ctx: AppContext }) {
  return <input type="hidden" name="_csrf" value={ctx.csrf} />;
}

function NavLinks({ nav, page, withTitles, t }: { nav: NavGroup[]; page: string; withTitles: boolean; t: AppContext['t'] }) {
  return (
    <>
      {nav.map((g) => (
        <div key={g.group} style={{ display: 'contents' }}>
          {withTitles ? <div className="nav-title">{t(g.group)}</div> : null}
          {g.items.map((i) => (
            <a key={i.key} className="nav-link" href={i.href} data-key={i.key} aria-label={t(i.label)} aria-current={i.key === page ? 'page' : undefined}>
              <Icon name={i.icon} size={18} />
              <span className="nav-label">{t(i.label)}</span>
            </a>
          ))}
        </div>
      ))}
    </>
  );
}

/**
 * App shell: sidebar, topbar (search, router + workspace switchers, user menu with theme/accent/density/language), mobile bottom
 * tab bar, drawer, command palette, confirm dialog, toasts. Markup/classes/data-attributes are the PHP layout's, so the shared
 * design system (app.css) and behaviour (app.js) apply unchanged.
 */
export default function Shell({ ctx, page, title, scripts, nonce, back, children }: { ctx: AppContext; page: string; title: string; scripts: string[]; nonce: string; back: string; children: ReactNode }) {
  const t = ctx.t;
  const nav = buildNav((c) => ctx.can(c));
  const tabs = tabItems(nav);
  const groupName = groupOf(nav, page);
  const user = ctx.user;
  const initial = user.username.slice(0, 1).toUpperCase();
  const rs = ctx.run(() => Routers.list());
  const workspaces = ctx.can('platform') ? Workspace.all() : [];
  const dict: Record<string, string> = {};
  for (const k of JS_STRINGS) dict[k] = t(k);
  for (const [short, en] of Object.entries(JS_KEYS)) dict[short] = t(en);
  const roleLabel = t(user.role.charAt(0).toUpperCase() + user.role.slice(1));

  return (
    <>
      <a className="skip" href="#main">
        {t('Skip to content')}
      </a>
      <div className="bg" aria-hidden="true" />
      <div className="app">
        <aside className="sidebar glass" id="sidebar" aria-label={t('Main navigation')}>
          <a className="brand" href="/">
            <span className="brand-mark">
              <BrandMark size={18} />
            </span>
            <span>NextMON</span>
          </a>
          <nav>
            <NavLinks nav={nav} page={page} withTitles t={t} />
          </nav>
          {ctx.router ? (
            <div className="sb-foot">
              <span className="live-dot" aria-hidden="true" />
              <b>{ctx.router.name}</b>
            </div>
          ) : null}
        </aside>

        <div className="shell">
          <header className="topbar glass">
            <button className="btn btn-ghost btn-icon menu-btn" type="button" data-drawer-open aria-label={t('Open menu')}>
              <Icon name="menu" />
            </button>
            <button className="btn btn-ghost btn-icon hide-m" type="button" data-sidebar-toggle aria-label={t('Collapse sidebar')}>
              <Icon name="sidebar" />
            </button>
            <div className="crumbs">
              <span className="hide-m">NextMON</span>
              {groupName ? (
                <>
                  <span className="hide-m sep">/</span>
                  <span className="hide-m">{t(groupName)}</span>
                  <span className="hide-m sep">/</span>
                </>
              ) : null}
              <b>{title}</b>
            </div>
            <div className="spacer" />
            <button className="btn btn-sm" type="button" data-palette-open aria-keyshortcuts="Control+K" aria-label={t('Search') + ' Ctrl K'}>
              <Icon name="search" size={16} />
              <span className="hide-m">{t('Search')}</span> <kbd className="hide-m">Ctrl K</kbd>
            </button>
            {ctx.can('platform') && workspaces.length > 0 ? (
              <form action={switchWorkspaceAction} className="row" style={{ flexWrap: 'nowrap' }}>
                <CsrfField ctx={ctx} />
                <input type="hidden" name="back" value={back} />
                <label className="sr-only" htmlFor="ws-sel">
                  {t('Workspace')}
                </label>
                <select key={ctx.workspace.id} id="ws-sel" name="workspace" className="select select-sm" data-autosubmit defaultValue={ctx.workspace.id} style={{ maxWidth: 170 }}>
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                      {w.id === ctx.user.workspace ? ' *' : ''}
                    </option>
                  ))}
                </select>
                <noscript>
                  <button className="btn btn-sm">{t('Go')}</button>
                </noscript>
              </form>
            ) : null}
            {rs.length > 0 ? (
              <form action={selectRouterAction} className="row" style={{ flexWrap: 'nowrap' }}>
                <CsrfField ctx={ctx} />
                <input type="hidden" name="back" value={back} />
                <label className="sr-only" htmlFor="router-sel">
                  {t('Router')}
                </label>
                <select key={ctx.router?.id ?? 'none'} id="router-sel" name="router" className="select select-sm" data-autosubmit defaultValue={ctx.router?.id} style={{ maxWidth: 170 }}>
                  {rs.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                      {r.type === 'demo' ? ' (demo)' : ''}
                      {r.shared ? ` (${t('shared')}${r.mode === 'ro' ? ', ' + t('read only') : ''})` : ''}
                    </option>
                  ))}
                </select>
                <noscript>
                  <button className="btn btn-sm">{t('Go')}</button>
                </noscript>
              </form>
            ) : null}
            <details className="menu">
              <summary className="btn btn-ghost btn-icon" aria-label={t('Account')}>
                <span className="avatar">{initial}</span>
              </summary>
              <div className="menu-pop">
                <div className="who">
                  <span className="avatar">{initial}</span>
                  <div>
                    <b>{user.username}</b>
                    <span>{roleLabel}</span>
                  </div>
                </div>
                <hr />
                <div className="opt">
                  <span className="lbl" style={{ padding: 0 }}>
                    {t('Theme')}
                  </span>
                  <div className="seg" role="group" aria-label={t('Theme')}>
                    <button type="button" data-theme-set="light" aria-pressed="false" aria-label={t('Light')}>
                      <Icon name="sun" size={16} />
                    </button>
                    <button type="button" data-theme-set="auto" aria-pressed="false">
                      {t('Auto')}
                    </button>
                    <button type="button" data-theme-set="dark" aria-pressed="false" aria-label={t('Dark')}>
                      <Icon name="moon" size={16} />
                    </button>
                  </div>
                </div>
                <div className="lbl">{t('Accent')}</div>
                <div className="swatches" role="group" aria-label={t('Accent')}>
                  {ACCENTS.map((ac) => (
                    <button key={ac} type="button" className="swatch" data-accent-set={ac} aria-pressed="false" aria-label={t(ac.charAt(0).toUpperCase() + ac.slice(1))} data-tip={t(ac.charAt(0).toUpperCase() + ac.slice(1))} />
                  ))}
                </div>
                <div className="opt">
                  <span className="lbl" style={{ padding: 0 }}>
                    {t('Density')}
                  </span>
                  <div className="seg" role="group" aria-label={t('Density')}>
                    <button type="button" data-density-set="compact" aria-pressed="false">
                      {t('Compact')}
                    </button>
                    <button type="button" data-density-set="comfortable" aria-pressed="false">
                      {t('Comfortable')}
                    </button>
                  </div>
                </div>
                <div className="opt">
                  <span className="lbl" style={{ padding: 0 }}>
                    {t('Language')}
                  </span>
                  <div className="seg" role="group" aria-label={t('Language')}>
                    <a href={`/lang?l=id&back=${encodeURIComponent(back)}`} aria-current={ctx.lang === 'id' ? 'true' : undefined}>
                      ID
                    </a>
                    <a href={`/lang?l=en&back=${encodeURIComponent(back)}`} aria-current={ctx.lang === 'en' ? 'true' : undefined}>
                      EN
                    </a>
                  </div>
                </div>
                <hr />
                <button className="item hide-m" type="button" data-help-open>
                  <Icon name="key" size={16} />
                  {t('Show shortcuts')}
                  <kbd style={{ marginLeft: 'auto' }}>?</kbd>
                </button>
                <form action={logoutAction}>
                  <CsrfField ctx={ctx} />
                  <button className="item" type="submit">
                    <Icon name="logout" size={16} />
                    {t('Sign out')}
                  </button>
                </form>
              </div>
            </details>
          </header>

          <main id="main" className="content" tabIndex={-1}>
            {ctx.impersonating ? (
              <div className="alert warn" style={{ marginBottom: 'var(--s4)' }} role="status" data-impersonating>
                <Icon name="building" size={18} />
                <div>
                  {t('You are viewing workspace :name as platform admin. Your actions are recorded in the audit log.', { ':name': ctx.workspace.name })}
                  <form action={switchWorkspaceAction} style={{ display: 'inline', marginLeft: 8 }}>
                    <CsrfField ctx={ctx} />
                    <input type="hidden" name="workspace" value={ctx.user.workspace} />
                    <input type="hidden" name="back" value="/" />
                    <button className="btn btn-sm" type="submit">
                      {t('Back to my workspace')}
                    </button>
                  </form>
                </div>
              </div>
            ) : null}
            {ctx.demo ? (
              <div className="alert info" style={{ marginBottom: 'var(--s4)' }} role="note">
                <Icon name="alert" size={18} />
                <div>{t('Demo mode: data on this router is simulated. Add a real MikroTik under Routers to manage a device.')}</div>
              </div>
            ) : null}
            <noscript>
              <div className="alert warn">{t('JavaScript is disabled; live charts and some controls will not work.')}</div>
            </noscript>
            {children}
          </main>
        </div>
      </div>

      <nav className="tabbar glass" aria-label={t('Quick navigation')}>
        {tabs.map((i) => (
          <a key={i.key} className="tab" href={i.href} aria-current={i.key === page ? 'page' : undefined}>
            <Icon name={i.icon} size={22} />
            <span>{t(i.label === 'Quick sell (POS)' ? 'POS' : i.label)}</span>
          </a>
        ))}
        <button className="tab" type="button" data-drawer-open>
          <Icon name="menu" size={22} />
          <span>{t('Menu')}</span>
        </button>
      </nav>

      <div className="drawer" id="drawer" aria-hidden="true">
        <div className="drawer-bg" data-drawer-close />
        <div className="drawer-panel glass" role="dialog" aria-modal="true" aria-label={t('Menu')}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <a className="brand" href="/">
              <span className="brand-mark">
                <BrandMark size={18} />
              </span>
              <span>NextMON</span>
            </a>
            <button className="btn btn-ghost btn-icon" type="button" data-drawer-close aria-label={t('Close')}>
              <Icon name="x" />
            </button>
          </div>
          <nav>
            <NavLinks nav={nav} page={page} withTitles t={t} />
          </nav>
        </div>
      </div>

      <div className="toasts" id="toasts" aria-live="polite" aria-atomic="false" />

      <dialog className="modal palette glass" id="palette" aria-label={t('Command palette')}>
        <input className="pal-input" id="pal-input" type="text" placeholder={t('Type a command or page name...')} autoComplete="off" aria-controls="pal-list" />
        <ul className="pal-list" id="pal-list" role="listbox" />
      </dialog>

      <dialog className="modal" id="confirm-dlg" aria-labelledby="confirm-title">
        <div className="modal-h">
          <h2 id="confirm-title">{t('Please confirm')}</h2>
        </div>
        <div className="modal-b">
          <p id="confirm-msg" />
        </div>
        <div className="modal-f">
          <button className="btn" type="button" data-confirm-no>
            {t('Cancel')}
          </button>
          <button className="btn btn-danger" type="button" data-confirm-yes>
            {t('Confirm')}
          </button>
        </div>
      </dialog>

      <script type="application/json" id="i18n" dangerouslySetInnerHTML={{ __html: safeJson(dict) }} />
      <ClientBoot scripts={scripts} nonce={nonce} />
    </>
  );
}

