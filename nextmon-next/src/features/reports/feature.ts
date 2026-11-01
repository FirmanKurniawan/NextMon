import { defineFeature } from '../types.ts';
import { reportsApi } from './api.ts';

export default defineFeature({
  id: 'reports',
  nav: [{ key: 'reports', href: '/reports', icon: 'chart', label: 'Sales report', group: 'Sales', order: 10, tab: 4 }],
  pages: [{ path: '/reports', title: 'Sales report', page: 'reports', scripts: ['charts', 'pages'], component: () => import('./page.tsx') }],
  api: { reports: reportsApi },
  i18n: {
    id: {
      'No router configured': 'Belum ada router',
      'Add a router first.': 'Tambahkan router terlebih dahulu.',
      'This router is shared with you as read-only.': 'Router ini dibagikan kepada Anda sebagai baca-saja.',
    },
  },
});
