import * as turf from '@turf/turf'

/** The server prices a rate per km on road distance, about this much longer than the straight line. */
const ROAD_FACTOR = 1.3

type Coordinates = { pickup_lat: number | null; pickup_lng: number | null; drop_lat: number | null; drop_lng: number | null }

/** Whether a load has usable pickup and drop-off coordinates (needed to price a rate per km). */
export const hasRouteCoordinates = (r: Coordinates) =>
  [r.pickup_lat, r.pickup_lng, r.drop_lat, r.drop_lng].every(v => v != null && Number.isFinite(Number(v)))
  && !(Number(r.pickup_lat) === 0 && Number(r.pickup_lng) === 0) && !(Number(r.drop_lat) === 0 && Number(r.drop_lng) === 0)

/** Road distance between a load's pickup and drop-off, estimated from the straight line; null without coordinates. */
export function estimatedRoadKm(r: Coordinates): number | null {
  if (!hasRouteCoordinates(r)) return null
  const km = turf.distance(turf.point([Number(r.pickup_lng), Number(r.pickup_lat)]), turf.point([Number(r.drop_lng), Number(r.drop_lat)]), { units: 'kilometers' })
  return Math.round(km * ROAD_FACTOR)
}

/** Optional price input: blank is fine, otherwise it must be a positive number. */
export function parsePrice(raw: string): { value?: number; error?: string } {
  const text = raw.trim()
  if (!text) return {}
  const value = Number(text)
  if (!Number.isFinite(value) || value <= 0) return { error: 'Enter a number above 0' }
  return { value }
}
