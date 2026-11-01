'use client';
/** Shows the flash cookie as a toast once the shared app.js is ready (it loads after hydration). */
import { useEffect } from 'react';

type Toast = (msg: string, type?: string) => unknown;
declare global {
  interface Window {
    NextMON?: { toast?: Toast };
  }
}

let pending: [string, string] | null = null;
let polling = false;

function take(): void {
  const m = document.cookie.split('; ').find((c) => c.startsWith('nm_flash='));
  if (!m) return;
  document.cookie = 'nm_flash=; Path=/; Max-Age=0; SameSite=Lax';
  try {
    const v = JSON.parse(decodeURIComponent(m.slice(9))) as unknown;
    if (Array.isArray(v) && typeof v[1] === 'string') pending = [v[0] === 'err' ? 'err' : 'ok', v[1]];
  } catch {
    /* ignore a malformed cookie */
  }
}

export default function Flash() {
  useEffect(() => {
    take();
    if (!pending || polling) return;
    polling = true;
    let n = 0;
    const t = setInterval(() => {
      const toast = window.NextMON?.toast;
      if (toast && pending) {
        toast(pending[1], pending[0]);
        pending = null;
      }
      if (!pending || ++n > 80) {
        clearInterval(t);
        polling = false;
      }
    }, 50);
  }, []);
  return null;
}
