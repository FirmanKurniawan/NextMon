/** Hotspot "Hosts": list with filter + bulk remove (forms in forms.ts, mounted at /hs/hotspot/hosts/remove). */
import { defineFeature } from '../types.ts';

export default defineFeature({
  id: 'hosts',
  nav: [{ key: 'hosts', href: '/hotspot/hosts', icon: 'monitor', label: 'Hosts', group: 'Hotspot', order: 50 }],
  pages: [{ path: '/hotspot/hosts', title: 'Hosts', cap: 'view', page: 'hosts', component: () => import('./page.tsx') }],
  // JSON API: /api/json/hosts (also /json/hosts)
  api: {
    hosts: {
      cap: 'view',
      async GET(ctx) {
        const data = await ctx.driver().print('/ip/hotspot/host');
        return { ok: true, total: data.length, data };
      },
    },
  },
});
