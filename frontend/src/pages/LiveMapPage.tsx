import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Truck } from 'lucide-react'
import toast from 'react-hot-toast'
import { analyticsAPI, vehiclesAPI } from '@/services/api'
import { useAuthStore } from '@/store/authStore'
import LiveMap from '@/components/map/LiveMap'
import { Button, StatusPill, SearchInput, EmptyState, Skeleton } from '@/components/ui'
import { isFleetVehicle, isVehicleLive } from '@/utils/vehicles'
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
 * vehicle without hunting for it on the map.
 */
export default function LiveMapPage() {
  const [searchParams] = useSearchParams()
  const requestedVehicleId = searchParams.get('vehicle')
  const [selectedId, setSelectedId] = useState<string | null>(requestedVehicleId)
  const [zoomEvent, setZoomEvent] = useState(0)
  const [search, setSearch] = useState('')

  const role = useAuthStore(s => s.role)
  const isStaff = role === 'admin' || role === 'superadmin'
  const queryClient = useQueryClient()
  const syncGps = useMutation({
    mutationFn: analyticsAPI.syncSparkGPS,
    onSuccess: result => {
      if (result.status === 'success') {
        toast.success('GPS positions updated.')
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

  const selectVehicle = (id: string) => {
    setSelectedId(id)
    setZoomEvent(Date.now())
  }

  // Deep link from other pages (e.g. Emergencies' "Open on live map"): zoom to
  // the requested vehicle once its position is loaded.
  useEffect(() => {
    if (!requestedVehicleId) return
    const match = withPosition.find(v => v.id === requestedVehicleId)
    if (match) setZoomEvent(Date.now())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedVehicleId, withPosition.length])

  return (
    <div className="flex h-full w-full flex-col md:flex-row">
      <aside className="flex h-64 shrink-0 flex-col border-b border-border bg-surface md:h-full md:w-80 md:border-b-0 md:border-r">
        <div className="border-b border-border p-4">
          <h1 className="text-lg font-semibold text-text">Live map</h1>
          <p className="mt-0.5 text-sm text-muted">{isLoading ? 'Loading vehicles…' : `${liveCount.toLocaleString('en-IN')} of ${fleet.length.toLocaleString('en-IN')} vehicles live`}</p>
          {isStaff && (
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              icon={<RefreshCw size={14} />}
              loading={syncGps.isPending}
              onClick={() => syncGps.mutate()}
            >
              Sync GPS now
            </Button>
          )}
          <SearchInput value={search} onChange={setSearch} placeholder="Search by plate number" label="Search vehicles" className="mt-3" />
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : isError ? (
            <EmptyState compact icon={<Truck size={22} />} title="We could not load vehicles" description="Check your connection and try again." action={<Button variant="secondary" size="sm" onClick={() => refetch()}>Try again</Button>} />
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
                    className={
                      'flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm hover:bg-surface-subtle focus:bg-surface-subtle focus:outline-none' +
                      (selectedId === v.id ? ' bg-brand-soft hover:bg-brand-soft' : '')
                    }
                  >
                    <span className="font-medium text-text">{v.plate_number}</span>
                    <StatusPill status={v.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <div className="relative min-h-[320px] flex-1">
        <LiveMap
          vehicles={fleet}
          selectedVehicleId={selectedId}
          zoomFocusEvent={zoomEvent}
          onVehicleSelect={setSelectedId}
          className="h-full w-full"
        />
      </div>
    </div>
  )
}
