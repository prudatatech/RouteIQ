import type { Bounds } from './layers'
import type { LatLng, MapVehicle } from './types'

/** Group vehicle markers only when the map has more than this many. */
export const CLUSTER_THRESHOLD = 50
/** At this zoom and closer, every vehicle is drawn on its own. */
export const CLUSTER_MAX_ZOOM = 13
/** Vehicles closer than about this many screen pixels share one cluster. */
const CELL_PX = 64

export interface VehicleCluster {
  id: string
  position: LatLng
  count: number
  bounds: Bounds
}

export interface ClusteredVehicles {
  singles: MapVehicle[]
  clusters: VehicleCluster[]
}

/**
 * Groups nearby vehicles into clusters using a grid that follows the zoom level.
 * Below the threshold, or when zoomed in, every vehicle stays on its own.
 * The selected vehicle is never absorbed into a cluster, so it stays clickable and labelled.
 */
export function clusterVehicles(vehicles: MapVehicle[], zoom: number, selectedId?: string | null): ClusteredVehicles {
  if (vehicles.length <= CLUSTER_THRESHOLD || zoom >= CLUSTER_MAX_ZOOM) {
    return { singles: vehicles, clusters: [] }
  }

  // Degrees covered by one cell at this zoom (256 px tiles).
  const cellDeg = (360 * CELL_PX) / (256 * 2 ** zoom)
  const cells = new Map<string, MapVehicle[]>()
  const singles: MapVehicle[] = []

  for (const v of vehicles) {
    if (v.id === selectedId) { singles.push(v); continue }
    const key = `${Math.floor(v.position.lng / cellDeg)}:${Math.floor(v.position.lat / cellDeg)}`
    const cell = cells.get(key)
    if (cell) cell.push(v)
    else cells.set(key, [v])
  }

  const clusters: VehicleCluster[] = []
  for (const [key, members] of cells) {
    if (members.length === 1) { singles.push(members[0]); continue }
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
    let sumLat = 0, sumLng = 0
    for (const { position } of members) {
      minLng = Math.min(minLng, position.lng); maxLng = Math.max(maxLng, position.lng)
      minLat = Math.min(minLat, position.lat); maxLat = Math.max(maxLat, position.lat)
      sumLat += position.lat; sumLng += position.lng
    }
    clusters.push({
      id: `cluster-${key}`,
      position: { lat: sumLat / members.length, lng: sumLng / members.length },
      count: members.length,
      bounds: [[minLng, minLat], [maxLng, maxLat]],
    })
  }
  return { singles, clusters }
}
