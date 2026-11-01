/**
 * WORKED EXAMPLE of a feature module (see DEVELOPING.md): hotspot "Hosts". Everything a feature can contribute is declared here;
 * no shared file is edited. A later agent may replace/extend this module (keep the id `hosts`).
 */
import { defineFeature } from '../types.ts';

export default defineFeature({
  id: 'hosts',
  // 1. navigation entry (sidebar, drawer, command palette)
  nav: [{ key: 'hosts', href: '/hotspot/hosts', icon: 'monitor', label: 'Hosts', group: 'Hotspot', order: 50 }],
  // 2. page(s): lazy-loaded server component, rendered inside the shell with the workspace already set
  pages: [{ path: '/hotspot/hosts', title: 'Hosts', cap: 'view', component: () => import('./page.tsx') }],
  // 3. JSON API: /api/json/hosts (also /json/hosts). Guard (session, CSRF on POST, capability, workspace) is applied for you.
  api: {
    hosts: {
      cap: 'view',
      async GET(ctx) {
        const data = await ctx.driver().print('/ip/hotspot/host');
        return { ok: true, total: data.length, data };
      },
    },
  },
  // 4. translations (English is the source language; only add what core does not have)
  i18n: {
    id: {
      'Hotspot hosts': 'Host hotspot',
      'Devices the hotspot has seen on the LAN side.': 'Perangkat yang terlihat hotspot di sisi LAN.',
      'MAC address': 'Alamat MAC',
      Authorized: 'Terotorisasi',
      Bypassed: 'Bypass',
      'No hosts.': 'Tidak ada host.',
    },
  },
});
