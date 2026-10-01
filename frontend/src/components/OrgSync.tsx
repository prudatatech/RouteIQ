import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { orgAPI } from '@/services/api'
import { useAuthStore } from '@/store/authStore'
import { useOrgStore } from '@/store/orgStore'

/**
 * Loads the user's organisations once signed in, and clears cached data whenever the active
 * organisation changes so nothing from the old one stays on screen. If /orgs/mine fails or is
 * empty (older backend) there is no active organisation and no X-Org-Id header is sent.
 */
export function OrgSync() {
  const queryClient = useQueryClient()
  const userId = useAuthStore(s => s.userId)
  const hasSession = useAuthStore(s => !!s.session)
  const activeOrgId = useOrgStore(s => s.activeOrgId)
  const previous = useRef(activeOrgId)

  useEffect(() => {
    if (!hasSession || !userId) { useOrgStore.getState().reset(); return }
    let cancelled = false
    orgAPI.mine()
      .then(m => { if (!cancelled) useOrgStore.getState().setMemberships(m) })
      .catch(() => { if (!cancelled) useOrgStore.getState().reset() })
    return () => { cancelled = true }
  }, [hasSession, userId])

  useEffect(() => {
    if (previous.current === activeOrgId) return
    previous.current = activeOrgId
    // Reset (not just remove) so the pages on screen refetch for the new organisation
    void queryClient.resetQueries()
  }, [activeOrgId, queryClient])

  return null
}
