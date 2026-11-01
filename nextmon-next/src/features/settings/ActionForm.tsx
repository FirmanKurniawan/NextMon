'use client';
/**
 * A <form> bound to a server action that returns { ok, msg }. The message becomes a toast (shared app.js `NextMON.toast`), a
 * successful save closes the surrounding <dialog> and (optionally) resets the form. The page data is refreshed by the action itself
 * (revalidatePath). The confirm dialog of the shared app.js works through the data-confirm attribute.
 */
import { useActionState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { ActionResult } from './result.ts';

declare global {
  interface Window {
    NextMON?: { toast?: (msg: string, type?: string) => unknown };
  }
}

export default function ActionForm({
  action,
  children,
  className,
  style,
  confirm,
  reset,
  onResult,
}: {
  action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  children: ReactNode | ((state: ActionResult | null, pending: boolean) => ReactNode);
  className?: string;
  style?: React.CSSProperties;
  /** confirmation text shown by the shared confirm dialog before submitting */
  confirm?: string;
  /** reset the fields after a successful save */
  reset?: boolean;
  onResult?: (r: ActionResult) => void;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state) return;
    if (state.msg) window.NextMON?.toast?.(state.msg, state.ok ? 'ok' : 'err');
    if (state.ok) {
      const dlg = ref.current?.closest('dialog');
      if (dlg?.open) dlg.close();
      if (reset) ref.current?.reset();
    }
    onResult?.(state);
    ref.current?.querySelectorAll('.btn.loading').forEach((b) => b.classList.remove('loading'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <form ref={ref} action={formAction} className={className} style={style} data-confirm={confirm}>
      {typeof children === 'function' ? children(state, pending) : children}
    </form>
  );
}
