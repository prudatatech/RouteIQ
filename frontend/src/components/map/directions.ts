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

/** Resolved routes, cached in memory per origin/destination (and any via stops) key for this tab's lifetime. */
const routeCache = new Map<string, DrivingRoute | null>()
/** In-flight requests, keyed the same way, so concurrent callers for the same key share one fetch. */
const inFlight = new Map<string, Promise<DrivingRoute | null>>()

/** Stable cache key for an ordered waypoint list; coordinates are rounded to ~1 m so GPS jitter still hits the cache. */
function waypointsKey(waypoints: LatLng[]): string {
  return waypoints.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(';')
}

/**
 * Road route through the waypoints, in order, using live traffic.
 * Returns null without a Mapbox token, with fewer than two waypoints, or when
 * no route is found; callers then draw a dashed straight line instead.
 *
 * Results are cached in memory per origin/destination key, and concurrent
 * requests for the same key are de-duplicated onto a single network call.
 */
export async function fetchDrivingRoute(waypoints: LatLng[], signal?: AbortSignal): Promise<DrivingRoute | null> {
  if (!MAPBOX_TOKEN || waypoints.length < 2) return null

  const key = waypointsKey(waypoints)
  if (routeCache.has(key)) return routeCache.get(key) ?? null

  let pending = inFlight.get(key)
  if (!pending) {
    pending = requestDrivingRoute(waypoints, MAPBOX_TOKEN)
      .then((result) => {
        routeCache.set(key, result)
        return result
      })
      .finally(() => { inFlight.delete(key) })
    inFlight.set(key, pending)
  }

  if (!signal) return pending
  // `signal` only cancels this caller's wait; the shared request keeps going for other callers.
  return new Promise<DrivingRoute | null>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'))
    if (signal.aborted) { onAbort(); return }
    signal.addEventListener('abort', onAbort, { once: true })
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

async function requestDrivingRoute(waypoints: LatLng[], token: string): Promise<DrivingRoute | null> {
  const coords = waypoints.slice(0, MAX_WAYPOINTS).map((p) => `${p.lng},${p.lat}`).join(';')
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coords}` +
    `?overview=full&geometries=geojson&access_token=${encodeURIComponent(token)}`

  const res = await fetch(url)
  if (!res.ok) throw new Error(`Directions request failed (${res.status})`)
  const data = (await res.json()) as {
    routes?: { geometry: { coordinates: [number, number][] }; duration: number; distance: number }[]
  }
  const best = data.routes?.[0]
  if (!best) return null
  return { coordinates: best.geometry.coordinates, durationSeconds: best.duration, distanceMeters: best.distance }
}
