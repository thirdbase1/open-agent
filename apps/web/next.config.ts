import type { NextConfig } from 'next';

/**
 * Migration notes (verified against vercel.com/docs and nextjs.org/docs, not assumed):
 *
 * - BlockSuite ships Lit web components + Yjs CRDT internals that read `document`/`customElements`
 *   at module scope. These must never be pulled into the server bundle or SSR'd. We keep every
 *   BlockSuite-importing component behind `"use client"` + `dynamic(() => import(...), { ssr: false })`
 *   (see components/doc-editor-client.tsx), and additionally list the packages under
 *   `serverExternalPackages` so Next.js does not try to statically analyze/bundle them for the
 *   server graph at all.
 * - `transpilePackages` covers our own workspace packages (`@afk/component`, `@afk/graphql`, etc.)
 *   which ship untranspiled TS/ESM from the monorepo, matching Next.js's documented monorepo guidance.
 * - Rewrites for `/api/*` are handled at the vercel.json Services layer (this app's `api` sibling
 *   service), not here, so no rewrites() block is needed for same-project API calls in production.
 *   A local rewrite is added only for `next dev` convenience when running the web app standalone.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@afk/component', '@afk/graphql', '@afk/error'],
  serverExternalPackages: [
    '@blocksuite/affine',
    '@blocksuite/icons',
    '@blocksuite/store',
    'yjs',
  ],
  async rewrites() {
    if (process.env.NODE_ENV !== 'development') return [];
    return [
      { source: '/api/:path*', destination: 'http://localhost:3010/api/:path*' },
      { source: '/graphql', destination: 'http://localhost:3010/graphql' },
    ];
  },
};

export default nextConfig;
