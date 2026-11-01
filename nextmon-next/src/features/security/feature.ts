import { defineFeature } from '../types.ts';

export default defineFeature({
  id: 'security',
  nav: [{ key: 'security', href: '/settings/security', icon: 'shield', label: 'Security', group: 'System', order: 60 }],
  pages: [{ path: '/settings/security', title: 'Security', cap: 'view', page: 'security', scripts: ['pages'], component: () => import('./page.tsx') }],
  i18n: {
    id: {
      'Password policy, session timeout, signed-in devices and sign-in history.': 'Kebijakan password, batas waktu sesi, perangkat yang masuk, dan riwayat login.',
    },
  },
});
