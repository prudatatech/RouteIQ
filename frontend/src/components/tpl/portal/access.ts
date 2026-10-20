/**
 * Whether the signed-in account may open the partner portal at `routeId`.
 * The portal is the partner's own: `ownPartnerId` is the partner record linked to this sign-in (null when there is none).
 */
export type PortalAccess = 'own' | 'other' | 'no-partner'

export function portalAccess(
  ownPartner: string | { id?: string | null; custom_id?: string | null } | null | undefined,
  routeId: string | undefined,
  ownCustomId?: string | null
): PortalAccess {
  if (!ownPartner) return 'no-partner'
  const ownId = typeof ownPartner === 'string' ? ownPartner : ownPartner.id
  const customId = typeof ownPartner === 'object' && ownPartner !== null ? (ownPartner.custom_id ?? ownCustomId) : ownCustomId
  if (!ownId && !customId) return 'no-partner'

  if (!routeId) return 'other'
  const rLower = routeId.toLowerCase()
  if (ownId && rLower === ownId.toLowerCase()) return 'own'
  if (customId && rLower === customId.toLowerCase()) return 'own'
  return 'other'
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
