import { useEffect } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Lock } from 'lucide-react'
import { useEffectiveRole } from '@/store/effectiveRole'
import { roleCanOpen } from '@/utils/effectiveRole'
import { useAccountKind } from '@/store/accountKind'
import { homeForKind, LOGIN_PATH, type AccountKind } from '@/utils/accountKind'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/services/supabase'
import { Button, EmptyState, Spinner } from '@/components/ui'
import { pageNameFor } from '@/config/navigation'

/** Home page for a role, from the store. Vendors without a profile are routed later by the vendor pages. */
function homeForRole(role: string | null): string | null {
  if (role === 'admin' || role === 'superadmin' || role === 'manager') return '/today'
  if (role === 'driver') return '/driver'
  if (role === 'vendor') return '/vendor/loads'
  return null
}

function NoAccess() {
  const clearAuth = useAuthStore(s => s.clearAuth)
  const signOut = async () => {
    try { await supabase.auth.signOut() } catch (err) { console.error('Sign-out failed', err) }
    clearAuth()
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <EmptyState
        icon={<Lock size={22} />}
        title="This account can't use the web app"
        description="Ask your MargixIndia administrator to give your account access, or sign in with a different account."
        action={<Button variant="secondary" onClick={signOut}>Sign out</Button>}
      />
    </div>
  )
}

/** Sends a signed-in user home from a page their role cannot open, and says why. */
function BlockedRedirect({ to, from }: { to: string; from: string }) {
  useEffect(() => {
    const name = pageNameFor(from)
    toast.error(`You don't have access to this page${name ? ` (${name})` : ''}. Ask an administrator if you need it.`, { id: 'page-blocked' })
  }, [from])
  return <Navigate to={to} replace />
}

/**
 * `kinds` limits a route to one kind of account (staff, vendor or 3PL partner; see utils/accountKind.ts) on top of
 * `allowedRoles`: a 3PL partner has the vendor role but is not a vendor.
 */
export default function PrivateRoute({ children, allowedRoles, kinds }: { children: React.ReactNode, allowedRoles?: string[], kinds?: AccountKind[] }) {
  const location = useLocation()
  const token = useAuthStore(s => s.token)
  const { role, ready: orgsReady } = useEffectiveRole()
  const { kind, tplPartnerId, role: accountRole } = useAccountKind()
  const authInitialized = useAuthStore(s => s.authInitialized)

  // Supabase's session (and this store) haven't finished restoring yet — e.g. a hard
  // reload of a deep link. Show a spinner instead of bouncing to /login prematurely.
  // Also wait for a signed-in person's organisations: their role is the one they hold in the active organisation
  if (!authInitialized || (token && !orgsReady)) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-bg">
        <Spinner size={32} />
      </div>
    )
  }

  if (!token) {
    // Come back here after signing in
    const params = new URLSearchParams({ next: `${location.pathname}${location.search}` })
    return <Navigate to={`${LOGIN_PATH}?${params}`} replace />
  }

  // A route for one kind of account sends the others to their own home
  if (kinds && (!kind || !kinds.includes(kind))) {
    const home = kind ? homeForKind(kind, { role: accountRole, tplPartnerId }) : null
    if (!home || home === location.pathname) return <NoAccess />
    return <BlockedRedirect to={home} from={location.pathname} />
  }

  // If this route is restricted to certain roles
  if (!roleCanOpen(role, allowedRoles)) {
    const home = homeForRole(role)
    // Accounts with no area in the web app (no role, customers) would
    // otherwise bounce between redirects forever.
    if (!home || home === location.pathname) return <NoAccess />
    return <BlockedRedirect to={home} from={location.pathname} />
  }

  return <>{children}</>
}
