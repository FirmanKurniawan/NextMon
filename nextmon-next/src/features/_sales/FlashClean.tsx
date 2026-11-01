'use client';
import { useEffect } from 'react';

/** Drops ?flash= from the address bar after the toast was shown, so a reload does not repeat it. */
export default function FlashClean() {
  useEffect(() => {
    const u = new URL(window.location.href);
    if (!u.searchParams.has('flash')) return;
    u.searchParams.delete('flash');
    window.history.replaceState(null, '', u.pathname + u.search + u.hash);
  }, []);
  return null;
}
