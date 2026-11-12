'use client';
/**
 * <form> that calls a Server Action from the browser, shows the result as a toast (shared app.js K.toast), refreshes the server
 * data and optionally closes the surrounding <dialog> / resets the form. Used instead of `action=` so a failed submit keeps what the
 * user typed (React would reset the form) and so the shared app.js confirm dialogs (`data-confirm`) keep working.
 */
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { ComponentProps, FormEvent } from 'react';
import type { ActionResult } from './util';

/** Shared app.js exposes window.NextMON (toast, t). Typed locally: several features declare it and global merges must agree. */
type NM = { toast?: (msg: string, type?: string) => unknown; t?: (k: string) => string };
const nm = (): NM | undefined => (window as unknown as { NextMON?: NM }).NextMON;

type Props = Omit<ComponentProps<'form'>, 'action' | 'onSubmit'> & {
  action: (fd: FormData) => Promise<ActionResult>;
  /** close the enclosing <dialog> when the action succeeded */
  closeOnOk?: boolean;
  resetOnOk?: boolean;
  /** show an inline alert banner inside the form for the latest result */
  inlineAlert?: boolean;
  /** receive the result (e.g. the wizard shows its command log) */
  onResult?: (r: ActionResult, fd: FormData) => void;
  /** refresh server data after success (default true) */
  refresh?: boolean;
};

export function toast(msg: string | undefined, ok: boolean): void {
  if (!msg) return;
  const k = nm();
  if (k?.toast) {
    k.toast(msg, ok ? 'ok' : 'err');
    return;
  }
  // Fallback when app.js has not finished booting yet: render into #toasts directly.
  const box = document.getElementById('toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'toast ' + (ok ? 'ok' : 'err');
  el.setAttribute('role', ok ? 'status' : 'alert');
  const txt = document.createElement('div');
  txt.className = 't-msg';
  txt.textContent = msg;
  el.appendChild(txt);
  box.appendChild(el);
  setTimeout(() => el.remove(), ok ? 4200 : 7000);
}

export default function ActionForm({ action, closeOnOk, resetOnOk, inlineAlert, onResult, refresh = true, children, ...rest }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [last, setLast] = useState<ActionResult | null>(null);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    if (e.defaultPrevented || pending) return; // app.js confirm dialog is still open / already running
    e.preventDefault();
    const form = e.currentTarget;
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const fd = new FormData(form, submitter);
    const btns = Array.from(form.querySelectorAll<HTMLButtonElement>('button:not([type="button"])'));
    for (const b of btns) b.disabled = true;
    submitter?.classList.add('loading');
    if (inlineAlert) setLast(null);
    start(async () => {
      let r: ActionResult;
      try {
        r = await action(fd);
      } catch {
        r = { ok: false, msg: nm()?.t?.('error') ?? 'Error' };
      }
      for (const b of btns) b.disabled = false;
      submitter?.classList.remove('loading');
      toast(r.msg, r.ok);
      if (inlineAlert && r.msg) setLast(r);
      onResult?.(r, fd);
      if (r.ok) {
        if (resetOnOk) form.reset();
        if (closeOnOk) form.closest('dialog')?.close();
        if (refresh) router.refresh();
      }
    });
  }

  return (
    <form {...rest} onSubmit={onSubmit} aria-busy={pending || undefined}>
      {children}
      {inlineAlert && last?.msg ? (
        <div className={'alert ' + (last.ok ? 'info' : 'err')} role={last.ok ? 'status' : 'alert'} style={{ flexBasis: '100%' }}>
          <div>{last.msg}</div>
        </div>
      ) : null}
    </form>
  );
}
