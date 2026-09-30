import { MAPBOX_TOKEN } from '@/config/mapConfig'
import { alignCongestion, type CongestionLevel } from './congestion'
import type { LatLng } from './types'

export interface DrivingRoute {
  /** Road geometry as GeoJSON [lng, lat] pairs. */
  coordinates: [number, number][]
  /** Duration with live traffic. */
  durationSeconds: number
  distanceMeters: number
  /**
   * Congestion of each line segment (`coordinates.length - 1` entries, "unknown" where Mapbox has
   * no data), from the `congestion` annotation. Empty when the response had none.
   */
  congestion: CongestionLevel[]
  /** Length in metres of each line segment, from the `distance` annotation (same length as `congestion`). */
  segmentMeters: number[]
  /** Duration in seconds of each line segment, from the `duration` annotation (same length as `congestion`). */
  segmentSeconds: number[]
}

/** The Mapbox Directions API accepts at most 25 waypoints. */
const MAX_WAYPOINTS = 25

/** True when driving directions can be fetched (a Mapbox token is configured). */
export const directionsAvailable = MAPBOX_TOKEN !== null

/**
 * How long a road route stays valid. Live traffic moves within minutes, so an old answer would
 * colour the road and promise an arrival time that are no longer true.
 */
export const ROUTE_CACHE_MS = 3 * 60_000
/** Free-flow time hardly changes during the day, so it is kept longer. */
export const FREE_FLOW_CACHE_MS = 20 * 60_000

interface Cached<T> { value: T; at: number }

/** Resolved routes, cached in memory per waypoint list for `ROUTE_CACHE_MS`. */
const routeCache = new Map<string, Cached<DrivingRoute | null>>()
const freeFlowCache = new Map<string, Cached<number | null>>()
/** In-flight requests, keyed the same way, so concurrent callers for the same key share one fetch. */
const inFlight = new Map<string, Promise<DrivingRoute | null>>()
const freeFlowInFlight = new Map<string, Promise<number | null>>()

/** Stable cache key for an ordered waypoint list; coordinates are rounded to ~1 m so GPS jitter still hits the cache. */
function waypointsKey(waypoints: LatLng[], digits = 5): string {
  return waypoints.map((p) => `${p.lat.toFixed(digits)},${p.lng.toFixed(digits)}`).join(';')
}

function fresh<T>(entry: Cached<T> | undefined, maxAgeMs: number): entry is Cached<T> {
  return entry !== undefined && Date.now() - entry.at < maxAgeMs
}

/**
 * Road route through the waypoints, in order, using live traffic (Mapbox driving-traffic), with
 * per-segment congestion, duration and distance annotations.
 * Returns null without a Mapbox token, with fewer than two waypoints, or when
 * no route is found; callers then draw a dashed straight line instead.
 *
 * Results are cached in memory for a few minutes, and concurrent requests for the same
 * waypoints are de-duplicated onto a single network call.
 */
export async function fetchDrivingRoute(waypoints: LatLng[], signal?: AbortSignal): Promise<DrivingRoute | null> {
  if (!MAPBOX_TOKEN || waypoints.length < 2) return null

  const key = waypointsKey(waypoints)
  const cached = routeCache.get(key)
  if (fresh(cached, ROUTE_CACHE_MS)) return cached.value

  let pending = inFlight.get(key)
  if (!pending) {
    pending = requestDrivingRoute(waypoints, MAPBOX_TOKEN)
      .then((result) => {
        routeCache.set(key, { value: result, at: Date.now() })
        return result
      })
      .finally(() => { inFlight.delete(key) })
    inFlight.set(key, pending)
  }

  return withSignal(pending, signal)
}

/** `signal` only cancels this caller's wait; the shared request keeps going for other callers. */
function withSignal<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'))
    if (signal.aborted) { onAbort(); return }
    signal.addEventListener('abort', onAbort, { once: true })
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

interface MapboxLeg {
  annotation?: { congestion?: unknown[]; duration?: unknown[]; distance?: unknown[] }
}

const numbers = (values: unknown[] | undefined): number[] =>
  (values ?? []).map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0))

/** Turns a Mapbox directions response into a DrivingRoute. Exported for tests. */
export function parseDrivingRoute(data: {
  routes?: { geometry: { coordinates: [number, number][] }; duration: number; distance: number; legs?: MapboxLeg[] }[]
}): DrivingRoute | null {
  const best = data.routes?.[0]
  if (!best) return null
  const coordinates = best.geometry.coordinates
  const legs = best.legs ?? []
  const joined = (pick: (a: NonNullable<MapboxLeg['annotation']>) => unknown[] | undefined) =>
    legs.flatMap((leg) => (leg.annotation ? pick(leg.annotation) ?? [] : []))
  const congestion = joined((a) => a.congestion)
  const segments = Math.max(0, coordinates.length - 1)
  const pad = (values: number[]) => Array.from({ length: segments }, (_, i) => values[i] ?? 0)
  return {
    coordinates,
    durationSeconds: best.duration,
    distanceMeters: best.distance,
    congestion: congestion.length > 0 ? alignCongestion(congestion, coordinates.length) : [],
    segmentMeters: pad(numbers(joined((a) => a.distance))),
    segmentSeconds: pad(numbers(joined((a) => a.duration))),
  }
}

async function requestDrivingRoute(waypoints: LatLng[], token: string): Promise<DrivingRoute | null> {
  const coords = waypoints.slice(0, MAX_WAYPOINTS).map((p) => `${p.lng},${p.lat}`).join(';')
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coords}` +
    `?overview=full&geometries=geojson&annotations=congestion,duration,distance&access_token=${encodeURIComponent(token)}`

  const res = await fetch(url)
  if (!res.ok) throw new Error(`Directions request failed (${res.status})`)
  return parseDrivingRoute(await res.json())
}

/**
 * Driving time through the waypoints ignoring traffic (Mapbox `driving`, speed-limit based).
 * The gap to `DrivingRoute.durationSeconds` is what traffic adds. Null without a token or when
 * no route is found. The waypoint key is coarse (about 1 km) so a moving vehicle reuses it.
 */
export async function fetchFreeFlowSeconds(waypoints: LatLng[], signal?: AbortSignal): Promise<number | null> {
  if (!MAPBOX_TOKEN || waypoints.length < 2) return null
  const key = waypointsKey(waypoints, 2)
  const cached = freeFlowCache.get(key)
  if (fresh(cached, FREE_FLOW_CACHE_MS)) return cached.value

  let pending = freeFlowInFlight.get(key)
  if (!pending) {
    const coords = waypoints.slice(0, MAX_WAYPOINTS).map((p) => `${p.lng},${p.lat}`).join(';')
    const url =
      `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}` +
      `?overview=false&access_token=${encodeURIComponent(MAPBOX_TOKEN)}`
    pending = fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Directions request failed (${res.status})`)
        const data = (await res.json()) as { routes?: { duration: number }[] }
        const seconds = data.routes?.[0]?.duration ?? null
        freeFlowCache.set(key, { value: seconds, at: Date.now() })
        return seconds
      })
      .finally(() => { freeFlowInFlight.delete(key) })
    freeFlowInFlight.set(key, pending)
  }
  return withSignal(pending, signal)
}
