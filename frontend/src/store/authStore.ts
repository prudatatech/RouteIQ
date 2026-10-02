import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Session } from '@supabase/supabase-js'

// Supabase's own client already persists the token/refreshToken/session in localStorage
// under 'margixindia-auth' (see services/supabase.ts). This store used to duplicate that
// in 'margixindia-auth-store' via zustand's persist — two copies of the same secrets in
// localStorage. Supabase is now the only token store: token/refreshToken/session live only
// in memory here (still readable via useAuthStore for the lifetime of the tab, refreshed by
// setSession/clearAuth), and only the non-sensitive role/userId are persisted so
// role-gated UI has something to paint with before the Supabase session round-trips.
interface AuthState {
  token: string | null
  refreshToken: string | null
  role: string | null
  userId: string | null
  /** The 3PL partner record linked to this sign-in (memory only; read again with the role on every load). */
  tplPartnerId: string | null
  session: Session | null
  /** True once the initial supabase.auth.getSession() restore (App's effect) has resolved. */
  authInitialized: boolean
  setAuth: (token: string, refreshToken: string, role: string, userId: string) => void
  setSession: (session: Session | null, role?: string | null, tplPartnerId?: string | null) => void
  setAuthInitialized: (initialized: boolean) => void
  clearAuth: () => void
}

const LEGACY_PERSISTED_KEY = 'margixindia-auth-store'

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      refreshToken: null,
      role: null,
      userId: null,
      tplPartnerId: null,
      session: null,
      authInitialized: false,

      // Legacy setter (kept for backward compat during migration)
      setAuth: (token: string, refreshToken: string, role: string, userId: string) =>
        set({ token, refreshToken, role, userId }),

      // New Supabase session setter
      // `role` must come from the database (services/account.ts). There is deliberately no
      // fallback to user_metadata or to a default role.
      setSession: (session: Session | null, role?: string | null, tplPartnerId?: string | null) => {
        if (session) {
          set({
            token: session.access_token,
            refreshToken: session.refresh_token,
            userId: session.user.id,
            role: role ?? null,
            tplPartnerId: tplPartnerId ?? null,
            session,
          })
        } else {
          get().clearAuth()
        }
      },

      setAuthInitialized: (initialized: boolean) => set({ authInitialized: initialized }),

      clearAuth: () =>
        set({ token: null, refreshToken: null, role: null, userId: null, tplPartnerId: null, session: null }),
    }),
    {
      name: LEGACY_PERSISTED_KEY,
      // Only non-sensitive UI fields are persisted; token/refreshToken/session stay in
      // memory only and are re-derived from Supabase's own session storage on load.
      partialize: (state) => ({ role: state.role, userId: state.userId }),
      version: 1,
      migrate: (persistedState) => {
        // One-time cleanup: any previously persisted token/refreshToken/session is dropped
        // by only carrying forward role/userId from the old blob.
        const legacy = (persistedState || {}) as Partial<AuthState>
        return { role: legacy.role ?? null, userId: legacy.userId ?? null }
      },
    }
  )
)

