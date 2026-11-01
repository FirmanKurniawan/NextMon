/**
 * Runs once when the Next.js server boots. Node-specific work lives in instrumentation-node.ts (peer address stamping, shutdown
 * hooks) so the edge bundle of this file stays free of Node APIs.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerNode } = await import('./instrumentation-node');
    await registerNode();
  }
}
