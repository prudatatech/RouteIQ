import clsx from 'clsx'
import { CheckCircle2, Clock, MapPin, Truck } from 'lucide-react'
import { Card, DetailList } from '@/components/ui/Card'
import { StatusPill } from '@/components/ui/StatusPill'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States'
import { MapView, type MapPoint, type MapVehicle } from '@/components/map'
import { formatEta } from '@/utils/timeFormat'

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
  destination?: TrackedDestination | null
  vehicle?: TrackedVehicle | null
  /** Real ETA computed by the backend from the active route or a distance estimate. */
  eta_minutes?: number | null
}

const STEPS = [
  { key: 'created', label: 'Booked' },
  { key: 'picked_up', label: 'Picked up' },
  { key: 'in_transit', label: 'In transit' },
  { key: 'delivered', label: 'Delivered' },
] as const

function stepIndex(status: string | undefined) {
  if (!status) return -1
  const idx = STEPS.findIndex(s => s.key === status)
  if (idx >= 0) return idx
  // Any other in-progress status (e.g. "assigned", "dispatched") counts as "picked up".
  if (status !== 'cancelled') return 1
  return -1
}

/**
 * One shipment's status timeline, origin/destination, ETA, carrier and live map.
 * Used by the public customer tracker (`/track/:trackingId`) and reusable by vendor
 * tracking. Pure presentation — the caller fetches the data and owns polling.
 */
export function ShipmentTracker({ shipment, isLoading, error, onRetry, className }: {
  shipment: ShipmentTrackingData | null | undefined
  isLoading?: boolean
  /** Message to show when loading failed. */
  error?: string | null
  onRetry?: () => void
  className?: string
}) {
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
          title="No shipment found"
          description="Check the tracking ID and try again."
        />
      </Card>
    )
  }

  const cancelled = shipment.status === 'cancelled'
  const delivered = shipment.status === 'delivered'
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

  return (
    <div className={clsx('space-y-6', className)}>
      <Card padded className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs text-muted">Tracking ID</p>
            <p className="truncate font-mono text-2xl font-semibold text-text">{shipment.tracking_id}</p>
          </div>
          <StatusPill status={shipment.status} />
        </div>

        {cancelled ? (
          <p className="text-sm text-muted">This shipment was cancelled.</p>
        ) : (
          <ol className="flex items-center" aria-label="Delivery status">
            {STEPS.map((step, i) => {
              const isDone = i < currentStepIdx
              const active = i === currentStepIdx
              return (
                <li key={step.key} className="flex flex-1 items-center last:flex-none">
                  <div className="flex w-20 flex-col items-center gap-2 text-center">
                    <span
                      aria-hidden="true"
                      className={clsx(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-medium',
                        isDone || active ? 'border-brand bg-brand text-on-brand' : 'border-border bg-surface text-muted',
                      )}
                    >
                      {isDone || active ? <CheckCircle2 size={14} /> : i + 1}
                    </span>
                    <span className={clsx('text-xs', active || isDone ? 'font-medium text-text' : 'text-muted')}>{step.label}</span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <span aria-hidden="true" className={clsx('mx-1 h-0.5 flex-1', i < currentStepIdx ? 'bg-brand' : 'bg-border')} />
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
            { label: 'Weight', value: shipment.total_weight_kg != null ? `${shipment.total_weight_kg} kg` : '—' },
            { label: 'Items', value: shipment.total_items ?? '—' },
          ]}
        />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <MapView mode="tracking" height={280} vehicles={vehicles} points={points} />
        </Card>

        <div className="space-y-6">
          <Card padded>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-text">Estimated arrival</p>
              <Clock size={16} className="text-brand" aria-hidden="true" />
            </div>
            <p className="mt-2 text-2xl font-semibold text-text">
              {delivered ? 'Delivered' : shipment.eta_minutes != null ? formatEta(shipment.eta_minutes) : '—'}
            </p>
            {!delivered && shipment.eta_minutes == null && (
              <p className="mt-1 text-xs text-muted">No live vehicle assigned yet.</p>
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
    </div>
  )
}
