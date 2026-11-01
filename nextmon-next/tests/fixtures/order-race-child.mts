// Child of tests/unit/shop-orders.test.ts: waits for the common start time, then calls Orders.markPaid() on one order in ITS OWN process.
// Usage: node order-race-child.mts <workspace id> <order id>   (NEXTMON_DATA / NEXTMON_DEMO come from the environment)
import { Orders } from '../../src/features/orders/orders.ts';
import { Workspace } from '../../src/lib/workspace.ts';

const [ws, id] = process.argv.slice(2) as [string, string];
await new Promise((r) => setTimeout(r, 400));
const res = await Workspace.run(ws, () => Orders.markPaid(id, 'race-child', null));
console.log(JSON.stringify([res[0], res[1], res[2]?.voucher?.user ?? '']));
