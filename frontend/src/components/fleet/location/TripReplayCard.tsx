import { useCallback, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Route as RouteIcon } from 'lucide-react'
import { depotsAPI, gpsAPI, routesAPI } from '@/services/api'
import { Alert, Button, Card, CardBody, CardHeader, Checkbox, EmptyState, ErrorState, Input, Select, Skeleton, Stat } from '@/components/ui'
import { Swatch } from '@/components/map/Swatch'
import { MapView, directionsAvailable, fetchDrivingRoute, type MapLine, type MapPoint, type MapRouteStop, type MapVehicle, type MapViewHandle } from '@/components/map'
import { errorMessage, formatDateTime, formatDay, formatKm, formatMinutes, formatTime } from '@/utils/display'
import type { VehicleTrack } from './format'
import { ReplayPlayerBar } from './ReplayPlayerBar'
import { ReplayPlanCompare, ReplayStoppages } from './ReplayStoppages'
import {
  SPEED_BUCKETS, comparePlan, downsampleTrack, effectiveSpeeds, findStoppages, interpolateAt, speedRuns, timeOf, trackTotals,
  type LatLng, type Stoppage,
} from './replay'
import { useReplayPlayer } from './useReplayPlayer'

/** The most points drawn on the map; the totals and stoppages still use every point. */
const MAX_DRAWN_POINTS = 800
/** Newest points the server returns for one replay. */
const TRACK_LIMIT = 5000
/** Longest span the track endpoint accepts. */
const MAX_SPAN_MS = 7 * 24 * 3_600_000
const STOP_CHOICES = [5, 10, 15, 30, 60]
/** The muted line for the planned route. */
const PLANNED_COLOR = '#71717A'
/** The Mapbox directions call takes at most this many waypoints. */
const MAX_WAYPOINTS = 25

interface RouteStopRow {
  sequence: number
  status?: string | null
  delivery_points?: { latitude?: number | null; longitude?: number | null; name?: string | null; address?: string | null } | null
}

interface ReplayRoute {
  id: string
  status: string
  started_at?: string | null
  completed_at?: string | null
  created_at?: string | null
  depot_id?: string | null
  total_distance_km?: number | null
  total_duration_minutes?: number | null
  route_stops?: RouteStopRow[] | null
}

interface DepotRow { id: string; name?: string; latitude?: number | null; longitude?: number | null }

interface Range { from: Date; to: Date }

const pad = (n: number) => String(n).padStart(2, '0')
/** The value a datetime-local input wants, in the browser's time zone. */
const toInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }

const PRESETS: { label: string; range: () => Range }[] = [
  { label: 'Last 6 hours', range: () => ({ from: new Date(Date.now() - 6 * 3_600_000), to: new Date() }) },
  { label: 'Today', range: () => ({ from: startOfToday(), to: new Date() }) },
  { label: 'Yesterday', range: () => { const to = startOfToday(); return { from: new Date(to.getTime() - 24 * 3_600_000), to } } },
  { label: 'Last 24 hours', range: () => ({ from: new Date(Date.now() - 24 * 3_600_000), to: new Date() }) },
]

function stopPoints(route: ReplayRoute | undefined): (LatLng & { name: string; status?: string; sequence: number })[] {
  return [...(route?.route_stops ?? [])]
    .sort((a, b) => a.sequence - b.sequence)
    .flatMap(s => {
      const dp = s.delivery_points
      const lat = Number(dp?.latitude)
      const lng = Number(dp?.longitude)
      return dp && Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)
        ? [{ lat, lng, name: dp.name || dp.address || `Stop ${s.sequence}`, status: s.status ?? undefined, sequence: s.sequence }]
        : []
    })
}

function routeLabel(r: ReplayRoute): string {
  const when = r.started_at ?? r.created_at
  const stops = r.route_stops?.length ?? 0
  return `${when ? `${formatDay(when)}, ${formatTime(when)}` : 'Trip'} · ${stops} stop${stops === 1 ? '' : 's'}${r.status === 'active' ? ' · in progress' : ''}`
}

/**
 * Trip replay: pick a date range or a route, see the GPS track coloured by speed, play it back
 * with a marker, and read off the distance, driving time, stops and how it compared with the plan.
 */
export function TripReplayCard({ vehicleId, plate }: { vehicleId: string; plate: string }) {
  const [mode, setMode] = useState<'range' | 'route'>('range')
  const [draft, setDraft] = useState<{ from: string; to: string }>(() => {
    const r = PRESETS[3].range()
    return { from: toInput(r.from), to: toInput(r.to) }
  })
  const [applied, setApplied] = useState<Range | null>(null)
  const [routeId, setRouteId] = useState('')
  const [minStop, setMinStop] = useState(10)
  const [follow, setFollow] = useState(false)
  const [skipStops, setSkipStops] = useState(false)
  const mapRef = useRef<MapViewHandle>(null)

  const apply = useCallback((range: Range) => {
    setDraft({ from: toInput(range.from), to: toInput(range.to) })
    setApplied(range)
  }, [])

  const rangeError = useMemo(() => {
    const from = new Date(draft.from)
    const to = new Date(draft.to)
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 'Choose a start and an end time.'
    if (from >= to) return 'The start must be before the end.'
    if (to.getTime() - from.getTime() > MAX_SPAN_MS) return 'Choose at most 7 days at a time.'
    return null
  }, [draft])

  const routes = useQuery<ReplayRoute[]>({
    queryKey: ['replay-routes', vehicleId],
    queryFn: () => routesAPI.list({ vehicle_id: vehicleId, limit: 50 }) as Promise<ReplayRoute[]>,
    enabled: mode === 'route',
    select: list => list.filter(r => Array.isArray(r.route_stops) && (r.started_at || r.completed_at) && ['completed', 'active'].includes(r.status)),
  })
  const chosenRoute = mode === 'route' ? routes.data?.find(r => r.id === routeId) : undefined

  const depots = useQuery<DepotRow[]>({
    queryKey: ['replay-depots'],
    queryFn: () => depotsAPI.list() as Promise<DepotRow[]>,
    enabled: !!chosenRoute?.depot_id,
    staleTime: 10 * 60_000,
  })

  const chooseRoute = (id: string) => {
    setRouteId(id)
    const route = routes.data?.find(r => r.id === id)
    if (!route) return
    const from = new Date(route.started_at ?? route.created_at ?? Date.now())
    const to = route.completed_at ? new Date(route.completed_at) : new Date()
    // A little either side so the arrival at the first stop and the last leg are in the picture
    apply({ from: new Date(from.getTime() - 5 * 60_000), to: new Date(Math.min(to.getTime() + 5 * 60_000, from.getTime() + MAX_SPAN_MS)) })
  }

  const fromIso = applied?.from.toISOString()
  const toIso = applied?.to.toISOString()
  const track = useQuery<VehicleTrack>({
    queryKey: ['replay-track', vehicleId, fromIso, toIso],
    queryFn: () => gpsAPI.track(vehicleId, { from: fromIso, to: toIso, limit: TRACK_LIMIT }) as Promise<VehicleTrack>,
    enabled: !!applied,
    staleTime: 60_000,
  })

  // ── Everything worked out from the full track ──
  const points = useMemo(() => track.data?.points ?? [], [track.data])
  const times = useMemo(() => points.map(timeOf), [points])
  const speeds = useMemo(() => effectiveSpeeds(points), [points])
  const totals = useMemo(() => trackTotals(points, speeds), [points, speeds])
  const stoppages = useMemo(() => findStoppages(points, minStop), [points, minStop])

  // ── Only what is drawn is thinned ──
  const lines = useMemo<MapLine[]>(() => {
    const drawn = downsampleTrack(points.map((p, i) => ({ ...p, speed: speeds[i] })), MAX_DRAWN_POINTS)
    return speedRuns(drawn, drawn.map(d => d.speed)).map((run, i) => ({
      id: `speed-${i}`, coordinates: run.coordinates, color: run.bucket.color, width: 5,
    }))
  }, [points, speeds])

  // ── The planned route, when one is chosen ──
  const plannedStops = useMemo(() => stopPoints(chosenRoute), [chosenRoute])
  const depot = depots.data?.find(d => d.id === chosenRoute?.depot_id)
  const depotPoint = useMemo(() => (depot && Number.isFinite(Number(depot.latitude)) && Number.isFinite(Number(depot.longitude))
    ? { lat: Number(depot.latitude), lng: Number(depot.longitude) } : null), [depot])
  const waypoints = useMemo<LatLng[]>(
    () => (plannedStops.length === 0 ? [] : [...(depotPoint ? [depotPoint] : []), ...plannedStops, ...(depotPoint ? [depotPoint] : [])]),
    [plannedStops, depotPoint],
  )
  const road = useQuery({
    queryKey: ['replay-plan-road', chosenRoute?.id, waypoints.length],
    queryFn: () => fetchDrivingRoute(waypoints),
    enabled: directionsAvailable && waypoints.length >= 2 && waypoints.length <= MAX_WAYPOINTS,
    staleTime: 10 * 60_000,
  })
  const plannedPath = useMemo<{ coordinates: [number, number][]; basis: 'road' | 'straight' }>(() => {
    if (road.data?.coordinates.length) return { coordinates: road.data.coordinates, basis: 'road' }
    return { coordinates: waypoints.map(w => [w.lng, w.lat] as [number, number]), basis: 'straight' }
  }, [road.data, waypoints])

  const comparison = useMemo(() => (chosenRoute && points.length > 1
    ? comparePlan(points, plannedPath.coordinates.map(([lng, lat]) => ({ lat, lng })), chosenRoute.total_distance_km ?? null, totals.distanceKm)
    : null), [chosenRoute, points, plannedPath, totals.distanceKm])

  // ── Playback ──
  const startMs = times[0] ?? 0
  const endMs = times[times.length - 1] ?? 0
  const skipRanges = useMemo(() => (skipStops ? stoppages.filter(s => s.kind === 'stopped').map(s => ({ startMs: s.startMs, endMs: s.endMs })) : []), [skipStops, stoppages])
  const player = useReplayPlayer(startMs, endMs, skipRanges)
  const position = useMemo(() => interpolateAt(points, times, speeds, player.time), [points, times, speeds, player.time])

  const vehicles = useMemo<MapVehicle[]>(() => (position
    ? [{ id: 'replay', position: { lat: position.lat, lng: position.lng }, status: 'on_route', heading: position.heading, label: plate, instant: true }]
    : []), [position, plate])

  const mapStops = useMemo<MapRouteStop[]>(() => plannedStops.map((s, i) => ({
    id: `plan-${i}`, sequence: s.sequence, position: { lat: s.lat, lng: s.lng }, label: s.name, status: s.status,
  })), [plannedStops])

  const markers = useMemo<MapPoint[]>(() => {
    if (points.length < 2) return []
    const first = points[0]
    const last = points[points.length - 1]
    const stops = [...stoppages].filter(s => s.kind === 'stopped').sort((a, b) => b.minutes - a.minutes).slice(0, 30).map((s): MapPoint => ({
      id: `stop-${s.startMs}`, kind: 'location', position: { lat: s.lat, lng: s.lng },
      label: `Stopped ${formatMinutes(s.minutes)} from ${formatTime(s.startMs)}`,
    }))
    return [
      { id: 'trip-start', kind: 'pickup', position: first, label: `Trip start, ${formatDateTime(first.at)}` },
      { id: 'trip-end', kind: 'drop', position: last, label: `Trip end, ${formatDateTime(last.at)}` },
      ...stops,
    ]
  }, [points, stoppages])

  const pickStoppage = (s: Stoppage) => {
    player.pause()
    player.seek(s.startMs)
    mapRef.current?.flyTo({ lat: s.lat, lng: s.lng }, 15)
  }

  const showTrip = () => {
    if (rangeError) return
    setApplied({ from: new Date(draft.from), to: new Date(draft.to) })
  }

  return (
    <Card>
      <CardHeader title="Trip replay" description="Play back where the vehicle went, how fast, and where it stopped" />
      <CardBody className="space-y-4">
        <div role="group" aria-label="What to replay" className="inline-flex rounded-control border border-border p-0.5">
          {([['range', 'Date and time'], ['route', 'A trip']] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={mode === id}
              onClick={() => setMode(id)}
              className={`rounded-control px-3 py-1.5 text-sm font-medium transition-colors ${mode === id ? 'bg-brand-soft text-text' : 'text-muted hover:text-text'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === 'range' ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input label="From" type="datetime-local" value={draft.from} onChange={e => setDraft(d => ({ ...d, from: e.target.value }))} />
              <Input label="To" type="datetime-local" value={draft.to} onChange={e => setDraft(d => ({ ...d, to: e.target.value }))} error={rangeError} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {PRESETS.map(p => <Button key={p.label} size="sm" variant="secondary" onClick={() => apply(p.range())}>{p.label}</Button>)}
              <Button size="sm" onClick={showTrip} disabled={!!rangeError}>Show trip</Button>
            </div>
            <p className="text-xs text-muted">Times are in your device's time zone.</p>
          </div>
        ) : routes.isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : routes.isError ? (
          <ErrorState compact title="We could not load this vehicle's trips" onRetry={() => routes.refetch()} />
        ) : (routes.data?.length ?? 0) === 0 ? (
          <EmptyState compact icon={<RouteIcon size={22} />} title="No trips to replay" description="Trips this vehicle has started or completed show up here." />
        ) : (
          <Select
            label="Trip"
            placeholder="Choose a trip"
            value={routeId}
            onChange={e => chooseRoute(e.target.value)}
            options={(routes.data ?? []).map(r => ({ value: r.id, label: routeLabel(r) }))}
          />
        )}

        {!applied ? (
          <EmptyState compact title="Choose what to replay" description="Pick a date and time, or a trip, to load the GPS track." />
        ) : track.isLoading ? (
          <Skeleton className="h-80 w-full" />
        ) : track.isError ? (
          <ErrorState compact title="We could not load the track" description={errorMessage(track.error, 'Check your connection and try again.')} onRetry={() => track.refetch()} />
        ) : points.length < 2 ? (
          <EmptyState
            compact
            title="No GPS track in this period"
            description={`${plate} reported ${points.length === 1 ? 'only one position' : 'no positions'} between ${formatDateTime(applied.from)} and ${formatDateTime(applied.to)}.`}
          />
        ) : (
          <>
            {track.data?.truncated && (
              <Alert tone="warning" title="Only the latest positions are shown">
                This period has more than {TRACK_LIMIT.toLocaleString('en-IN')} positions, so the earliest were left out. Choose a shorter period to see all of it.
              </Alert>
            )}

            <div className="relative h-72 overflow-hidden rounded-card border border-border sm:h-96">
              <MapView
                ref={mapRef}
                mode="route"
                vehicles={vehicles}
                lines={lines}
                route={chosenRoute ? { coordinates: plannedPath.coordinates, stops: mapStops, planned: true } : null}
                points={markers}
                follow={follow ? 'replay' : false}
                clusters={false}
                interactive
                height="100%"
                fitPadding={40}
                ariaLabel={`Map replaying the trip of ${plate}`}
              >
                <div className="pointer-events-none absolute bottom-2 left-2 z-10 rounded-control border border-border bg-surface/95 px-2 py-1.5 text-xs shadow-raised">
                  <ul className="space-y-0.5">
                    {SPEED_BUCKETS.map(b => (
                      <li key={b.id} className="flex items-center gap-1.5 text-text">
                        <Swatch color={b.color} />
                        {b.label}
                      </li>
                    ))}
                    {chosenRoute && plannedPath.coordinates.length > 1 && (
                      <li className="flex items-center gap-1.5 text-text">
                        <Swatch color={PLANNED_COLOR} shape="dash" />
                        Planned route
                      </li>
                    )}
                  </ul>
                </div>
              </MapView>
            </div>

            <ReplayPlayerBar player={player} startMs={startMs} endMs={endMs} position={position} />
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <Checkbox label="Follow the vehicle" checked={follow} onChange={e => setFollow(e.target.checked)} />
              <Checkbox label="Skip the time it stood still" checked={skipStops} onChange={e => setSkipStops(e.target.checked)} />
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Distance" value={formatKm(totals.distanceKm)} hint={`${points.length.toLocaleString('en-IN')} positions`} />
              <Stat label="Driving time" value={formatMinutes(totals.drivingMinutes)} hint={totals.averageMovingKmph != null ? `${Math.round(totals.averageMovingKmph)} km/h on average` : undefined} />
              <Stat label="Standing time" value={formatMinutes(totals.stoppedMinutes)} hint={`Over ${formatMinutes(totals.spanMinutes)} in all`} />
              <Stat label="Top speed" value={`${Math.round(totals.maxSpeedKmph)} km/h`} />
            </div>

            {chosenRoute && comparison && (
              <ReplayPlanCompare
                comparison={comparison}
                basis={plannedPath.basis}
                plannedMinutes={chosenRoute.total_duration_minutes ?? null}
                actualMinutes={totals.spanMinutes}
              />
            )}

            <div className="space-y-2">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <h3 className="text-sm font-medium text-text">Stops</h3>
                <Select
                  label="Show stops of at least"
                  className="w-44"
                  value={String(minStop)}
                  onChange={e => setMinStop(Number(e.target.value))}
                  options={STOP_CHOICES.map(m => ({ value: String(m), label: `${m} minutes` }))}
                />
              </div>
              <ReplayStoppages stoppages={stoppages} minMinutes={minStop} onPick={pickStoppage} />
            </div>
          </>
        )}
      </CardBody>
    </Card>
  )
}

export default TripReplayCard
