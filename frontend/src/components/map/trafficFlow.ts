import { TRAFFIC_COLORS } from '@/config/mapConfig'
import { CONGESTION_LABEL } from './congestion'

export const FLOW_SOURCE_ID = 'traffic-flow'
export const FLOW_LAYER_ID = 'traffic-flow'

/** Legend of the flow tiles and the route line: same colours, same words. */
export const TRAFFIC_LEGEND = [
  { level: 'low', label: 'Free flow', color: TRAFFIC_COLORS.low },
  { level: 'moderate', label: 'Slow', color: TRAFFIC_COLORS.moderate },
  { level: 'heavy', label: 'Queuing', color: TRAFFIC_COLORS.heavy },
  { level: 'severe', label: 'Stopped', color: TRAFFIC_COLORS.severe },
] as const satisfies readonly { level: keyof typeof CONGESTION_LABEL; label: string; color: string }[]

/**
 * Layers MapView draws that must stay above the traffic flow: India's borders, geofences, trails
 * and the route line. Everything else in the base map (roads, water) is below it.
 */
const ABOVE_FLOW = new Set([
  'india-pov-borders-casing',
  'india-pov-borders-line',
  'mapview-geofence-fill',
  'mapview-geofence-line',
  'mapview-trail-casing',
  'mapview-trail-line',
  'mapview-route-casing',
  'mapview-route-line',
  'mapview-route-congestion',
])

/**
 * Where to insert the flow layer, like Google: over the roads and buildings of the base map but
 * under its labels, so street and place names stay readable. That is just before the first label
 * (symbol) layer that comes after the last road/fill layer (Carto starts with a few water labels
 * that sit below the roads, so the very first symbol layer is not the place). Never above our own
 * overlays (India's borders, geofences, trails, route line): when the base map has no labels (satellite),
 * it goes just below the first of those, or on top when none is drawn yet.
 */
export function flowInsertBeforeId(layers: readonly { id: string; type: string }[]): string | undefined {
  const all = layers.filter((l) => l.id !== FLOW_LAYER_ID)
  const firstOwn = all.findIndex((l) => ABOVE_FLOW.has(l.id))
  const base = firstOwn === -1 ? all : all.slice(0, firstOwn)
  let lastNonLabel = -1
  base.forEach((l, i) => { if (l.type !== 'symbol') lastNonLabel = i })
  const firstLabel = base.slice(lastNonLabel + 1).find((l) => l.type === 'symbol')
  return firstLabel?.id ?? (firstOwn === -1 ? undefined : all[firstOwn].id)
}

/**
 * Absolute tile URL template for maplibre. The token travels as a query parameter because tile
 * requests cannot carry the login header; it is short-lived and only good for these tiles.
 */
export function flowTilesUrl(apiBase: string, origin: string, token: string): string {
  const base = new URL(apiBase, origin).toString().replace(/\/$/, '')
  return `${base}/traffic/tiles/flow/{z}/{x}/{y}.png?t=${encodeURIComponent(token)}`
}

/** Renew a token this long before it runs out. */
export const TOKEN_RENEW_MARGIN_S = 5 * 60
