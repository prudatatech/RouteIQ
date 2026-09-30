/**
 * Where a requester's own page is: their booking, vendor load or bid. Used by the shipment page and the
 * invoice page, so both link to the same place.
 */
export function requesterHref(r: { kind: string; id: string | null }): string | null {
  if (!r.id) return null
  const id = encodeURIComponent(r.id)
  if (r.kind === 'customer_booking') return `/requests?open=${id}&source=customer`
  if (r.kind === 'vendor_load') return `/requests?open=${id}&source=vendor`
  if (r.kind === 'vendor_bid') return `/bids?open=${id}`
  return null
}
