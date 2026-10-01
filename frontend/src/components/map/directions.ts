import { api } from '@/services/api'
import { alignCongestion, type CongestionLevel } from './congestion'
import type { LatLng } from './types'

export interface DrivingRoute {
  /** Road geometry as GeoJSON [lng, lat] pairs. */
  coordinates: [number, number][]
  /** Duration with live traffic. */
  durationSeconds: number
  distanceMeters: number
  /**
   * Congestion of each line segment (`coordinates.length - 1` entries, "unknown" where there is
   * no data), from the provider's `congestion` annotation. Empty when the answer had none.
   */
  congestion: CongestionLevel[]
  /** Length in metres of each line segment (same length as `congestion`). */
  segmentMeters: number[]
  /** Duration in seconds of each line segment (same length as `congestion`). */
  segmentSeconds: number[]
}

/** The backend accepts at most 25 waypoints per request. */
const MAX_WAYPOINTS = 25

/**
 * Driving directions come from the backend (`POST /routing/directions`), which holds the Mapbox
 * and TomTom keys, so the browser needs no map token and this is always on. When the server has no
 * provider set up (503) or finds no route, callers get null and draw the dashed straight line.
 */
export const directionsAvailable = true

/**
 * Whether the server said (once) that it has no directions provider. Staff pages ask
 * `GET /routing/status` first and pass the answer on, so a server without a key is never called
 * for every trip page.
 */
export interface RoutingAvailability { available?: boolean }
export const routingOff = (status: RoutingAvailability | null | undefined): boolean => status?.available === false

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

/** Directions as the backend sends them (`POST /routing/directions`). */
export interface DirectionsResponse {
  coordinates?: [number, number][]
  distance_meters?: number
  duration_seconds?: number
  congestion?: unknown[]
  segment_meters?: unknown[]
  segment_seconds?: unknown[]
}

const numbers = (values: unknown[] | undefined): number[] =>
  (values ?? []).map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0))

/** Turns the backend's directions answer into a DrivingRoute. Exported for tests. */
export function parseDirectionsResponse(data: DirectionsResponse | null | undefined): DrivingRoute | null {
  const coordinates = data?.coordinates
  if (!data || !Array.isArray(coordinates) || coordinates.length < 2) return null
  const segments = coordinates.length - 1
  const pad = (values: number[]) => Array.from({ length: segments }, (_, i) => values[i] ?? 0)
  const congestion = data.congestion ?? []
  return {
    coordinates,
    durationSeconds: Number(data.duration_seconds) || 0,
    distanceMeters: Number(data.distance_meters) || 0,
    congestion: congestion.length > 0 ? alignCongestion(congestion, coordinates.length) : [],
    segmentMeters: pad(numbers(data.segment_meters)),
    segmentSeconds: pad(numbers(data.segment_seconds)),
  }
}

/** The server has no provider (503) or no road route (404): not an error, the caller draws a straight line. */
export function isNoRoute(error: unknown): boolean {
  const status = (error as { response?: { status?: number } })?.response?.status
  return status === 503 || status === 404
}

async function requestDirections(waypoints: LatLng[], traffic: boolean): Promise<DrivingRoute | null> {
  try {
    const res = await api.post('/routing/directions', {
      waypoints: waypoints.slice(0, MAX_WAYPOINTS).map((p) => ({ lat: p.lat, lng: p.lng })),
      traffic,
    })
    return parseDirectionsResponse(res.data as DirectionsResponse)
  } catch (error) {
    if (isNoRoute(error)) return null
    throw error
  }
}

function cachedRoute(key: string, load: () => Promise<DrivingRoute | null>, signal?: AbortSignal): Promise<DrivingRoute | null> {
  const cached = routeCache.get(key)
  if (fresh(cached, ROUTE_CACHE_MS)) return Promise.resolve(cached.value)

  let pending = inFlight.get(key)
  if (!pending) {
    pending = load()
      .then((result) => {
        routeCache.set(key, { value: result, at: Date.now() })
        return result
      })
      .finally(() => { inFlight.delete(key) })
    inFlight.set(key, pending)
  }
  return withSignal(pending, signal)
}

/**
 * Road route through the waypoints, in order, using live traffic, with per-segment congestion,
 * duration and distance annotations (congestion comes from Mapbox; the TomTom fallback has none).
 * Returns null with fewer than two waypoints, when the server has no directions provider, or when
 * no route is found; callers then draw a dashed straight line instead. Other failures reject.
 *
 * Results are cached in memory for a few minutes, and concurrent requests for the same
 * waypoints are de-duplicated onto a single network call.
 */
export async function fetchDrivingRoute(waypoints: LatLng[], signal?: AbortSignal): Promise<DrivingRoute | null> {
  if (waypoints.length < 2) return null
  return cachedRoute(waypointsKey(waypoints), () => requestDirections(waypoints, true), signal)
}

/**
 * The road line from a tracked shipment's vehicle to its next stop, for the public tracking page
 * (no sign-in, so it cannot ask for arbitrary directions). The server works out both ends itself;
 * `positionKey` only keeps the browser from asking again until the vehicle has moved.
 */
export async function fetchTrackedRoute(trackingId: string, positionKey: string, signal?: AbortSignal): Promise<DrivingRoute | null> {
  return cachedRoute(`track:${trackingId}:${positionKey}`, async () => {
    try {
      const res = await api.get(`/shipments/track/${encodeURIComponent(trackingId)}/route`)
      return parseDirectionsResponse(res.data as DirectionsResponse)
    } catch (error) {
      if (isNoRoute(error)) return null
      throw error
    }
  }, signal)
}

/**
 * Driving time through the waypoints ignoring traffic (speed-limit based).
 * The gap to `DrivingRoute.durationSeconds` is what traffic adds. Null when the server has no
 * provider or no route is found. The waypoint key is coarse (about 1 km) so a moving vehicle reuses it.
 */
export async function fetchFreeFlowSeconds(waypoints: LatLng[], signal?: AbortSignal): Promise<number | null> {
  if (waypoints.length < 2) return null
  const key = waypointsKey(waypoints, 2)
  const cached = freeFlowCache.get(key)
  if (fresh(cached, FREE_FLOW_CACHE_MS)) return cached.value

  let pending = freeFlowInFlight.get(key)
  if (!pending) {
    pending = requestDirections(waypoints, false)
      .then((route) => {
        const seconds = route ? route.durationSeconds : null
        freeFlowCache.set(key, { value: seconds, at: Date.now() })
        return seconds
      })
      .finally(() => { freeFlowInFlight.delete(key) })
    freeFlowInFlight.set(key, pending)
  }
  return withSignal(pending, signal)
}
