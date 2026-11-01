import { defineFeature } from '../types.ts';

export default defineFeature({
  id: 'users',
  nav: [{ key: 'users', href: '/hotspot/users', icon: 'users', label: 'Hotspot users', group: 'Hotspot', order: 10, tab: 2 }],
  pages: [{ path: '/hotspot/users', title: 'Hotspot users', cap: 'view', page: 'users', component: () => import('./page.tsx') }],
});
