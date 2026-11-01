/** Router backup / export + downloads (port of BackupController) and the workspace app-data backup / restore (lib/appbackup.ts). */
import { defineFeature } from '../types.ts';
import { backupApi } from './api.ts';
import { idBackup } from './i18n-id.ts';

export default defineFeature({
  id: 'backup',
  nav: [{ key: 'backup', href: '/backup', icon: 'download', label: 'Backup', group: 'Network', cap: 'write', order: 40 }],
  pages: [{ path: '/backup', title: 'Backup', cap: 'write', page: 'backup', scripts: ['/assets/next/net-forms.js'], component: () => import('./page.tsx') }],
  api: { backup: backupApi },
  i18n: { id: idBackup },
});
