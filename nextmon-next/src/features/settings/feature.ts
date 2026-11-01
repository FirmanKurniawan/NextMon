import { defineFeature } from '../types.ts';
import { id } from './i18n.ts';

export default defineFeature({
  id: 'settings',
  nav: [{ key: 'settings', href: '/settings', icon: 'settings', label: 'Settings', group: 'System', order: 90 }],
  pages: [{ path: '/settings', title: 'Settings', cap: 'view', page: 'settings', scripts: ['pages'], component: () => import('./page.tsx') }],
  i18n: { id },
});
