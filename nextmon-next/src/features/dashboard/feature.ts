import { defineFeature } from '../types.ts';
import { dashboardApi, healthApi, interfacesApi, logsApi, trafficApi } from './api.ts';

export default defineFeature({
  id: 'dashboard',
  nav: [{ key: 'dashboard', href: '/', icon: 'home', label: 'Dashboard', group: 'Overview', order: 1, tab: 1 }],
  pages: [{ path: '/', title: 'Dashboard', page: 'dashboard', scripts: ['charts', 'next-live', 'pages'], component: () => import('./page.tsx') }],
  api: { dashboard: dashboardApi, status: dashboardApi, logs: logsApi, traffic: trafficApi, interfaces: interfacesApi, health: healthApi },
});
