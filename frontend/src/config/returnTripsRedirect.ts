/**
 * Old addresses of what is now Return trips (/return-trips), with the tab each one maps to.
 * Backhaul, Bids and 3PL partners were three pages; their own `?tab=` filters and `?open=` links carry over.
 */

export type OldReturnTripsPage = 'backhaul' | 'bids' | 'partners'

/** Old Backhaul tab to the view inside Pool loads. */
const POOL_VIEWS: Record<string, string> = { loads: 'loads', pool: 'plan', match: 'match', price: 'price', delivery: 'delivery' }
const PARTNER_STATUSES = ['pending', 'active', 'paused', 'rejected', 'all']

/** The Return trips address for an old page and its query string (`?tab=decide&open=...`). */
export function returnTripsLink(from: OldReturnTripsPage, search: string): string {
  const old = new URLSearchParams(search)
  const next = new URLSearchParams()
  const oldTab = old.get('tab')

  if (from === 'bids') {
    // Open stays the open tab; every other Bids filter (decide, awarded, closed, all) is now on Bids to decide
    if (oldTab !== 'open') next.set('tab', 'bids')
  } else if (from === 'backhaul') {
    next.set('tab', 'pool')
    const view = oldTab ? POOL_VIEWS[oldTab] : null
    if (view && view !== 'loads') next.set('view', view)
  } else {
    next.set('tab', 'partners')
    if (oldTab && PARTNER_STATUSES.includes(oldTab) && oldTab !== 'pending') next.set('status', oldTab)
  }

  // Everything else (?open=, ?q=, ?sort=) is kept as it was
  for (const [key, value] of old) if (key !== 'tab' && key !== 'view') next.set(key, value)
  const query = next.toString()
  return `/return-trips${query ? `?${query}` : ''}`
}
