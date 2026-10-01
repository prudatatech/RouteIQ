import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import Map, {
  FullscreenControl,
  Layer,
  NavigationControl,
  Source,
  type ErrorEvent,
  type MapLayerMouseEvent,
  type MapRef,
} from 'react-map-gl/maplibre'
import clsx from 'clsx'
import type { FeatureCollection, LineString } from 'geojson'
import { BASE_STYLES, MAP_DEFAULTS, ROUTE_PALETTES, TERRAIN_HILLSHADE } from '@/config/mapConfig'
import { INDIA_BORDERS_SOURCE_ID, INDIA_BORDERS_URL, hideCountryBorders, indiaBordersLayers } from './indiaBorders'
import {
  GEOFENCE_SOURCE_ID,
  ROUTE_SOURCE_ID,
  TRAIL_SOURCE_ID,
  ROUTE_CONGESTION_SOURCE_ID,
  contentBounds,
  geofenceFeatures,
  geofenceFillLayer,
  geofenceLineLayer,
  routeCasingLayer,
  routeFeature,
  routeLineLayer,
  trailCasingLayer,
  trailFeatures,
  trailLineLayer,
  withValidPosition,
} from './layers'
import { congestionFeatures, congestionLineLayer } from './congestion'
import TrafficLayers, { TrafficLegend } from './TrafficLayers'
import AltRoutes from './AltRoutes'
import { LINES_SOURCE_ID, lineFeatures, linesCasingLayer, linesDashedLayer, linesSolidLayer } from './lines'
import { clusterVehicles, type VehicleCluster } from './cluster'
import { MapKeyboardContext } from './keyboardContext'
import { ClusterMarker, PointMarker, StopMarker, VehicleMarker } from './markers'
import { MapError, MapLoading, RecenterButton, StatusLegend } from './overlays'
import type { LatLng, MapControls, MapFit, MapMode, MapViewHandle, MapViewProps } from './types'

interface ModeDefaults {
  fitTo: MapFit
  flyToSelected: boolean
  follow: boolean
  controls: MapControls
  showLegend: boolean
}

const MODE_DEFAULTS: Record<MapMode, ModeDefaults> = {
  fleet: { fitTo: 'initial', flyToSelected: true, follow: false, controls: { zoom: true, fullscreen: true, recenter: true }, showLegend: true },
  route: { fitTo: 'content', flyToSelected: false, follow: false, controls: { zoom: true, fullscreen: true, recenter: true }, showLegend: false },
  incident: { fitTo: 'content', flyToSelected: true, follow: false, controls: { zoom: true, fullscreen: true, recenter: true }, showLegend: false },
  tracking: { fitTo: 'initial', flyToSelected: false, follow: true, controls: { zoom: true, recenter: true }, showLegend: false },
  picker: { fitTo: 'content', flyToSelected: false, follow: false, controls: { zoom: true }, showLegend: false },
}

/** The route source before there is a route: the route layers stay mounted (and in order) with nothing to draw. */
const EMPTY_LINE: FeatureCollection<LineString> = { type: 'FeatureCollection', features: [] }

/** Zoom used when there is a single thing to show, or when flying to a selection. */
const FOCUS_ZOOM = 14
/** Never zoom in further than this when fitting several things. */
const FIT_MAX_ZOOM = 15
/** Same as the marker glide, so the camera and the vehicle move together. */
const FOLLOW_DURATION_MS = 1500
/** If the style has not loaded by then, show an error instead of a blank box. */
const LOAD_TIMEOUT_MS = 20000

type LoadState = { status: 'loading' } | { status: 'ready' } | { status: 'error'; message: string; canRetry: boolean }

let webglSupport: boolean | undefined

/** Checked once per page; the probe context is released so it does not use up the browser's WebGL slots. */
function webglAvailable(): boolean {
  if (webglSupport !== undefined) return webglSupport
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    webglSupport = Boolean(gl)
  } catch {
    webglSupport = false
  }
  return webglSupport
}

const WEBGL_MESSAGE =
  'This browser or device cannot draw maps (WebGL is turned off or not supported). Try another browser, or turn on hardware acceleration.'
const NETWORK_MESSAGE = 'The map could not be loaded. Check your internet connection and try again.'
const SLOW_MESSAGE = 'The map is taking too long to load. Check your internet connection and try again.'

/** Tile errors come with a sourceId or tile and are not fatal; style and WebGL errors are. */
function isFatal(e: ErrorEvent): boolean {
  const extra = e as ErrorEvent & { sourceId?: string; tile?: unknown }
  return !extra.sourceId && !extra.tile
}

/**
 * The one map component for the app. See README.md in this folder.
 * Fills its parent (at least 320 px high) unless `height` is given.
 */
const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView(props, ref) {
  const {
    mode = 'fleet',
    route = null,
    trails,
    lines,
    baseStyle = 'streets',
    clusters: clusteringOn = true,
    selectedId = null,
    onSelect,
    fitPadding = 48,
    interactive = true,
    keyboardStops = true,
    showLabels = false,
    onPick,
    onPointMove,
    initialCenter,
    initialZoom,
    pitch = 0,
    height,
    className,
    ariaLabel = 'Map',
    children,
  } = props
  const defaults = MODE_DEFAULTS[mode]
  const palette = ROUTE_PALETTES[baseStyle]
  const fitTo = props.fitTo ?? defaults.fitTo
  const flyToSelected = props.flyToSelected ?? defaults.flyToSelected
  const follow = props.follow ?? defaults.follow
  const controls = props.controls ?? defaults.controls
  const showLegend = props.showLegend ?? defaults.showLegend
  // Traffic flow raster tiles are disabled until the backend is redeployed with
  // the relative-delay tile style. Route-level congestion colouring still works.
  const traffic = props.traffic ? { ...props.traffic, flow: false } : undefined

  const vehicles = useMemo(() => withValidPosition(props.vehicles), [props.vehicles])
  const points = useMemo(() => withValidPosition(props.points), [props.points])
  const stops = useMemo(() => withValidPosition(route?.stops), [route?.stops])

  // Lines count toward the fitted bounds like trails do
  const boundsTrails = useMemo(() => [...(trails ?? []), ...(lines ?? []).map((l) => ({ id: l.id, coordinates: l.coordinates }))], [trails, lines])

  const mapRef = useRef<MapRef>(null)
  const [attempt, setAttempt] = useState(0)
  const [load, setLoad] = useState<LoadState>(() =>
    webglAvailable() ? { status: 'loading' } : { status: 'error', message: WEBGL_MESSAGE, canRetry: false },
  )
  const ready = load.status === 'ready'

  // Never leave a blank box: give up with a message if the style does not arrive.
  useEffect(() => {
    if (load.status !== 'loading') return
    const timer = window.setTimeout(
      () => setLoad({ status: 'error', message: SLOW_MESSAGE, canRetry: true }),
      LOAD_TIMEOUT_MS,
    )
    return () => window.clearTimeout(timer)
  }, [load.status, attempt])

  const handleError = useCallback((e: ErrorEvent) => {
    console.warn('Map error', e.error)
    if (!isFatal(e)) return
    setLoad((current) => {
      if (current.status === 'ready') return current // a late style error on a working map
      return webglAvailable()
        ? { status: 'error', message: NETWORK_MESSAGE, canRetry: true }
        : { status: 'error', message: WEBGL_MESSAGE, canRetry: false }
    })
  }, [])

  const retry = useCallback(() => {
    setLoad({ status: 'loading' })
    setAttempt((n) => n + 1)
  }, [])

  // Latest content, read by camera helpers without re-subscribing effects.
  const content = useRef({ vehicles, points, route, stops, trails: boundsTrails })
  content.current = { vehicles, points, route, stops, trails: boundsTrails }
  const padding = useRef(fitPadding)
  padding.current = fitPadding

  const fitToContent = useCallback((animate: boolean) => {
    const map = mapRef.current
    if (!map) return
    const { vehicles: v, points: p, route: r, stops: s, trails: t } = content.current
    const bounds = contentBounds(v, p, r ? { ...r, stops: s } : null, t)
    const duration = animate ? 800 : 0
    if (!bounds) {
      map.easeTo({ center: MAP_DEFAULTS.CENTER, zoom: MAP_DEFAULTS.ZOOM, duration })
      return
    }
    const [[minLng, minLat], [maxLng, maxLat]] = bounds
    if (minLng === maxLng && minLat === maxLat) {
      map.easeTo({ center: [minLng, minLat], zoom: FOCUS_ZOOM, padding: padding.current, duration })
    } else {
      map.fitBounds(bounds, { padding: padding.current, maxZoom: FIT_MAX_ZOOM, duration })
    }
  }, [])

  // Zoom level, so large fleets can be grouped while zoomed out.
  const [zoom, setZoom] = useState<number>(initialZoom ?? MAP_DEFAULTS.ZOOM)
  const { singles, clusters } = useMemo(
    () => (clusteringOn ? clusterVehicles(vehicles, zoom, selectedId) : { singles: vehicles, clusters: [] }),
    [vehicles, zoom, selectedId, clusteringOn],
  )
  const openCluster = useCallback((cluster: VehicleCluster) => {
    const map = mapRef.current
    if (!map) return
    const [[minLng, minLat], [maxLng, maxLat]] = cluster.bounds
    if (minLng === maxLng && minLat === maxLat) {
      map.easeTo({ center: [minLng, minLat], zoom: map.getZoom() + 2, duration: 600 })
    } else {
      map.fitBounds(cluster.bounds, { padding: 64, maxZoom: FIT_MAX_ZOOM, duration: 600 })
    }
  }, [])

  // A fly-to asked for before the style has loaded is kept and run once the map is ready,
  // so "open this vehicle" links still end up zoomed on it.
  const pendingFly = useRef<{ position: LatLng; zoom: number } | null>(null)
  const readyRef = useRef(false)
  readyRef.current = ready
  const flyTo = useCallback((position: LatLng, zoom = FOCUS_ZOOM) => {
    if (!readyRef.current || !mapRef.current) {
      pendingFly.current = { position, zoom }
      return
    }
    mapRef.current.flyTo({ center: [position.lng, position.lat], zoom, duration: 1200 })
  }, [])

  // ── Fit to content ────────────────────────────────────────────────────
  // Changes when things are added or removed, not when a vehicle just moves.
  const signature = useMemo(() => [
    vehicles.map((v) => v.id).sort().join(','),
    points.map((p) => `${p.id}@${p.position.lat.toFixed(5)},${p.position.lng.toFixed(5)}`).sort().join(','),
    stops.map((s) => s.id).join(','),
    // Length and end only: a line that starts at a moving vehicle must not refit on every ping.
    route?.coordinates.length ?? 0,
    route?.coordinates[route.coordinates.length - 1]?.join(',') ?? '',
    boundsTrails.map((t) => `${t.id}:${t.coordinates.length}`).join(','),
  ].join('|'), [vehicles, points, stops, route?.coordinates, boundsTrails])

  const hasFitted = useRef(false)
  useEffect(() => { hasFitted.current = false }, [attempt])
  useEffect(() => {
    if (!ready || fitTo === 'none') return
    if (fitTo === 'initial' && hasFitted.current) return
    const { vehicles: v, points: p, route: r, stops: s, trails: t } = content.current
    if (!contentBounds(v, p, r ? { ...r, stops: s } : null, t)) return
    fitToContent(hasFitted.current)
    hasFitted.current = true
  }, [ready, signature, fitTo, fitToContent])

  // Run a fly-to that was asked for while the map was still loading (after the first fit, so it wins).
  useEffect(() => {
    if (!ready || !pendingFly.current) return
    const { position, zoom: z } = pendingFly.current
    pendingFly.current = null
    mapRef.current?.flyTo({ center: [position.lng, position.lat], zoom: z, duration: 1200 })
  }, [ready])

  // ── Follow a vehicle ──────────────────────────────────────────────────
  const followId =
    typeof follow === 'string'
      ? follow
      : follow
        ? (selectedId && vehicles.some((v) => v.id === selectedId) ? selectedId : vehicles.length === 1 ? vehicles[0].id : null)
        : null
  const followed = followId ? vehicles.find((v) => v.id === followId) : undefined
  const [following, setFollowing] = useState(true)
  const lastFollowed = useRef<{ id: string; key: string } | null>(null)

  useEffect(() => {
    if (!ready || !followed) return
    const key = `${followed.position.lat},${followed.position.lng}`
    const previous = lastFollowed.current
    if (previous?.id === followed.id && previous.key === key) return
    lastFollowed.current = { id: followed.id, key }
    if (!previous) return // the first position is covered by the initial fit
    if (previous.id !== followed.id) {
      // Switched to another vehicle: go to it and follow it.
      setFollowing(true)
      mapRef.current?.flyTo({ center: [followed.position.lng, followed.position.lat], zoom: Math.max(mapRef.current.getZoom(), FOCUS_ZOOM), duration: 1200 })
      return
    }
    if (following) {
      mapRef.current?.easeTo({ center: [followed.position.lng, followed.position.lat], duration: FOLLOW_DURATION_MS })
    }
  }, [ready, followed, following])

  const recenter = useCallback(() => {
    if (followed) {
      setFollowing(true)
      flyTo(followed.position, Math.max(mapRef.current?.getZoom() ?? FOCUS_ZOOM, FOCUS_ZOOM))
    } else {
      fitToContent(true)
    }
  }, [followed, flyTo, fitToContent])

  // ── Fly to the selection ──────────────────────────────────────────────
  // Also runs when the selected thing first appears on the map (a ?vehicle= link opens before positions load).
  const hasSelectedTarget = Boolean(selectedId && (vehicles.some((x) => x.id === selectedId) || points.some((x) => x.id === selectedId)))
  useEffect(() => {
    if (!ready || !flyToSelected || !selectedId || !hasSelectedTarget) return
    const { vehicles: v, points: p } = content.current
    const target = v.find((x) => x.id === selectedId)?.position ?? p.find((x) => x.id === selectedId)?.position
    if (target) flyTo(target, Math.max(mapRef.current?.getZoom() ?? 0, FOCUS_ZOOM))
  }, [ready, flyToSelected, selectedId, hasSelectedTarget, flyTo])

  useImperativeHandle(ref, () => ({ flyTo, fitToContent: () => fitToContent(true) }), [flyTo, fitToContent])

  // ── Picking ───────────────────────────────────────────────────────────
  const handleClick = useCallback((e: MapLayerMouseEvent) => {
    if (!onPick) return
    const target = e.originalEvent.target
    if (target instanceof Element && target.closest('.maplibregl-marker')) return
    onPick({ lat: e.lngLat.lat, lng: e.lngLat.lng })
  }, [onPick])

  const line = route ? routeFeature({ ...route, stops }) : null
  // A line built from stops alone is a straight-line estimate, so draw it dashed.
  const planned = Boolean(route?.planned) || (route?.coordinates.length ?? 0) < 2
  // Coloured by congestion only for a driven road whose per-segment levels fit the line and say something
  const congestionData = useMemo(() => {
    const levels = route?.congestion
    if (planned || !route || !levels || levels.length !== route.coordinates.length - 1 || levels.every((l) => l === 'unknown')) return null
    return congestionFeatures(route.coordinates, levels)
  }, [route, planned])
  const geofences = useMemo(() => geofenceFeatures(points), [points])
  const trailData = useMemo(() => trailFeatures(trails ?? []), [trails])
  const lineData = useMemo(() => lineFeatures(lines ?? []), [lines])
  const routeForVehicle = route && route.coordinates.length > 1 ? route.coordinates : undefined
  const center = initialCenter ?? { lng: MAP_DEFAULTS.CENTER[0], lat: MAP_DEFAULTS.CENTER[1] }

  // The map's own canvas and buttons (zoom, fullscreen, recenter, attribution) and the controls laid over it
  // (Layers, place search, links) leave the keyboard order too: the list beside the map is the keyboard route
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = rootRef.current
    if (keyboardStops || !root) return
    const skip = () => root.querySelectorAll<HTMLElement>(KEYBOARD_SKIP_SELECTOR).forEach(el => el.setAttribute('tabindex', '-1'))
    skip()
    const observer = new MutationObserver(skip)
    observer.observe(root, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [keyboardStops])

  return (
    <div
      ref={rootRef}
      role="region"
      aria-label={ariaLabel}
      className={clsx('relative isolate w-full overflow-hidden bg-surface-subtle', height === undefined && 'h-full min-h-80', className)}
      style={height !== undefined ? { height } : undefined}
    >
      {load.status !== 'error' || load.canRetry ? (
        <MapKeyboardContext.Provider value={keyboardStops}>
        <Map
          key={attempt}
          ref={mapRef}
          mapStyle={BASE_STYLES[baseStyle].style}
          initialViewState={{ longitude: center.lng, latitude: center.lat, zoom: initialZoom ?? MAP_DEFAULTS.ZOOM, pitch }}
          minZoom={MAP_DEFAULTS.MIN_ZOOM}
          maxZoom={MAP_DEFAULTS.MAX_ZOOM}
          attributionControl={{ compact: true }}
          interactive={interactive}
          // On a phone a small map inside a form would trap the page scroll, so it asks for two fingers.
          cooperativeGestures={mode === 'picker'}
          cursor={onPick ? 'crosshair' : undefined}
          style={{ position: 'absolute', inset: 0 }}
          onLoad={(e) => {
            setZoom(e.target.getZoom())
            setLoad({ status: 'ready' })
            // India's official boundaries: hide the base map's own country borders, now and after every style switch
            hideCountryBorders(e.target)
            e.target.on('styledata', () => hideCountryBorders(e.target))
          }}
          onZoomEnd={(e) => setZoom(e.viewState.zoom)}
          onError={handleError}
          onClick={onPick ? handleClick : undefined}
          onDragStart={() => setFollowing(false)}
        >
          {interactive && controls.recenter && <RecenterButton onClick={recenter} />}
          {interactive && controls.zoom && <NavigationControl position="top-right" showCompass={pitch > 0} />}
          {interactive && controls.fullscreen && <FullscreenControl position="top-right" />}

          {baseStyle === 'terrain' && (
            <Source id="terrain-hillshade" type="raster" tiles={TERRAIN_HILLSHADE.tiles} tileSize={256} maxzoom={TERRAIN_HILLSHADE.maxzoom} attribution={TERRAIN_HILLSHADE.attribution}>
              <Layer id="terrain-hillshade" type="raster" beforeId={TERRAIN_HILLSHADE.beforeId} paint={{ 'raster-opacity': TERRAIN_HILLSHADE.opacity }} />
            </Source>
          )}

          {traffic && (traffic.flow || traffic.incidents) && <TrafficLayers flow={traffic.flow} incidents={traffic.incidents} />}

          <Source id={INDIA_BORDERS_SOURCE_ID} type="geojson" data={INDIA_BORDERS_URL}>
            {indiaBordersLayers(baseStyle).map((layer) => <Layer key={`${layer.id}-${baseStyle}`} {...layer} />)}
          </Source>

          {geofences.features.length > 0 && (
            <Source id={GEOFENCE_SOURCE_ID} type="geojson" data={geofences}>
              <Layer {...geofenceFillLayer} />
              <Layer {...geofenceLineLayer} />
            </Source>
          )}

          {/* Always mounted, before trails, alternatives and the congestion line, so the route's layers keep a fixed place in the stack (see routeCasingLayer) */}
          <Source id={ROUTE_SOURCE_ID} type="geojson" data={line ?? EMPTY_LINE}>
            <Layer {...routeCasingLayer(palette, Boolean(line) && !planned)} />
            <Layer {...routeLineLayer(planned, palette, Boolean(line) && !congestionData)} />
          </Source>

          {trailData.features.length > 0 && (
            <Source id={TRAIL_SOURCE_ID} type="geojson" data={trailData}>
              <Layer {...trailCasingLayer(palette)} />
              <Layer {...trailLineLayer} />
            </Source>
          )}

          <AltRoutes routes={props.altRoutes} onSelect={props.onAltRouteSelect} palette={palette} />
          {lineData.features.length > 0 && (
            <Source id={LINES_SOURCE_ID} type="geojson" data={lineData}>
              <Layer {...linesCasingLayer(palette)} />
              <Layer {...linesDashedLayer} />
              <Layer {...linesSolidLayer} />
            </Source>
          )}

          {congestionData && (
            <Source id={ROUTE_CONGESTION_SOURCE_ID} type="geojson" data={congestionData}>
              <Layer {...congestionLineLayer(palette)} />
            </Source>
          )}

          {stops.map((s) => <StopMarker key={s.id} stop={s} />)}

          {points.map((p) => (
            <PointMarker
              key={p.id}
              point={p}
              selected={p.id === selectedId}
              onSelect={onSelect}
              onMove={onPointMove}
            />
          ))}

          {clusters.map((c) => <ClusterMarker key={c.id} cluster={c} onOpen={openCluster} />)}

          {singles.map((v) => (
            <VehicleMarker
              key={v.id}
              vehicle={v}
              selected={v.id === selectedId}
              showLabel={showLabels}
              route={v.id === selectedId || v.id === followId ? routeForVehicle : undefined}
              onSelect={onSelect}
            />
          ))}
        </Map>
        </MapKeyboardContext.Provider>
      ) : null}

      {ready && showLegend && <StatusLegend vehicles={vehicles} />}
      {ready && traffic?.flow && <TrafficLegend enabled stacked={showLegend && vehicles.length > 0} />}
      {children}
      {load.status === 'loading' && <MapLoading />}
      {load.status === 'error' && <MapError message={load.message} onRetry={load.canRetry ? retry : undefined} />}
    </div>
  )
})

/** What leaves the Tab order when a map has `keyboardStops` off: the canvas, every control and everything laid over the map. */
export const KEYBOARD_SKIP_SELECTOR = 'canvas, a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'

export default MapView
