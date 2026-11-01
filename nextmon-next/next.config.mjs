// NextMON Next.js config. `standalone` output = `node .next/standalone/server.js` (what NextMON Server launches).
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  // node:sqlite is a Node builtin; keep server-only libs out of the client graph
  serverExternalPackages: [],
  experimental: {
    // Server Actions: Origin must match Host (or an entry below). Extra origins via NEXTMON_BASE_URL are added by middleware checks.
    serverActions: { bodySizeLimit: '2mb' },
  },
  async rewrites() {
    // The shared vanilla JS (pages.js) calls /json/*; the real handlers live under /api/json/*.
    return [{ source: '/json/:path*', destination: '/api/json/:path*' }];
  },
  async headers() {
    return [
      { source: '/assets/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=3600, must-revalidate' }] },
    ];
  },
};
export default nextConfig;
