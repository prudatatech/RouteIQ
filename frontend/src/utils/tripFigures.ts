/**
 * What the Trips list shows for a trip: its number, what it carries, and its distance and time.
 * Pure rules, covered by tripFigures.test.ts.
 */
import { manifestTrackingId } from '@/components/shipments/format'
import { getRouteDistance, getRouteDuration, type RouteLike } from './routeHelpers'

export interface TripLike extends RouteLike {
  id: string
  status: string
  is_manifest?: boolean
  started_at?: string | null
  completed_at?: string | null
  route_stops?: { sequence: number; delivery_points?: { latitude?: number | null; longitude?: number | null } | null; shipment?: { id: string; tracking_id?: string | null } | null }[] | null
}

/** TR-XXXXXXXX for a trip, CM-XXXXXXXX for a vendor load (which is its own trip). */
export const tripCode = (t: Pick<TripLike, 'id' | 'is_manifest'>) =>
  t.is_manifest ? manifestTrackingId(t.id) : `TR-${t.id.split('-')[0].toUpperCase()}`

/** The shipments and lots a trip carries, each once, in stop order. A vendor load carries itself. */
export function tripCarries(t: TripLike): string[] {
  if (t.is_manifest) return [manifestTrackingId(t.id)]
  const stops = [...(t.route_stops ?? [])].sort((a, b) => a.sequence - b.sequence)
  return [...new Set(stops.map(s => s.shipment?.tracking_id).filter((c): c is string => !!c))]
}

export type TripFigures =
  | { kind: 'none' }
  | {
    /** `actual` is what happened (the time from start to finish); `planned` is the plan. */
    kind: 'actual' | 'planned'
    distanceKm: number | null
    durationMinutes: number | null
    /** The trip has finished, so the distance is the planned one (the actual is not recorded). */
    distanceIsPlanned: boolean
  }

/**
 * Distance and time for a trip row.
 * - A cancelled trip with no stops never went anywhere: nothing is shown.
 * - A completed trip shows how long it took (completed minus started) when both times are known;
 *   its distance is the planned one, labelled, because no actual distance is recorded.
 * - Anything else shows the plan, which is the ETA while the trip is open.
 */
export function tripFigures(t: TripLike): TripFigures {
  const stops = t.route_stops?.length ?? 0
  if (t.status === 'cancelled' && stops === 0) return { kind: 'none' }
  const plannedKm = getRouteDistance(t)
  const km = plannedKm > 0 ? plannedKm : null
  const plannedMinutes = km != null ? getRouteDuration(t, km) : null

  if (t.status === 'completed' && t.started_at && t.completed_at) {
    const minutes = Math.round((Date.parse(t.completed_at) - Date.parse(t.started_at)) / 60_000)
    if (Number.isFinite(minutes) && minutes > 0) return { kind: 'actual', distanceKm: km, durationMinutes: minutes, distanceIsPlanned: true }
  }
  if (km == null) return { kind: 'none' }
  return { kind: 'planned', distanceKm: km, durationMinutes: plannedMinutes, distanceIsPlanned: t.status === 'completed' || t.status === 'cancelled' }
}

/** How a trip's `distance_km` was worked out, as the routes API reports it (`distance_basis`). */
export type DistanceBasis = 'actual' | 'planned' | 'estimated' | 'none'

/** "289.3 km", "289.3 km (planned)", "289.3 km (straight line)": the distance with how it was worked out, or a dash. */
export function distanceWithBasis(km: number | null | undefined, basis: DistanceBasis | null | undefined, format: (km: number) => string): string {
  if (km == null || !(km > 0) || basis === 'none' || !basis) return km != null && km > 0 && !basis ? format(km) : '—'
  if (basis === 'planned') return `${format(km)} (planned)`
  if (basis === 'estimated') return `${format(km)} (straight line)`
  return format(km)
}
