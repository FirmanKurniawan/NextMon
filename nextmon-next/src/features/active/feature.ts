import { defineFeature } from '../types.ts';

export default defineFeature({
  id: 'active',
  nav: [{ key: 'active', href: '/hotspot/active', icon: 'activity', label: 'Active sessions', group: 'Hotspot', order: 40 }],
  pages: [{ path: '/hotspot/active', title: 'Active sessions', cap: 'view', page: 'active', component: () => import('./page.tsx') }],
});
