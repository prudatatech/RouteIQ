import type { TrackPoint } from './format'

/**
 * Pure helpers for the trip replay: thinning a long track for drawing, colouring it by speed,
 * finding the position at a moment, detecting stoppages, totals and planned-versus-actual.
 * Totals and stoppages are always worked out on the full track; only drawing is thinned.
 */

export interface LatLng { lat: number; lng: number }

const EARTH_KM = 6371
const rad = (d: number) => (d * Math.PI) / 180

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h))
}

export const timeOf = (p: Pick<TrackPoint, 'at'>): number => Date.parse(p.at)

/* ── Downsampling ───────────────────────────────────────────────────────── */

/** Flat-earth distance in km from p to the segment a-b, fine at trip scale. */
function segmentDistanceKm(p: LatLng, a: LatLng, b: LatLng): number {
  const kx = 111.32 * Math.cos(rad(p.lat))
  const ky = 110.57
  const ax = (a.lng - p.lng) * kx, ay = (a.lat - p.lat) * ky
  const bx = (b.lng - p.lng) * kx, by = (b.lat - p.lat) * ky
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2))
  return Math.hypot(ax + t * dx, ay + t * dy)
}

/**
 * Keeps at most `max` points, always the first and the last, choosing the points that
 * bend the path most (Douglas-Peucker by count). A track that is already short is returned as it is.
 */
export function downsampleTrack<T extends LatLng>(points: readonly T[], max: number): T[] {
  const n = points.length
  if (max < 2 || n <= max) return points.slice()

  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1
  let kept = 2

  interface Span { from: number; to: number; at: number; dist: number }
  const farthest = (from: number, to: number): Span => {
    let at = -1
    let dist = -1
    for (let i = from + 1; i < to; i++) {
      const d = segmentDistanceKm(points[i], points[from], points[to])
      if (d > dist) { dist = d; at = i }
    }
    return { from, to, at, dist }
  }

  const spans: Span[] = n > 2 ? [farthest(0, n - 1)] : []
  while (kept < max && spans.length > 0) {
    let best = 0
    for (let i = 1; i < spans.length; i++) if (spans[i].dist > spans[best].dist) best = i
    const span = spans.splice(best, 1)[0]
    if (span.at < 0) continue
    keep[span.at] = 1
    kept++
    if (span.at - span.from > 1) spans.push(farthest(span.from, span.at))
    if (span.to - span.at > 1) spans.push(farthest(span.at, span.to))
  }

  const out: T[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i])
  return out
}

/* ── Speed ──────────────────────────────────────────────────────────────── */

export interface SpeedBucket {
  id: 'stopped' | 'slow' | 'moderate' | 'fast' | 'very-fast'
  label: string
  /** Lower bound in km/h (inclusive). */
  min: number
  /** Raw colour for the map line. */
  color: string
}

/** Slowest first. A trip is mostly moderate and fast; stopped and slow stand out in dark purple and blue. */
export const SPEED_BUCKETS: readonly SpeedBucket[] = [
  { id: 'stopped', label: 'Under 5 km/h', min: 0, color: '#4C1D95' },
  { id: 'slow', label: '5 to 25 km/h', min: 5, color: '#2563EB' },
  { id: 'moderate', label: '25 to 45 km/h', min: 25, color: '#0891B2' },
  { id: 'fast', label: '45 to 65 km/h', min: 45, color: '#15803D' },
  { id: 'very-fast', label: '65 km/h and over', min: 65, color: '#B45309' },
]

export function speedBucket(kmph: number | null | undefined): SpeedBucket {
  const v = typeof kmph === 'number' && Number.isFinite(kmph) && kmph > 0 ? kmph : 0
  let bucket = SPEED_BUCKETS[0]
  for (const b of SPEED_BUCKETS) if (v >= b.min) bucket = b
  return bucket
}

/**
 * Speed at each point: the reported one, or when the device did not report it, the speed
 * implied by the distance and time to the previous point.
 */
export function effectiveSpeeds(points: readonly TrackPoint[]): number[] {
  return points.map((p, i) => {
    if (p.speed_kmph != null && Number.isFinite(p.speed_kmph)) return Math.max(0, p.speed_kmph)
    if (i === 0) return 0
    const dtH = (timeOf(p) - timeOf(points[i - 1])) / 3_600_000
    return dtH > 0 ? haversineKm(points[i - 1], p) / dtH : 0
  })
}

export interface SpeedRun {
  bucket: SpeedBucket
  /** GeoJSON [lng, lat] pairs. */
  coordinates: [number, number][]
}

/**
 * The track cut into runs of one speed bucket, for drawing. Each segment takes the speed of the
 * point it ends at; runs share their end point so the line has no gaps.
 */
export function speedRuns(points: readonly TrackPoint[], speeds: readonly number[] = effectiveSpeeds(points)): SpeedRun[] {
  const runs: SpeedRun[] = []
  for (let i = 1; i < points.length; i++) {
    const bucket = speedBucket(speeds[i])
    const last = runs[runs.length - 1]
    const from: [number, number] = [points[i - 1].lng, points[i - 1].lat]
    const to: [number, number] = [points[i].lng, points[i].lat]
    if (last && last.bucket.id === bucket.id) last.coordinates.push(to)
    else runs.push({ bucket, coordinates: [from, to] })
  }
  return runs
}

/* ── Position at a moment ───────────────────────────────────────────────── */

export interface ReplayPosition {
  lat: number
  lng: number
  /** Direction of travel in degrees clockwise from north, or null while standing still. */
  heading: number | null
  speedKmph: number
  /** Milliseconds since epoch. */
  at: number
  /** Index of the last point at or before `at`. */
  index: number
}

export function bearing(a: LatLng, b: LatLng): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat))
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng))
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

/** The point index of the last fix at or before `t` (0 when `t` is before the first). */
export function indexAt(times: readonly number[], t: number): number {
  let lo = 0
  let hi = times.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (times[mid] <= t) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * Where the vehicle was at time `t`, by linear interpolation between the two fixes around it.
 * Before the first fix and after the last it stays at the ends. `speeds` and `times` are
 * computed once per track by the caller.
 */
export function interpolateAt(points: readonly TrackPoint[], times: readonly number[], speeds: readonly number[], t: number): ReplayPosition | null {
  if (points.length === 0) return null
  const clamped = Math.min(Math.max(t, times[0]), times[times.length - 1])
  const i = indexAt(times, clamped)
  const a = points[i]
  if (i >= points.length - 1) {
    const prev = points[Math.max(0, i - 1)]
    return { lat: a.lat, lng: a.lng, heading: i > 0 && speeds[i] > 0 ? bearing(prev, a) : (a.heading ?? null), speedKmph: speeds[i], at: clamped, index: i }
  }
  const b = points[i + 1]
  const span = times[i + 1] - times[i]
  const f = span > 0 ? (clamped - times[i]) / span : 0
  const moved = haversineKm(a, b) > 0.005
  return {
    lat: a.lat + (b.lat - a.lat) * f,
    lng: a.lng + (b.lng - a.lng) * f,
    heading: moved ? bearing(a, b) : (a.heading ?? null),
    speedKmph: speeds[i] + (speeds[i + 1] - speeds[i]) * f,
    at: clamped,
    index: i,
  }
}

/* ── Playback clock ─────────────────────────────────────────────────────── */

/** At 1x one second of watching is this many seconds of the trip. */
export const TRACK_SECONDS_PER_SECOND = 60
export const PLAYBACK_SPEEDS = [1, 2, 5, 10, 30] as const

export interface ClockStep { time: number; ended: boolean }

/** Moves the replay clock forward by `dtMs` of watching time at `multiplier`, stopping at `end`. */
export function advanceClock(time: number, dtMs: number, multiplier: number, end: number): ClockStep {
  const next = time + dtMs * TRACK_SECONDS_PER_SECOND * multiplier
  return next >= end ? { time: end, ended: true } : { time: next, ended: false }
}

/* ── Totals ─────────────────────────────────────────────────────────────── */

/** Time between fixes longer than this is a gap in reporting, not driving. */
export const MAX_DRIVING_GAP_MS = 10 * 60_000
/** Under this a vehicle counts as standing. */
export const MOVING_KMPH = 3

export interface TrackTotals {
  distanceKm: number
  drivingMinutes: number
  stoppedMinutes: number
  spanMinutes: number
  maxSpeedKmph: number
  /** Average speed while moving, or null when it never moved. */
  averageMovingKmph: number | null
}

export function trackTotals(points: readonly TrackPoint[], speeds: readonly number[] = effectiveSpeeds(points)): TrackTotals {
  let distanceKm = 0
  let drivingMs = 0
  let maxSpeed = 0
  for (let i = 1; i < points.length; i++) {
    const legKm = haversineKm(points[i - 1], points[i])
    const dt = timeOf(points[i]) - timeOf(points[i - 1])
    distanceKm += legKm
    const legSpeed = dt > 0 ? legKm / (dt / 3_600_000) : 0
    if (dt > 0 && dt <= MAX_DRIVING_GAP_MS && legSpeed >= MOVING_KMPH) drivingMs += dt
  }
  for (const s of speeds) if (s > maxSpeed) maxSpeed = s
  const spanMs = points.length > 1 ? timeOf(points[points.length - 1]) - timeOf(points[0]) : 0
  const drivingMinutes = drivingMs / 60_000
  return {
    distanceKm,
    drivingMinutes,
    stoppedMinutes: Math.max(0, spanMs / 60_000 - drivingMinutes),
    spanMinutes: spanMs / 60_000,
    maxSpeedKmph: maxSpeed,
    averageMovingKmph: drivingMs > 0 ? distanceKm / (drivingMs / 3_600_000) : null,
  }
}

/* ── Stoppages ──────────────────────────────────────────────────────────── */

export interface Stoppage {
  kind: 'stopped' | 'no_signal'
  startMs: number
  endMs: number
  minutes: number
  lat: number
  lng: number
  /** For no_signal: where it reappeared. */
  toLat?: number
  toLng?: number
}

/** A vehicle that stays within this many metres of where it stopped has not moved. */
export const STOP_RADIUS_M = 75

/**
 * Times the vehicle stayed put for at least `minMinutes` (`stopped`, including when the device
 * went quiet while parked), and times it stopped reporting for that long and reappeared somewhere
 * else (`no_signal`). Worked out from the gaps in the GPS points, in time order.
 */
export function findStoppages(points: readonly TrackPoint[], minMinutes: number, radiusM: number = STOP_RADIUS_M): Stoppage[] {
  const minMs = minMinutes * 60_000
  const radiusKm = radiusM / 1000
  const out: Stoppage[] = []

  let i = 0
  while (i < points.length - 1) {
    let j = i
    while (j + 1 < points.length && haversineKm(points[i], points[j + 1]) <= radiusKm) j++
    const dur = timeOf(points[j]) - timeOf(points[i])
    if (j > i && dur >= minMs) {
      const slice = points.slice(i, j + 1)
      out.push({
        kind: 'stopped',
        startMs: timeOf(points[i]),
        endMs: timeOf(points[j]),
        minutes: dur / 60_000,
        lat: slice.reduce((s, p) => s + p.lat, 0) / slice.length,
        lng: slice.reduce((s, p) => s + p.lng, 0) / slice.length,
      })
      i = j
    } else {
      i++
    }
  }

  for (let k = 1; k < points.length; k++) {
    const gap = timeOf(points[k]) - timeOf(points[k - 1])
    if (gap >= minMs && haversineKm(points[k - 1], points[k]) > radiusKm) {
      out.push({
        kind: 'no_signal',
        startMs: timeOf(points[k - 1]),
        endMs: timeOf(points[k]),
        minutes: gap / 60_000,
        lat: points[k - 1].lat,
        lng: points[k - 1].lng,
        toLat: points[k].lat,
        toLng: points[k].lng,
      })
    }
  }
  return out.sort((a, b) => a.startMs - b.startMs)
}

/* ── Planned versus actual ──────────────────────────────────────────────── */

export interface PlanComparison {
  plannedKm: number | null
  actualKm: number
  /** Actual minus planned. Positive: it drove further than planned. Null without a planned distance. */
  deviationKm: number | null
  /** The furthest the vehicle got from the planned line. */
  maxOffRouteKm: number
  /** Share of the track (0 to 1) more than `OFF_ROUTE_KM` from the planned line. */
  offRouteShare: number
}

export const OFF_ROUTE_KM = 0.5

function distanceToPathKm(p: LatLng, path: readonly LatLng[]): number {
  if (path.length === 0) return Infinity
  if (path.length === 1) return haversineKm(p, path[0])
  let best = Infinity
  for (let i = 0; i < path.length - 1; i++) best = Math.min(best, segmentDistanceKm(p, path[i], path[i + 1]))
  return best
}

/** Most points measured against the planned line; a longer track is thinned first. */
const COMPARE_MAX_POINTS = 400

export function comparePlan(points: readonly TrackPoint[], plannedPath: readonly LatLng[], plannedKm: number | null, actualKm: number): PlanComparison {
  const sample = downsampleTrack(points, COMPARE_MAX_POINTS)
  let maxOff = 0
  let off = 0
  if (plannedPath.length > 0) {
    for (const p of sample) {
      const d = distanceToPathKm(p, plannedPath)
      if (d > maxOff) maxOff = d
      if (d > OFF_ROUTE_KM) off++
    }
  }
  const usablePlanned = plannedKm != null && Number.isFinite(plannedKm) && plannedKm > 0 ? plannedKm : null
  return {
    plannedKm: usablePlanned,
    actualKm,
    deviationKm: usablePlanned == null ? null : actualKm - usablePlanned,
    maxOffRouteKm: maxOff,
    offRouteShare: sample.length > 0 ? off / sample.length : 0,
  }
}
