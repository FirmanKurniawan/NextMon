/** Router monitor: status cards, history charts, alert rules, stock, stored backups, scheduler (port of MonitorController). */
import { defineFeature } from '../types.ts';
import { monitorApi } from './api.ts';

export default defineFeature({
  id: 'monitor',
  nav: [{ key: 'monitor', href: '/monitor', icon: 'activity', label: 'Monitor', group: 'Network', order: 10 }],
  pages: [{ path: '/monitor', title: 'Monitor', cap: 'view', page: 'monitor', scripts: ['/assets/next/net-forms.js'], component: () => import('./page.tsx') }],
  api: { monitor: monitorApi },
  i18n: {
    id: {
      'Scheduled /export files are stored in the NextMON database (not web accessible). The newest :n are kept.': 'File /export terjadwal disimpan di database NextMON (tidak bisa diakses lewat web). :n terbaru disimpan.',
      'NextMON runs its own scheduler inside the server process (every minute, set NEXTMON_SCHEDULER=0 to turn it off). An external cron is only needed when the server may be asleep.':
        'NextMON menjalankan penjadwal sendiri di dalam proses server (tiap menit, set NEXTMON_SCHEDULER=0 untuk mematikan). Cron eksternal hanya perlu jika server bisa tertidur.',
    },
  },
});
