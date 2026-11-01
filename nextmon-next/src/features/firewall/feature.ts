/** Firewall address-list (port of NetController firewall*). */
import { defineFeature } from '../types.ts';
import { firewallApi } from './api.ts';

export default defineFeature({
  id: 'firewall',
  nav: [{ key: 'firewall', href: '/firewall', icon: 'shield', label: 'Firewall list', group: 'Network', order: 60 }],
  pages: [{ path: '/firewall', title: 'Firewall address list', cap: 'view', page: 'firewall', scripts: ['/assets/next/net-forms.js'], component: () => import('./page.tsx') }],
  api: { firewall: firewallApi },
});
