import { useQuery } from '@tanstack/react-query'
import { Truck } from 'lucide-react'
import { shipmentsAPI } from '@/services/api'
import { MapView, type MapPoint, type MapVehicle } from '@/components/map'
import { Card, EmptyState, Skeleton, StatusPill } from '@/components/ui'

interface TrackedShipment {
  tracking_id: string
  status: string
  priority?: string | null
  total_weight_kg?: number | null
  total_items?: number | null
  eta_minutes?: number | null
  origin_name?: string | null
  origin_address?: string | null
  destination?: { name?: string | null; address?: string | null; lat?: number | null; lng?: number | null } | null
  vehicle?: { plate_number?: string | null; type?: string | null; status?: string | null; lat?: number | null; lng?: number | null } | null
}

/**
 * One shipment's live position and status, self-contained (data fetch, map and
 * summary in one card) so it can be dropped into "My shipments" or the tracking page.
 */
export default function VendorTrackerCard({ trackingId }: { trackingId: string }) {
  const { data: shipment, isLoading, isError } = useQuery<TrackedShipment>({
    queryKey: ['vendorTrack', trackingId],
    queryFn: () => shipmentsAPI.trackPublicly(trackingId),
    enabled: !!trackingId,
    refetchInterval: query => {
      const status = (query.state.data as TrackedShipment | undefined)?.status
      return status && ['delivered', 'cancelled'].includes(status) ? false : 5000
    },
  })

  if (isLoading) {
    return (
      <Card padded className="space-y-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-48 w-full" />
      </Card>
    )
  }

  if (isError || !shipment) {
    return (
      <Card padded>
        <EmptyState compact title="Shipment not found" description={`We could not find a shipment with tracking ID ${trackingId}.`} />
      </Card>
    )
  }

  const vehicle: MapVehicle[] = shipment.vehicle?.lat != null && shipment.vehicle?.lng != null
    ? [{
      id: 'vehicle',
      label: shipment.vehicle.plate_number || 'Vehicle',
      status: shipment.vehicle.status ?? 'on_route',
      position: { lat: shipment.vehicle.lat, lng: shipment.vehicle.lng },
    }]
    : []
  const points: MapPoint[] = shipment.destination?.lat != null && shipment.destination?.lng != null
    ? [{ id: 'drop', kind: 'drop', label: `Delivery: ${shipment.destination.name ?? 'destination'}`, position: { lat: shipment.destination.lat, lng: shipment.destination.lng } }]
    : []

  return (
    <Card padded className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs text-muted">Tracking ID</p>
          <p className="font-mono text-lg font-semibold text-text">{shipment.tracking_id}</p>
        </div>
        <StatusPill status={shipment.status} />
      </div>

      <div className="overflow-hidden rounded-card border border-border">
        <MapView mode="tracking" height={240} vehicles={vehicle} points={points} />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <p className="text-xs text-muted">Origin</p>
          <p className="text-sm text-text">{shipment.origin_address || shipment.origin_name || '—'}</p>
        </div>
        <div>
          <p className="text-xs text-muted">Destination</p>
          <p className="text-sm text-text">{shipment.destination?.address || shipment.destination?.name || '—'}</p>
        </div>
        <div>
          <p className="text-xs text-muted">Weight</p>
          <p className="text-sm text-text">{shipment.total_weight_kg != null ? `${Number(shipment.total_weight_kg).toLocaleString('en-IN')} kg` : '—'}</p>
        </div>
        <div>
          <p className="text-xs text-muted">ETA</p>
          <p className="text-sm text-text">{shipment.eta_minutes != null ? `${Math.ceil(shipment.eta_minutes / 60)} h` : '—'}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-control border border-border px-3 py-2 text-sm text-text">
        <Truck size={16} className="text-muted" />
        {shipment.vehicle?.plate_number || 'Vehicle not yet assigned'}
        {shipment.vehicle?.type && <span className="text-muted">· {shipment.vehicle.type}</span>}
      </div>
    </Card>
  )
}
