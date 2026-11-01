import { defineFeature } from '../types.ts';

export default defineFeature({
  id: 'security',
  // reached from Settings; no sidebar entry of its own (the PHP edition links it from the Settings page head)
  pages: [{ path: '/settings/security', title: 'Security', cap: 'view', page: 'security', scripts: ['pages'], component: () => import('./page.tsx') }],
  i18n: {
    id: {
      'Password policy, session timeout, signed-in devices and sign-in history.': 'Kebijakan password, batas waktu sesi, perangkat yang masuk, dan riwayat login.',
    },
  },
});
