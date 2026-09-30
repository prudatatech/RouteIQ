import { formatDistanceStrict } from 'date-fns'
import type { LatLng } from './types'
import type { Bounds } from './layers'

/** Below this zoom incidents are grouped into counts; at or above it each one is drawn. */
export const INCIDENT_CLUSTER_MAX_ZOOM = 11
/** Approximate screen size of a cluster cell, in pixels. */
const CELL_PX = 56
/** Views are rounded outwards to this grid so a small pan re-uses the same request. */
const SNAP_DEG = 0.25
/** From this zoom the view is small enough (about 100 km across or less) to ask TomTom for fresh incidents. */
export const INCIDENT_REFRESH_MIN_ZOOM = 9

interface Positioned { id: string; lat: number; lng: number; severity?: number }

export interface IncidentCluster<T extends Positioned> {
  id: string
  position: LatLng
  count: number
  items: T[]
  bounds: Bounds
  /** Worst severity inside (0-4), for the colour of the count. */
  severity: number
}

export interface ClusteredIncidents<T extends Positioned> {
  singles: T[]
  clusters: IncidentCluster<T>[]
}

/**
 * Groups incidents that would overlap on screen into counts while zoomed out. Same idea as the
 * vehicle clusters (cluster.ts): a grid that follows the zoom. The selected incident is never
 * absorbed, so its popup stays anchored to it.
 */
export function clusterIncidents<T extends Positioned>(items: T[], zoom: number, selectedId?: string | null): ClusteredIncidents<T> {
  if (zoom >= INCIDENT_CLUSTER_MAX_ZOOM || items.length < 2) return { singles: items, clusters: [] }
  const cellDeg = (360 * CELL_PX) / (256 * 2 ** zoom)
  const cells = new Map<string, T[]>()
  const singles: T[] = []
  for (const item of items) {
    if (item.id === selectedId) { singles.push(item); continue }
    const key = `${Math.floor(item.lng / cellDeg)}:${Math.floor(item.lat / cellDeg)}`
    const cell = cells.get(key)
    if (cell) cell.push(item)
    else cells.set(key, [item])
  }
  const clusters: IncidentCluster<T>[] = []
  for (const [key, members] of cells) {
    if (members.length === 1) { singles.push(members[0]); continue }
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
    let sumLat = 0, sumLng = 0, severity = 0
    for (const m of members) {
      minLng = Math.min(minLng, m.lng); maxLng = Math.max(maxLng, m.lng)
      minLat = Math.min(minLat, m.lat); maxLat = Math.max(maxLat, m.lat)
      sumLat += m.lat; sumLng += m.lng
      severity = Math.max(severity, m.severity ?? 0)
    }
    clusters.push({
      id: `incident-cluster-${key}`,
      position: { lat: sumLat / members.length, lng: sumLng / members.length },
      count: members.length,
      items: members,
      bounds: [[minLng, minLat], [maxLng, maxLat]],
      severity,
    })
  }
  return { singles, clusters }
}

export interface IncidentViewRequest {
  /** `minLng,minLat,maxLng,maxLat` */
  bbox: string
  /** Ask the server to fetch fresh incidents from TomTom for this view when its data is old. */
  refresh: boolean
}

/**
 * The request for the current view: the view rounded outwards to a grid (so panning a little
 * repeats the same request), clamped to the world, and asking for fresh data only when zoomed in.
 */
export function incidentViewRequest(bounds: Bounds, zoom: number): IncidentViewRequest {
  const [[west, south], [east, north]] = bounds
  const down = (n: number) => Math.floor(n / SNAP_DEG) * SNAP_DEG
  const up = (n: number) => Math.ceil(n / SNAP_DEG) * SNAP_DEG
  const box = [
    Math.max(-180, down(west)), Math.max(-90, down(south)),
    Math.min(180, up(east)), Math.min(90, up(north)),
  ]
  return { bbox: box.map((n) => n.toFixed(2)).join(','), refresh: zoom >= INCIDENT_REFRESH_MIN_ZOOM }
}

/** "since 25 min ago" wording for when an incident started; null when the start is unknown or in the future. */
export function incidentSince(startsAt: string | null | undefined, now: number = Date.now()): string | null {
  if (!startsAt) return null
  const t = Date.parse(startsAt)
  if (!Number.isFinite(t) || t > now) return null
  return formatDistanceStrict(t, now, { addSuffix: true })
}

/** "+25 min" for a delay of a minute or more, else null. */
export function incidentDelay(delaySeconds: number | null | undefined): string | null {
  if (!delaySeconds || delaySeconds < 60) return null
  const minutes = Math.round(delaySeconds / 60)
  return minutes >= 60 ? `+${Math.floor(minutes / 60)} h ${minutes % 60} min`.replace(' 0 min', '') : `+${minutes} min`
}
