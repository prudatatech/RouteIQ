import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { selectActiveMembership, useOrgStore } from '@/store/orgStore'
import { canOpenPath, gateFor } from '@/utils/orgAccess'
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
  if (loaded && !canOpenPath(pathname, active)) return <Navigate to="/today" replace />
  return <>{children}</>
}
