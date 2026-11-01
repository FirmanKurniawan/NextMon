import { defineFeature } from '../types.ts';
import { importApi } from './api.ts';

export default defineFeature({
  id: 'import',
  nav: [{ key: 'import', href: '/import', icon: 'download', label: 'Import / export', group: 'Hotspot', cap: 'write', order: 70 }],
  pages: [
    { path: '/import', title: 'Import / export users', cap: 'write', page: 'import', component: () => import('./page.tsx') },
    { path: '/import/preview', title: 'Import preview', cap: 'write', page: 'import', component: () => import('./preview.tsx') },
    { path: '/import/result', title: 'Import result', cap: 'write', page: 'import', component: () => import('./result.tsx') },
  ],
  // CSV downloads (GET): /api/json/import/template | export | errors
  api: { import: importApi },
});
