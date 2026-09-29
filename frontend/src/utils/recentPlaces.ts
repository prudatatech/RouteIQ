import type { ResolvedPlace } from '@/services/geocoding'

/** Recently-picked places are kept per namespace so unrelated pickers don't mix histories. */
const STORAGE_PREFIX = 'margixindia:recent-places:'
/** Most recent entries kept per namespace. */
const MAX_ENTRIES = 8

function storageKey(namespace: string): string {
  return `${STORAGE_PREFIX}${namespace}`
}

/** Up to 8 recently-picked places for `namespace`, most recent first. */
export function getRecentPlaces(namespace: string): ResolvedPlace[] {
  try {
    const raw = localStorage.getItem(storageKey(namespace))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((p): p is ResolvedPlace =>
      !!p && typeof p === 'object' && typeof p.address === 'string' && typeof p.lat === 'number' && typeof p.lng === 'number')
  } catch {
    return []
  }
}

/** Records a picked place, most-recent-first, deduped by address, capped at 8. */
export function addRecentPlace(namespace: string, place: ResolvedPlace): void {
  try {
    const existing = getRecentPlaces(namespace).filter(p => p.address !== place.address)
    const next = [place, ...existing].slice(0, MAX_ENTRIES)
    localStorage.setItem(storageKey(namespace), JSON.stringify(next))
  } catch {
    // Storage may be unavailable (private mode, quota); recent addresses are a convenience only.
  }
}
