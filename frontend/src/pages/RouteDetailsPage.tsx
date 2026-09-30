import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { CheckCircle2, Copy, Edit2, ExternalLink, Play, Trash2, XCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import type { AxiosError } from 'axios'
import { routesAPI } from '@/services/api'
import { Page, PageHeader, Card, Button, buttonClasses, StatusPill, Stat, DetailList, Timeline, type TimelineEvent, EmptyState, LoadingState, ErrorState, useConfirm } from '@/components/ui'
import { MapView, TripEtaCard, fetchDrivingRoute, remainingStops, useLiveEta, type DrivingRoute, type LatLng, type MapRouteStop, type MapVehicle } from '@/components/map'
import { getRouteDistance, getRouteDuration, getRouteFuel, type RouteLike } from '@/utils/routeHelpers'
import { canCompleteRoute, canDispatchRoute, completeBlockedReason, useRouteStatusActions } from '@/hooks/useRouteStatusActions'
import { formatDateTime, formatMinutes, formatKm } from '@/utils/display'
import RouteConditions from '@/components/traffic/RouteConditions'
import { useAuthStore } from '@/store/authStore'
import MessagesPanel from '@/components/messages/MessagesPanel'
import { manifestTrackingId } from '@/components/shipments/format'

interface DeliveryPoint {
  name?: string | null
  address?: string | null
  latitude?: number | null
  longitude?: number | null
}

interface RouteStop {
  id: string
  sequence: number
  status?: string | null
  planned_arrival_at?: string | null
  delivery_point_id?: string | null
  delivery_points?: DeliveryPoint | null
  /** The shipment (or lot) this stop delivers; null for a place that is not a shipment's drop. */
  shipment?: { id: string; tracking_id: string } | null
}

/** Mirrors the backend rule in routes.routes.ts DELETE /:route_id: once a route
 * has started, deleting it would erase real movement history. Cancel it instead. */
const UNDELETABLE_STATUSES = new Set(['active', 'completed'])

interface RouteDetail extends RouteLike {
  id: string
  status: string
  vehicle_id?: string | null
  created_at?: string | null
  started_at?: string | null
  completed_at?: string | null
  is_manifest?: boolean
  optimization_score?: number | null
  vehicles?: (DeliveryPoint & { id?: string; plate_number?: string | null; status?: string | null; driver_id?: string | null; driver_name?: string | null }) | null
  route_stops?: RouteStop[] | null
}

/** Live traffic on the route map is refreshed this often while the route is active. */
const TRAFFIC_REFRESH_MS = 3 * 60_000

export default function RouteDetailsPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const statusActions = useRouteStatusActions()

  const { data: route, isLoading, isError, refetch } = useQuery<RouteDetail>({
    queryKey: ['route', id],
    queryFn: () => routesAPI.get(id as string),
    enabled: !!id,
    // The vehicle marker and the live ETA follow the truck while the route is running
    refetchInterval: (query) => (query.state.data?.status === 'active' ? 20_000 : false),
  })

  const role = useAuthStore(s => s.role)
  const isStaff = role === 'admin' || role === 'superadmin' || role === 'manager'

  const updateStatusMutation = useMutation({
    mutationFn: (status: string) => routesAPI.updateStatus((route as RouteDetail).id, status),
    onSuccess: () => {
      toast.success(route?.is_manifest ? 'Load cancelled' : 'Trip cancelled')
      queryClient.invalidateQueries({ queryKey: ['route', id] })
      queryClient.invalidateQueries({ queryKey: ['routes'] })
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
    },
    onError: (err: AxiosError<{ detail?: string }>) => toast.error(err?.response?.data?.detail || 'Failed to update trip status'),
  })

  const deleteMutation = useMutation({
    mutationFn: () => routesAPI.delete((route as RouteDetail).id),
    onSuccess: () => {
      toast.success('Trip deleted')
      queryClient.invalidateQueries({ queryKey: ['routes'] })
      navigate('/routes')
    },
    onError: (err: AxiosError<{ detail?: string }>) => toast.error(err?.response?.data?.detail || 'Failed to delete trip'),
  })

  const sortedStops = useMemo(
    () => (route?.route_stops ? [...route.route_stops].sort((a, b) => a.sequence - b.sequence) : []),
    [route],
  )

  // Real driving directions when a Mapbox token is configured; otherwise MapView
  // draws a dashed straight line through the stops.
  const [road, setRoad] = useState<DrivingRoute | null>(null)
  const [trafficTick, setTrafficTick] = useState(0)
  const routeActive = route?.status === 'active'
  useEffect(() => {
    if (!routeActive) return
    const timer = window.setInterval(() => setTrafficTick(n => n + 1), TRAFFIC_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [routeActive])
  const roadFor = useRef('')
  useEffect(() => {
    // A refresh keeps the drawn road until the new one arrives; only another route clears it
    if (roadFor.current !== `${route?.id}|${sortedStops.length}`) { roadFor.current = `${route?.id}|${sortedStops.length}`; setRoad(null) }
    if (!route) return
    const vehiclePos: LatLng | null = route.vehicles?.latitude && route.vehicles?.longitude
      ? { lat: route.vehicles.latitude, lng: route.vehicles.longitude } : null
    const stopPositions: LatLng[] = sortedStops.flatMap(s => (
      s.delivery_points?.latitude && s.delivery_points?.longitude
        ? [{ lat: s.delivery_points.latitude, lng: s.delivery_points.longitude }] : []
    ))
    const waypoints = [vehiclePos, ...stopPositions].filter((p): p is LatLng => p !== null)
    if (waypoints.length < 2) return
    let cancelled = false
    fetchDrivingRoute(waypoints)
      .then(result => { if (!cancelled) setRoad(result) })
      .catch(() => { /* MapView falls back to a dashed line */ })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.id, sortedStops.length, trafficTick])

  if (isLoading) return <Page><LoadingState label="Loading trip…" /></Page>
  if (isError || !route) {
    return (
      <Page>
        <ErrorState description="We could not load this trip. Check your connection and try again." onRetry={refetch} />
      </Page>
    )
  }

  const shortId = route.id.slice(0, 8).toUpperCase()
  const isCompleted = route.status === 'completed' || route.status === 'delivered'
  const isCancelled = route.status === 'cancelled'
  // A vendor load has one pickup and one drop: there is nothing to optimize, and it is cancelled, not deleted
  const canRunOptimizer = !route.is_manifest && (route.status === 'active' || route.status === 'pending')
  const canCancel = !isCompleted && !isCancelled
  const canDelete = !route.is_manifest && !UNDELETABLE_STATUSES.has(route.status)
  const completeBlocked = completeBlockedReason(route)

  const distance = getRouteDistance(route)
  const duration = getRouteDuration(route, distance)
  const fuel = getRouteFuel(route, distance)
  const isEstimated = !route.total_distance_km || route.total_distance_km <= 0

  const vehicleName = route.vehicles?.plate_number || (route.vehicle_id ? 'Vehicle not found' : 'Unassigned')
  // The shipment each stop delivers. A vendor load is one shipment, so both of its stops open it.
  const stopShipment = (s: RouteStop): { id: string; code: string } | null =>
    route.is_manifest ? { id: route.id, code: manifestTrackingId(route.id) } : s.shipment ? { id: s.shipment.id, code: s.shipment.tracking_id } : null

  const mapVehicles: MapVehicle[] = route.vehicles?.latitude && route.vehicles?.longitude && route.vehicle_id
    ? [{ id: route.vehicle_id, label: vehicleName, status: route.vehicles.status ?? 'on_route', position: { lat: route.vehicles.latitude, lng: route.vehicles.longitude } }]
    : []

  const mapStops: MapRouteStop[] = sortedStops.flatMap((s, i) => (
    s.delivery_points?.latitude && s.delivery_points?.longitude
      ? [{ id: s.id, sequence: i + 1, status: s.status ?? undefined, label: s.delivery_points.name ?? s.delivery_points.address ?? undefined, position: { lat: s.delivery_points.latitude, lng: s.delivery_points.longitude } }]
      : []
  ))

  const timeline: TimelineEvent[] = [
    { status: 'created', at: route.created_at },
    { status: 'active', at: route.started_at },
    { status: 'completed', at: route.completed_at },
  ].filter((e): e is TimelineEvent => !!e.at)

  const handleCancel = async () => {
    const ok = await confirm({
      title: route.is_manifest ? 'Cancel this load?' : 'Cancel this trip?',
      message: route.is_manifest
        ? "The vendor's request goes back to approved so it can be assigned again, the vehicle gets its capacity back and the driver is told."
        : 'The vehicle and driver will no longer see this trip as active.',
      confirmLabel: route.is_manifest ? 'Cancel load' : 'Cancel trip',
      tone: 'danger',
    })
    if (ok) updateStatusMutation.mutate('cancelled')
  }

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete this trip?',
      message: 'This cannot be undone.',
      confirmLabel: 'Delete trip',
      tone: 'danger',
    })
    if (ok) deleteMutation.mutate()
  }

  // A vendor load is its own trip and its id is the load's id, so its paperwork and its shipment page open from that id.
  // Edit and duplicate exist only for vendor loads; ordinary trips don't offer them.
  const handleEdit = () => navigate(`/shipments/${route.id}/manifest`)
  const handleDuplicate = () => navigate('/return-trips?tab=pool&view=match', { state: { duplicateManifest: route } })

  return (
    <Page>
      <PageHeader
        back={{ to: '/routes', label: 'Back to trips' }}
        title={<span className="inline-flex flex-wrap items-center gap-3">Trip {shortId} <StatusPill status={route.status} kind="route" /></span>}
        description={(
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {route.created_at && <span>Created {formatDistanceToNow(new Date(route.created_at), { addSuffix: true })}</span>}
            {route.vehicle_id && route.vehicles?.plate_number && (
              <Link to={`/fleet/${route.vehicle_id}`} className="font-mono font-medium text-brand hover:underline">{route.vehicles.plate_number}</Link>
            )}
            {route.vehicles?.driver_id && route.vehicles.driver_name && (
              <Link to={`/admin/users/${route.vehicles.driver_id}`} className="font-medium text-brand hover:underline">{route.vehicles.driver_name}</Link>
            )}
          </span>
        )}
        actions={
          <div className="flex flex-wrap gap-2">
            {canDispatchRoute(route) && (
              <Button icon={<Play size={16} />} onClick={() => statusActions.dispatch(route)} loading={statusActions.isPending}>Send to driver</Button>
            )}
            {canCompleteRoute(route) && (
              <Button
                icon={<CheckCircle2 size={16} />}
                onClick={() => statusActions.complete(route)}
                loading={statusActions.isPending}
                disabled={completeBlocked !== null}
                title={completeBlocked ?? undefined}
              >
                Mark completed
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => navigate('/optimize', { state: { routeId: route.id } })}
              disabled={!canRunOptimizer}
              title={route.is_manifest ? 'A vendor load has one pickup and one drop, so there is nothing to optimize.' : undefined}
            >
              Run optimizer
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Distance" value={distance > 0 ? formatKm(distance) : '—'} hint={distance > 0 && isEstimated ? 'Estimated' : undefined} />
        <Stat label="ETA" value={duration > 0 ? formatMinutes(duration) : '—'} hint={duration > 0 && isEstimated ? 'Estimated' : undefined} />
        <Stat label="Fuel" value={fuel > 0 ? `${fuel.toLocaleString('en-IN', { maximumFractionDigits: 1 })} L` : '—'} hint={fuel > 0 && isEstimated ? 'Estimated' : undefined} />
        <Stat label="Vehicle" value={vehicleName} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <Card className="overflow-hidden lg:col-span-7">
          <div className="h-96 lg:h-full">
            <MapView
              mode="route"
              route={{ coordinates: road?.coordinates ?? [], stops: mapStops, planned: !road, congestion: road?.congestion }}
              vehicles={mapVehicles}
              traffic={isStaff ? { flow: true, incidents: true } : undefined}
              ariaLabel="Route map"
            />
          </div>
        </Card>

        <div className="space-y-6 lg:col-span-5">
          <Card padded>
            <h2 className="mb-4 text-lg font-semibold text-text">Stops</h2>
            {sortedStops.length === 0 ? (
              <EmptyState compact title="No stops on this trip" />
            ) : (
              <ol className="space-y-3">
                {sortedStops.map((s, i) => (
                  <li key={s.id} className="flex items-start justify-between gap-3 text-sm">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-xs font-medium text-muted">{i + 1}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-text">{s.delivery_points?.name || s.delivery_points?.address || 'Delivery point'}</span>
                        {stopShipment(s) && (
                          <Link to={`/shipments/${stopShipment(s)!.id}`} className="block truncate font-mono text-xs font-medium text-brand hover:underline">
                            {stopShipment(s)!.code}
                          </Link>
                        )}
                      </span>
                    </div>
                    <StatusPill status={s.status} />
                  </li>
                ))}
              </ol>
            )}
          </Card>

          {routeActive && <RouteLiveEta route={route} />}

          <RouteConditions routeId={route.id} />

          <Card padded className="space-y-4">
            <h2 className="text-lg font-semibold text-text">Details</h2>
            <DetailList columns={2} items={[
              {
                label: 'Vehicle',
                value: route.vehicle_id && route.vehicles?.plate_number
                  ? <Link to={`/fleet/${route.vehicle_id}`} className="font-mono font-medium text-brand hover:underline">{vehicleName}</Link>
                  : vehicleName,
              },
              {
                label: 'Driver',
                value: route.vehicles?.driver_id && route.vehicles.driver_name
                  ? <Link to={`/admin/users/${route.vehicles.driver_id}`} className="font-medium text-brand hover:underline">{route.vehicles.driver_name}</Link>
                  : (route.vehicles?.driver_name || 'Not assigned'),
              },
              { label: 'Created', value: formatDateTime(route.created_at) },
              { label: 'Stops', value: sortedStops.length.toLocaleString('en-IN') },
            ]} />
            {timeline.length > 0 && <Timeline events={timeline} formatAt={formatDateTime} />}
          </Card>

          <Card padded className="space-y-4">
            <h2 className="text-lg font-semibold text-text">Messages</h2>
            <MessagesPanel
              target={{ route_id: route.id }}
              unavailable={route.vehicles?.driver_id ? undefined : 'No driver is assigned to this vehicle, so nobody would see a message.'}
            />
          </Card>

          <Card padded className="space-y-4">
            <h2 className="text-lg font-semibold text-text">Actions</h2>
            <div className="grid grid-cols-2 gap-2">
              {route.is_manifest && (
                <>
                  <Link to={`/shipments/${route.id}`} className={buttonClasses({ variant: 'secondary' })}>
                    <ExternalLink size={16} aria-hidden="true" /> Open shipment
                  </Link>
                  <Button variant="secondary" icon={<Edit2 size={16} />} onClick={handleEdit}>Edit manifest</Button>
                  <Button variant="secondary" icon={<Copy size={16} />} onClick={handleDuplicate}>Duplicate to backhaul</Button>
                </>
              )}
              <Button
                variant="danger"
                icon={<XCircle size={16} />}
                onClick={handleCancel}
                disabled={!canCancel}
                loading={updateStatusMutation.isPending}
              >
                {route.is_manifest ? 'Cancel load' : 'Cancel trip'}
              </Button>
              {canDelete && (
                <Button variant="danger" icon={<Trash2 size={16} />} onClick={handleDelete} loading={deleteMutation.isPending}>
                  Delete
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>
    </Page>
  )
}

/** Live ETA for the vehicle on an active route: where it is now, through the stops it has not done yet. */
function RouteLiveEta({ route }: { route: RouteDetail }) {
  const stops = useMemo(() => remainingStops(route.route_stops), [route.route_stops])
  const lat = route.vehicles?.latitude
  const lng = route.vehicles?.longitude
  const origin: LatLng | null = lat && lng ? { lat, lng } : null
  const eta = useLiveEta({ origin, stops })
  if (stops.length === 0) return null
  return (
    <TripEtaCard
      eta={eta.data}
      loading={eta.isLoading}
      error={!origin ? 'The vehicle has no GPS position yet.' : eta.isError ? 'We could not work out the ETA. It will try again shortly.' : eta.isSuccess ? 'No driving route was found to the remaining stops.' : null}
    />
  )
}
