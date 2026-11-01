import { defineFeature } from '../types.ts';

// No nav entry of its own: reached from the Vouchers page (the PHP edition highlights "Vouchers" here too).
export default defineFeature({
  id: 'templates',
  pages: [{ path: '/vouchers/templates', title: 'Voucher templates', cap: 'write', page: 'vouchers', scripts: ['qr', 'pages', '/assets/js/voucher.js'], component: () => import('./page.tsx') }],
});
