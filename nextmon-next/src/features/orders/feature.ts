import { defineFeature } from '../types.ts';
import { ordersApi } from './api.ts';

/** Admin side of the online shop: orders list / detail / manual confirm / refund / CSV. (The public side lives in features/shop + src/app/(bare).) */
export default defineFeature({
  id: 'orders',
  nav: [{ key: 'orders', href: '/orders', icon: 'list', label: 'Online orders', group: 'Sales', cap: 'write', order: 40 }],
  pages: [
    { path: '/orders', title: 'Online orders', cap: 'write', page: 'orders', component: () => import('./page.tsx') },
    { path: '/orders/view', title: 'Order details', cap: 'write', page: 'orders', component: () => import('./view.tsx') },
  ],
  api: { orders: ordersApi },
  i18n: {
    id: {
      'Order details': 'Detail pesanan',
      Reversed: 'Dibatalkan',
      Credited: 'Dikreditkan',
      'Skipped (reseller inactive)': 'Dilewati (reseller nonaktif)',
      'Pending (paid and fulfilled)': 'Menunggu (lunas dan terkirim)',
    },
  },
});
