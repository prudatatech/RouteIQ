/**
 * margixindia — Final drop of a shipment
 *
 * A shipment can have several delivery points. The one rule used everywhere
 * (public tracking, the optimizer, the shipments list, the web console) is:
 * the destination is the final drop, the point created last. `createShipment`
 * stamps its points with rising `created_at` values, so the order is exact.
 */

interface HasCreatedAt {
  created_at?: string | null;
}

/** Delivery points oldest first; points with the same or no timestamp keep their given order. */
export function sortDeliveryPoints<T extends HasCreatedAt>(points: readonly T[] | null | undefined): T[] {
  return (points ?? [])
    .map((p, i) => ({ p, i, t: p.created_at ? Date.parse(p.created_at) : NaN }))
    .sort((a, b) => {
      if (Number.isFinite(a.t) && Number.isFinite(b.t) && a.t !== b.t) return a.t - b.t;
      return a.i - b.i;
    })
    .map(x => x.p);
}

/** The final drop: the last delivery point, or null when there is none. */
export function finalDeliveryPoint<T extends HasCreatedAt>(points: readonly T[] | null | undefined): T | null {
  const sorted = sortDeliveryPoints(points);
  return sorted.length > 0 ? sorted[sorted.length - 1] : null;
}
