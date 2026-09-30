import { circle } from '@turf/turf'
import type { Feature, FeatureCollection, LineString, Polygon } from 'geojson'
import type { LayerProps } from 'react-map-gl/maplibre'
import { MAP_COLORS, MAP_TONES, type MapTone } from '@/config/mapConfig'
import type { LatLng, MapPoint, MapPointKind, MapRoute, MapTrail, MapVehicle } from './types'

/** Colour role of each point kind. Shared by markers and their geofence circles. */
export const POINT_TONES: Record<MapPointKind, MapTone> = {
  pickup: 'success',
  drop: 'brand',
  incident: 'danger',
  hub: 'neutral',
  load: 'info',
  location: 'brand',
}

/* ── Route line ─────────────────────────────────────────────────────────── */

export const ROUTE_SOURCE_ID = 'mapview-route'
export const ROUTE_CONGESTION_SOURCE_ID = 'mapview-route-congestion'

export function routeFeature(route: MapRoute): Feature<LineString> | null {
  const coords = route.coordinates.length > 1
    ? route.coordinates
    : (route.stops ?? [])
        .slice()
        .sort((a, b) => a.sequence - b.sequence)
        .map((s) => [s.position.lng, s.position.lat] as [number, number])
  if (coords.length < 2) return null
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }
}

/** A white casing under the line keeps it readable on any base map. */
export const routeCasingLayer: LayerProps = {
  id: 'mapview-route-casing',
  type: 'line',
  layout: { 'line-join': 'round', 'line-cap': 'round' },
  paint: { 'line-color': MAP_COLORS.routeCasing, 'line-width': 7 },
}

export function routeLineLayer(planned: boolean): LayerProps {
  return {
    id: 'mapview-route-line',
    type: 'line',
    layout: { 'line-join': 'round', 'line-cap': planned ? 'butt' : 'round' },
    paint: planned
      ? { 'line-color': MAP_COLORS.plannedRoute, 'line-width': 3, 'line-dasharray': [2, 2] }
      : { 'line-color': MAP_COLORS.route, 'line-width': 4 },
  }
}

/* ── Trails ─────────────────────────────────────────────────────────────── */

export const TRAIL_SOURCE_ID = 'mapview-trails'

export function trailFeatures(trails: MapTrail[]): FeatureCollection<LineString> {
  return {
    type: 'FeatureCollection',
    features: trails
      .filter((t) => t.coordinates.length > 1)
      .map((t) => ({ type: 'Feature', properties: { id: t.id }, geometry: { type: 'LineString', coordinates: t.coordinates } })),
  }
}

export const trailCasingLayer: LayerProps = {
  id: 'mapview-trail-casing',
  type: 'line',
  layout: { 'line-join': 'round', 'line-cap': 'round' },
  paint: { 'line-color': MAP_COLORS.routeCasing, 'line-width': 6, 'line-opacity': 0.8 },
}

export const trailLineLayer: LayerProps = {
  id: 'mapview-trail-line',
  type: 'line',
  layout: { 'line-join': 'round', 'line-cap': 'round' },
  paint: { 'line-color': MAP_COLORS.trail, 'line-width': 3.5 },
}

/* ── Geofences ──────────────────────────────────────────────────────────── */

export const GEOFENCE_SOURCE_ID = 'mapview-geofences'

export function geofenceFeatures(points: MapPoint[]): FeatureCollection<Polygon> {
  return {
    type: 'FeatureCollection',
    features: points
      .filter((p) => p.radiusKm && p.radiusKm > 0)
      .map((p) => {
        const feature = circle([p.position.lng, p.position.lat], p.radiusKm as number, { steps: 64, units: 'kilometers' })
        feature.properties = { color: MAP_TONES[POINT_TONES[p.kind]].color }
        return feature
      }),
  }
}

export const geofenceFillLayer: LayerProps = {
  id: 'mapview-geofence-fill',
  type: 'fill',
  paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.08 },
}

export const geofenceLineLayer: LayerProps = {
  id: 'mapview-geofence-line',
  type: 'line',
  paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-dasharray': [2, 2] },
}

/* ── Bounds ─────────────────────────────────────────────────────────────── */

export type Bounds = [[number, number], [number, number]]

/** Real coordinates only. 0,0 is how missing GPS usually arrives, so it counts as missing. */
const isValid = (p: LatLng) =>
  Number.isFinite(p.lat) && Number.isFinite(p.lng) &&
  Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 &&
  !(p.lat === 0 && p.lng === 0)

/** Bounding box of everything on the map, or null when there is nothing. */
export function contentBounds(vehicles: MapVehicle[], points: MapPoint[], route?: MapRoute | null, trails?: MapTrail[]): Bounds | null {
  // A geofence counts with its full circle, so fitting shows the whole zone.
  const fenceEdges = points.flatMap((p): LatLng[] => {
    if (!p.radiusKm || p.radiusKm <= 0) return []
    const dLat = p.radiusKm / 110.574
    const dLng = p.radiusKm / (111.32 * Math.cos((p.position.lat * Math.PI) / 180))
    return [
      { lat: p.position.lat - dLat, lng: p.position.lng - dLng },
      { lat: p.position.lat + dLat, lng: p.position.lng + dLng },
    ]
  })
  const positions: LatLng[] = [
    ...vehicles.map((v) => v.position),
    ...points.map((p) => p.position),
    ...fenceEdges,
    ...(route?.stops ?? []).map((s) => s.position),
    ...(route?.coordinates ?? []).map(([lng, lat]) => ({ lat, lng })),
    ...(trails ?? []).flatMap((t) => t.coordinates.map(([lng, lat]) => ({ lat, lng }))),
  ].filter(isValid)
  if (positions.length === 0) return null

  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
  for (const { lat, lng } of positions) {
    minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng)
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat)
  }
  return [[minLng, minLat], [maxLng, maxLat]]
}

/** Drops vehicles and points with missing or impossible coordinates (never guessed). */
export function withValidPosition<T extends { position: LatLng }>(items: T[] | undefined): T[] {
  return (items ?? []).filter((item) => isValid(item.position))
}
