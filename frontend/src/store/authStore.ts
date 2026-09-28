import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { supabase } from '@/services/supabase'
import type { Session } from '@supabase/supabase-js'

// Supabase's own client already persists the token/refreshToken/session in localStorage
// under 'margixindia-auth' (see services/supabase.ts). This store used to duplicate that
// in 'margixindia-auth-store' via zustand's persist — two copies of the same secrets in
// localStorage. Supabase is now the only token store: token/refreshToken/session live only
// in memory here (still readable via useAuthStore for the lifetime of the tab, refreshed by
// setSession/clearAuth/initAuth), and only the non-sensitive role/userId are persisted so
// role-gated UI has something to paint with before the Supabase session round-trips.
interface AuthState {
  token: string | null
  refreshToken: string | null
  role: string | null
  userId: string | null
  session: Session | null
  /** True once the initial supabase.auth.getSession() restore (App's effect / initAuth) has resolved. */
  authInitialized: boolean
  setAuth: (token: string, refreshToken: string, role: string, userId: string) => void
  setSession: (session: Session | null, role?: string) => void
  setAuthInitialized: (initialized: boolean) => void
  clearAuth: () => void
  initAuth: () => Promise<void>
}

const LEGACY_PERSISTED_KEY = 'margixindia-auth-store'

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      refreshToken: null,
      role: null,
      userId: null,
      session: null,
      authInitialized: false,

      // Legacy setter (kept for backward compat during migration)
      setAuth: (token: string, refreshToken: string, role: string, userId: string) =>
        set({ token, refreshToken, role, userId }),

      // New Supabase session setter
      setSession: (session: Session | null, role?: string) => {
        if (session) {
          set({
            token: session.access_token,
            refreshToken: session.refresh_token,
            userId: session.user.id,
            role: role || session.user.user_metadata?.role || get().role || 'driver',
            session,
          })
        } else {
          get().clearAuth()
        }
      },

      setAuthInitialized: (initialized: boolean) => set({ authInitialized: initialized }),

      clearAuth: () =>
        set({ token: null, refreshToken: null, role: null, userId: null, session: null }),

      // Initialize: check for existing Supabase session on app start
      initAuth: async () => {
        const { data: { session } } = await supabase.auth.getSession()
        if (session) {
          // Fetch role from public.users since Supabase JWT role is always 'authenticated'
          const { data: user } = await supabase
            .from('users')
            .select('role')
            .eq('id', session.user.id)
            .maybeSingle()

          get().setSession(session, user?.role)
        }
        set({ authInitialized: true })
      },
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

