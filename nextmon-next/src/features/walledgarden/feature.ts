import { defineFeature } from '../types.ts';

export default defineFeature({
  id: 'walledgarden',
  nav: [{ key: 'walledgarden', href: '/walledgarden', icon: 'globe', label: 'Walled garden', group: 'Network', order: 90 }],
  pages: [{ path: '/walledgarden', title: 'Walled garden', cap: 'view', page: 'walledgarden', component: () => import('./page.tsx') }],
});
