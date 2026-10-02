import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { selectActiveMembership, useOrgStore } from '@/store/orgStore'
import { Link } from 'react-router-dom'
import { canOpenPath, gateFor, isPlatformOnlyPath } from '@/utils/orgAccess'
import { LoadingState } from '@/components/ui'

/**
 * Wraps the staff console. A user whose active organisation is pending, rejected or suspended only gets
 * the "Waiting for approval" screen (no menu); /platform pages open for the platform owner alone.
 */
export function OrgGuard({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const loaded = useOrgStore(s => s.loaded)
  const active = useOrgStore(selectActiveMembership)
  const gate = gateFor(loaded, active)
  // Wait for the organisations before drawing a menu the user might not be allowed to use
  if (gate === 'loading') return <div className="flex min-h-screen items-center justify-center bg-bg"><LoadingState label="Loading" /></div>
  if (gate === 'waiting' || gate === 'suspended') return <Navigate to="/waiting-for-approval" replace />
  if (loaded && !canOpenPath(pathname, active)) {
    if (isPlatformOnlyPath(pathname)) return <PlatformOnlyMessage />
    return <Navigate to="/today" replace />
  }
  return <>{children}</>
}

/** Shown in place of a platform-only page (vendor verification, 3PL applications) to anyone acting for a company. */
function PlatformOnlyMessage() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-form flex-col items-start justify-center gap-3 px-4">
      <h1 className="text-2xl font-semibold text-text">This page is for the MargixIndia platform team</h1>
      <p className="text-muted">
        Verifying vendors and approving 3PL partners is done by the platform, not by a company. Your company still sees the name
        and city of the vendors whose loads it can open.
      </p>
      <Link to="/today" className="text-brand underline">Back to Today</Link>
    </div>
  )
}
