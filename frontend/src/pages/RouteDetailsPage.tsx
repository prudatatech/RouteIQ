import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { CheckCircle2, Copy, Edit2, Play, Trash2, XCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import type { AxiosError } from 'axios'
import { routesAPI } from '@/services/api'
import { Page, PageHeader, Card, Button, StatusPill, Stat, DetailList, Timeline, type TimelineEvent, EmptyState, LoadingState, ErrorState, useConfirm } from '@/components/ui'
import { MapView, fetchDrivingRoute, type DrivingRoute, type LatLng, type MapRouteStop, type MapVehicle } from '@/components/map'
import { getRouteDistance, getRouteDuration, getRouteFuel, type RouteLike } from '@/utils/routeHelpers'
import { canCompleteRoute, canDispatchRoute, useRouteStatusActions } from '@/hooks/useRouteStatusActions'
import { formatDateTime } from '@/utils/display'
import { formatEta } from '@/utils/timeFormat'
import MessagesPanel from '@/components/messages/MessagesPanel'

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
  delivery_point_id?: string | null
  delivery_points?: DeliveryPoint | null
}

/** Mirrors the backend rule in routes.routes.ts DELETE /:route_id: once a route
 * has started, deleting it would erase real movement history. Cancel it instead. */
const UNDELETABLE_STATUSES = new Set(['active', 'in_progress', 'completed'])

interface RouteDetail extends RouteLike {
  id: string
  status: string
  vehicle_id?: string | null
  created_at?: string | null
  started_at?: string | null
  completed_at?: string | null
  is_manifest?: boolean
  optimization_score?: number | null
  vehicles?: (DeliveryPoint & { plate_number?: string | null; status?: string | null; driver_id?: string | null; driver_name?: string | null }) | null
  route_stops?: RouteStop[] | null
}

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
  })

  const updateStatusMutation = useMutation({
    mutationFn: (status: string) => routesAPI.updateStatus((route as RouteDetail).id, status),
    onSuccess: () => {
      toast.success('Route status updated')
      queryClient.invalidateQueries({ queryKey: ['route', id] })
    },
    onError: (err: AxiosError<{ detail?: string }>) => toast.error(err?.response?.data?.detail || 'Failed to update route status'),
  })

  const deleteMutation = useMutation({
    mutationFn: () => routesAPI.delete((route as RouteDetail).id),
    onSuccess: () => {
      toast.success('Route deleted')
      navigate('/routes')
    },
    onError: (err: AxiosError<{ detail?: string }>) => toast.error(err?.response?.data?.detail || 'Failed to delete route'),
  })

  const sortedStops = useMemo(
    () => (route?.route_stops ? [...route.route_stops].sort((a, b) => a.sequence - b.sequence) : []),
    [route],
  )

  // Real driving directions when a Mapbox token is configured; otherwise MapView
  // draws a dashed straight line through the stops.
  const [road, setRoad] = useState<DrivingRoute | null>(null)
  useEffect(() => {
    setRoad(null)
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
  }, [route?.id, sortedStops.length])

  if (isLoading) return <Page><LoadingState label="Loading route…" /></Page>
  if (isError || !route) {
    return (
      <Page>
        <ErrorState description="We could not load this route. Check your connection and try again." onRetry={refetch} />
      </Page>
    )
  }

  const shortId = route.id.slice(0, 8).toUpperCase()
  const isCompleted = route.status === 'completed' || route.status === 'delivered'
  const isCancelled = route.status === 'cancelled'
  const canRunOptimizer = route.status === 'active' || route.status === 'pending' || route.status === 'on_route' || route.status === 'in_progress'
  const canCancel = !isCompleted && !isCancelled
  const canDelete = !UNDELETABLE_STATUSES.has(route.status)

  const distance = getRouteDistance(route)
  const duration = getRouteDuration(route, distance)
  const fuel = getRouteFuel(route, distance)
  const isEstimated = !route.total_distance_km || route.total_distance_km <= 0

  const vehicleName = route.vehicles?.plate_number || (route.vehicle_id ? route.vehicle_id.slice(0, 8) : 'Unassigned')

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
    { status: 'in_progress', at: route.started_at },
    { status: 'completed', at: route.completed_at },
  ].filter((e): e is TimelineEvent => !!e.at)

  const handleCancel = async () => {
    const ok = await confirm({
      title: 'Cancel this route?',
      message: 'The vehicle and driver will no longer see this route as active.',
      confirmLabel: 'Cancel route',
      tone: 'danger',
    })
    if (ok) updateStatusMutation.mutate('cancelled')
  }

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete this route?',
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      tone: 'danger',
    })
    if (ok) deleteMutation.mutate()
  }

  // Edit and duplicate exist only for cargo manifests; standard routes don't offer them.
  const handleEdit = () => navigate(`/shipments/${route.id}/manifest`)
  const handleDuplicate = () => navigate('/backhaul', { state: { duplicateManifest: route } })

  return (
    <Page>
      <PageHeader
        back={{ to: '/routes', label: 'Back to routes' }}
        title={<span className="inline-flex flex-wrap items-center gap-3">Route {shortId} <StatusPill status={route.status} /></span>}
        description={route.created_at ? `Created ${formatDistanceToNow(new Date(route.created_at), { addSuffix: true })}` : undefined}
        actions={
          <div className="flex flex-wrap gap-2">
            {canDispatchRoute(route) && (
              <Button icon={<Play size={16} />} onClick={() => statusActions.dispatch(route)} loading={statusActions.isPending}>Dispatch</Button>
            )}
            {canCompleteRoute(route) && (
              <Button icon={<CheckCircle2 size={16} />} onClick={() => statusActions.complete(route)} loading={statusActions.isPending}>Mark completed</Button>
            )}
            <Button
              variant="secondary"
              onClick={() => navigate('/optimize', { state: { routeId: route.id } })}
              disabled={!canRunOptimizer}
            >
              Run optimizer
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Distance" value={distance > 0 ? `${distance.toLocaleString('en-IN', { maximumFractionDigits: 1 })} km` : '—'} hint={distance > 0 && isEstimated ? 'Estimated' : undefined} />
        <Stat label="ETA" value={duration > 0 ? formatEta(duration) : '—'} hint={duration > 0 && isEstimated ? 'Estimated' : undefined} />
        <Stat label="Fuel" value={fuel > 0 ? `${fuel.toLocaleString('en-IN', { maximumFractionDigits: 1 })} L` : '—'} hint={fuel > 0 && isEstimated ? 'Estimated' : undefined} />
        <Stat label="Vehicle" value={vehicleName} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <Card className="overflow-hidden lg:col-span-7">
          <div className="h-96 lg:h-full">
            <MapView
              mode="route"
              route={{ coordinates: road?.coordinates ?? [], stops: mapStops, planned: !road }}
              vehicles={mapVehicles}
              ariaLabel="Route map"
            />
          </div>
        </Card>

        <div className="space-y-6 lg:col-span-5">
          <Card padded>
            <h2 className="mb-4 text-lg font-semibold text-text">Stops</h2>
            {sortedStops.length === 0 ? (
              <EmptyState compact title="No stops on this route" />
            ) : (
              <ol className="space-y-3">
                {sortedStops.map((s, i) => (
                  <li key={s.id} className="flex items-start justify-between gap-3 text-sm">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-xs font-medium text-muted">{i + 1}</span>
                      <span className="min-w-0 truncate text-text">{s.delivery_points?.name || s.delivery_points?.address || 'Delivery point'}</span>
                    </div>
                    <StatusPill status={s.status} />
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card padded className="space-y-4">
            <h2 className="text-lg font-semibold text-text">Details</h2>
            <DetailList columns={2} items={[
              { label: 'Vehicle', value: vehicleName },
              { label: 'Driver', value: route.vehicles?.driver_name || 'Not assigned' },
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
                  <Button variant="secondary" icon={<Edit2 size={16} />} onClick={handleEdit}>Edit</Button>
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
                Cancel route
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
