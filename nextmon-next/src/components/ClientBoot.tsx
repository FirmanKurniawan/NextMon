'use client';
/**
 * Loads the shared vanilla JS (app.js, charts.js, pages.js ...) AFTER React finished hydrating.
 * Why: those scripts mutate the DOM (palette, toasts, skeleton -> data, aria state). If they ran before hydration, React would
 * find a DOM that differs from its tree and throw the page away. Effects run after the hydration commit, so order is safe.
 * Scripts are appended with the CSP nonce, in order (async=false), once per page load.
 */
import { useEffect } from 'react';

declare global {
  interface Window {
    __nmBoot?: boolean;
  }
}

export default function ClientBoot({ scripts, nonce }: { scripts: string[]; nonce: string }) {
  useEffect(() => {
    if (window.__nmBoot) return; // React StrictMode runs effects twice in dev
    window.__nmBoot = true;
    for (const src of scripts) {
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      if (nonce) s.setAttribute('nonce', nonce);
      document.body.appendChild(s);
    }
    // app.js registers the service worker on window "load"; when hydration finished after "load", do it here
    if ('serviceWorker' in navigator && document.readyState === 'complete') {
      navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {});
    }
  }, [scripts, nonce]);
  return null;
}
