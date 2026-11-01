import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import Shell from '../../components/Shell';
import { Features } from '../../features/registry.ts';
import { allNavItems } from '../../nav/registry.ts';
import { requireContext } from '../../server/guard.ts';
import { resolveRoute } from '../../server/route.ts';
import '../../../public/assets/css/app.css';

export const dynamic = 'force-dynamic';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#eaeff3' },
    { media: '(prefers-color-scheme: dark)', color: '#090f15' },
  ],
};

export async function generateMetadata(): Promise<Metadata> {
  const h = await headers();
  const m = Features.matchPage((h.get('x-nextmon-path') ?? '/').split('?')[0]!);
  return {
    title: { template: '%s - NextMON', default: 'NextMON' },
    manifest: '/manifest.webmanifest',
    icons: { icon: [{ url: '/assets/icon.svg', type: 'image/svg+xml' }, { url: '/assets/icons/favicon.ico', sizes: '32x32 16x16' }], apple: '/assets/icons/apple-touch-icon.png' },
    appleWebApp: { capable: true, title: 'NextMON' },
    ...(m ? { title: m.page.title } : {}),
  };
}

/** Authenticated shell around every feature page. Pages themselves only render their body. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await requireContext();
  const h = await headers();
  const nonce = h.get('x-nonce') ?? '';
  const full = h.get('x-nextmon-path') ?? '/';
  const route = resolveRoute(full.split('?')[0]!, allNavItems());
  const title = route ? ctx.t(route.title) : '404';
  return (
    <html lang={ctx.lang} data-theme="auto" suppressHydrationWarning>
      <head>
        {/* blocking on purpose: applies theme/accent/density before first paint (no flash) */}
        {/* browsers hide the nonce attribute from the DOM (the client sees ""), so React would flag a hydration mismatch */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/assets/js/theme.js" nonce={nonce} suppressHydrationWarning />
      </head>
      <body data-page={route?.pageKey ?? ''} data-base="" data-csrf={ctx.csrf} data-lang={ctx.lang} data-demo={ctx.demo ? '1' : '0'}>
        <Shell ctx={ctx} page={route?.pageKey ?? ''} title={title} scripts={route?.scripts ?? ['/assets/js/app.js']} nonce={nonce} back={full}>
          {children}
        </Shell>
      </body>
    </html>
  );
}
