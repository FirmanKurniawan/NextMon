/** DHCP leases (port of NetworkController dhcp*). */
import { defineFeature } from '../types.ts';
import { dhcpApi } from './api.ts';

export default defineFeature({
  id: 'dhcp',
  nav: [{ key: 'dhcp', href: '/dhcp', icon: 'list', label: 'DHCP leases', group: 'Network', order: 70 }],
  pages: [{ path: '/dhcp', title: 'DHCP leases', cap: 'view', page: 'dhcp', scripts: ['/assets/next/net-forms.js'], component: () => import('./page.tsx') }],
  api: { dhcp: dhcpApi },
});
