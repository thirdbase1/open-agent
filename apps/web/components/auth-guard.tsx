'use client';

/**
 * Ported from packages/frontend/app/src/components/auth-guard.tsx.
 *
 * Behavior preserved 1:1:
 *  - still reads `useAuthStore` (zustand, copied unchanged into ../store/auth.ts)
 *  - still calls `refreshSession()` on mount
 *  - still shows the same loading spinner while checking
 *  - still redirects to /sign-in?redirect=<path> when unauthenticated
 *
 * Only the routing primitives changed: react-router-dom's `<Navigate>` + `useLocation` are
 * replaced with next/navigation's `useRouter` + `usePathname`/`useSearchParams`, since Next.js's
 * App Router owns navigation now.
 */
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

import { useAuthStore } from '@/store/auth';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading, refreshSession } = useAuthStore();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    refreshSession().catch(() => {});
  }, [refreshSession]);

  useEffect(() => {
    if (!isLoading && !user) {
      const qs = searchParams.toString();
      const redirectUrl = qs ? `${pathname}?${qs}` : pathname;
      router.replace(`/sign-in?redirect=${encodeURIComponent(redirectUrl)}`);
    }
  }, [isLoading, user, pathname, searchParams, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex items-center space-x-3">
          <svg
            className="animate-spin h-8 w-8 text-indigo-600"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span className="text-lg text-gray-700">Loading...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return <>{children}</>;
}
