// NextMON Next.js config. `standalone` output = `node .next/standalone/server.js` (what NextMON Server launches).
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // dev only: parallel dev servers can use separate build dirs (NM_DIST_DIR=.next-dev-a); production keeps .next
  ...(process.env.NM_DIST_DIR && process.env.NODE_ENV !== 'production' ? { distDir: process.env.NM_DIST_DIR } : {}),
  poweredByHeader: false,
  reactStrictMode: true,
  // node:sqlite is a Node builtin; keep server-only libs out of the client graph
  serverExternalPackages: [],
  experimental: {
    // Server Actions: Origin must match Host (or an entry below). Extra origins via NEXTMON_BASE_URL are added by middleware checks.
    serverActions: { bodySizeLimit: '2mb' },
    // forbidden() + app/(app)/forbidden.tsx: real HTTP 403 for pages the role may not open (PHP parity)
    authInterrupts: true,
  },
  async rewrites() {
    // The shared vanilla JS (pages.js) calls /json/*; the real handlers live under /api/json/*.
    return [
      { source: '/json/:path*', destination: '/api/json/:path*' },
      // same download URLs as the PHP edition (bookmarks / scripts keep working)
      { source: '/reports/export', destination: '/api/json/reports/export' },
      { source: '/orders/export', destination: '/api/json/orders/export' },
      { source: '/import/:file(template|export|errors)', destination: '/api/json/import/:file' },
      { source: '/wizard/template.zip', destination: '/api/json/wizard/template.zip' },
      { source: '/backup/download', destination: '/api/json/backup' },
    ];
  },
  async headers() {
    return [
      { source: '/assets/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=3600, must-revalidate' }] },
    ];
  },
};
export default nextConfig;
