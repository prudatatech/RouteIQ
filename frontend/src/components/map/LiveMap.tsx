import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { marketplaceAPI, routesAPI } from '@/services/api'
import { trafficAPI } from '@/services/pricing'
import { useAuthStore } from '@/store/authStore'
import type { ResolvedPlace } from '@/services/geocoding'
import { PlaceSearch } from '@/components/ui'
import { supabase, openChannel } from '@/services/supabase'
import { useVehicleTrack } from '@/components/fleet/location/useVehicleLocation'
import { trackCoordinates } from '@/components/fleet/location/format'
import MapView from './MapView'
import LayerSwitcher, { type LayerOverlay } from './LayerSwitcher'
import { useLayerPrefs } from './layerPrefs'
import { fetchDrivingRoute, type DrivingRoute } from './directions'
import { TripEtaLine } from './TripEta'
import { useTrafficTileToken } from './useTrafficTileToken'
import { remainingStops as toEtaStops } from './tripStops'
import { useLiveEta } from './useLiveEta'
import { useLiveVehiclePositions } from './useLiveVehiclePositions'
import type { LatLng, MapMode, MapPoint, MapRoute, MapRouteStop, MapTrail, MapVehicle, MapViewHandle } from './types'

/** Vehicle as returned by the vehicles API. */
export interface LiveMapVehicle {
  id: string
  plate_number: string
  latitude?: number | null
  longitude?: number | null
  status: string
  vehicle_type?: string
  cargo_types?: string[]
}

interface DeliveryPoint {
  latitude?: number | string | null
  longitude?: number | string | null
  name?: string | null
  address?: string | null
}

/** A route stop as returned by the routes API (or built by a page). */
export interface LiveMapStop {
  id?: string
  sequence?: number
  status?: string
  /** Set when the route is dispatched; the live ETA is compared with it. */
  planned_arrival_at?: string | null
  delivery_points?: DeliveryPoint | DeliveryPoint[] | null
}

interface RouteRow {
  id: string
  name?: string | null
  status: string
  vehicle_id?: string | null
  route_stops?: LiveMapStop[] | null
}

interface OpenLoad {
  id: string
  origin_lat?: number | null
  origin_lng?: number | null
  origin_name?: string | null
  weight_kg?: number | null
}

export interface LiveMapProps {
  vehicles: LiveMapVehicle[]
  selectedVehicleId?: string | null
  /** Change this number to fly to the selected vehicle. */
  zoomFocusEvent?: number
  onVehicleSelect?: (id: string) => void
  /** Stops to draw for the selected vehicle instead of its active route's pending stops. */
  customPendingStops?: LiveMapStop[]
  /** Map preset. Default "fleet". */
  mode?: MapMode
  /** Hide the place search, route summary, open loads and legend (for small embedded maps). */
  compact?: boolean
  className?: string
}

/** Zoom used when a vehicle is selected. */
const SELECT_ZOOM = 16
/** The selected vehicle's road route (and its congestion colours) is fetched again this often. */
const ROUTE_REFRESH_MS = 3 * 60_000
/** How far back the selected vehicle's trail goes. */
const TRAIL_HOURS = 6

const stopPosition = (stop: LiveMapStop): LatLng | null => {
  const dp = Array.isArray(stop.delivery_points) ? stop.delivery_points[0] : stop.delivery_points
  if (dp?.latitude == null || dp?.longitude == null) return null
  const lat = Number(dp.latitude)
  const lng = Number(dp.longitude)
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null
}

const stopLabel = (stop: LiveMapStop): string | undefined => {
  const dp = Array.isArray(stop.delivery_points) ? stop.delivery_points[0] : stop.delivery_points
  return dp?.name || dp?.address || undefined
}

const bySequence = (a: LiveMapStop, b: LiveMapStop) => (a.sequence ?? 0) - (b.sequence ?? 0)

/**
 * Live fleet map: vehicles with realtime GPS, the selected vehicle's active
 * route (road route when a Mapbox token is set), open marketplace loads and a
 * place search. Drawing is done by MapView.
 */
export default function LiveMap({
  vehicles,
  selectedVehicleId,
  zoomFocusEvent,
  onVehicleSelect,
  customPendingStops,
  mode = 'fleet',
  compact = false,
  className,
}: LiveMapProps) {
  const mapRef = useRef<MapViewHandle>(null)
  const queryClient = useQueryClient()
  const livePositions = useLiveVehiclePositions()
  const [clickedId, setClickedId] = useState<string | null>(null)
  // A page that passes onVehicleSelect owns the selection (so it can also clear it);
  // otherwise a clicked marker stays selected here.
  const selectedId = onVehicleSelect ? (selectedVehicleId ?? null) : (selectedVehicleId ?? clickedId)
  const [layers, setLayers] = useLayerPrefs()

  // ── Vehicles ──────────────────────────────────────────────────────────
  const mapVehicles = useMemo<MapVehicle[]>(() => vehicles.flatMap((v) => {
    const live = livePositions[v.id]
    const position = live ?? (v.latitude != null && v.longitude != null ? { lat: Number(v.latitude), lng: Number(v.longitude) } : null)
    // Vehicles without a GPS position are left off the map, never placed at a guessed spot.
    return position ? [{ id: v.id, position, status: v.status, label: v.plate_number, vehicle_type: v.vehicle_type }] : []
  }), [vehicles, livePositions])

  const selectedVehicle = selectedId ? mapVehicles.find((v) => v.id === selectedId) : undefined

  // ── Selected vehicle's active route ───────────────────────────────────
  const { data: activeRoute } = useQuery({
    queryKey: ['routes', selectedId],
    queryFn: () => routesAPI.list({ vehicle_id: selectedId }) as Promise<RouteRow[]>,
    enabled: !!selectedId,
    refetchInterval: 10000,
    select: (routes: RouteRow[]) =>
      routes.find((r) => (r.status === 'active' || r.status === 'pending') && r.vehicle_id === selectedId) ?? null,
  })

  // New stops added mid-route show up without waiting for the next refetch.
  useEffect(() => {
    if (!selectedId) return
    const channel = openChannel(`map-route-stops-${selectedId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'route_stops' }, () => {
        queryClient.invalidateQueries({ queryKey: ['routes'] })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [selectedId, queryClient])

  const pendingStops = useMemo(() => {
    if (customPendingStops && customPendingStops.length > 0) return [...customPendingStops].sort(bySequence)
    return (activeRoute?.route_stops ?? []).filter((s) => s.status === 'pending').sort(bySequence)
  }, [customPendingStops, activeRoute])

  const stops = useMemo<MapRouteStop[]>(() => pendingStops.flatMap((s, i) => {
    const position = stopPosition(s)
    return position
      ? [{ id: s.id ?? `stop-${i}`, position, sequence: s.sequence ?? i + 1, status: s.status, label: stopLabel(s) }]
      : []
  }), [pendingStops])

  // Road route from the vehicle through the stops. Refetched when the stops or the selected
  // vehicle change, not on every GPS ping, and every few minutes so the congestion colours stay current.
  const [driving, setDriving] = useState<DrivingRoute | null>(null)
  const vehiclePosRef = useRef<LatLng | null>(null)
  vehiclePosRef.current = selectedVehicle?.position ?? null
  const stopsRef = useRef(stops)
  stopsRef.current = stops
  const stopsKey = stops.map((s) => `${s.position.lat},${s.position.lng}`).join(';')
  const hasVehiclePosition = Boolean(selectedVehicle)
  const [trafficTick, setTrafficTick] = useState(0)
  useEffect(() => {
    if (!selectedId || stops.length === 0) return
    const timer = window.setInterval(() => setTrafficTick((n) => n + 1), ROUTE_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [selectedId, stops.length])

  const drivingFor = useRef('')
  useEffect(() => {
    const key = `${selectedId}|${stopsKey}|${hasVehiclePosition}`
    // A refresh keeps the old line until the new one arrives; only a different route clears it.
    if (drivingFor.current !== key) { drivingFor.current = key; setDriving(null) }
    const start = vehiclePosRef.current
    const waypoints = stopsRef.current.map((s) => s.position)
    if (!start || waypoints.length === 0) return
    const controller = new AbortController()
    fetchDrivingRoute([start, ...waypoints], controller.signal)
      .then((result) => { if (!controller.signal.aborted) setDriving(result) })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) console.warn('Could not fetch the road route', err)
      })
    return () => controller.abort()
    // Keyed on stopsKey (not positions) so a moving vehicle does not trigger a refetch.
  }, [selectedId, stopsKey, hasVehiclePosition, trafficTick])

  const route = useMemo<MapRoute | null>(() => {
    if (stops.length === 0 || !layers.routes) return null
    const start = selectedVehicle ? [[selectedVehicle.position.lng, selectedVehicle.position.lat] as [number, number]] : []
    if (driving) {
      // The vehicle's own position is prepended to the road geometry: that first segment has no traffic data
      const congestion = driving.congestion.length > 0 ? [...start.map(() => 'unknown' as const), ...driving.congestion] : undefined
      return { coordinates: [...start, ...driving.coordinates], stops, congestion }
    }
    const straight = [...start, ...stops.map((s) => [s.position.lng, s.position.lat] as [number, number])]
    return { coordinates: straight, stops, planned: true }
  }, [stops, driving, selectedVehicle, layers.routes])

  // ── Open marketplace loads ────────────────────────────────────────────
  const { data: openLoads } = useQuery({
    queryKey: ['marketplace_loads'],
    queryFn: () => marketplaceAPI.openLoads() as Promise<{ loads?: OpenLoad[] }>,
    refetchInterval: 15000,
    enabled: !compact,
  })
  const loadPoints = useMemo<MapPoint[]>(() => compact ? [] : (openLoads?.loads ?? []).flatMap((l) =>
    l.origin_lat != null && l.origin_lng != null
      ? [{
          id: `load-${l.id}`,
          kind: 'load' as const,
          position: { lat: Number(l.origin_lat), lng: Number(l.origin_lng) },
          label: `Open load${l.origin_name ? ` from ${l.origin_name}` : ''}${l.weight_kg ? `, ${l.weight_kg} kg` : ''}`,
        }]
      : []), [openLoads, compact])

  // ── Live traffic (staff only: the tiles and incidents need a signed-in staff user) ──
  const role = useAuthStore((s) => s.role)
  const isStaff = role === 'admin' || role === 'superadmin' || role === 'manager'
  const tileToken = useTrafficTileToken(isStaff)
  const { data: routeIncidents } = useQuery({
    queryKey: ['traffic-incidents'],
    queryFn: () => trafficAPI.incidents(),
    refetchInterval: 60_000,
    enabled: !compact && isStaff,
  })

  // ── Live ETA of the selected vehicle through its remaining stops ──────
  const etaStops = useMemo(
    () => toEtaStops(customPendingStops && customPendingStops.length > 0 ? customPendingStops : activeRoute?.route_stops),
    [customPendingStops, activeRoute],
  )
  const liveEta = useLiveEta({ origin: selectedVehicle?.position ?? null, stops: etaStops, enabled: !compact && !!selectedId })

  // ── Trail of the selected vehicle, from its GPS history ───────────────
  const { data: track } = useVehicleTrack(selectedId, TRAIL_HOURS, !compact && layers.trails)
  const trails = useMemo<MapTrail[]>(() => {
    const coordinates = trackCoordinates(track)
    return selectedId && layers.trails && coordinates.length > 1 ? [{ id: selectedId, coordinates }] : []
  }, [track, selectedId, layers.trails])

  // ── Camera: fly to a vehicle when it is selected and when asked to ────
  // Selecting (a marker, the list, or a ?vehicle= link) zooms to it once its position is known.
  // A link opens before positions have loaded, so this waits for the position instead of giving up.
  const flownTo = useRef<string | null>(null)
  const selectedPosition = selectedVehicle?.position
  useEffect(() => {
    if (!selectedId) { flownTo.current = null; return }
    if (!selectedPosition || flownTo.current === selectedId) return
    flownTo.current = selectedId
    mapRef.current?.flyTo(selectedPosition, SELECT_ZOOM)
  }, [selectedId, selectedPosition])

  // Asking again for the vehicle that is already selected (clicking it in a list) flies back to it.
  const lastZoomEvent = useRef<number | undefined>(zoomFocusEvent)
  useEffect(() => {
    if (!zoomFocusEvent || lastZoomEvent.current === zoomFocusEvent) return
    if (!selectedPosition) return // keep the request until the position is known
    lastZoomEvent.current = zoomFocusEvent
    mapRef.current?.flyTo(selectedPosition, SELECT_ZOOM)
  }, [zoomFocusEvent, selectedPosition])

  const handleSelect = (id: string) => {
    if (id.startsWith('load-')) return
    setClickedId(id)
    onVehicleSelect?.(id)
  }

  const notSetUp = tileToken.data && !tileToken.data.configured
  const overlays: LayerOverlay[] = [
    ...(isStaff ? [{
      id: 'flow',
      label: 'Live traffic',
      checked: layers.flow,
      hint: notSetUp ? 'Not set up yet' : 'Congestion on the roads',
    }, {
      id: 'traffic',
      label: 'Traffic incidents',
      checked: layers.traffic,
      hint: 'Accidents, road works and closures',
    }] : []),
    { id: 'routes', label: 'Route lines', checked: layers.routes, hint: 'Active route of the selected vehicle' },
    { id: 'trails', label: 'Vehicle trail', checked: layers.trails, hint: `Where the selected vehicle went in the last ${TRAIL_HOURS} hours` },
    { id: 'clusters', label: 'Group nearby vehicles', checked: layers.clusters },
  ]

  const remainingStops = (activeRoute?.route_stops ?? []).filter((s) => s.status === 'pending').length

  return (
    <MapView
      ref={mapRef}
      mode={mode}
      vehicles={mapVehicles}
      route={route}
      points={loadPoints}
      trails={trails}
      baseStyle={compact ? 'streets' : layers.base}
      traffic={{ flow: isStaff && layers.flow, incidents: isStaff && !compact && layers.traffic }}
      clusters={layers.clusters}
      selectedId={selectedId}
      onSelect={handleSelect}
      flyToSelected={false}
      showLegend={!compact}
      className={className}
      ariaLabel="Live fleet map"
    >
      {!compact && (
        <LayerSwitcher
          baseStyle={layers.base}
          onBaseStyleChange={(base) => setLayers({ base })}
          overlays={overlays}
          onOverlayChange={(id, checked) => setLayers({ [id]: checked })}
        />
      )}
      {!compact && (
        <div className="absolute left-3 top-3 z-10 flex w-72 max-w-[calc(100%-4.5rem)] flex-col gap-2">
          <MapPlaceSearch onFound={(pos) => mapRef.current?.flyTo(pos, 13)} />
          {isStaff && routeIncidents && (
            <p className="rounded-control border border-border bg-surface px-3 py-2 text-xs text-muted shadow-raised">
              {!routeIncidents.configured
                ? 'Traffic incidents are not set up yet.'
                : routeIncidents.incidents.length === 0
                  ? 'No traffic incidents on active routes.'
                  : `${routeIncidents.incidents.length.toLocaleString('en-IN')} traffic ${routeIncidents.incidents.length === 1 ? 'incident' : 'incidents'} on active routes.`}
            </p>
          )}
          {selectedId && activeRoute && (
            <section aria-label="Active route" className="rounded-control border border-border bg-surface p-3 text-sm shadow-raised">
              <p className="truncate font-medium text-text">{activeRoute.name || `Route ${activeRoute.id.slice(0, 8)}`}</p>
              <p className="mt-1 text-xs text-muted">
                {remainingStops} {remainingStops === 1 ? 'stop' : 'stops'} left · {activeRoute.status === 'active' ? 'Active' : 'Pending'}
              </p>
              {liveEta.data && <TripEtaLine eta={liveEta.data} />}
            </section>
          )}
        </div>
      )}
    </MapView>
  )
}

/** Search box that moves the map to a place in India, with live suggestions. */
function MapPlaceSearch({ onFound }: { onFound: (position: LatLng) => void }) {
  const [place, setPlace] = useState<ResolvedPlace | null>(null)
  return (
    <div role="search" className="rounded-control shadow-raised">
      <PlaceSearch
        label="Search for a place"
        hideLabel
        placeholder="Search for a place"
        value={place}
        onChange={p => {
          setPlace(p)
          if (p) onFound({ lat: p.lat, lng: p.lng })
        }}
      />
    </div>
  )
}
