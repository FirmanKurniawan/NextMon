// Child of tests/unit/shop-reseller.test.ts: waits for the common start time, then calls markPaid / refund on one order in ITS OWN process.
// Usage: node shop-reseller-child.mts <workspace id> <order id> <paid|refund>   (NEXTMON_DATA / NEXTMON_DEMO come from the environment)
import { Orders } from '../../src/features/orders/orders.ts';
import { Workspace } from '../../src/lib/workspace.ts';

const [ws, id, mode] = process.argv.slice(2) as [string, string, string];
await new Promise((r) => setTimeout(r, 400));
const res = await Workspace.run(ws, () => (mode === 'refund' ? Orders.refund(id, 'child', 'race', false) : Orders.markPaid(id, 'race-child', 2000)));
console.log(JSON.stringify([res[0], res[1]]));
