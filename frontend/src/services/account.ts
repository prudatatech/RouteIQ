import { supabase } from './supabase'

export interface Account {
  /** superadmin, admin, manager, driver, vendor, or whatever public.users holds; null when there is no row. */
  role: string | null
  hasVendorProfile: boolean
  tplPartnerId: string | null
}

/**
 * Works out what a signed-in user is, the same way the database does in
 * public.current_app_role(): staff roles from public.users win, then anyone with a
 * vendor profile or a 3PL partner record is a vendor, otherwise the public.users role.
 * Never reads user_metadata, which the user can set themselves.
 */
export async function loadAccount(userId: string): Promise<Account> {
  const [user, vendor, partner] = await Promise.all([
    supabase.from('users').select('role').eq('id', userId).maybeSingle(),
    supabase.from('vendor_profiles').select('id').eq('id', userId).maybeSingle(),
    supabase.from('tpl_partners').select('id').eq('user_id', userId).limit(1).maybeSingle(),
  ])
  const failed = user.error || vendor.error || partner.error
  if (failed) throw failed

  const userRole: string | null = user.data?.role ?? null
  const hasVendorProfile = !!vendor.data
  const tplPartnerId: string | null = partner.data?.id ?? null
  const isStaff = userRole === 'admin' || userRole === 'superadmin' || userRole === 'manager'
  const role = !isStaff && (hasVendorProfile || tplPartnerId) ? 'vendor' : userRole
  return { role, hasVendorProfile, tplPartnerId }
}

/** The page a user lands on after signing in, or null when the account has no area in the web app. */
export function homeFor(account: Account): string | null {
  switch (account.role) {
    case 'superadmin':
    case 'admin':
    case 'manager':
      return '/today'
    case 'driver':
      return '/driver'
    case 'vendor':
      if (account.tplPartnerId) return `/3pl-portal/${account.tplPartnerId}`
      return account.hasVendorProfile ? '/vendor' : '/vendor/onboarding'
    default:
      return null
  }
}

function hasPendingLoadRequest() {
  try {
    return !!sessionStorage.getItem('pendingMapRequest')
  } catch {
    return false
  }
}

/**
 * Where to go after signing in. A vendor without a company profile always goes to
 * onboarding first. Otherwise a safe `next` path wins, then a load the vendor started
 * posting before signing in, then the role's home page.
 */
export function destinationFor(account: Account, next: string | null): string | null {
  const home = homeFor(account)
  if (!home) return null
  const isVendor = account.role === 'vendor'
  if (isVendor && !account.tplPartnerId && !account.hasVendorProfile) return home
  if (next) return next
  if (isVendor && !account.tplPartnerId && hasPendingLoadRequest()) return '/vendor/request'
  return home
}
