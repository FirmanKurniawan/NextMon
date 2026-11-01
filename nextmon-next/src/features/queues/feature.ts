/** Simple queues (port of NetController queue*). */
import { defineFeature } from '../types.ts';
import { queuesApi } from './api.ts';

export default defineFeature({
  id: 'queues',
  nav: [{ key: 'queues', href: '/queues', icon: 'layers', label: 'Queues', group: 'Network', order: 50 }],
  pages: [{ path: '/queues', title: 'Queues', cap: 'view', page: 'queues', scripts: ['/assets/next/net-forms.js'], component: () => import('./page.tsx') }],
  api: { queues: queuesApi },
});
