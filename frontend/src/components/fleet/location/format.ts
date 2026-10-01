import { formatDateTime, formatKg, formatMinutes, formatRelative, formatTime } from '@/utils/display'
import type { Tone } from '@/components/ui/status'

/** GET /fleet/vehicles/:id/location */
export interface VehicleLocation {
  vehicle_id: string
  plate_number: string
  status: string
  latitude: number | null
  longitude: number | null
  place_name: string | null
  speed_kmph: number | null
  heading: number | null
  accuracy_m: number | null
  recorded_at: string | null
  last_seen_at: string | null
  live: boolean
  gps_device: string | null
}

export type ActivityState = 'carrying' | 'idle' | 'offline'

export interface ActivityJob {
  kind: 'route' | 'manifest'
  id: string
  status: string
  from: string | null
  to: string | null
  next_stop: string | null
  stops_total: number | null
  stops_done: number | null
  weight_kg: number | null
  tracking_ids: string[]
  started_at: string | null
}

/** GET /fleet/vehicles/:id/activity */
export interface VehicleActivity {
  vehicle_id: string
  plate_number: string
  state: ActivityState
  vehicle_status: string
  live: boolean
  last_seen_at: string | null
  since: string | null
  position: { lat: number; lng: number } | null
  place_name: string | null
  load: { percent_full: number | null; load_kg: number | null; capacity_kg: number | null; basis: 'reported' | 'declared' | 'manifest' | null }
  jobs: ActivityJob[]
  stationary: { since: string; minutes: number; at_least: boolean } | null
  last_moved_at: string | null
}

export interface TrackPoint {
  lat: number
  lng: number
  at: string
  speed_kmph: number | null
  heading: number | null
  accuracy: number | null
}

/** GET /gps/vehicle/:id/track */
export interface VehicleTrack {
  vehicle_id: string
  from: string
  to: string
  count: number
  truncated: boolean
  distance_km: number
  points: TrackPoint[]
}

/** What POST /fleet/vehicles/:id/share-links and GET .../share-links return. */
export interface ShareLink {
  id: string
  vehicle_id: string
  expires_at: string
  created_at: string
  view_count: number
  last_viewed_at: string | null
  /** Only on the response that creates the link. */
  token?: string
  path?: string
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const

/** "NE" for a heading in degrees clockwise from north, or null when there is no heading. */
export function compassPoint(degrees: number | null | undefined): string | null {
  if (degrees == null || !Number.isFinite(degrees)) return null
  const d = ((degrees % 360) + 360) % 360
  return COMPASS[Math.round(d / 45) % 8]
}

/** "55 km/h", or a plain "Not reported". */
export function speedText(kmph: number | null | undefined): string {
  return kmph == null || !Number.isFinite(kmph) ? 'Not reported' : `${Math.round(kmph).toLocaleString('en-IN')} km/h`
}

/** "NE (45°)", or "Not reported". */
export function headingText(degrees: number | null | undefined): string {
  const point = compassPoint(degrees)
  return point ? `${point} (${Math.round(Number(degrees))}°)` : 'Not reported'
}

/** "±7 m", or "Not reported". */
export function accuracyText(metres: number | null | undefined): string {
  return metres == null || !Number.isFinite(metres) ? 'Not reported' : `±${Math.round(metres).toLocaleString('en-IN')} m`
}

/** "18.50000, 73.80000", or null when either coordinate is missing. */
export function coordinatesText(lat: number | null | undefined, lng: number | null | undefined): string | null {
  return lat == null || lng == null ? null : `${lat.toFixed(5)}, ${lng.toFixed(5)}`
}

export function googleMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`
}

/** A real position: in range and not 0,0 (how a missing fix usually arrives). */
export function hasPosition(lat: number | null | undefined, lng: number | null | undefined): lat is number {
  return lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)
}

export const ACTIVITY_LABEL: Record<ActivityState, string> = {
  carrying: 'Carrying a load',
  idle: 'Idle',
  offline: 'Offline',
}

export const ACTIVITY_TONE: Record<ActivityState, Tone> = {
  carrying: 'info',
  idle: 'neutral',
  offline: 'danger',
}

/** "Pune Hub to Surat Store"; either end may be unknown. */
export function routeText(from: string | null, to: string | null): string | null {
  if (from && to) return `${from} to ${to}`
  if (to) return `To ${to}`
  if (from) return `From ${from}`
  return null
}

/** One line for a job: "Route to Surat Store, 1 of 2 stops done" or "Manifest, Andheri to Thane, 250 kg". */
export function jobText(job: ActivityJob): string {
  const where = routeText(job.from, job.to)
  if (job.kind === 'route') {
    const progress = job.stops_total ? `${job.stops_done ?? 0} of ${job.stops_total} stops done` : null
    return ['Trip', where, progress].filter(Boolean).join(', ')
  }
  return ['Shipment', where, job.weight_kg ? formatKg(job.weight_kg) : null].filter(Boolean).join(', ')
}

/** "60% full (600 kg of 1,000 kg)", "60% full", "600 kg on board", or null when nothing is known. */
export function loadText(load: VehicleActivity['load']): string | null {
  const kg = load.load_kg != null ? formatKg(load.load_kg) : null
  if (load.percent_full != null) {
    const of = kg && load.capacity_kg ? ` (${kg} of ${formatKg(load.capacity_kg)})` : ''
    return `${load.percent_full}% full${of}`
  }
  return kg ? `${kg} on board` : null
}

/**
 * What the vehicle has been doing, in a sentence:
 * "Idle since 2:05 pm (2 h 5 min) at Pune Hub", "Offline, last seen 20 minutes ago", "Carrying a load since ...".
 */
export function activitySentence(a: VehicleActivity, now: number = Date.now()): string {
  const where = a.place_name ? ` at ${a.place_name}` : ''
  if (a.state === 'offline') {
    return a.last_seen_at ? `Offline, last heard from ${formatRelative(a.last_seen_at, now)}` : 'Never reported a position'
  }
  if (a.state === 'carrying') {
    return a.since ? `Carrying a load since ${formatDateTime(a.since)}` : 'Carrying a load'
  }
  if (!a.stationary) return `Idle${where}`
  const { since, minutes, at_least: atLeast } = a.stationary
  const length = formatMinutes(minutes)
  return `Idle since ${atLeast ? 'at least ' : ''}${formatTime(since)} (${length === '—' ? 'just now' : length})${where}`
}

/** GeoJSON [lng, lat] pairs of a track, for the map. */
export function trackCoordinates(track: Pick<VehicleTrack, 'points'> | null | undefined): [number, number][] {
  return (track?.points ?? []).map(p => [p.lng, p.lat])
}

/** How long a shared link lasts. */
export const SHARE_DURATIONS = [
  { hours: 1, label: '1 hour' },
  { hours: 8, label: '8 hours' },
  { hours: 24, label: '24 hours' },
  { hours: 72, label: '3 days' },
  { hours: 168, label: '7 days' },
] as const

/** The full address a shared link opens at. */
export function shareUrl(path: string, origin: string): string {
  return `${origin.replace(/\/$/, '')}${path}`
}
