import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Truck } from 'lucide-react'
import toast from 'react-hot-toast'
import { analyticsAPI, vehiclesAPI } from '@/services/api'
import { useAuthStore } from '@/store/authStore'
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

  const role = useAuthStore(s => s.role)
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
        <div className="space-y-3 border-b border-border p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-text">Live map</h1>
              <p className="mt-0.5 text-sm text-muted">{isLoading ? 'Loading vehicles…' : `${liveCount.toLocaleString('en-IN')} of ${fleet.length.toLocaleString('en-IN')} vehicles live`}</p>
            </div>
            {isStaff && (
              <Button
                variant="secondary"
                size="sm"
                className="shrink-0"
                icon={<RefreshCw size={14} />}
                loading={syncGps.isPending}
                onClick={() => syncGps.mutate()}
              >
                Sync GPS
              </Button>
            )}
          </div>
          <SearchInput value={search} onChange={setSearch} placeholder="Search by plate number" label="Search vehicles" />
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
            />
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map(v => (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() => selectVehicle(v.id)}
                    aria-current={selectedId === v.id ? 'true' : undefined}
                    className={
                      'flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm hover:bg-surface-subtle focus-visible:bg-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand' +
                      (selectedId === v.id ? ' bg-brand-soft hover:bg-brand-soft' : '')
                    }
                  >
                    <span className="min-w-0 truncate font-medium text-text">{v.plate_number}</span>
                    <StatusPill status={v.status} />
                  </button>
                </li>
              ))}
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
