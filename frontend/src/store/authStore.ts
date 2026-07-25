import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { supabase } from '@/services/supabase'
import type { Session } from '@supabase/supabase-js'

interface AuthState {
  token: string | null
  refreshToken: string | null
  role: string | null
  userId: string | null
  session: Session | null
  setAuth: (token: string, refreshToken: string, role: string, userId: string) => void
  setSession: (session: Session | null, role?: string) => void
  clearAuth: () => void
  initAuth: () => Promise<void>
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      refreshToken: null,
      role: null,
      userId: null,
      session: null,

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
      },
    }),
    { name: 'routeiq-auth-store' }
  )
)

