import { defineFeature } from '../types.ts';
import { routersApi } from './api.ts';
import { id } from './i18n.ts';

export default defineFeature({
  id: 'routers',
  nav: [{ key: 'routers', href: '/routers', icon: 'router', label: 'Routers', group: 'System', order: 10 }],
  pages: [{ path: '/routers', title: 'Routers', cap: 'view', page: 'routers', scripts: ['pages'], component: () => import('./page.tsx') }],
  api: { routers: routersApi },
  i18n: { id },
});
