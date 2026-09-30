import type { LayerProps } from 'react-map-gl/maplibre'
import type { Map as MaplibreMap } from 'maplibre-gl'
import type { BaseStyleId } from '@/config/mapConfig'
import { BASE_STYLES } from '@/config/mapConfig'

/**
 * India's official boundaries on every map.
 *
 * The free base maps (Carto, from OpenStreetMap) draw country borders as they are held on
 * the ground, which leaves out parts of Jammu and Kashmir, Ladakh (including Gilgit-Baltistan
 * and Aksai Chin) and shows Arunachal Pradesh as disputed. Maps shown in India must show
 * India's boundaries as the Government of India defines them. So the base map's own country
 * borders are hidden and the land borders are drawn from Natural Earth's India point-of-view
 * countries (ne_10m_admin_0_countries_ind, public domain), built into
 * public/geo/india-pov-borders.geojson with:
 *
 *   mapshaper ne_10m_admin_0_countries_ind.geojson -filter-fields ADM0_A3 \
 *     -simplify 20% keep-shapes -innerlines -o format=geojson precision=0.0005 india-pov-borders.geojson
 *
 * State and district borders of the base map stay as they are.
 */

export const INDIA_BORDERS_SOURCE_ID = 'india-pov-borders'
export const INDIA_BORDERS_URL = '/geo/india-pov-borders.geojson'

interface StyleLayerLike {
  id: string
  type: string
  'source-layer'?: string
  filter?: unknown
}

/** True for a base-map layer that draws country (admin level 2) or disputed borders. */
export function isCountryBorderLayer(layer: StyleLayerLike): boolean {
  if (layer.type !== 'line') return false
  const id = layer.id.toLowerCase()
  if (/disputed/.test(id)) return true
  if (layer['source-layer'] !== 'boundary') return /(^|[_-])(country|countries|admin[_-]?0|admin[_-]?2)([_-]|$)/.test(id)
  if (/country|disputed/.test(id)) return true
  const filter = JSON.stringify(layer.filter ?? null)
  // ["==","admin_level",2], ["<=","admin_level",2], ["==",["get","admin_level"],2] and the like
  return /"admin_level"\]?,\s*[0-2]\b/.test(filter) || /"disputed"/.test(filter)
}

const NOT_DISPUTED = ['!=', 'disputed', 1]

/**
 * Hide the base map's own country borders, and drop lines it marks as disputed from the
 * state and district borders it keeps (the Line of Control is one). Safe to call again on
 * every style change.
 */
export function hideCountryBorders(map: MaplibreMap): void {
  const layers = map.getStyle()?.layers ?? []
  for (const layer of layers) {
    const l = layer as StyleLayerLike
    if (isCountryBorderLayer(l)) {
      if (map.getLayoutProperty(layer.id, 'visibility') !== 'none') map.setLayoutProperty(layer.id, 'visibility', 'none')
    } else if (l.type === 'line' && l['source-layer'] === 'boundary' && !JSON.stringify(l.filter ?? null).includes('"disputed"')) {
      map.setFilter(layer.id, (l.filter ? ['all', l.filter, NOT_DISPUTED] : NOT_DISPUTED) as never)
    }
  }
}

/** India's-view land borders, in the base map's own border colour. */
export function indiaBordersLayers(baseStyle: BaseStyleId): LayerProps[] {
  const { color, casing } = BASE_STYLES[baseStyle].border
  const width = ['interpolate', ['linear'], ['zoom'], 3, 0.8, 6, 1.4, 10, 2] as unknown as number
  const layers: LayerProps[] = []
  if (casing) {
    layers.push({
      id: 'india-pov-borders-casing',
      type: 'line',
      layout: { 'line-join': 'round' },
      paint: { 'line-color': casing, 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 2.4, 6, 3.4, 10, 4.5] as unknown as number, 'line-opacity': 0.55 },
    })
  }
  layers.push({
    id: 'india-pov-borders-line',
    type: 'line',
    layout: { 'line-join': 'round' },
    paint: { 'line-color': color, 'line-width': width },
  })
  return layers
}
