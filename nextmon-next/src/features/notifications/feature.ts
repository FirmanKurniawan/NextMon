import { defineFeature } from '../types.ts';

export default defineFeature({
  id: 'notifications',
  nav: [{ key: 'notifications', href: '/notifications', icon: 'bell', label: 'Notifications', group: 'System', cap: 'admin', order: 91 }],
  pages: [{ path: '/notifications', title: 'Notifications', cap: 'admin', page: 'notifications', component: () => import('./page.tsx') }],
  i18n: {
    id: {
      'Send alerts to a Telegram chat and/or a generic webhook.': 'Kirim peringatan ke chat Telegram dan/atau webhook umum.',
    },
  },
});
