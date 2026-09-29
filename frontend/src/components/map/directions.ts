import { MAPBOX_TOKEN } from '@/config/mapConfig'
import type { LatLng } from './types'

export interface DrivingRoute {
  /** Road geometry as GeoJSON [lng, lat] pairs. */
  coordinates: [number, number][]
  durationSeconds: number
  distanceMeters: number
}

/** The Mapbox Directions API accepts at most 25 waypoints. */
const MAX_WAYPOINTS = 25

/** True when driving directions can be fetched (a Mapbox token is configured). */
export const directionsAvailable = MAPBOX_TOKEN !== null

/**
 * Road route through the waypoints, in order, using live traffic.
 * Returns null without a Mapbox token, with fewer than two waypoints, or when
 * no route is found; callers then draw a dashed straight line instead.
 */
export async function fetchDrivingRoute(waypoints: LatLng[], signal?: AbortSignal): Promise<DrivingRoute | null> {
  if (!MAPBOX_TOKEN || waypoints.length < 2) return null
  const coords = waypoints.slice(0, MAX_WAYPOINTS).map((p) => `${p.lng},${p.lat}`).join(';')
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coords}` +
    `?overview=full&geometries=geojson&access_token=${encodeURIComponent(MAPBOX_TOKEN)}`

  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Directions request failed (${res.status})`)
  const data = (await res.json()) as {
    routes?: { geometry: { coordinates: [number, number][] }; duration: number; distance: number }[]
  }
  const best = data.routes?.[0]
  if (!best) return null
  return { coordinates: best.geometry.coordinates, durationSeconds: best.duration, distanceMeters: best.distance }
}
