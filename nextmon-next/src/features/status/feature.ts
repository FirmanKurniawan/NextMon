import { defineFeature } from '../types.ts';

/** Public voucher status (/status, /status.json): routes live in src/app/(bare); logic in lookup.ts. Nothing to add to the admin shell. */
export default defineFeature({ id: 'status' });
