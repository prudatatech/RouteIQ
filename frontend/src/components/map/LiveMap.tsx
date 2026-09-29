import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { marketplaceAPI, routesAPI } from '@/services/api'
import { trafficAPI } from '@/services/pricing'
import { describeIncident } from '@/utils/traffic'
import { useAuthStore } from '@/store/authStore'
import type { ResolvedPlace } from '@/services/geocoding'
import { PlaceSearch } from '@/components/ui'
import { supabase, openChannel } from '@/services/supabase'
import { formatEta } from '@/utils/timeFormat'
import MapView from './MapView'
import { fetchDrivingRoute, type DrivingRoute } from './directions'
import { useLiveVehiclePositions } from './useLiveVehiclePositions'
import type { LatLng, MapMode, MapPoint, MapRoute, MapRouteStop, MapVehicle, MapViewHandle } from './types'

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
  const selectedId = selectedVehicleId ?? clickedId

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

  // Road route from the vehicle through the stops. Refetched when the stops
  // or the selected vehicle change, not on every GPS ping.
  const [driving, setDriving] = useState<DrivingRoute | null>(null)
  const vehiclePosRef = useRef<LatLng | null>(null)
  vehiclePosRef.current = selectedVehicle?.position ?? null
  const stopsRef = useRef(stops)
  stopsRef.current = stops
  const stopsKey = stops.map((s) => `${s.position.lat},${s.position.lng}`).join(';')
  const hasVehiclePosition = Boolean(selectedVehicle)

  useEffect(() => {
    setDriving(null)
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
  }, [selectedId, stopsKey, hasVehiclePosition])

  const route = useMemo<MapRoute | null>(() => {
    if (stops.length === 0) return null
    const start = selectedVehicle ? [[selectedVehicle.position.lng, selectedVehicle.position.lat] as [number, number]] : []
    if (driving) return { coordinates: [...start, ...driving.coordinates], stops }
    const straight = [...start, ...stops.map((s) => [s.position.lng, s.position.lat] as [number, number])]
    return { coordinates: straight, stops, planned: true }
  }, [stops, driving, selectedVehicle])

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

  // ── Traffic incidents on active routes (staff only) ───────────────────
  const role = useAuthStore((s) => s.role)
  const isStaff = role === 'admin' || role === 'superadmin' || role === 'manager'
  const { data: traffic } = useQuery({
    queryKey: ['traffic-incidents'],
    queryFn: () => trafficAPI.incidents(),
    refetchInterval: 60_000,
    enabled: !compact && isStaff,
  })
  const incidentPoints = useMemo<MapPoint[]>(() => (traffic?.incidents ?? []).map((i) => ({
    id: `traffic-${i.id}`,
    kind: 'incident' as const,
    position: { lat: i.lat, lng: i.lng },
    label: `Traffic: ${describeIncident(i)}`,
  })), [traffic])

  // ── Camera: fly to the selected vehicle on request ────────────────────
  const lastZoomEvent = useRef<number | undefined>()
  useEffect(() => {
    if (!zoomFocusEvent || lastZoomEvent.current === zoomFocusEvent) return
    lastZoomEvent.current = zoomFocusEvent
    if (selectedVehicle) mapRef.current?.flyTo(selectedVehicle.position, 16)
  }, [zoomFocusEvent, selectedVehicle])

  const handleSelect = (id: string) => {
    if (id.startsWith('load-') || id.startsWith('traffic-')) return
    setClickedId(id)
    onVehicleSelect?.(id)
  }

  const remainingStops = (activeRoute?.route_stops ?? []).filter((s) => s.status === 'pending').length

  return (
    <MapView
      ref={mapRef}
      mode={mode}
      vehicles={mapVehicles}
      route={route}
      points={[...loadPoints, ...incidentPoints]}
      selectedId={selectedId}
      onSelect={handleSelect}
      flyToSelected={false}
      showLegend={!compact}
      className={className}
      ariaLabel="Live fleet map"
    >
      {!compact && (
        <div className="absolute left-3 top-3 z-10 flex w-72 max-w-[calc(100%-4.5rem)] flex-col gap-2">
          <MapPlaceSearch onFound={(pos) => mapRef.current?.flyTo(pos, 13)} />
          {isStaff && traffic && (
            <p className="rounded-control border border-border bg-surface px-3 py-2 text-xs text-muted shadow-raised">
              {!traffic.configured
                ? 'Traffic incidents are off. Add a TomTom key to show them.'
                : traffic.incidents.length === 0
                  ? 'No traffic incidents on active routes.'
                  : `${traffic.incidents.length.toLocaleString('en-IN')} traffic ${traffic.incidents.length === 1 ? 'incident' : 'incidents'} on active routes.`}
            </p>
          )}
          {selectedId && activeRoute && (
            <section aria-label="Active route" className="rounded-control border border-border bg-surface p-3 text-sm shadow-raised">
              <p className="truncate font-medium text-text">{activeRoute.name || `Route ${activeRoute.id.slice(0, 8)}`}</p>
              <p className="mt-1 text-xs text-muted">
                {remainingStops} {remainingStops === 1 ? 'stop' : 'stops'} left · {activeRoute.status === 'active' ? 'Active' : 'Pending'}
              </p>
              {driving && (
                <p className="mt-1 text-xs text-muted">
                  Arrives in <span className="font-medium text-text">{formatEta(driving.durationSeconds / 60)}</span>
                  {' · '}
                  <span className="tabular">{(driving.distanceMeters / 1000).toFixed(1)} km</span> to go
                </p>
              )}
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
