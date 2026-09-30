import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Marker, Popup, useMap } from 'react-map-gl/maplibre'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Ban, CarFront, CloudRain, Construction, TriangleAlert, Timer, Waves, Wrench, type LucideIcon } from 'lucide-react'
import clsx from 'clsx'
import { api } from '@/services/api'
import { trafficAPI, type AreaIncident, type TrafficIncidentKind } from '@/services/pricing'
import { MAP_TONES, type MapTone } from '@/config/mapConfig'
import { CONGESTION_LABEL } from './congestion'
import { useTrafficTileToken } from './useTrafficTileToken'
import { FLOW_LAYER_ID, FLOW_SOURCE_ID, TRAFFIC_LEGEND, flowInsertBeforeId, flowTilesUrl } from './trafficFlow'
import {
  clusterIncidents, incidentDelay, incidentSince, incidentViewRequest, type IncidentCluster,
} from './trafficIncidents'
import type { Bounds } from './layers'
import type { MapTraffic } from './types'

/* ── Flow tiles ─────────────────────────────────────────────────────────── */

/**
 * Adds the flow raster to the map by hand instead of through <Layer>: the position in the stack
 * matters (over roads, under labels and under our own lines and markers, see flowInsertBeforeId)
 * and has to be found again after every base map switch.
 */
function FlowLayer({ url }: { url: string }) {
  const { current: mapRef } = useMap()

  useEffect(() => {
    const map = mapRef?.getMap()
    if (!map) return
    const ensure = () => {
      try {
        const style = map.getStyle()
        if (!style) return
        if (!map.getSource(FLOW_SOURCE_ID)) {
          map.addSource(FLOW_SOURCE_ID, { type: 'raster', tiles: [url], tileSize: 256, maxzoom: 18, attribution: '© TomTom' })
        }
        if (!map.getLayer(FLOW_LAYER_ID)) {
          map.addLayer(
            { id: FLOW_LAYER_ID, type: 'raster', source: FLOW_SOURCE_ID, paint: { 'raster-opacity': 0.7, 'raster-fade-duration': 150 } },
            flowInsertBeforeId(style.layers),
          )
        }
      } catch {
        // The style is being replaced; the next styledata event tries again.
      }
    }
    ensure()
    map.on('styledata', ensure)
    return () => {
      map.off('styledata', ensure)
      try {
        if (map.getLayer(FLOW_LAYER_ID)) map.removeLayer(FLOW_LAYER_ID)
        if (map.getSource(FLOW_SOURCE_ID)) map.removeSource(FLOW_SOURCE_ID)
      } catch {
        // The map is already gone.
      }
    }
  }, [mapRef, url])

  return null
}

/** Tile URL once the token is known; null when flow is off, not set up on the server, or the token could not be had. */
function useFlowUrl(enabled: boolean): string | null {
  const token = useTrafficTileToken(enabled)
  return enabled && token.data?.token
    ? flowTilesUrl(String(api.defaults.baseURL ?? '/api/v1'), window.location.origin, token.data.token)
    : null
}

/**
 * Colour key of the flow tiles, same words and colours as the route line. A plain overlay for
 * MapView to draw over the map box; shows only while the flow layer itself has tiles to load.
 */
export function TrafficLegend({ enabled, stacked = false }: {
  enabled: boolean
  /** A vehicle status legend already sits at the bottom left: stand above it. */
  stacked?: boolean
}) {
  const url = useFlowUrl(enabled)
  if (!url) return null
  return (
    <ul
      aria-label="Traffic"
      className={clsx(
        'absolute left-2 z-10 flex max-w-[calc(100%-6.5rem)] flex-wrap gap-x-3 gap-y-1 rounded-control border border-border bg-surface px-3 py-1.5 text-xs text-text shadow-raised',
        stacked ? 'bottom-12' : 'bottom-2',
      )}
    >
      {TRAFFIC_LEGEND.map((item) => (
        <li key={item.level} className="flex items-center gap-1.5">
          <svg aria-hidden width="16" height="4" viewBox="0 0 16 4"><rect width="16" height="4" rx="2" fill={item.color} /></svg>
          {CONGESTION_LABEL[item.level]}
        </li>
      ))}
    </ul>
  )
}

/* ── Incidents ──────────────────────────────────────────────────────────── */

const KIND: Record<TrafficIncidentKind, { icon: LucideIcon; tone: MapTone }> = {
  accident: { icon: CarFront, tone: 'danger' },
  roadworks: { icon: Construction, tone: 'warning' },
  closure: { icon: Ban, tone: 'danger' },
  jam: { icon: Timer, tone: 'warning' },
  flooding: { icon: Waves, tone: 'info' },
  weather: { icon: CloudRain, tone: 'info' },
  hazard: { icon: TriangleAlert, tone: 'warning' },
  breakdown: { icon: Wrench, tone: 'neutral' },
  other: { icon: TriangleAlert, tone: 'neutral' },
}

function incidentLabel(i: AreaIncident): string {
  const delay = incidentDelay(i.delay_seconds)
  return `${i.type}${i.road ? ` on ${i.road}` : ''}${delay ? `, ${delay}` : ''}`
}

const IncidentMarker = memo(function IncidentMarker({ incident, selected, onSelect }: {
  incident: AreaIncident
  selected: boolean
  onSelect: (id: string) => void
}) {
  const { icon: Icon, tone } = KIND[incident.kind] ?? KIND.other
  return (
    <Marker longitude={incident.lng} latitude={incident.lat} anchor="center" style={{ zIndex: selected ? 4 : 2 }}>
      <button
        type="button"
        aria-label={`Traffic: ${incidentLabel(incident)}`}
        aria-pressed={selected}
        title={incidentLabel(incident)}
        onClick={(e) => { e.stopPropagation(); onSelect(incident.id) }}
        className="flex items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <span
          className={clsx(
            'flex items-center justify-center rounded-full border-2 border-surface text-white shadow-raised',
            MAP_TONES[tone].bg,
            selected ? 'h-8 w-8 ring-2 ring-brand ring-offset-1' : 'h-7 w-7',
          )}
        >
          <Icon size={14} aria-hidden />
        </span>
      </button>
    </Marker>
  )
})

const IncidentClusterMarker = memo(function IncidentClusterMarker({ cluster, onOpen }: {
  cluster: IncidentCluster<AreaIncident>
  onOpen: (cluster: IncidentCluster<AreaIncident>) => void
}) {
  const tone: MapTone = cluster.severity >= 3 ? 'danger' : cluster.severity >= 2 ? 'warning' : 'neutral'
  return (
    <Marker longitude={cluster.position.lng} latitude={cluster.position.lat} anchor="center" style={{ zIndex: 2 }}>
      <button
        type="button"
        aria-label={`${cluster.count} traffic incidents close together. Zoom in to see them.`}
        title={`${cluster.count} traffic incidents`}
        onClick={(e) => { e.stopPropagation(); onOpen(cluster) }}
        className={clsx(
          'flex h-8 min-w-8 items-center justify-center rounded-full border-2 border-surface px-1.5 text-xs font-semibold text-white shadow-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
          MAP_TONES[tone].bg,
        )}
      >
        {cluster.count.toLocaleString('en-IN')}
      </button>
    </Marker>
  )
})

function IncidentPopup({ incident, onClose }: { incident: AreaIncident; onClose: () => void }) {
  const delay = incidentDelay(incident.delay_seconds)
  const since = incidentSince(incident.starts_at)
  return (
    <Popup
      longitude={incident.lng}
      latitude={incident.lat}
      offset={18}
      maxWidth="260px"
      closeButton
      closeOnClick={false}
      onClose={onClose}
    >
      <div className="space-y-1 pr-3 text-sm text-text">
        <p className="font-semibold">{incident.type}</p>
        {incident.road && <p className="text-muted">Road: <span className="text-text">{incident.road}</span></p>}
        <p className="text-muted">Delay: <span className="text-text">{delay ?? 'Not reported'}</span></p>
        {since && <p className="text-muted">Since <span className="text-text">{since.replace(/ ago$/, '')} ago</span></p>}
        {incident.description && incident.description.toLowerCase() !== incident.type.toLowerCase() && (
          <p className="text-muted">{incident.description}</p>
        )}
      </div>
    </Popup>
  )
}

function IncidentsLayer() {
  const { current: mapRef } = useMap()
  const [view, setView] = useState<{ bounds: Bounds; zoom: number } | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    const map = mapRef?.getMap()
    if (!map) return
    const update = () => {
      const b = map.getBounds()
      setView({ bounds: [[b.getWest(), b.getSouth()], [b.getEast(), b.getNorth()]], zoom: map.getZoom() })
    }
    update()
    map.on('moveend', update)
    return () => { map.off('moveend', update) }
  }, [mapRef])

  const request = useMemo(() => (view ? incidentViewRequest(view.bounds, view.zoom) : null), [view])
  const { data } = useQuery({
    queryKey: ['traffic-area', request?.bbox, request?.refresh],
    queryFn: ({ signal }) => trafficAPI.incidentsInBbox(request!.bbox, request!.refresh, signal),
    enabled: request !== null,
    staleTime: 60_000,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  })

  const incidents = useMemo(() => data?.incidents ?? [], [data])
  const zoom = view?.zoom ?? 0
  const { singles, clusters } = useMemo(() => clusterIncidents(incidents, zoom, selectedId), [incidents, zoom, selectedId])
  const selected = selectedId ? incidents.find((i) => i.id === selectedId) : undefined

  const openCluster = useCallback((cluster: IncidentCluster<AreaIncident>) => {
    const map = mapRef?.getMap()
    if (!map) return
    const [[minLng, minLat], [maxLng, maxLat]] = cluster.bounds
    if (minLng === maxLng && minLat === maxLat) map.easeTo({ center: [minLng, minLat], zoom: map.getZoom() + 2, duration: 600 })
    else map.fitBounds(cluster.bounds, { padding: 64, maxZoom: 14, duration: 600 })
  }, [mapRef])

  return (
    <>
      {clusters.map((c) => <IncidentClusterMarker key={c.id} cluster={c} onOpen={openCluster} />)}
      {singles.map((i) => <IncidentMarker key={i.id} incident={i} selected={i.id === selectedId} onSelect={setSelectedId} />)}
      {selected && <IncidentPopup incident={selected} onClose={() => setSelectedId(null)} />}
    </>
  )
}

/* ── Both together ──────────────────────────────────────────────────────── */

/**
 * Live traffic for MapView (staff only: the tiles and incidents need sign-in). Rendered inside the map.
 */
export default function TrafficLayers({ flow = false, incidents = false }: MapTraffic) {
  const url = useFlowUrl(flow)
  return (
    <>
      {url && <FlowLayer url={url} />}
      {incidents && <IncidentsLayer />}
    </>
  )
}
