import { defineFeature } from '../types.ts';

export default defineFeature({
  id: 'audit',
  nav: [{ key: 'audit', href: '/audit', icon: 'list', label: 'Audit log', group: 'System', cap: 'admin', order: 30 }],
  pages: [{ path: '/audit', title: 'Audit log', cap: 'admin', page: 'audit', scripts: ['pages'], component: () => import('./page.tsx') }],
  i18n: { id: { 'Who did what. The newest 300 events are shown.': 'Siapa melakukan apa. 300 kejadian terbaru ditampilkan.' } },
});
