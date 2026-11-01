import { defineFeature } from '../types.ts';
import { resellersApi } from './api.ts';

const JS = '/assets/js/mod-security.js';

export default defineFeature({
  id: 'resellers',
  nav: [
    { key: 'resellers', href: '/resellers', icon: 'users', label: 'Resellers', group: 'Sales', cap: 'admin', order: 30 },
    { key: 'wallet', href: '/me/wallet', icon: 'cart', label: 'My wallet', group: 'Sales', cap: 'sell', order: 31, roles: ['reseller'] },
  ],
  pages: [
    { path: '/resellers', title: 'Resellers', cap: 'admin', page: 'resellers', scripts: [JS], component: () => import('./page.tsx') },
    { path: '/resellers/ledger', title: 'Reseller ledger', cap: 'admin', page: 'resellers', scripts: [JS], component: () => import('./ledger.tsx') },
    { path: '/me/wallet', title: 'My wallet', cap: 'sell', page: 'wallet', scripts: [JS], component: () => import('./wallet.tsx') },
  ],
  api: { resellers: resellersApi },
  i18n: {
    id: {
      'Shop referral': 'Referal toko',
      'Referral code': 'Kode referal',
      code: 'kode',
      'Referral code saved.': 'Kode referal disimpan.',
      'Referral code: 3-24 characters, a-z, 0-9 and dash.': 'Kode referal: 3-24 karakter, a-z, 0-9 dan tanda hubung.',
      'This referral code is already used.': 'Kode referal ini sudah dipakai.',
      'Your shop link (earn commission on paid shop orders):': 'Link toko Anda (dapat komisi dari pesanan toko yang lunas):',
      Reversed: 'Dibatalkan',
      Credited: 'Dikreditkan',
      'Skipped (reseller inactive)': 'Dilewati (reseller nonaktif)',
      'Pending (paid and fulfilled)': 'Menunggu (lunas dan terkirim)',
      'No router configured': 'Belum ada router',
      'Add a router first.': 'Tambahkan router terlebih dahulu.',
    },
  },
});
