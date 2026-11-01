import { defineFeature } from '../types.ts';

export default defineFeature({
  id: 'profiles',
  nav: [{ key: 'profiles', href: '/hotspot/profiles', icon: 'tag', label: 'User profiles', group: 'Hotspot', order: 20 }],
  pages: [{ path: '/hotspot/profiles', title: 'User profiles', cap: 'view', page: 'profiles', scripts: ['pages'], component: () => import('./page.tsx') }],
});
