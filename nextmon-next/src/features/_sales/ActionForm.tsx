'use client';
/**
 * A <form> that runs a server action (CSRF field + capability are checked by runAction) and then does a HARD navigation to the URL
 * the action returns (path + signed flash). The shared vanilla JS (toasts, charts, dialogs) initialises once per full page load,
 * which is why a soft redirect is not used here.
 */
import { useRef } from 'react';
import type { FormEvent, ReactNode } from 'react';

type Result = { to?: string; error?: string };

const toast = (msg: string, type: string) => (window as unknown as { NextMON?: { toast?: (m: string, t?: string) => unknown } }).NextMON?.toast?.(msg, type);

export default function ActionForm({
  action,
  children,
  className,
  id,
  confirm,
  inline,
}: {
  action: (fd: FormData) => Promise<Result>;
  children: ReactNode;
  className?: string;
  id?: string;
  /** confirmation text (shared app.js shows its dialog via data-confirm) */
  confirm?: string;
  inline?: boolean;
}) {
  const busy = useRef(false);
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    if (e.defaultPrevented) return; // confirm dialog pending (shared app.js re-submits after OK)
    e.preventDefault();
    if (busy.current) return;
    busy.current = true;
    const form = e.currentTarget;
    try {
      const r = await action(new FormData(form));
      if (r?.to) window.location.assign(r.to);
      else if (r?.error) toast(r.error, 'err');
    } catch {
      toast('Error', 'err');
    } finally {
      busy.current = false;
      form.querySelectorAll('.btn.loading').forEach((b) => b.classList.remove('loading'));
    }
  }
  return (
    <form id={id} method="post" className={className ?? (inline ? 'inline-form' : undefined)} data-confirm={confirm} onSubmit={onSubmit}>
      {children}
    </form>
  );
}
