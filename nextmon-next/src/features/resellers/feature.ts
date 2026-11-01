import { defineFeature } from '../types.ts';
import { resellersApi } from './api.ts';

const JS = '/assets/js/mod-security.js';

export default defineFeature({
  id: 'resellers',
  nav: [
    { key: 'resellers', href: '/resellers', icon: 'users', label: 'Resellers', group: 'Sales', cap: 'admin', order: 30 },
    { key: 'wallet', href: '/me/wallet', icon: 'cart', label: 'My wallet', group: 'Sales', cap: 'sell', order: 31 },
  ],
  pages: [
    { path: '/resellers', title: 'Resellers', cap: 'admin', page: 'resellers', scripts: [JS], component: () => import('./page.tsx') },
    { path: '/resellers/ledger', title: 'Reseller ledger', cap: 'admin', page: 'resellers', scripts: [JS], component: () => import('./ledger.tsx') },
    { path: '/me/wallet', title: 'My wallet', cap: 'sell', page: 'wallet', scripts: [JS], component: () => import('./wallet.tsx') },
  ],
  api: { resellers: resellersApi },
  i18n: {
    id: {
      'No router configured': 'Belum ada router',
      'Add a router first.': 'Tambahkan router terlebih dahulu.',
    },
  },
});
