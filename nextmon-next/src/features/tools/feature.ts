/** Router diagnostics: ping, traceroute, torch, system health, logs (port of ToolsController). The client is the shared pages.js (P.tools). */
import { defineFeature } from '../types.ts';
import { toolsApi } from './api.ts';

export default defineFeature({
  id: 'tools',
  nav: [{ key: 'tools', href: '/tools', icon: 'terminal', label: 'Tools', group: 'Network', order: 30 }],
  pages: [{ path: '/tools', title: 'Tools', cap: 'view', page: 'tools', scripts: ['pages'], component: () => import('./page.tsx') }],
  api: { tools: toolsApi },
});
