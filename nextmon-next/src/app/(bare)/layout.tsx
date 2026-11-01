import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { anonLang } from '../../server/context.ts';
import '../../../public/assets/css/app.css';

export const metadata: Metadata = {
  title: { template: '%s - NextMON', default: 'NextMON' },
  manifest: '/manifest.webmanifest',
  icons: { icon: [{ url: '/assets/icon.svg', type: 'image/svg+xml' }, { url: '/assets/icons/favicon.ico', sizes: '32x32 16x16' }], apple: '/assets/icons/apple-touch-icon.png' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#0b7285' };

/** Bare layout: login, setup and public pages (no sidebar, no session required). */
export default async function BareLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? '';
  const lang = await anonLang();
  return (
    <html lang={lang} data-theme="auto" suppressHydrationWarning>
      <head>
        {/* blocking on purpose: applies theme/accent/density before first paint (no flash) */}
        {/* browsers hide the nonce attribute from the DOM (the client sees ""), so React would flag a hydration mismatch */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/assets/js/theme.js" nonce={nonce} suppressHydrationWarning />
      </head>
      <body data-base="">
        <div className="bg" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
