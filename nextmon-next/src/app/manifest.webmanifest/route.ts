import { anonLang } from '../../server/context.ts';
import { I18n } from '../../lib/i18n.ts';

export const dynamic = 'force-dynamic';

/** PWA manifest (same content as the PHP edition's /manifest.webmanifest). */
export async function GET(): Promise<Response> {
  const t = I18n.translator(await anonLang());
  const icon = (f: string, sizes: string, purpose = 'any') => ({ src: '/assets/icons/' + f, sizes, type: 'image/png', purpose });
  const shortcut = (name: string, short: string, url: string) => ({ name, short_name: short, url, icons: [{ src: '/assets/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] });
  const body = {
    id: '/',
    name: 'NextMON Hotspot Manager',
    short_name: 'NextMON',
    description: t('MikroTik hotspot manager'),
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    display_override: ['window-controls-overlay', 'standalone', 'minimal-ui'],
    orientation: 'any',
    background_color: '#090f15',
    theme_color: '#0b7285',
    categories: ['utilities', 'business', 'productivity'],
    icons: [icon('icon-192.png', '192x192'), icon('icon-512.png', '512x512'), icon('icon-maskable-512.png', '512x512', 'maskable'), { src: '/assets/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
    shortcuts: [shortcut(t('Dashboard'), t('Dashboard'), '/'), shortcut(t('Hosts'), t('Hosts'), '/hotspot/hosts')],
  };
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'no-cache' } });
}
