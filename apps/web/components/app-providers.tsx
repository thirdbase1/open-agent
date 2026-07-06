'use client';

/**
 * Root client provider tree. Replaces the old `<BrowserRouter>` wrapper from
 * packages/frontend/app/src/main.tsx - Next.js's App Router replaces react-router entirely,
 * so only app-level (non-routing) providers remain here.
 */
import { ConfirmModalProvider } from '@afk/component';

export function AppProviders({ children }: { children: React.ReactNode }) {
  return <ConfirmModalProvider>{children}</ConfirmModalProvider>;
}
