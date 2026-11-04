import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // Browsers only honour this over https; it keeps returning visitors on https for two years.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
  // No script rules (those would need per-request nonces): only framing, plugins, <base> and
  // where forms may post, none of which MenuNiva needs beyond its own site.
  { key: 'Content-Security-Policy', value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'" },
];

const nextConfig: NextConfig = {
  // A separate build directory lets the E2E server (test database) run next to `npm run dev`.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  poweredByHeader: false,
  serverExternalPackages: ['@node-rs/argon2', 'pg', '@prisma/adapter-pg'],
  experimental: {
    serverActions: { bodySizeLimit: '6mb' },
    // Off: in `next dev` the MCP server writes every browser console line to .next/dev/logs, the
    // file watcher picks that write up, recompiles and reloads the page, which logs again: the
    // sign-in pages reloaded several times a second and could not be submitted.
    mcpServer: false,
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
