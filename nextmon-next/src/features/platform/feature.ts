import { defineFeature } from '../types.ts';
import { id } from './i18n.ts';

export default defineFeature({
  id: 'platform',
  nav: [{ key: 'platform', href: '/platform/accounts', icon: 'users', label: 'Accounts', group: 'System', cap: 'platform', order: 90 }],
  pages: [{ path: '/platform/accounts', title: 'Accounts', cap: 'platform', page: 'platform', component: () => import('./page.tsx') }],
  i18n: { id },
});
