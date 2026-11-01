/** ARP table (port of NetworkController arp*). */
import { defineFeature } from '../types.ts';
import { arpApi } from './api.ts';

export default defineFeature({
  id: 'arp',
  nav: [{ key: 'arp', href: '/arp', icon: 'link', label: 'ARP', group: 'Network', order: 40 }],
  pages: [{ path: '/arp', title: 'ARP', cap: 'view', page: 'arp', scripts: ['/assets/next/net-forms.js'], component: () => import('./page.tsx') }],
  api: { arp: arpApi },
});
