import { useEffect, useMemo } from 'react'
import { Layer, Source, useMap } from 'react-map-gl/maplibre'
import type { MapLayerMouseEvent } from 'maplibre-gl'
import type { RoutePalette } from '@/config/mapConfig'
import { ROUTE_CASING_LAYER_ID } from './layers'
import type { MapAltRoute } from './types'

const layerId = (id: string) => `mapview-alt-${id}-line`
const casingLayerId = (id: string) => `mapview-alt-${id}-casing`
const hitLayerId = (id: string) => `mapview-alt-${id}-hit`

/**
 * Other route options, drawn muted under the main route. Each one can be clicked (it has a wide
 * invisible line so a finger can hit it), which reports its id. Must be rendered inside <Map>.
 */
export default function AltRoutes({ routes, onSelect, palette }: { routes?: MapAltRoute[]; onSelect?: (id: string) => void; palette: RoutePalette }) {
  const { current: map } = useMap()
  const usable = useMemo(() => (routes ?? []).filter((r) => r.coordinates.length > 1), [routes])

  useEffect(() => {
    if (!map || !onSelect || usable.length === 0) return
    const hitLayers = () => usable.map((r) => hitLayerId(r.id)).filter((id) => map.getLayer(id))
    const idAt = (e: MapLayerMouseEvent): string | null => {
      const layers = hitLayers()
      if (layers.length === 0) return null
      const hit = map.queryRenderedFeatures(e.point, { layers })[0]
      return (hit?.properties?.id as string | undefined) ?? null
    }
    const onClick = (e: MapLayerMouseEvent) => {
      const id = idAt(e)
      if (id) onSelect(id)
    }
    const onMove = (e: MapLayerMouseEvent) => {
      map.getCanvas().style.cursor = idAt(e) ? 'pointer' : ''
    }
    map.on('click', onClick)
    map.on('mousemove', onMove)
    return () => {
      map.off('click', onClick)
      map.off('mousemove', onMove)
      map.getCanvas().style.cursor = ''
    }
  }, [map, onSelect, usable])

  return (
    <>
      {usable.map((r) => (
        <Source
          key={r.id}
          id={`mapview-alt-${r.id}`}
          type="geojson"
          data={{ type: 'Feature', properties: { id: r.id }, geometry: { type: 'LineString', coordinates: r.coordinates } }}
        >
          <Layer id={casingLayerId(r.id)} type="line" beforeId={ROUTE_CASING_LAYER_ID} layout={{ 'line-join': 'round', 'line-cap': 'round' }} paint={{ 'line-color': palette.casing, 'line-width': 6, 'line-opacity': 0.7 }} />
          <Layer id={layerId(r.id)} type="line" beforeId={ROUTE_CASING_LAYER_ID} layout={{ 'line-join': 'round', 'line-cap': 'round' }} paint={{ 'line-color': palette.alternative, 'line-width': 4, 'line-opacity': 0.9 }} />
          <Layer id={hitLayerId(r.id)} type="line" beforeId={ROUTE_CASING_LAYER_ID} layout={{ 'line-join': 'round', 'line-cap': 'round' }} paint={{ 'line-color': palette.alternative, 'line-width': 18, 'line-opacity': 0 }} />
        </Source>
      ))}
    </>
  )
}
