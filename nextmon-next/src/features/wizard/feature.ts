import { defineFeature } from '../types.ts';
import { wizardApi } from './api.ts';
import { id } from './i18n.ts';

export default defineFeature({
  id: 'wizard',
  nav: [{ key: 'wizard', href: '/wizard', icon: 'zap', label: 'Setup wizard', group: 'Network', cap: 'admin', order: 90 }],
  pages: [{ path: '/wizard', title: 'Setup wizard', cap: 'admin', page: 'wizard', component: () => import('./page.tsx') }],
  api: { wizard: wizardApi },
  i18n: { id },
});
