import { defineFeature } from '../types.ts';

/**
 * Shop admin (settings: products, gateway credentials, branding). The public storefront / order / webhook / demo-pay routes live in
 * src/app/(bare)/{shop,pay}; their logic is public.ts + config.ts + gateways.ts here. Orders admin is features/orders.
 */
export default defineFeature({
  id: 'shop',
  nav: [{ key: 'shop_settings', href: '/shop/settings', icon: 'globe', label: 'Shop settings', group: 'Sales', cap: 'admin', order: 50 }],
  pages: [{ path: '/shop/settings', title: 'Shop settings', cap: 'admin', page: 'shop_settings', scripts: ['/assets/js/mod-shop.js'], component: () => import('./settings.tsx') }],
  i18n: {
    id: {
      'Merchant code': 'Kode merchant',
      'Payment channel code': 'Kode kanal pembayaran',
      'e.g. QRIS, BRIVA, MYBVA (see your Tripay channel list)': 'mis. QRIS, BRIVA, MYBVA (lihat daftar kanal Tripay Anda)',
      'Callback verification token': 'Token verifikasi callback',
      'Service unavailable': 'Layanan tidak tersedia',
    },
  },
});
