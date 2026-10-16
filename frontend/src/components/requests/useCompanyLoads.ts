import { selectActiveMembership, useOrgStore } from '@/store/orgStore'

/** Match the company endpoint's organisation boundary before requesting or showing cached loads. */
export function useCompanyLoads() {
  const active = useOrgStore(selectActiveMembership)
  const ready = useOrgStore(s => s.loaded)
  const allowed = ready && active?.org.kind === 'logistic_company' && active.org.status === 'active' && active.role !== 'driver'
  const message = !ready ? 'Loading your organisation…'
    : active?.org.kind === 'logistic_company' && active.org.status !== 'active'
      ? `Your logistic company is ${active.org.status}. Loads are available after company approval.`
      : active?.role === 'driver' ? 'The company load board is for logistic company staff.'
        : 'Choose a logistic company in the Organisation menu to view and book loads.'
  return { allowed, orgId: active?.org.id ?? null, message }
}
