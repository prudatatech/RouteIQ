import { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, MapPin } from 'lucide-react'
import { publicAPI } from '@/services/api'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { Spinner } from '@/components/ui/Spinner'
import { StatusPill } from '@/components/ui/StatusPill'
import { MapView, type MapTrail, type MapVehicle } from '@/components/map'
import { usePlaceName } from '@/components/fleet/location/useVehicleLocation'
import {
  ACTIVITY_LABEL, ACTIVITY_TONE, googleMapsUrl, hasPosition, headingText, speedText,
  type ActivityState,
} from '@/components/fleet/location/format'
import { formatDateTime, formatRelative } from '@/utils/display'

interface SharedVehicle {
  plate_number: string
  expires_at: string
  live: boolean
  state: ActivityState
  latitude: number | null
  longitude: number | null
  speed_kmph: number | null
  heading: number | null
  last_seen_at: string | null
  trail: { lat: number; lng: number; at: string }[]
}

/**
 * Public, read-only live location of one vehicle, opened from a link staff share
 * (Share live location on the fleet page). No sign-in: the link's token is the credential,
 * and it stops working when it expires or is closed.
 */
export default function VehicleSharePage() {
  const { token } = useParams<{ token: string }>()
  const query = useQuery<SharedVehicle>({
    queryKey: ['vehicle-share', token],
    queryFn: () => publicAPI.vehicleShare(token!) as Promise<SharedVehicle>,
    enabled: !!token,
    retry: false,
    // Keep looking while the link works; a closed link stops the polling on its own
    refetchInterval: q => (q.state.status === 'error' ? false : 10_000),
  })
  const data = query.data
  const positioned = !!data && hasPosition(data.latitude, data.longitude)
  const place = usePlaceName(data?.latitude, data?.longitude)

  const vehicles = useMemo<MapVehicle[]>(() => (data && positioned
    ? [{ id: 'shared', position: { lat: data.latitude!, lng: data.longitude! }, status: data.live ? 'on_route' : 'offline', label: data.plate_number, heading: data.heading }]
    : []), [data, positioned])
  const trails = useMemo<MapTrail[]>(() => (data && data.trail.length > 1
    ? [{ id: 'shared', coordinates: data.trail.map(p => [p.lng, p.lat] as [number, number]) }]
    : []), [data])

  const status = (query.error as { response?: { status?: number } } | null)?.response?.status
  const closed = status === 404

  return (
    <div className="flex min-h-screen flex-col items-center bg-bg px-4 py-8 text-text">
      <div className="w-full max-w-xl space-y-4">
        <div className="text-center">
          <p className="text-xs font-medium uppercase text-brand">MargixIndia</p>
          <h1 className="mt-1 text-2xl font-semibold text-text">Live vehicle location</h1>
        </div>

        {query.isLoading && (
          <Card padded className="flex flex-col items-center gap-3 py-10">
            <Spinner size={28} label="Loading location" />
          </Card>
        )}

        {query.isError && (
          <Card padded>
            <ErrorState
              title={closed ? 'This link has expired or was closed' : 'We could not load the location'}
              description={closed ? 'Ask the person who sent it for a new link.' : 'Check your internet connection and try again.'}
              onRetry={closed ? undefined : () => query.refetch()}
            />
          </Card>
        )}

        {data && (
          <>
            <Card padded className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-lg font-semibold text-text">{data.plate_number}</p>
                <StatusPill tone={ACTIVITY_TONE[data.state]}>{ACTIVITY_LABEL[data.state]}</StatusPill>
              </div>
              {positioned ? (
                <>
                  <div className="h-72 overflow-hidden rounded-card border border-border">
                    <MapView
                      mode="tracking"
                      height="100%"
                      vehicles={vehicles}
                      trails={trails}
                      selectedId="shared"
                      ariaLabel={`Map showing ${data.plate_number}`}
                    />
                  </div>
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                    <div>
                      <dt className="text-muted">Place</dt>
                      <dd className="text-text">{place.name ?? (place.loading ? 'Looking up…' : 'Not available')}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">Last update</dt>
                      <dd className="text-text">{data.last_seen_at ? formatRelative(data.last_seen_at) : 'Never'}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">Speed</dt>
                      <dd className="text-text">{speedText(data.speed_kmph)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">Heading</dt>
                      <dd className="text-text">{headingText(data.heading)}</dd>
                    </div>
                  </dl>
                  {!data.live && (
                    <p className="text-sm text-muted">This vehicle has not reported its position for a while. The map shows where it was last seen.</p>
                  )}
                  <a
                    href={googleMapsUrl(data.latitude!, data.longitude!)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
                  >
                    <ExternalLink size={14} aria-hidden="true" />
                    Open in Google Maps
                  </a>
                </>
              ) : (
                <EmptyState
                  compact
                  icon={<MapPin size={22} />}
                  title="No Signal"
                  description={`GPS data unavailable for ${data.plate_number}.`}
                />
              )}
            </Card>
            <p className="text-center text-xs text-muted">This link works until {formatDateTime(data.expires_at)}.</p>
          </>
        )}
      </div>
    </div>
  )
}
