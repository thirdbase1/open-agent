# Frontend migration status (Rspack SPA -> Next.js App Router)

Tracks Phase 1 of the Vercel-native migration. Written honestly: this is a partial,
in-progress port, not a finished rewrite. Do not merge assuming full parity.

## Done (verified 1:1 against original source, traceable line-by-line)

- `vercel.json` (repo root) — Vercel Services definition, `web` (this app) + `api` (NestJS).
- `next.config.ts` — `serverExternalPackages` for BlockSuite/Yjs, `transpilePackages` for
  workspace packages, dev-only `/api` + `/graphql` rewrites matching the old rspack devServer proxy.
- `app/layout.tsx` + `components/app-providers.tsx` — replaces `main.tsx`'s `<BrowserRouter>` +
  `<ConfirmModalProvider>` wrapper. Router wrapper removed (Next.js owns routing); provider kept.
- `components/auth-guard.tsx` — full port of `src/components/auth-guard.tsx`. Same
  `useAuthStore` (zustand, unchanged), same loading spinner markup, same redirect-with-return-url
  behavior. Only `react-router-dom`'s `<Navigate>`/`useLocation` swapped for
  `next/navigation`'s `useRouter`/`usePathname`/`useSearchParams`.
- `components/doc-editor-client.tsx` — the one genuinely hard architectural piece. BlockSuite's
  `DocEditor` is Lit custom elements + Yjs CRDT; verified (web search, not assumed) that neither
  Vercel nor Next.js docs have or need a "Lit support" flag, because custom elements are a
  standard client-side DOM API with no SSR story. Solution: `next/dynamic(..., { ssr: false })`
  plus listing the BlockSuite/Yjs packages in `serverExternalPackages` so Next.js never touches
  them during server-side module analysis.
- `store/auth.ts`, `store/sidebar.ts`, `store/onboarding.ts` — copied unchanged. Zustand stores
  have no SSR/router coupling; they work identically in Next.js client components.
- `package.json` — Next.js 16 added, react-router/react-router-dom dropped, all other frontend
  deps preserved verbatim from `packages/frontend/app/package.json`.

## Explicitly NOT done yet (do not assume otherwise)

The following pages/components still live only in `packages/frontend/app/src/**` and have
**not** been ported to `apps/web`:

- `pages/chats/chat.tsx`, `chats-dashboard.tsx`, `chat-playback.tsx` and every renderer under
  `pages/chats/renderers/*`
- `pages/layout/chat-layout.tsx` (`OALayout` — sidebar shell with recent chats/favorites)
- `pages/library-dashboard.tsx`, `pages/doc-page.tsx`, `components/doc-panel/*`
- `pages/sign-in.tsx`, `pages/magic-link.tsx`, `pages/oauth-login.tsx`, `pages/oauth-callback.tsx`
- `pages/onboarding/*`, `pages/redirect.tsx`, `pages/doc-edit-test.tsx`
- `components/cmdk/*`, `components/sidebar/*`, `components/chat-panel/*`, `components/chat/*`
- All `*.css.ts` (vanilla-extract) files — need conversion to Tailwind utility classes or CSS
  Modules; none converted yet beyond the global stylesheet entry point.
- Electron target (`packages/frontend/electron`) — untouched; out of scope for this phase.
- No `app/page.tsx` or App Router route files exist yet for chats/library/sign-in/etc - only the
  supporting components above are ported. Route wiring is the next step once the remaining
  components exist.

## Why the incomplete state is committed as-is

Porting ~100 interdependent files without the ability to run `next build`/`tsc` against the
real dependency graph in this environment risks producing code that looks finished but doesn't
compile. This sandbox has also had its filesystem reset mid-session multiple times, which is why
commits here are unusually small and granular (one file per commit, pushed immediately) rather
than large batches — it's the only way to guarantee no completed work is silently lost.

Each item above will be ported in a follow-up commit, verified against original source
file-by-file, and (once a real build environment is available) validated with an actual
`next build` + `vitest` run before being called done.
