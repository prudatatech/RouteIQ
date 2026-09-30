/**
 * Whether the signed-in account may open the partner portal at `routeId`.
 * The portal is the partner's own: `ownPartnerId` is the partner record linked to this sign-in (null when there is none).
 */
export type PortalAccess = 'own' | 'other' | 'no-partner'

export function portalAccess(ownPartnerId: string | null | undefined, routeId: string | undefined): PortalAccess {
  if (!ownPartnerId) return 'no-partner'
  return routeId && routeId.toLowerCase() === ownPartnerId.toLowerCase() ? 'own' : 'other'
}

/** Where the old `?tab=` links of the one-page dashboard go now (the portal has a page per section). */
const LEGACY_TABS = new Map<string, string>([
  ['overview', ''],
  ['orders', ''],
  ['earnings', 'earnings'],
  ['coverage', 'lanes'],
  ['documents', 'documents'],
  ['settings', 'settings'],
])

/** The portal page for an old `?tab=` value, as a path under the portal ('' is Orders), or null when it is not one. */
export function legacyTabPage(tab: string | null): string | null {
  return (tab && LEGACY_TABS.get(tab)) ?? null
}
