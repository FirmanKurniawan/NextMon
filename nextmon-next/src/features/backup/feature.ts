/** Router backup / export + downloads (port of BackupController). */
import { defineFeature } from '../types.ts';
import { backupApi } from './api.ts';

export default defineFeature({
  id: 'backup',
  nav: [{ key: 'backup', href: '/backup', icon: 'download', label: 'Backup', group: 'Network', cap: 'write', order: 80 }],
  pages: [{ path: '/backup', title: 'Backup', cap: 'write', page: 'backup', scripts: ['/assets/next/net-forms.js'], component: () => import('./page.tsx') }],
  api: { backup: backupApi },
});
