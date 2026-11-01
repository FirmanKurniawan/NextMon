/** PPPoE: secrets, live sessions and profiles (port of NetworkController pppoe*). */
import { defineFeature } from '../types.ts';
import { pppoeApi } from './api.ts';

export default defineFeature({
  id: 'pppoe',
  nav: [{ key: 'pppoe', href: '/pppoe', icon: 'users', label: 'PPPoE', group: 'Network', order: 20 }],
  pages: [{ path: '/pppoe', title: 'PPPoE', cap: 'view', page: 'pppoe', scripts: ['/assets/next/net-forms.js'], component: () => import('./page.tsx') }],
  api: { pppoe: pppoeApi },
  i18n: {
    id: {
      'This router is shared read-only: changes are disabled.': 'Router ini dibagikan hanya-baca: perubahan dinonaktifkan.',
      'Check name, password, profile, MAC, and IP addresses.': 'Periksa nama, password, profil, MAC, dan alamat IP.',
    },
  },
});
