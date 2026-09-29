import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { CheckCircle2, Clock, MapPin, Truck } from 'lucide-react'
import { Card, DetailList } from '@/components/ui/Card'
import { StatusPill } from '@/components/ui/StatusPill'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States'
import { Timeline } from '@/components/ui/Timeline'
import { MapView, type MapPoint, type MapVehicle } from '@/components/map'
import { fetchDrivingRoute, type DrivingRoute } from '@/components/map/directions'
import { formatKg, formatMinutes, formatDateTime } from '@/utils/display'

/** Vehicle fields the public tracking endpoint returns — no driver identity or phone. */
export interface TrackedVehicle {
  id?: string | null
  plate_number?: string | null
  type?: string | null
  status?: string | null
  lat?: number | null
  lng?: number | null
}

export interface TrackedDestination {
  name?: string | null
  address?: string | null
  lat?: number | null
  lng?: number | null
}

/** Shape of `GET /shipments/track/:trackingId` (see backend-ts `ShipmentService.getPublicTracking`). */
export interface ShipmentTrackingData {
  tracking_id: string
  status: string
  priority?: string | null
  total_items?: number | null
  total_weight_kg?: number | null
  origin_name?: string | null
  origin_address?: string | null
  origin_lat?: number | null
  origin_lng?: number | null
  destination?: TrackedDestination | null
  vehicle?: TrackedVehicle | null
  /** Arrival estimate from the vehicle's position to the next stop (straight line, average speed). */
  eta_minutes?: number | null
  /** Status timeline, public-safe: status and time only, no names. See ShipmentService.getPublicTracking. */
  history?: { status: string; at: string }[] | null
}

type LatLngPoint = { lat: number; lng: number }

/** Where the vehicle is heading next: the pickup for a manifest that is not yet in transit, otherwise the drop. */
function nextStopOf(shipment: ShipmentTrackingData): LatLngPoint | null {
  const toPickup = shipment.tracking_id.startsWith('CM-') && shipment.status !== 'in_transit'
  const origin = shipment.origin_lat != null && shipment.origin_lng != null
    ? { lat: shipment.origin_lat, lng: shipment.origin_lng } : null
  const drop = shipment.destination?.lat != null && shipment.destination?.lng != null
    ? { lat: shipment.destination.lat, lng: shipment.destination.lng } : null
  return toPickup ? origin ?? drop : drop
}

/** Road route (with live traffic) from the vehicle to its next stop; null when unavailable. */
function useRemainingRoute(vehicle: LatLngPoint | null, stop: LatLngPoint | null, enabled: boolean) {
  // ~100 m rounding so each position poll does not trigger a new Directions request.
  const key = vehicle && stop && enabled
    ? [vehicle.lat.toFixed(3), vehicle.lng.toFixed(3), stop.lat.toFixed(5), stop.lng.toFixed(5)].join(',')
    : null
  const [result, setResult] = useState<{ key: string; route: DrivingRoute | null } | null>(null)
  useEffect(() => {
    if (!key) return
    const [vLat, vLng, sLat, sLng] = key.split(',').map(Number)
    const ctrl = new AbortController()
    fetchDrivingRoute([{ lat: vLat, lng: vLng }, { lat: sLat, lng: sLng }], ctrl.signal)
      .then(route => setResult({ key, route }))
      .catch(() => { /* aborted or failed: fall back to the backend estimate */ })
    return () => ctrl.abort()
  }, [key])
  return key && result?.key === key ? result.route : null
}

const STEPS = [
  { key: 'created', label: 'Booked' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'picked_up', label: 'Picked up' },
  { key: 'in_transit', label: 'In transit' },
  { key: 'delivered', label: 'Delivered' },
] as const

function stepIndex(status: string | undefined) {
  if (!status) return -1
  const idx = STEPS.findIndex(s => s.key === status)
  if (idx >= 0) return idx
  // A failed delivery happens with the load already on its way, so it sits at "In transit"
  // (its own message says what happened).
  if (status === 'exception') return STEPS.findIndex(s => s.key === 'in_transit')
  // Any other in-progress status (e.g. "dispatched") is before pickup; only real pickups show as "Picked up".
  if (status !== 'cancelled') return 0
  return -1
}

/**
 * One shipment's status timeline, origin/destination, ETA, carrier and live map.
 * Used by the public customer tracker (`/track/:trackingId`) and reusable by vendor
 * tracking. Pure presentation — the caller fetches the data and owns polling.
 */
export function ShipmentTracker({ shipment, trackingId, isLoading, error, onRetry, className }: {
  /** The ID that was looked up; named in the not-found message. */
  trackingId?: string
  shipment: ShipmentTrackingData | null | undefined
  isLoading?: boolean
  /** Message to show when loading failed. */
  error?: string | null
  onRetry?: () => void
  className?: string
}) {
  const vLat = shipment?.vehicle?.lat
  const vLng = shipment?.vehicle?.lng
  const vehiclePos = vLat != null && vLng != null ? { lat: vLat, lng: vLng } : null
  const nextStop = useMemo(() => (shipment ? nextStopOf(shipment) : null), [shipment])
  const inProgress = !!shipment && shipment.status !== 'delivered' && shipment.status !== 'cancelled'
  const drivingRoute = useRemainingRoute(vehiclePos, nextStop, inProgress)

  if (isLoading) {
    return (
      <div className={clsx('space-y-6', className)}>
        <Card padded className="space-y-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-24 w-full" />
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <Card padded className={className}>
        <ErrorState title="We could not load this shipment" description={error} onRetry={onRetry} />
      </Card>
    )
  }

  if (!shipment) {
    return (
      <Card padded className={className}>
        <EmptyState
          icon={<MapPin size={22} />}
          title={trackingId ? `No shipment found for ${trackingId}` : 'No shipment found'}
          description="Check the tracking ID for typos. You can find it in the message or email you got from the vendor or company that booked it."
        />
      </Card>
    )
  }

  const cancelled = shipment.status === 'cancelled'
  const delivered = shipment.status === 'delivered'
  const failed = shipment.status === 'exception'
  const currentStepIdx = cancelled ? -1 : stepIndex(shipment.status)

  const vehicles: MapVehicle[] = (shipment.vehicle?.lat != null && shipment.vehicle?.lng != null)
    ? [{
      id: shipment.vehicle.id ?? 'vehicle',
      label: shipment.vehicle.plate_number ?? 'Your delivery',
      status: shipment.vehicle.status ?? 'on_route',
      position: { lat: shipment.vehicle.lat, lng: shipment.vehicle.lng },
    }]
    : []
  const points: MapPoint[] = (shipment.destination?.lat != null && shipment.destination?.lng != null)
    ? [{
      id: 'drop',
      kind: 'drop',
      label: `Delivery address: ${shipment.destination.name ?? 'Destination'}`,
      position: { lat: shipment.destination.lat, lng: shipment.destination.lng },
    }]
    : []

  const etaMinutes = drivingRoute ? drivingRoute.durationSeconds / 60 : shipment.eta_minutes
  const route = drivingRoute ? { coordinates: drivingRoute.coordinates } : null

  return (
    <div className={clsx('space-y-6', className)}>
      <Card padded className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs text-muted">Tracking ID</p>
            <p className="truncate font-mono text-2xl font-semibold text-text">{shipment.tracking_id}</p>
          </div>
          <StatusPill status={shipment.status}>{failed ? 'Delivery attempt failed' : undefined}</StatusPill>
        </div>

        {failed && (
          <p role="status" className="text-sm text-danger">
            The delivery attempt failed. The carrier will arrange another attempt, and this page updates when they do.
          </p>
        )}

        {cancelled ? (
          <p className="text-sm text-muted">This shipment was cancelled.</p>
        ) : (
          <ol className="flex items-center" aria-label="Delivery status">
            {STEPS.map((step, i) => {
              const isDone = i < currentStepIdx
              const active = i === currentStepIdx
              return (
                <li key={step.key} className="flex min-w-0 flex-1 items-center last:flex-none">
                  <div className="flex w-14 shrink-0 flex-col items-center gap-2 text-center sm:w-20">
                    <span
                      aria-hidden="true"
                      className={clsx(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-medium',
                        isDone || active ? 'border-brand-fill bg-brand-fill text-on-brand' : 'border-border bg-surface text-muted',
                      )}
                    >
                      {isDone || active ? <CheckCircle2 size={14} /> : i + 1}
                    </span>
                    <span className={clsx('text-xs', active || isDone ? 'font-medium text-text' : 'text-muted')}>{step.label}</span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <span aria-hidden="true" className={clsx('mx-1 h-0.5 min-w-2 flex-1', i < currentStepIdx ? 'bg-brand-fill' : 'bg-border')} />
                  )}
                </li>
              )
            })}
          </ol>
        )}

        <DetailList
          columns={2}
          items={[
            { label: 'Origin', value: shipment.origin_name || shipment.origin_address || '—' },
            { label: 'Destination', value: shipment.destination?.name || shipment.destination?.address || '—' },
            { label: 'Priority', value: shipment.priority ? shipment.priority.charAt(0).toUpperCase() + shipment.priority.slice(1) : '—' },
            { label: 'Weight', value: formatKg(shipment.total_weight_kg) },
            { label: 'Items', value: shipment.total_items != null ? shipment.total_items.toLocaleString('en-IN') : '—' },
          ]}
        />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <MapView mode="tracking" height={280} vehicles={vehicles} points={points} route={route} />
        </Card>

        <div className="space-y-6">
          <Card padded>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-text">Time to arrival</p>
              <Clock size={16} className="text-brand" aria-hidden="true" />
            </div>
            <p className="mt-2 text-2xl font-semibold text-text">
              {delivered ? 'Delivered' : cancelled ? 'Cancelled' : failed ? 'Delivery attempt failed' : etaMinutes != null ? (etaMinutes < 1 ? 'Arriving now' : formatMinutes(etaMinutes)) : '—'}
            </p>
            {!delivered && !cancelled && !failed && etaMinutes == null && (
              <p className="mt-1 text-xs text-muted">Shown once a vehicle is on its way and sharing its location.</p>
            )}
            {!delivered && !cancelled && !failed && etaMinutes != null && (
              <p className="mt-1 text-xs text-muted">An estimate from the vehicle's position now. Traffic and stops can change it.</p>
            )}
          </Card>

          <Card padded>
            <p className="text-sm font-medium text-text">Carrier</p>
            <div className="mt-3 flex items-center gap-3 rounded-control border border-border bg-surface-subtle p-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-surface text-brand">
                <Truck size={18} aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-text">{shipment.vehicle?.plate_number || 'Not yet assigned'}</p>
                {shipment.vehicle && (
                  <p className="text-xs text-muted">
                    {shipment.vehicle.type || 'Vehicle'} · <StatusPill status={shipment.vehicle.status} dot={false} className="ml-0.5 align-middle" />
                  </p>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>

      {shipment.history && shipment.history.length > 0 && (
        <Card padded>
          <p className="mb-4 text-sm font-medium text-text">Status history</p>
          <Timeline
            events={shipment.history.map(e => (e.status === 'exception' ? { ...e, note: 'Delivery attempt failed' } : e))}
            formatAt={formatDateTime}
          />
        </Card>
      )}
    </div>
  )
}
