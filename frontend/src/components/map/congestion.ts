import type { Feature, FeatureCollection, LineString } from 'geojson'
import type { LayerProps } from 'react-map-gl/maplibre'
import { TRAFFIC_COLORS, type RoutePalette } from '@/config/mapConfig'

/**
 * Congestion of one stretch of a route, as Mapbox reports it for driving-traffic.
 * "unknown" is a road it has no traffic data for.
 */
export type CongestionLevel = 'low' | 'moderate' | 'heavy' | 'severe' | 'unknown'

const LEVELS: readonly CongestionLevel[] = ['low', 'moderate', 'heavy', 'severe', 'unknown']

/** Plain words for the legend and the route summary. */
export const CONGESTION_LABEL: Record<Exclude<CongestionLevel, 'unknown'>, string> = {
  low: 'Free flow',
  moderate: 'Slow',
  heavy: 'Queuing',
  severe: 'Stopped',
}

export function normalizeCongestion(value: unknown): CongestionLevel {
  return typeof value === 'string' && (LEVELS as readonly string[]).includes(value) ? (value as CongestionLevel) : 'unknown'
}

/**
 * One congestion level per line segment (between consecutive coordinates). Mapbox sends one
 * array per leg; a multi-stop route is those arrays joined. A list that does not fit the
 * geometry is padded with "unknown" or cut, never stretched, so a colour is never put on the
 * wrong stretch of road.
 */
export function alignCongestion(levels: readonly unknown[] | null | undefined, coordinateCount: number): CongestionLevel[] {
  const segments = Math.max(0, coordinateCount - 1)
  const out: CongestionLevel[] = []
  for (let i = 0; i < segments; i++) out.push(normalizeCongestion(levels?.[i]))
  return out
}

export interface CongestionRun {
  level: CongestionLevel
  /** [lng, lat] pairs; consecutive runs share their joining point so the line has no gaps. */
  coordinates: [number, number][]
}

/** Merges neighbouring segments of the same level into runs (fewer features to draw). */
export function congestionRuns(coordinates: [number, number][], congestion: readonly CongestionLevel[]): CongestionRun[] {
  const runs: CongestionRun[] = []
  for (let i = 0; i < coordinates.length - 1; i++) {
    const level = congestion[i] ?? 'unknown'
    const last = runs[runs.length - 1]
    if (last && last.level === level) last.coordinates.push(coordinates[i + 1])
    else runs.push({ level, coordinates: [coordinates[i], coordinates[i + 1]] })
  }
  return runs
}

export function congestionFeatures(coordinates: [number, number][], congestion: readonly CongestionLevel[]): FeatureCollection<LineString> {
  return {
    type: 'FeatureCollection',
    features: congestionRuns(coordinates, congestion).map((run): Feature<LineString> => ({
      type: 'Feature',
      properties: { level: run.level },
      geometry: { type: 'LineString', coordinates: run.coordinates },
    })),
  }
}

/** The route line coloured by congestion. Sits on the same casing as the flat line; stretches with no data take a neutral colour of the palette. */
export function congestionLineLayer(palette: RoutePalette): LayerProps {
  return {
    id: 'mapview-route-congestion',
    type: 'line',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-width': 4.5,
      'line-color': [
        'match', ['get', 'level'],
        'low', TRAFFIC_COLORS.low,
        'moderate', TRAFFIC_COLORS.moderate,
        'heavy', TRAFFIC_COLORS.heavy,
        'severe', TRAFFIC_COLORS.severe,
        palette.unknown,
      ],
    },
  }
}

export interface CongestionSummary {
  /** Metres of the route at each level (unknown stretches are not counted). */
  metres: Record<Exclude<CongestionLevel, 'unknown'>, number>
  /** Metres that are slow, queuing or stopped. */
  slowMetres: number
  /** True when at least one segment carried traffic data. */
  known: boolean
}

/** How much of a route is congested, from Mapbox's per-segment distances (metres). */
export function summarizeCongestion(congestion: readonly CongestionLevel[], distances: readonly number[] | null | undefined): CongestionSummary {
  const metres = { low: 0, moderate: 0, heavy: 0, severe: 0 }
  let known = false
  congestion.forEach((level, i) => {
    if (level === 'unknown') return
    known = true
    const d = distances?.[i]
    if (typeof d === 'number' && Number.isFinite(d) && d > 0) metres[level] += d
  })
  return { metres, slowMetres: metres.moderate + metres.heavy + metres.severe, known }
}
