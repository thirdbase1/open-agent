import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface AuthState {
  user: User | null;
  isLoading: boolean;
  error: string | null;
  // authentication methods
  signInPassword: (
    email: string,
    password: string,
    options?: { verifyToken?: string; challenge?: string }
  ) => Promise<void>;
  login: (email: string, password: string) => Promise<void>; // alias
  checkUserByEmail: (
    email: string
  ) => Promise<{ hasPassword: boolean; canSignIn: boolean }>;
  sendMagicLink: (
    email: string,
    options?: { verifyToken?: string; challenge?: string; redirectUrl?: string }
  ) => Promise<void>;
  verifyMagicLink: (email: string, token: string) => Promise<void>;
  signInOAuth: (code: string, state: string, provider: string) => Promise<void>;
  logout: () => void;
  refreshSession: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, _get) => ({
      user: null,
      isLoading: false,
      error: null,

      // Check if user exists and whether they have a password
      checkUserByEmail: async (
        email: string
      ): Promise<{ hasPassword: boolean; canSignIn: boolean }> => {
        const res = await fetch('/api/auth/preflight', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        if (!res.ok) throw new Error('Failed to check user');
        const data = await res.json();
        if (!data.canSignIn) {
          set({ error: 'Early access required' });
        }
        return data;
      },

      // Password login (renamed from login)
      signInPassword: async (
        email: string,
        password: string,
        options?: { verifyToken?: string; challenge?: string }
      ) => {
        set({ isLoading: true, error: null });
        try {
          // auto-fetch challenge if not provided
          if (!options?.challenge) {
            const { challenge } = await getCaptchaChallenge();
            if (challenge) {
              options = { ...options, challenge };
            }
          }
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
          };
          if (options?.verifyToken)
            headers['x-captcha-token'] = options.verifyToken;
          if (options?.challenge)
            headers['x-captcha-challenge'] = options.challenge;

          const response = await fetch('/api/auth/sign-in', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              email,
              password,
              verifyToken: options?.verifyToken,
              challenge: options?.challenge,
            }),
          });
          if (!response.ok) throw new Error('Login failed');
          const data = await response.json();
          set({
            user: data.user,
            isLoading: false,
            error: null,
          });
        } catch (error) {
          set({
            isLoading: false,
            error: error instanceof Error ? error.message : 'Login failed',
          });
          throw error;
        }
      },

      // alias for backward compatibility
      login: (email: string, password: string) =>
        _get().signInPassword(email, password),

      // Send magic link / OTP to email
      sendMagicLink: async (
        email: string,
        options?: {
          verifyToken?: string;
          callbackUrl?: string;
        }
      ) => {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        // signin without password is to send magic link
        await fetch('/api/auth/sign-in', {
          method: 'POST',
          headers,
          body: JSON.stringify({ email, callbackUrl: options?.callbackUrl }),
        });
      },

      // Verify magic link / OTP
      verifyMagicLink: async (email: string, token: string): Promise<void> => {
        set({ isLoading: true, error: null });
        try {
          const res = await fetch('/api/auth/magic-link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, token }),
          });
          if (!res.ok) throw new Error('Invalid code');
          const data = await res.json();
          set({
            user: data.user,
            isLoading: false,
            error: null,
          });
        } catch (err) {
          set({
            isLoading: false,
            error: err instanceof Error ? err.message : 'Verification failed',
          });
          throw err;
        }
      },

      // Sign in via OAuth after redirect
      signInOAuth: async (code: string, state: string, provider: string) => {
        set({ isLoading: true, error: null });
        try {
          const res = await fetch('/api/oauth/callback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, state, provider }),
          });
          if (!res.ok) throw new Error('OAuth login failed');
          const data = await res.json();
          set({
            user: data.user,
            isLoading: false,
            error: null,
          });
        } catch (err) {
          set({
            isLoading: false,
            error: err instanceof Error ? err.message : 'OAuth login failed',
          });
          throw err;
        }
      },

      logout: () => {
        fetch('/api/auth/sign-out', { method: 'GET' }).catch(console.error);
        set({ user: null, error: null });
      },

      refreshSession: async () => {
        set({ isLoading: true });
        try {
          const res = await fetch('/api/auth/session');
          if (res.ok) {
            const data = await res.json();
            set({ user: data.user, isLoading: false });
          } else {
            set({ user: null, isLoading: false });
          }
        } catch {
          set({ user: null, isLoading: false });
        }
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'auth-storage',
      partialize: state => ({
        user: state.user,
      }),
    }
  )
);

// Captcha caching helpers (5-minute TTL)
let cachedChallenge: string | undefined;
let cachedAt = 0;

async function getCaptchaChallenge(): Promise<{ challenge?: string }> {
  const now = Date.now();
  if (cachedChallenge && now - cachedAt < 5 * 60 * 1000) {
    return { challenge: cachedChallenge };
  }

  try {
    const res = await fetch('/api/auth/challenge');
    if (!res.ok) return {};
    const data = (await res.json()) as { challenge: string };
    if (data?.challenge) {
      cachedChallenge = data.challenge;
      cachedAt = now;
      return { challenge: cachedChallenge };
    }
  } catch {
    // ignore errors – treat as no-captcha required
  }
  return {};
}
