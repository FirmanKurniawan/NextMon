import { defineFeature } from '../types.ts';
import { posApi } from './api.ts';

export default defineFeature({
  id: 'pos',
  nav: [{ key: 'pos', href: '/pos', icon: 'cart', label: 'Quick sell (POS)', group: 'Sales', cap: 'sell', order: 20 }],
  pages: [{ path: '/pos', title: 'Quick sell (POS)', cap: 'sell', page: 'pos', scripts: ['qr', 'pages'], component: () => import('./page.tsx') }],
  api: { pos: posApi },
  i18n: {
    id: {
      'No router configured': 'Belum ada router',
      'Add a router first.': 'Tambahkan router terlebih dahulu.',
      'This router is shared with you as read-only.': 'Router ini dibagikan kepada Anda sebagai baca-saja.',
    },
  },
});
