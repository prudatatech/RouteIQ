import { create } from 'zustand'
import {
  pickActiveOrgId, readStoredOrgId, writeStoredOrgId, type Membership,
} from '@/utils/orgs'

interface OrgState {
  memberships: Membership[]
  /** Null when the user has no memberships or the backend has no organisations yet: no header is sent. */
  activeOrgId: string | null
  loaded: boolean
  /** Replaces the memberships (from GET /orgs/mine) and keeps the remembered org when still valid. */
  setMemberships: (memberships: Membership[]) => void
  /** Switches organisation; no-op for an org the user is not in. */
  setActiveOrg: (id: string) => void
  reset: () => void
}

export const useOrgStore = create<OrgState>()((set, get) => ({
  memberships: [],
  activeOrgId: null,
  loaded: false,
  setMemberships: memberships => {
    const activeOrgId = pickActiveOrgId(memberships, get().activeOrgId ?? readStoredOrgId())
    writeStoredOrgId(activeOrgId)
    set({ memberships, activeOrgId, loaded: true })
  },
  setActiveOrg: id => {
    if (!get().memberships.some(m => m.org.id === id)) return
    writeStoredOrgId(id)
    set({ activeOrgId: id })
  },
  reset: () => set({ memberships: [], activeOrgId: null, loaded: true }),
}))

/** The active membership (org and the user's role in it), or null. */
export const selectActiveMembership = (s: OrgState): Membership | null =>
  s.memberships.find(m => m.org.id === s.activeOrgId) ?? null

/** Headers to add to an API call: X-Org-Id only when an organisation is active. */
export function orgHeaders(): Record<string, string> {
  const id = useOrgStore.getState().activeOrgId
  return id ? { 'X-Org-Id': id } : {}
}
