import { useMemo } from 'react'
import { MapPin } from 'lucide-react'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui'
import { MapView, type MapTrail, type MapVehicle } from '@/components/map'
import { formatKm, formatTime } from '@/utils/display'
import ActivitySummary from './ActivitySummary'
import GpsReadout from './GpsReadout'
import ShareLocationButton from './ShareLocationButton'
import { hasPosition, speedText, trackCoordinates } from './format'
import { useVehicleActivity, useVehicleLocation, usePlaceName, useVehicleTrack } from './useVehicleLocation'

/** How far back the trail on the mini map goes. */
const TRAIL_HOURS = 6
/** Recent points listed under the map. */
const RECENT_POINTS = 5

/**
 * Where one vehicle is and what it is doing: a mini map with its recent trail, the place name,
 * coordinates, speed, heading, accuracy and last seen, whether it is carrying a load, idle or
 * offline, and a link to share its live position. Fetches its own data and refreshes it.
 * With no position it says so ("No Signal") instead of showing an empty map.
 */
export function VehicleLocationPanel({ vehicleId }: { vehicleId: string }) {
  const location = useVehicleLocation(vehicleId)
  const activity = useVehicleActivity(vehicleId)
  const track = useVehicleTrack(vehicleId, TRAIL_HOURS)

  const data = location.data
  const positioned = !!data && hasPosition(data.latitude, data.longitude)
  const place = usePlaceName(data?.latitude, data?.longitude, data?.place_name)

  const vehicles = useMemo<MapVehicle[]>(() => (data && positioned
    ? [{
        id: data.vehicle_id,
        position: { lat: data.latitude!, lng: data.longitude! },
        status: data.status,
        label: data.plate_number,
        heading: data.heading,
      }]
    : []), [data, positioned])
  const trails = useMemo<MapTrail[]>(() => {
    const coordinates = trackCoordinates(track.data)
    return coordinates.length > 1 ? [{ id: vehicleId, coordinates }] : []
  }, [track.data, vehicleId])

  if (location.isLoading) {
    return (
      <section aria-label="GPS location" className="space-y-3">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-16 w-full" />
      </section>
    )
  }
  if (location.isError || !data) {
    return (
      <section aria-label="GPS location">
        <ErrorState compact title="We could not load the GPS location" description="Check your connection and try again." onRetry={() => { location.refetch(); activity.refetch() }} />
      </section>
    )
  }

  const recent = (track.data?.points ?? []).slice(-RECENT_POINTS).reverse()

  return (
    <section aria-label="GPS location" className="space-y-4">
      <h3 className="text-sm font-semibold text-text">GPS location</h3>

      {positioned ? (
        <>
          <div className="h-48 overflow-hidden rounded-card border border-border">
            <MapView
              mode="tracking"
              fitTo="content"
              follow={false}
              vehicles={vehicles}
              trails={trails}
              selectedId={data.vehicle_id}
              interactive={false}
              height="100%"
              fitPadding={32}
              ariaLabel={`Map showing ${data.plate_number} and where it has been in the last ${TRAIL_HOURS} hours`}
            />
          </div>
          <GpsReadout location={data} place={place.name} placeLoading={place.loading} />
        </>
      ) : (
        <EmptyState
          compact
          icon={<MapPin size={22} />}
          title="No Signal"
          description={`GPS data unavailable for ${data.plate_number}. Ensure the vehicle has an active GPS device linked.`}
          action={(
            <span className="inline-block rounded-control bg-neutral-soft px-3 py-2 text-xs text-muted">
              {data.gps_device ? <>GPS device: <span className="font-mono font-medium text-text">{data.gps_device}</span></> : 'No GPS device linked to this vehicle'}
            </span>
          )}
        />
      )}

      {activity.data ? (
        <ActivitySummary activity={activity.data} />
      ) : activity.isLoading ? (
        <Skeleton className="h-10 w-full" />
      ) : (
        <p className="text-sm text-muted">We could not work out what this vehicle is doing right now.</p>
      )}

      {positioned && (
        <div>
          <p className="text-sm font-medium text-text">Recent trail</p>
          {track.isLoading ? (
            <Skeleton className="mt-1 h-10 w-full" />
          ) : track.isError ? (
            <p className="mt-1 text-sm text-muted">We could not load the trail.</p>
          ) : recent.length === 0 ? (
            <p className="mt-1 text-sm text-muted">No positions recorded in the last {TRAIL_HOURS} hours.</p>
          ) : (
            <>
              <p className="mt-1 text-xs text-muted">
                Last {TRAIL_HOURS} hours: {track.data!.count.toLocaleString('en-IN')} {track.data!.count === 1 ? 'position' : 'positions'}, {formatKm(track.data!.distance_km)} driven
              </p>
              <ul className="mt-2 divide-y divide-border rounded-control border border-border text-sm">
                {recent.map(point => (
                  <li key={point.at} className="flex items-center justify-between gap-3 px-3 py-1.5">
                    <span className="text-text">{formatTime(point.at, { seconds: true })}</span>
                    <span className="font-mono text-xs text-muted">{point.lat.toFixed(5)}, {point.lng.toFixed(5)}</span>
                    <span className="text-xs text-muted">{point.speed_kmph != null ? speedText(point.speed_kmph) : ''}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <ShareLocationButton vehicleId={vehicleId} plate={data.plate_number} disabled={!positioned} />
    </section>
  )
}

export default VehicleLocationPanel
