import type { Feature, FeatureCollection, LineString } from 'geojson'
import type { FilterSpecification } from 'maplibre-gl'
import type { LayerProps } from 'react-map-gl/maplibre'
import type { RoutePalette } from '@/config/mapConfig'
import type { MapLine } from './types'

/** Lines drawn on the map from the `lines` prop: several routes, an old and a new order, a track coloured by speed. */
export const LINES_SOURCE_ID = 'mapview-lines'

const DEFAULT_WIDTH = 4

export function lineFeatures(lines: MapLine[]): FeatureCollection<LineString> {
  const features: Feature<LineString>[] = lines
    .filter((l) => l.coordinates.length > 1)
    .map((l) => ({
      type: 'Feature',
      properties: {
        id: l.id,
        color: l.color,
        width: l.width ?? DEFAULT_WIDTH,
        opacity: l.opacity ?? 1,
        dashed: Boolean(l.dashed),
      },
      geometry: { type: 'LineString', coordinates: l.coordinates },
    }))
  return { type: 'FeatureCollection', features }
}

const solid: FilterSpecification = ['==', ['get', 'dashed'], false]
const dashed: FilterSpecification = ['==', ['get', 'dashed'], true]

/** A casing under solid lines (light on light maps, dark on dark ones) keeps them readable on any base map. */
export function linesCasingLayer(palette: RoutePalette): LayerProps {
  return {
    id: 'mapview-lines-casing',
    type: 'line',
    filter: solid,
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': palette.casing, 'line-width': ['+', ['get', 'width'], 2.5], 'line-opacity': ['get', 'opacity'] },
  }
}

export const linesSolidLayer: LayerProps = {
  id: 'mapview-lines-solid',
  type: 'line',
  filter: solid,
  layout: { 'line-join': 'round', 'line-cap': 'round' },
  paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-opacity': ['get', 'opacity'] },
}

export const linesDashedLayer: LayerProps = {
  id: 'mapview-lines-dashed',
  type: 'line',
  filter: dashed,
  layout: { 'line-join': 'round', 'line-cap': 'butt' },
  paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-opacity': ['get', 'opacity'], 'line-dasharray': [2, 2] },
}
