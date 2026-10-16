import { useAuthStore } from '@/store/authStore'
import { useOrgStore } from '@/store/orgStore'
import { accountKindOf, type AccountKind } from '@/utils/accountKind'

/**
 * The signed-in person's kind of account (staff, vendor or 3PL partner; see utils/accountKind.ts).
 * `ready` is false while a signed-in person's organisations are still loading.
 */
export function useAccountKind(): { kind: AccountKind | null; signedIn: boolean; ready: boolean; tplPartnerId: string | null; role: string | null } {
  const role = useAuthStore(s => s.role)
  const tplPartnerId = useAuthStore(s => s.tplPartnerId)
  const signedIn = useAuthStore(s => !!s.token)
  const memberships = useOrgStore(s => s.memberships)
  const loaded = useOrgStore(s => s.loaded)
  return { kind: accountKindOf({ role, tplPartnerId }, memberships), signedIn, ready: !signedIn || loaded, tplPartnerId, role }
}

/**
 * For the public vendor pages (/vendor/request, /vendor/return-trips): the kind of a signed-in person who
 * is not a vendor (company staff or a 3PL partner), else null. Posting a load and bidding need a vendor account.
 */
export function useBlockedFromVendorActions(): Exclude<AccountKind, 'vendor'> | null {
  const { kind, signedIn, ready } = useAccountKind()
  return signedIn && ready && kind && kind !== 'vendor' ? kind : null
}
