import { defineFeature } from '../types.ts';

export default defineFeature({
  id: 'vouchers',
  nav: [{ key: 'vouchers', href: '/vouchers', icon: 'ticket', label: 'Vouchers', group: 'Hotspot', cap: 'sell', order: 30, tab: 3 }],
  pages: [{ path: '/vouchers', title: 'Vouchers', cap: 'sell', page: 'vouchers', scripts: ['qr', 'pages', '/assets/js/voucher.js'], component: () => import('./page.tsx') }],
});
