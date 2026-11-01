'use client';
/**
 * <form> that calls a Server Action from the browser, shows the result as a toast (shared app.js K.toast), refreshes the server
 * data and optionally closes the surrounding <dialog> / resets the form. Used instead of `action=` so a failed submit keeps what the
 * user typed (React would reset the form) and so the shared app.js confirm dialogs (`data-confirm`) keep working.
 */
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
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
  /** receive the result (e.g. the wizard shows its command log) */
  onResult?: (r: ActionResult, fd: FormData) => void;
  /** refresh server data after success (default true) */
  refresh?: boolean;
};

export function toast(msg: string | undefined, ok: boolean): void {
  if (msg) nm()?.toast?.(msg, ok ? 'ok' : 'err');
}

export default function ActionForm({ action, closeOnOk, resetOnOk, onResult, refresh = true, children, ...rest }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    if (e.defaultPrevented || pending) return; // app.js confirm dialog is still open / already running
    e.preventDefault();
    const form = e.currentTarget;
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const fd = new FormData(form, submitter);
    const btns = Array.from(form.querySelectorAll<HTMLButtonElement>('button:not([type="button"])'));
    for (const b of btns) b.disabled = true;
    submitter?.classList.add('loading');
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
    </form>
  );
}
