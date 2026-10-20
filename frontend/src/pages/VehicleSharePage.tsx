import { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, MapPin } from 'lucide-react'
import { publicAPI } from '@/services/api'
import { Card, DetailList } from '@/components/ui/Card'
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
    <main className="flex min-h-screen flex-col items-center bg-bg px-4 py-8 text-text selection:bg-brand-soft selection:text-brand">
      <div className="w-full max-w-xl space-y-5">
        <div className="text-center space-y-1.5">
          <div className="inline-flex items-center gap-2 rounded-full border border-brand/20 bg-brand-soft px-3 py-0.5 text-xs font-bold uppercase tracking-wider text-brand shadow-xs">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
            </span>
            MargixIndia Live Fleet Radar
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-text">Vehicle Location Tracker</h1>
          <p className="text-xs text-muted max-w-sm mx-auto">
            Direct highway telemetry feed authorized for recipient viewing.
          </p>
        </div>

        {query.isLoading && (
          <Card padded className="flex flex-col items-center gap-3 py-12 rounded-3xl border border-border shadow-raised">
            <Spinner size={32} label="Acquiring satellite telemetry" />
            <p className="text-xs text-muted font-medium">Resolving vehicle GPS fix…</p>
          </Card>
        )}

        {query.isError && (
          <Card padded className="rounded-3xl border border-border shadow-raised">
            <ErrorState
              title={closed ? 'This link has expired or was revoked' : 'We could not connect to telemetry feed'}
              description={closed ? 'Ask your dispatch team for an active live vehicle share link.' : 'Check your internet connection and retry.'}
              onRetry={closed ? undefined : () => query.refetch()}
            />
          </Card>
        )}

        {data && (
          <>
            <div className="rounded-3xl border border-border/80 bg-surface shadow-raised overflow-hidden">
              {/* Header */}
              <div className="border-b border-border/80 bg-surface-subtle/50 p-5 sm:p-6 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Vehicle Registration</span>
                  <h2 className="font-mono text-xl sm:text-2xl font-black text-text tracking-wide">
                    {data.plate_number}
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill tone={ACTIVITY_TONE[data.state]}>{ACTIVITY_LABEL[data.state]}</StatusPill>
                </div>
              </div>

              {positioned ? (
                <div className="p-5 sm:p-6 space-y-5">
                  <div className="h-80 overflow-hidden rounded-2xl border border-border shadow-xs">
                    <MapView
                      mode="tracking"
                      height="100%"
                      vehicles={vehicles}
                      trails={trails}
                      selectedId="shared"
                      fitPadding={80}
                      ariaLabel={`Map showing vehicle ${data.plate_number}`}
                    />
                  </div>

                  <div className="rounded-2xl border border-border bg-surface-subtle/40 p-4">
                    <DetailList
                      columns={2}
                      items={[
                        { label: 'Current Landmark', value: place.name ?? (place.loading ? 'Resolving GPS landmark…' : 'Highway Sector') },
                        { label: 'Last Signal', value: data.last_seen_at ? formatRelative(data.last_seen_at) : 'Active now' },
                        { label: 'Ground Speed', value: speedText(data.speed_kmph) },
                        { label: 'Highway Heading', value: headingText(data.heading) },
                      ]}
                    />
                  </div>

                  {!data.live && (
                    <div className="rounded-xl border border-warning/30 bg-warning-soft p-3 text-xs text-warning font-medium">
                      This vehicle has not reported GPS coordinates recently. The pin indicates its last confirmed position.
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-1">
                    <a
                      href={googleMapsUrl(data.latitude!, data.longitude!)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-brand hover:underline"
                    >
                      <ExternalLink size={14} aria-hidden="true" />
                      Open Coordinates in Google Maps
                    </a>

                    <span className="text-[11px] text-muted font-medium">
                      Auto-refreshes every 10s
                    </span>
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center">
                  <EmptyState
                    compact
                    icon={<MapPin size={24} className="text-muted" />}
                    title="No Satellite GPS Signal"
                    description={`Position telemetry unavailable for vehicle ${data.plate_number}.`}
                  />
                </div>
              )}
            </div>

            <p className="text-center text-xs text-muted">
              Live link expires automatically on {formatDateTime(data.expires_at)}.
            </p>
          </>
        )}
      </div>
    </main>
  )
}
