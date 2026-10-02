import { useAuthStore } from '@/store/authStore'
import { useOrgStore } from '@/store/orgStore'
import { effectiveRoleOf } from '@/utils/effectiveRole'

/**
 * The signed-in person's role in the active organisation (see utils/effectiveRole.ts), re-read whenever the
 * organisation switches or the memberships reload. `ready` is false while a signed-in person's organisations
 * are still loading, so a guard waits instead of judging by the account role and bouncing them.
 */
export function useEffectiveRole(): { role: string | null; ready: boolean } {
  const accountRole = useAuthStore(s => s.role)
  const signedIn = useAuthStore(s => !!s.token)
  const memberships = useOrgStore(s => s.memberships)
  const activeOrgId = useOrgStore(s => s.activeOrgId)
  const loaded = useOrgStore(s => s.loaded)
  return { role: effectiveRoleOf(accountRole, memberships, activeOrgId), ready: !signedIn || loaded }
}
