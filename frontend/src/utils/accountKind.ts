import type { Membership } from './orgs'
import { safeNextPath } from './safeNext'

/**
 * The three kinds of account. They all sign in at /login, which then sends each to its own area (homeForKind):
 *  - staff   logistic company staff, platform admins and drivers
 *  - vendor  a vendor, who is not a 3PL partner
 *  - tpl     a 3PL partner
 */
export type AccountKind = 'staff' | 'vendor' | 'tpl'

export interface KindInput {
  /** The account role from services/account.ts loadAccount (null when the account has no role). */
  role: string | null
  tplPartnerId?: string | null
}

const STAFF_ROLES = ['superadmin', 'admin', 'manager', 'driver']

/** The one sign-in page. */
export const LOGIN_PATH = '/login'

/**
 * What an account is. Staff roles win, as in services/account.ts; then a 3PL partner record or an active
 * 3PL organisation; a membership of the platform or of a logistic company makes someone staff (so a company
 * owner who is still waiting for approval signs in as staff); then a plain vendor. Null when the account has
 * no area in the web app.
 */
export function accountKindOf(input: KindInput, memberships: Membership[] = []): AccountKind | null {
  if (input.role === 'superadmin' || input.role === 'admin' || input.role === 'manager') return 'staff'
  if (input.tplPartnerId) return 'tpl'
  if (memberships.some(m => m.org.kind === 'platform' || m.org.kind === 'logistic_company')) return 'staff'
  if (memberships.some(m => m.org.kind === 'tpl_partner' && m.org.status === 'active')) return 'tpl'
  if (input.role === 'vendor') return 'vendor'
  if (input.role && STAFF_ROLES.includes(input.role)) return 'staff'
  return null
}

/** Pages anyone may open, so a vendor can come back to them after signing in. */
const PUBLIC_PATHS = ['/ship', '/vendor/request', '/vendor/return-trips', '/track']

function pathOf(next: string): string {
  return next.split(/[?#]/)[0].replace(/\/+$/, '') || '/'
}

const isUnder = (path: string, base: string) => path === base || path.startsWith(`${base}/`)

/**
 * `next` only counts when it belongs to the account's own area; otherwise null (the caller goes to the home page).
 * Staff: anything but /vendor/*, /ship and /3pl-portal/*. Vendor: /vendor/*, /ship or the public pages. 3PL: /3pl-portal/*.
 * Also keeps the open-redirect guard (a path starting with "/" and not "//").
 */
export function nextForKind(kind: AccountKind | null, next: string | null | undefined): string | null {
  const safe = safeNextPath(next)
  if (!safe || !kind) return null
  const path = pathOf(safe)
  const vendorArea = isUnder(path, '/vendor') || path === '/ship'
  const tplArea = isUnder(path, '/3pl-portal')
  if (kind === 'staff') return vendorArea || tplArea ? null : safe
  if (kind === 'vendor') return vendorArea || PUBLIC_PATHS.some(p => isUnder(path, p)) ? safe : null
  return tplArea ? safe : null
}

/** The home page of a kind (null when a 3PL account has no partner id to open). */
export function homeForKind(kind: AccountKind, input: KindInput): string | null {
  if (kind === 'vendor') return '/vendor/loads'
  if (kind === 'tpl') return input.tplPartnerId ? `/3pl-portal/${input.tplPartnerId}` : null
  return input.role === 'driver' ? '/driver' : '/today'
}
