/** Scheduler: no page of its own (the UI lives on /monitor). Boot: instrumentation-node.ts; web trigger: /api/public/cron. */
import { defineFeature } from '../types.ts';

export default defineFeature({ id: 'scheduler' });
