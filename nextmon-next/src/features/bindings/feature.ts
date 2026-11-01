import { defineFeature } from '../types.ts';

export default defineFeature({
  id: 'bindings',
  nav: [{ key: 'bindings', href: '/hotspot/bindings', icon: 'link', label: 'IP bindings', group: 'Hotspot', order: 60 }],
  pages: [{ path: '/hotspot/bindings', title: 'IP bindings', cap: 'view', page: 'bindings', component: () => import('./page.tsx') }],
});
