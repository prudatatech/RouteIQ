import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Smartphone } from 'lucide-react'
import toast from 'react-hot-toast'
import { shipmentsAPI, telemetryAPI } from '@/services/api'
import LiveMap, { type LiveMapStop, type LiveMapVehicle } from './LiveMap'
import { formatMinutes } from '@/utils/display'
import { remainingStops } from './tripStops'
import { useLiveEta } from './useLiveEta'

interface PublicTracking {
  tracking_id?: string
  status?: string
  eta_minutes?: number | null
  origin_lat?: number | null
  origin_lng?: number | null
  destination?: { lat?: number | null; lng?: number | null } | null
  vehicle?: {
    plate_number?: string
    status?: string
    lat?: number | null
    lng?: number | null
    type?: string
  } | null
}

/** The next place the vehicle is heading to: pickup before collection, drop while in transit. */
function nextStop(track: PublicTracking): LiveMapStop[] | undefined {
  if (!track.tracking_id?.startsWith('CM-')) return undefined
  const beforePickup = track.status === 'created' || track.status === 'assigned' || track.status === 'scheduled'
  const target = beforePickup
    ? { latitude: track.origin_lat, longitude: track.origin_lng }
    : track.status === 'in_transit'
      ? { latitude: track.destination?.lat, longitude: track.destination?.lng }
      : null
  return target ? [{ status: 'pending', sequence: 1, delivery_points: target }] : undefined
}

/** Tracking map for one shipment, shown inside a shipment row. */
export default function InlineTrackingMap({ trackingId, vehicleId, allVehicles = [] }: { trackingId: string, /** The shipment's own vehicle (the public tracking answer carries no internal ids). */ vehicleId?: string | null, allVehicles?: LiveMapVehicle[] }) {
  const { data: trackInfo, isLoading, isError } = useQuery({
    queryKey: ['trackPublicly', trackingId],
    queryFn: () => shipmentsAPI.trackPublicly(trackingId) as Promise<PublicTracking>,
    refetchInterval: 10000,
  })

  const [isCalling, setIsCalling] = useState(false)

  // Live ETA with traffic from where the vehicle is now to its next stop (pickup or drop)
  const target = trackInfo ? nextStop(trackInfo) : undefined
  const vLat = trackInfo?.vehicle?.lat
  const vLng = trackInfo?.vehicle?.lng
  const liveEta = useLiveEta({
    origin: vLat != null && vLng != null ? { lat: Number(vLat), lng: Number(vLng) } : null,
    stops: remainingStops(target),
    enabled: !!target,
  })
  const eta = liveEta.data

  if (isLoading) {
    return (
      <div role="status" className="flex h-64 items-center justify-center gap-2 text-sm text-muted">
        <Loader2 size={16} className="animate-spin" aria-hidden /> Loading tracking…
      </div>
    )
  }

  if (isError) {
    return <div className="flex h-64 items-center justify-center rounded-card bg-surface-subtle text-sm text-muted">Tracking could not be loaded. Try again in a moment.</div>
  }

  const vehicle = trackInfo?.vehicle
  if (!trackInfo || !vehicle) {
    return <div className="flex h-64 items-center justify-center rounded-card bg-surface-subtle text-sm text-muted">No driver assigned yet.</div>
  }
  // The public answer gives a position only while the goods are on the road
  if (vehicle.lat == null || vehicle.lng == null) {
    return <div className="flex h-64 items-center justify-center rounded-card bg-surface-subtle text-sm text-muted">The live position shows once the goods are out for delivery or in transit.</div>
  }

  const activeVehicle: LiveMapVehicle = {
    id: vehicleId ?? vehicle.plate_number ?? 'vehicle',
    plate_number: vehicle.plate_number ?? 'Vehicle',
    status: vehicle.status ?? 'on_route',
    latitude: vehicle.lat,
    longitude: vehicle.lng,
    vehicle_type: vehicle.type,
  }

  // Use the fleet list when it already has this vehicle, otherwise just this one.
  const mapVehicles = allVehicles.some(v => v.id === activeVehicle.id) ? allVehicles : [activeVehicle]

  const handleCallDriver = async () => {
    if (!vehicleId) return
    try {
      setIsCalling(true)
      await telemetryAPI.callDriver(vehicleId)
      toast.success('Calling the driver app')
    } catch (e: unknown) {
      toast.error(`Could not call the driver: ${e instanceof Error ? e.message : 'unknown error'}`)
    } finally {
      setIsCalling(false)
    }
  }

  return (
    <div className="relative mt-4 h-80 w-full overflow-hidden rounded-card border border-border bg-surface">
      <LiveMap
        vehicles={mapVehicles}
        selectedVehicleId={activeVehicle.id}
        customPendingStops={nextStop(trackInfo)}
        mode="tracking"
        compact
      />
      <div className="absolute left-3 top-3 z-10 flex items-center gap-4 rounded-control border border-border bg-surface px-3 py-2 shadow-raised">
        <div>
          <div className="text-xs text-muted">Arrives in</div>
          <div className="text-sm font-medium text-text">
            {eta ? formatMinutes(eta.etaSeconds / 60) : trackInfo.eta_minutes ? formatMinutes(trackInfo.eta_minutes) : 'Not available yet'}
          </div>
          {eta && eta.trafficDelaySeconds > 0 && (
            <div className="text-xs text-danger">Traffic adds {formatMinutes(eta.trafficDelaySeconds / 60)}</div>
          )}
          {eta && eta.trafficDelaySeconds === 0 && eta.freeFlowSeconds !== null && (
            <div className="text-xs text-muted">No traffic delay</div>
          )}
        </div>
        {vehicleId && <button
          type="button"
          onClick={handleCallDriver}
          disabled={isCalling}
          className="flex h-control items-center gap-2 rounded-control border border-border bg-surface px-3 text-sm font-medium text-text hover:bg-surface-subtle disabled:opacity-50"
        >
          {isCalling ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Smartphone size={14} aria-hidden />}
          {isCalling ? 'Calling…' : 'Call driver'}
        </button>}
      </div>
    </div>
  )
}
