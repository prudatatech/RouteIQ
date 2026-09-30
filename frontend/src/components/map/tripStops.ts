import type { EtaStop } from './useLiveEta'

interface DeliveryPointLike {
  latitude?: number | string | null
  longitude?: number | string | null
}

/** A route stop as the routes API returns it (`route_stops(*, delivery_points(*))`). */
export interface TripStopRow {
  sequence?: number | null
  status?: string | null
  planned_arrival_at?: string | null
  delivery_points?: DeliveryPointLike | DeliveryPointLike[] | null
}

/**
 * The stops a vehicle still has to reach, in order, with a real position each. Stops with no
 * coordinates are left out (never guessed), and done stops (completed, failed, skipped) are not remaining.
 */
export function remainingStops(rows: readonly TripStopRow[] | null | undefined): EtaStop[] {
  return (rows ?? [])
    .filter((s) => (s.status ?? 'pending') === 'pending' || s.status === 'arrived')
    .slice()
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
    .flatMap((s) => {
      const dp = Array.isArray(s.delivery_points) ? s.delivery_points[0] : s.delivery_points
      if (dp?.latitude == null || dp?.longitude == null) return []
      const lat = Number(dp.latitude)
      const lng = Number(dp.longitude)
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return []
      return [{ position: { lat, lng }, plannedArrivalAt: s.planned_arrival_at ?? null }]
    })
}
