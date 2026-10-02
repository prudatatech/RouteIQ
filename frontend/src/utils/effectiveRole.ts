import type { Membership } from '@/utils/orgs'

/**
 * The role a person has in the organisation they act for. The API computes it (GET /orgs/mine: `app_role` on each
 * membership; platform owner/admin -> superadmin, company owner/admin -> admin, ops/dispatcher/finance/member ->
 * manager, driver -> driver, vendor and 3PL -> vendor, and none of the staff roles while the organisation is not
 * active), so the screens and the backend agree. Without an active membership (no organisations yet, a customer,
 * an older backend) it is the account role, as before.
 */
export function effectiveRoleOf(
  accountRole: string | null,
  memberships: Membership[],
  activeOrgId: string | null,
): string | null {
  const active = activeOrgId ? memberships.find(m => m.org.id === activeOrgId) : undefined
  return active?.app_role ?? accountRole
}

const STAFF = ['admin', 'superadmin', 'manager']

/** Whether a role works in the operations screens. */
export const isStaffRole = (role: string | null | undefined): boolean => !!role && STAFF.includes(role)

/** Whether a route restricted to `allowedRoles` opens for `role` (no restriction opens for everyone signed in). */
export const roleCanOpen = (role: string | null, allowedRoles?: string[]): boolean =>
  !allowedRoles || (!!role && allowedRoles.includes(role))
