import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Plus, Truck, Fuel, BarChart2, Pencil, Trash2, MapPin, Navigation } from 'lucide-react'
import { vehiclesAPI, telemetryWS } from '@/services/api'
import { formatTimeAgo } from '@/utils/timeFormat'
import {
  Page, PageHeader, Button, IconButton, DataTable, StatusPill, SearchInput, Drawer, DetailList,
  parseSort, serializeSort, useConfirm, useTabParam, useUrlState, type Column,
} from '@/components/ui'
import { MapView } from '@/components/map'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/services/supabase'
import VehicleWizardModal from '@/components/fleet/VehicleWizardModal'
import { downloadCsv, toCsv } from '@/utils/csv'

interface Vehicle {
  id: string
  plate_number: string
  vehicle_type: string
  vehicle_model?: string | null
  status: string
  capacity_kg?: number | null
  current_load_kg?: number | null
  available_capacity_kg?: number | null
  current_fuel_liters?: number | null
  fuel_capacity_liters?: number | null
  latitude?: number | null
  longitude?: number | null
  last_sync?: string | null
  last_heartbeat?: string | null
  driver_name?: string | null
  spark_id?: string | null
  speed_kmh?: number | null
}

// The backend's /vehicles/summary groups "idle" and "available" into one count, so
// they share a single filter tab here rather than showing a fabricated split.
const STATUS_FILTERS = ['all', 'on_route', 'idle', 'maintenance', 'offline', 'archived'] as const
const STATUS_FILTER_LABELS: Record<(typeof STATUS_FILTERS)[number], string> = {
  all: 'All', on_route: 'On route', idle: 'Idle / available', maintenance: 'Maintenance', offline: 'Offline', archived: 'Archived',
}

// A vehicle counts as live when its last position report is at most this old.
const LIVE_GPS_THRESHOLD_MS = 5 * 60 * 1000

// Latest position report: telemetry/driver pings set last_heartbeat, the GPS provider sync sets last_sync.
function lastPingAt(v: Vehicle): Date | null {
  const times = [v.last_heartbeat, v.last_sync]
    .filter((t): t is string => !!t)
    .map(t => new Date(t).getTime())
    .filter(t => !Number.isNaN(t))
  return times.length > 0 ? new Date(Math.max(...times)) : null
}

export default function FleetPage() {
  const role = useAuthStore(s => s.role)
  const navigate = useNavigate()
  const { confirm } = useConfirm()
  const queryClient = useQueryClient()

  const [filter, setFilter] = useTabParam(STATUS_FILTERS, 'all', 'status')
  const [search, setSearch] = useUrlState('q', { debounceMs: 300 })
  const [sortParam, setSortParam] = useUrlState('sort')
  const sort = parseSort(sortParam)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null)
  const [detailVehicle, setDetailVehicle] = useState<Vehicle | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()

  // Keep "last seen" labels and the live threshold current.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(tick)
  }, [])

  // Realtime updates for the fleet table.
  useEffect(() => {
    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      queryClient.invalidateQueries({ queryKey: ['fleet-summary'] })
    }
    const channel = supabase
      .channel('fleet_page_updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, invalidate)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [queryClient])

  // Live GPS telemetry over the backend WebSocket (the server broadcasts type: 'TELEMETRY_UPDATE').
  useEffect(() => {
    const ws = telemetryWS.connect((message: { type?: string; data?: { vehicle_id: string; lat: number; lng: number; speed?: number } }) => {
      if (message.type !== 'TELEMETRY_UPDATE' || !message.data) return
      const { vehicle_id, lat, lng, speed } = message.data
      queryClient.setQueriesData({ queryKey: ['vehicles'] }, (old: Vehicle[] | undefined) => {
        if (!old) return old
        return old.map(v => v.id === vehicle_id
          ? { ...v, latitude: lat, longitude: lng, last_heartbeat: new Date().toISOString(), speed_kmh: speed }
          : v)
      })
    })
    return () => ws.close()
  }, [queryClient])

  // "idle" covers both idle and available statuses (see STATUS_FILTER_LABELS), so it
  // is filtered on the client rather than passed as a single status to the backend.
  const { data: vehicles = [], isLoading, error, refetch } = useQuery<Vehicle[]>({
    queryKey: ['vehicles', filter],
    queryFn: () => vehiclesAPI.list({ status: filter === 'all' || filter === 'idle' ? undefined : filter, limit: 200 }) as Promise<Vehicle[]>,
    select: rows => filter === 'idle' ? rows.filter(v => v.status === 'idle' || v.status === 'available') : rows,
    refetchInterval: 15_000,
  })

  const { data: summary } = useQuery({
    queryKey: ['fleet-summary'],
    queryFn: vehiclesAPI.summary,
  })

  // Opened from a link elsewhere (e.g. global search): ?open=<id> selects the
  // matching vehicle and opens its drawer, then the param is dropped from the URL.
  useEffect(() => {
    const openId = searchParams.get('open')
    if (!openId || isLoading) return
    const match = vehicles.find(v => v.id === openId)
    if (match) setDetailVehicle(match)
    setSearchParams(params => { params.delete('open'); return params }, { replace: true })
  }, [searchParams, setSearchParams, vehicles, isLoading])

  const counts: Record<string, number> = {
    all: summary?.total ?? 0,
    on_route: summary?.active ?? 0,
    idle: summary?.idle ?? 0,
    maintenance: summary?.maintenance ?? 0,
    offline: summary?.offline ?? 0,
    archived: summary?.archived ?? 0,
  }

  const filtered = useMemo(
    () => vehicles.filter(v => v.plate_number.toLowerCase().includes(search.toLowerCase())),
    [vehicles, search],
  )

  const deleteMutation = useMutation({
    mutationFn: (id: string) => vehiclesAPI.delete(id),
    onSuccess: (_data, id) => {
      queryClient.setQueriesData({ queryKey: ['vehicles'] }, (old: Vehicle[] | undefined) => old?.filter(v => v.id !== id))
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      queryClient.invalidateQueries({ queryKey: ['fleet-summary'] })
      toast.success('Vehicle deleted')
    },
    onError: (err: { response?: { data?: { detail?: string } } }) => toast.error(err.response?.data?.detail || 'Failed to delete vehicle'),
  })

  const handleDelete = async (v: Vehicle) => {
    const ok = await confirm({
      title: `Delete ${v.plate_number}?`,
      message: 'This removes the vehicle from the fleet. This cannot be undone.',
      confirmLabel: 'Delete',
      tone: 'danger',
    })
    if (ok) deleteMutation.mutate(v.id)
  }

  const columns: Column<Vehicle>[] = [
    {
      key: 'vehicle',
      header: 'Vehicle',
      sortValue: v => v.plate_number,
      cell: v => (
        <div>
          <p className="font-medium text-text">{v.plate_number}</p>
          <p className="text-xs text-muted">{v.vehicle_model || v.vehicle_type}</p>
        </div>
      ),
    },
    { key: 'type', header: 'Type', hideBelow: 'md', cell: v => <span className="capitalize">{v.vehicle_type}</span> },
    { key: 'status', header: 'Status', cell: v => <StatusPill status={v.status} /> },
    {
      key: 'fuel',
      header: 'Fuel',
      hideBelow: 'lg',
      cell: v => {
        const capacity = v.fuel_capacity_liters || 0
        const current = v.current_fuel_liters || 0
        const pct = capacity > 0 ? Math.round((current / capacity) * 100) : null
        return (
          <span className="inline-flex items-center gap-1.5 text-sm text-text">
            <Fuel size={14} className="text-muted" aria-hidden="true" />
            {current.toLocaleString('en-IN')} / {capacity.toLocaleString('en-IN')} L
            {pct !== null && <span className="text-xs text-muted">({pct}%)</span>}
          </span>
        )
      },
    },
    {
      key: 'lastSeen',
      header: 'Last seen',
      sortValue: v => lastPingAt(v)?.getTime() ?? 0,
      cell: v => {
        const pingAt = lastPingAt(v)
        const isLive = !!pingAt && now - pingAt.getTime() <= LIVE_GPS_THRESHOLD_MS
        if (isLive) return <StatusPill tone="success">Live</StatusPill>
        return <span className="text-sm text-muted">{pingAt ? formatTimeAgo(pingAt, now) : 'No GPS data'}</span>
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      cell: v => (
        <div className="flex items-center justify-end gap-1">
          <IconButton label={`Show ${v.plate_number} on the map`} icon={<MapPin size={16} />} size="sm" onClick={() => setDetailVehicle(v)} />
          <IconButton label={`Analytics for ${v.plate_number}`} icon={<BarChart2 size={16} />} size="sm" onClick={() => navigate('/analytics?vehicle=' + v.id)} />
          {role !== 'driver' && (
            <>
              <IconButton label={`Edit ${v.plate_number}`} icon={<Pencil size={16} />} size="sm" onClick={() => setEditingVehicle(v)} />
              <IconButton label={`Delete ${v.plate_number}`} icon={<Trash2 size={16} />} size="sm" onClick={() => handleDelete(v)} />
            </>
          )}
        </div>
      ),
    },
  ]

  const detailPing = detailVehicle ? lastPingAt(detailVehicle) : null
  const detailIsLive = !!detailPing && now - detailPing.getTime() <= LIVE_GPS_THRESHOLD_MS

  const exportCsv = () => {
    const csv = toCsv(filtered.map(v => ({
      plate_number: v.plate_number,
      type: v.vehicle_type,
      model: v.vehicle_model || '',
      status: v.status,
      fuel_current_l: v.current_fuel_liters ?? '',
      fuel_capacity_l: v.fuel_capacity_liters ?? '',
      driver: v.driver_name || '',
      last_seen: lastPingAt(v)?.toISOString() ?? '',
    })), [
      { key: 'plate_number', header: 'Plate number' },
      { key: 'type', header: 'Type' },
      { key: 'model', header: 'Model' },
      { key: 'status', header: 'Status' },
      { key: 'fuel_current_l', header: 'Fuel (L)' },
      { key: 'fuel_capacity_l', header: 'Fuel capacity (L)' },
      { key: 'driver', header: 'Driver' },
      { key: 'last_seen', header: 'Last seen' },
    ])
    downloadCsv(`fleet-${new Date().toISOString().slice(0, 10)}.csv`, csv)
  }

  return (
    <Page>
      <PageHeader
        title="Fleet"
        description={`${counts.all.toLocaleString('en-IN')} vehicles.`}
        actions={(
          <>
            <Button variant="secondary" icon={<Download size={16} />} onClick={exportCsv}>Export CSV</Button>
            {role !== 'driver' && (
              <Button icon={<Plus size={16} />} onClick={() => setIsAddOpen(true)}>Add vehicle</Button>
            )}
          </>
        )}
      >
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search by plate number" label="Search vehicles" className="max-w-xs" />
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setFilter(s)}
                className={
                  'rounded-full px-3 py-1 text-xs font-medium transition-colors ' +
                  (filter === s ? 'bg-brand-soft text-brand' : 'bg-neutral-soft text-muted hover:text-text')
                }
              >
                {STATUS_FILTER_LABELS[s]} · {counts[s] ?? 0}
              </button>
            ))}
          </div>
        </div>
      </PageHeader>

      <DataTable
        caption="Fleet vehicles"
        columns={columns}
        rows={filtered}
        rowKey={v => v.id}
        loading={isLoading}
        error={error ? 'We could not load the fleet.' : undefined}
        onRetry={() => refetch()}
        onRowClick={setDetailVehicle}
        empty={{
          icon: <Truck size={22} />,
          title: search ? 'No vehicles match your search' : 'No vehicles yet',
          description: search ? undefined : 'Add your first vehicle to get started.',
          action: !search && role !== 'driver' ? <Button icon={<Plus size={16} />} onClick={() => setIsAddOpen(true)}>Add vehicle</Button> : undefined,
        }}
        pageSize={20}
        sort={sort}
        onSortChange={s => setSortParam(serializeSort(s))}
      />

      <VehicleWizardModal
        isOpen={isAddOpen || !!editingVehicle}
        onClose={() => { setIsAddOpen(false); setEditingVehicle(null) }}
        initialData={editingVehicle}
      />

      <Drawer
        open={!!detailVehicle}
        onClose={() => setDetailVehicle(null)}
        title={detailVehicle?.plate_number ?? ''}
        description={detailVehicle?.vehicle_model || detailVehicle?.vehicle_type}
      >
        {detailVehicle && (
          <div className="space-y-4">
            <div className="h-64 overflow-hidden rounded-card border border-border">
              {detailVehicle.latitude != null && detailVehicle.longitude != null ? (
                <MapView
                  mode="tracking"
                  vehicles={[{
                    id: detailVehicle.id,
                    position: { lat: detailVehicle.latitude, lng: detailVehicle.longitude },
                    status: detailVehicle.status,
                    label: detailVehicle.plate_number,
                  }]}
                  selectedId={detailVehicle.id}
                  interactive={false}
                  ariaLabel={`Map showing ${detailVehicle.plate_number}`}
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted">
                  <Navigation size={22} aria-hidden="true" />
                  No GPS signal for this vehicle.
                </div>
              )}
            </div>
            <DetailList
              columns={2}
              items={[
                { label: 'Status', value: <StatusPill status={detailVehicle.status} /> },
                { label: 'Last seen', value: detailIsLive ? 'Live' : (detailPing ? formatTimeAgo(detailPing, now) : 'No GPS data') },
                { label: 'Driver', value: detailVehicle.driver_name || 'Unassigned' },
                { label: 'GPS device', value: detailVehicle.spark_id || 'Not linked' },
                {
                  label: 'Coordinates',
                  value: detailVehicle.latitude != null
                    ? <span className="font-mono text-xs">{detailVehicle.latitude.toFixed(5)}, {detailVehicle.longitude!.toFixed(5)}</span>
                    : 'Unknown',
                },
                {
                  label: 'Fuel',
                  value: `${(detailVehicle.current_fuel_liters ?? 0).toLocaleString('en-IN')} / ${(detailVehicle.fuel_capacity_liters ?? 0).toLocaleString('en-IN')} L`,
                },
              ]}
            />
          </div>
        )}
      </Drawer>
    </Page>
  )
}
