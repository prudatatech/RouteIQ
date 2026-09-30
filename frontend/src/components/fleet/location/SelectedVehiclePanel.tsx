import { ArrowLeft, Crosshair, MapPin } from 'lucide-react'
import { Button, EmptyState, ErrorState, IconButton, Skeleton, StatusPill } from '@/components/ui'
import { VehicleTripEta } from '@/components/map'
import ActivitySummary from './ActivitySummary'
import GpsReadout from './GpsReadout'
import ShareLocationButton from './ShareLocationButton'
import { hasPosition } from './format'
import { useVehicleActivity, useVehicleLocation, usePlaceName } from './useVehicleLocation'

/**
 * The live map's panel for the selected vehicle: GPS data (coordinates, place, speed, heading,
 * accuracy, last seen), what it is doing (carrying a load, idle, offline) and a share link.
 */
export default function SelectedVehiclePanel({ vehicleId, plate, onBack, onZoom }: {
  vehicleId: string
  /** Shown while the data loads. */
  plate?: string
  onBack: () => void
  /** Fly the map to the vehicle again. */
  onZoom?: () => void
}) {
  const location = useVehicleLocation(vehicleId)
  const activity = useVehicleActivity(vehicleId)
  const data = location.data
  const positioned = !!data && hasPosition(data.latitude, data.longitude)
  const place = usePlaceName(data?.latitude, data?.longitude, data?.place_name)
  const name = data?.plate_number ?? plate ?? 'Vehicle'

  return (
    <section aria-label={`${name} on the map`} className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border p-3">
        <IconButton label="Back to all vehicles" icon={<ArrowLeft size={18} />} size="sm" onClick={onBack} />
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-text">{name}</h2>
        {data && <StatusPill status={data.status} />}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {location.isLoading ? (
          <>
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-16 w-full" />
          </>
        ) : location.isError || !data ? (
          <ErrorState compact title="We could not load this vehicle" description="It may have been removed, or the connection dropped." onRetry={() => { location.refetch(); activity.refetch() }} />
        ) : (
          <>
            {positioned ? (
              <GpsReadout location={data} place={place.name} placeLoading={place.loading} />
            ) : (
              <EmptyState
                compact
                icon={<MapPin size={22} />}
                title="No Signal"
                description={`GPS data unavailable for ${data.plate_number}. Ensure the vehicle has an active GPS device linked.`}
              />
            )}

            {activity.data
              ? <ActivitySummary activity={activity.data} />
              : activity.isLoading
                ? <Skeleton className="h-10 w-full" />
                : <p className="text-sm text-muted">We could not work out what this vehicle is doing right now.</p>}

            <VehicleTripEta vehicleId={vehicleId} position={positioned ? { lat: data.latitude!, lng: data.longitude! } : null} />

            <div className="flex flex-wrap gap-2">
              {positioned && onZoom && <Button variant="secondary" icon={<Crosshair size={16} />} onClick={onZoom}>Zoom to vehicle</Button>}
              <ShareLocationButton vehicleId={vehicleId} plate={data.plate_number} disabled={!positioned} />
            </div>
          </>
        )}
      </div>
    </section>
  )
}
