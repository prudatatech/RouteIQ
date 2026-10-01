export type OrgKind = 'platform' | 'logistic_company' | 'vendor' | 'tpl_partner'
export type OrgRole = 'owner' | 'admin' | 'ops' | 'finance' | 'dispatcher' | 'driver' | 'member'

export interface Membership {
  org: { id: string; kind: OrgKind; name: string; status: string }
  role: OrgRole
}

export const ORG_STORAGE_KEY = 'margixindia-active-org'

/** Switcher group headings, in the order they are shown. */
export const ORG_KIND_GROUPS: { kind: OrgKind; label: string }[] = [
  { kind: 'platform', label: 'Platform' },
  { kind: 'logistic_company', label: 'Logistic companies' },
  { kind: 'vendor', label: 'Vendor' },
  { kind: 'tpl_partner', label: '3PL' },
]

export const ORG_ROLE_LABELS: Record<OrgRole, string> = {
  owner: 'Owner', admin: 'Admin', ops: 'Operations', finance: 'Finance', dispatcher: 'Dispatcher', driver: 'Driver', member: 'Member',
}

/** Memberships grouped by kind in the fixed order; empty groups are left out. */
export function groupMemberships(memberships: Membership[]): { kind: OrgKind; label: string; items: Membership[] }[] {
  return ORG_KIND_GROUPS
    .map(g => ({ ...g, items: memberships.filter(m => m.org.kind === g.kind) }))
    .filter(g => g.items.length > 0)
}

/** The remembered org if the user is still a member of it, else the first membership, else null. */
export function pickActiveOrgId(memberships: Membership[], remembered: string | null): string | null {
  if (memberships.length === 0) return null
  if (remembered && memberships.some(m => m.org.id === remembered)) return remembered
  return memberships[0].org.id
}

export function readStoredOrgId(): string | null {
  try { return localStorage.getItem(ORG_STORAGE_KEY) } catch { return null }
}

export function writeStoredOrgId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ORG_STORAGE_KEY, id)
    else localStorage.removeItem(ORG_STORAGE_KEY)
  } catch { /* storage unavailable: the choice lasts for this tab only */ }
}

export interface OrgProfileInput {
  name: string
  legal_name: string
  gstin: string
  pan: string
  state: string
  address: string
}

export interface OrgProfile extends Partial<OrgProfileInput> {
  id: string
  kind: OrgKind
  status: string
}

export interface OrgMember {
  user_id: string
  full_name?: string | null
  email?: string | null
  phone?: string | null
  role: OrgRole
  status: string
}

/** Only owners and admins of the active organisation manage its profile and members. */
export const canManageOrg = (role: OrgRole | undefined): boolean => role === 'owner' || role === 'admin'
