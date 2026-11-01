/** Live interface traffic: one SSE stream (TrafficHub) per selected interface + a table of all interfaces (NetController live traffic). */
import { defineFeature } from '../types.ts';

export default defineFeature({
  id: 'traffic',
  nav: [{ key: 'traffic', href: '/traffic', icon: 'activity', label: 'Traffic', group: 'Network', order: 15 }],
  pages: [{ path: '/traffic', title: 'Live traffic', cap: 'view', page: 'traffic', scripts: ['charts', '/assets/next/traffic.js'], component: () => import('./page.tsx') }],
  i18n: {
    id: {
      'Live traffic per interface (streamed from the router).': 'Trafik langsung per interface (di-stream dari router).',
      'Peak': 'Puncak',
      'Interfaces': 'Interface',
      'Running': 'Aktif',
      'Stopped': 'Berhenti',
      'Connecting...': 'Menghubungkan...',
      'Reconnecting...': 'Menghubungkan ulang...',
      'Live': 'Langsung',
    },
  },
});
