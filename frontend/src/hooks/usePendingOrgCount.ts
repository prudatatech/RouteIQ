import { useQuery } from '@tanstack/react-query'
import { adminOrgsAPI } from '@/services/api'
import { selectActiveMembership, useOrgStore } from '@/store/orgStore'
import { isPlatformActor } from '@/utils/orgAccess'

/** How many companies wait for approval; only asked for when acting as the platform owner, else null. */
export function usePendingOrgCount(): number | null {
  const platform = isPlatformActor(useOrgStore(selectActiveMembership))
  const q = useQuery({
    queryKey: ['platform-orgs-pending'],
    queryFn: () => adminOrgsAPI.list({ kind: 'logistic_company', status: 'pending', limit: 1 }).then(p => p.total),
    enabled: platform,
    refetchInterval: 60_000,
    retry: false,
  })
  return platform ? q.data ?? null : null
}
