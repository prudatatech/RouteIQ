import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Truck } from 'lucide-react'
import { vehiclesAPI } from '@/services/api'
import LiveMap from '@/components/map/LiveMap'
import { StatusPill, SearchInput, EmptyState, Skeleton } from '@/components/ui'

interface VehicleRow {
  id: string
  plate_number: string
  status: string
  latitude?: number | null
  longitude?: number | null
}

/**
 * Full-screen fleet map. LiveMap draws each vehicle from its last stored
 * position and follows live GPS updates over Supabase realtime; the legend
 * lives inside LiveMap. The side list lets an operator find and select a
 * vehicle without hunting for it on the map.
 */
export default function LiveMapPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [zoomEvent, setZoomEvent] = useState(0)
  const [search, setSearch] = useState('')

  const { data: vehicles = [], isLoading } = useQuery<VehicleRow[]>({
    queryKey: ['vehicles', 'live'],
    queryFn: () => vehiclesAPI.list({ limit: 500 }),
    refetchInterval: 10_000,
  })

  const fleet = vehicles.filter(v => v.status !== 'archived')
  const withPosition = fleet.filter(v => v.latitude != null && v.longitude != null)
  const filtered = withPosition.filter(v => v.plate_number.toLowerCase().includes(search.toLowerCase()))

  const selectVehicle = (id: string) => {
    setSelectedId(id)
    setZoomEvent(Date.now())
  }

  return (
    <div className="flex h-full w-full flex-col md:flex-row">
      <aside className="flex h-64 shrink-0 flex-col border-b border-border bg-surface md:h-full md:w-80 md:border-b-0 md:border-r">
        <div className="border-b border-border p-4">
          <h1 className="text-lg font-semibold text-text">Live map</h1>
          <p className="mt-0.5 text-sm text-muted">{withPosition.length} of {fleet.length} vehicles reporting</p>
          <SearchInput value={search} onChange={setSearch} placeholder="Search by plate number" label="Search vehicles" className="mt-3" />
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
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
