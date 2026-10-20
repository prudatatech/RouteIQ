import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Truck } from 'lucide-react'
import toast from 'react-hot-toast'
import { analyticsAPI, vehiclesAPI } from '@/services/api'
import { useEffectiveRole } from '@/store/effectiveRole'
import LiveMap from '@/components/map/LiveMap'
import { Button, StatusPill, SearchInput, EmptyState, ErrorState, Skeleton } from '@/components/ui'
import { isFleetVehicle, isVehicleLive } from '@/utils/vehicles'
import SelectedVehiclePanel from '@/components/fleet/location/SelectedVehiclePanel'
import { useLiveMinutes } from '@/components/fleet/vehicleStatus'

interface VehicleRow {
  id: string
  plate_number: string
  status: string
  latitude?: number | null
  longitude?: number | null
  last_heartbeat?: string | null
  last_sync?: string | null
}

/**
 * Full-screen fleet map. LiveMap draws each vehicle from its last stored
 * position and follows live GPS updates over Supabase realtime; the legend
 * lives inside LiveMap. The side list lets an operator find and select a
 * vehicle without hunting for it on the map. Selecting one (list, marker or a
 * `?vehicle=<id>` link) zooms to it and swaps the list for its GPS data,
 * activity and share link. The selection lives in the URL, so it can be shared.
 */
export default function LiveMapPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedId = searchParams.get('vehicle')
  const [zoomEvent, setZoomEvent] = useState(0)
  const [search, setSearch] = useState('')

  const role = useEffectiveRole().role
  const isStaff = role === 'admin' || role === 'superadmin'
  const queryClient = useQueryClient()
  const syncGps = useMutation({
    mutationFn: analyticsAPI.syncSparkGPS,
    onSuccess: result => {
      if (result.status === 'success') {
        toast.success('GPS positions updated')
        queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      } else {
        toast(result.message || 'GPS sync is not set up, so nothing was updated.')
      }
    },
    onError: () => toast.error('We could not sync GPS. Try again.'),
  })

  const { data: vehicles = [], isLoading, isError, refetch } = useQuery<VehicleRow[]>({
    queryKey: ['vehicles', 'live'],
    queryFn: () => vehiclesAPI.list({ limit: 500 }) as Promise<VehicleRow[]>,
    refetchInterval: 10_000,
  })

  // Fleet vehicles only: no archived ones, no placeholder stubs (TEMP-/DRFT-).
  const fleet = vehicles.filter(isFleetVehicle)
  const liveMinutes = useLiveMinutes()
  // "Reporting" = live: heard from within the limit, not merely having a stored position once.
  const liveCount = fleet.filter(v => isVehicleLive(v, liveMinutes)).length
  const withPosition = fleet.filter(v => v.latitude != null && v.longitude != null)
  const filtered = withPosition.filter(v => v.plate_number.toLowerCase().includes(search.trim().toLowerCase()))

  // The selection is the ?vehicle= parameter. Opening the page with it (for example Emergencies'
  // "Open on live map") selects that vehicle, and LiveMap zooms to it as soon as its position is known.
  const setSelected = (id: string | null) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (id) next.set('vehicle', id)
      else next.delete('vehicle')
      return next
    }, { replace: true })
  }
  const selectVehicle = (id: string) => {
    setSelected(id)
    setZoomEvent(Date.now())
  }
  const selectedPlate = fleet.find(v => v.id === selectedId)?.plate_number

  return (
    <div className="flex h-full w-full flex-col md:flex-row">
      {/* On a phone the map comes first and the list or vehicle panel sits under it, so neither hides the other. */}
      <aside className="order-2 flex h-[45%] min-h-0 shrink-0 flex-col border-t border-border bg-surface md:order-1 md:h-full md:w-80 md:border-r md:border-t-0">
        {selectedId ? (
          <SelectedVehiclePanel
            key={selectedId}
            vehicleId={selectedId}
            plate={selectedPlate}
            onBack={() => setSelected(null)}
            onZoom={() => setZoomEvent(Date.now())}
          />
        ) : (
        <>
        <div className="space-y-3 border-b border-border p-4 bg-surface-subtle/50">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-text">Live Fleet Map</h1>
                {liveCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> {liveCount} Live
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted truncate">
                {isLoading ? 'Loading vehicles…' : `${withPosition.length} mapped · ${fleet.length} active fleet`}
              </p>
            </div>
            {isStaff && (
              <Button
                variant="secondary"
                size="sm"
                className="shrink-0 shadow-xs hover:border-brand/40"
                icon={<RefreshCw size={14} />}
                loading={syncGps.isPending}
                onClick={() => syncGps.mutate()}
              >
                Sync GPS
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <SearchInput value={search} onChange={setSearch} placeholder="Search plate (e.g. MH12)" label="Search vehicles" />
            </div>
            {search && (
              <Button variant="ghost" size="sm" onClick={() => setSearch('')} className="shrink-0 text-xs">
                Clear
              </Button>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : isError ? (
            <ErrorState compact title="We could not load vehicles" description="Check your connection and try again." onRetry={() => refetch()} />
          ) : filtered.length === 0 ? (
            <EmptyState
              compact
              icon={<Truck size={22} />}
              title={withPosition.length === 0 ? 'No vehicles reporting' : 'No matches'}
              description={withPosition.length === 0 ? 'Vehicles appear here once they send a GPS position.' : 'Try a different plate number.'}
              action={search ? <Button variant="secondary" size="sm" onClick={() => setSearch('')}>Clear search</Button> : undefined}
            />
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map(v => {
                const live = isVehicleLive(v, liveMinutes)
                const isSelected = selectedId === v.id
                return (
                  <li key={v.id}>
                    <button
                      type="button"
                      onClick={() => selectVehicle(v.id)}
                      aria-current={isSelected ? 'true' : undefined}
                      className={
                        'flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm transition-all hover:bg-surface-subtle focus-visible:bg-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand ' +
                        (isSelected
                          ? 'border-l-4 border-brand bg-brand-soft/70 font-semibold shadow-xs'
                          : 'border-l-4 border-transparent')
                      }
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {live ? (
                          <span className="relative flex h-2.5 w-2.5 shrink-0" title="Transmitting live telemetry">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                          </span>
                        ) : (
                          <span className="h-2 w-2 shrink-0 rounded-full bg-muted/40" title="Stationary or offline" />
                        )}
                        <span className="min-w-0 truncate font-mono text-sm tracking-wide text-text">{v.plate_number}</span>
                      </div>
                      <StatusPill status={v.status} />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        </>
        )}
      </aside>

      <div className="relative order-1 min-h-[280px] flex-1 md:order-2">
        <LiveMap
          vehicles={fleet}
          selectedVehicleId={selectedId}
          zoomFocusEvent={zoomEvent}
          onVehicleSelect={setSelected}
          className="h-full w-full"
        />
      </div>
    </div>
  )
}
