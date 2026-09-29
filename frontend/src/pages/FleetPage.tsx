import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Plus, Truck, Fuel, BarChart2, Pencil, Trash2, MapPin } from 'lucide-react'
import { vehiclesAPI, telemetryWS } from '@/services/api'
import { formatRelative } from '@/utils/display'
import {
  Page, PageHeader, Button, IconButton, DataTable, StatusPill, SearchInput,
  Tabs, TabPanel, humanize, parseSort, serializeSort, useConfirm, useTabParam, useUrlState, type Column, type TabItem,
} from '@/components/ui'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'
import { supabase, openChannel } from '@/services/supabase'
import VehicleWizardModal from '@/components/fleet/VehicleWizardModal'
import { downloadCsv, toCsv } from '@/utils/csv'
import { fleetAPI } from '@/services/api'
import AlertsView from '@/components/fleet/AlertsView'
import FleetAnalyticsView from '@/components/fleet/FleetAnalyticsView'
import ServiceDueView from '@/components/fleet/ServiceDueView'
import LoadBar from '@/components/fleet/LoadBar'
import CargoChips from '@/components/fleet/CargoChips'
import SosCountBadge from '@/components/fleet/SosCountBadge'
import { useSosCounts } from '@/components/fleet/useSosCounts'
import { vehicleLoad } from '@/components/fleet/load'
import { containerSize, type Vehicle } from '@/components/fleet/types'
import { apiErrorMessage, bandLabel, bandTone, fleetKeys, type HealthBand } from '@/components/fleet/health'
import { useLiveMinutes } from '@/components/fleet/vehicleStatus'
import { isDraftVehicle, isVehicleLive, lastSeenAt } from '@/utils/vehicles'
import { MaintenanceNote } from '@/components/fleet/maintenance/MaintenanceNote'
import { useOpenMaintenanceJobs } from '@/components/fleet/maintenance/useOpenMaintenanceJobs'
import { useFleetHealth } from '@/components/fleet/useFleetHealth'

const VIEW_IDS = ['vehicles', 'analytics', 'alerts', 'service'] as const

// The backend's /vehicles/summary groups "idle" and "available" into one count, so
// they share a single filter tab here rather than showing a fabricated split.
// "All" is the active fleet: no archived vehicles and no drafts (placeholder stubs and saved
// drafts), which have their own filter and never count in the totals. This is the same rule the
// summary uses, so the tab counts and the rows always agree.
const STATUS_FILTERS = ['all', 'on_route', 'idle', 'maintenance', 'offline', 'archived', 'drafts'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]
const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: 'All', on_route: 'On route', idle: 'Idle / available', maintenance: 'Maintenance', offline: 'Offline', archived: 'Archived', drafts: 'Drafts',
}

function matchesFilter(v: Vehicle, filter: StatusFilter): boolean {
  // Waiting for approval: reviewed on the Vehicle requests page, not part of the fleet yet
  if (v.status === 'pending_approval') return false
  if (filter === 'drafts') return isDraftVehicle(v)
  if (isDraftVehicle(v)) return false
  if (filter === 'all') return v.status !== 'archived'
  if (filter === 'idle') return v.status === 'idle' || v.status === 'available'
  return v.status === filter
}

/** Every vehicle, page by page (the server caps a page at 500), in the server's stable plate order. */
async function fetchAllVehicles(): Promise<Vehicle[]> {
  const PAGE = 500
  const rows: Vehicle[] = []
  for (let skip = 0; skip < 20 * PAGE; skip += PAGE) {
    const page = await vehiclesAPI.list({ limit: PAGE, skip }) as Vehicle[]
    rows.push(...page)
    if (page.length < PAGE) break
  }
  return rows
}

export default function FleetPage() {
  const role = useAuthStore(s => s.role)
  const navigate = useNavigate()
  const { confirm } = useConfirm()
  const queryClient = useQueryClient()

  const [view, setView] = useTabParam(VIEW_IDS, 'vehicles')
  const [filter, setFilter] = useTabParam(STATUS_FILTERS, 'all', 'status')
  const liveMinutes = useLiveMinutes()
  const [search, setSearch] = useUrlState('q', { debounceMs: 300 })
  const [sortParam, setSortParam] = useUrlState('sort')
  const sort = parseSort(sortParam)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null)
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
    const channel = openChannel('fleet_page_updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, invalidate)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [queryClient])

  // Live GPS telemetry over the backend WebSocket (the server broadcasts type: 'TELEMETRY_UPDATE').
  useEffect(() => {
    const ws = telemetryWS.connect((message: { type?: string; data?: { vehicle_id: string; lat: number; lng: number; speed?: number } }) => {
      if (message.type !== 'TELEMETRY_UPDATE' || !message.data) return
      const { vehicle_id, lat, lng, speed } = message.data
      queryClient.setQueriesData({ queryKey: ['vehicles', 'fleet'] }, (old: Vehicle[] | undefined) => {
        if (!old) return old
        return old.map(v => v.id === vehicle_id
          ? { ...v, latitude: lat, longitude: lng, last_heartbeat: new Date().toISOString(), speed_kmh: speed }
          : v)
      })
    })
    return () => ws.close()
  }, [queryClient])

  // Every vehicle is loaded once and the filter tabs are applied here (matchesFilter), so the
  // tab counts, the rows and the summary all follow one rule.
  const { data: vehicles = [], isLoading, error, refetch } = useQuery<Vehicle[]>({
    queryKey: ['vehicles', 'fleet'],
    queryFn: fetchAllVehicles,
    refetchInterval: 15_000,
  })

  const { data: summary } = useQuery({
    queryKey: ['fleet-summary'],
    queryFn: vehiclesAPI.summary,
  })

  // Opened from a link elsewhere (global search, insights, fleet health): ?open=<vehicle id> goes
  // straight to that vehicle's page. On the Alerts view the same param names an alert instead.
  const openId = searchParams.get('open')
  useEffect(() => {
    if (openId && view !== 'alerts') navigate(`/fleet/${openId}`, { replace: true })
  }, [openId, view, navigate])

  const healthQuery = useFleetHealth()
  const healthById = useMemo(() => new Map((healthQuery.data ?? []).map(h => [h.vehicle_id, h])), [healthQuery.data])
  const sosCounts = useSosCounts()
  const openJobs = useOpenMaintenanceJobs()

  const alertSummary = useQuery<{ open: number; acknowledged: number }>({
    queryKey: fleetKeys.alertSummary,
    queryFn: () => fleetAPI.alertSummary(),
    refetchInterval: 30_000,
  })
  const serviceDue = useQuery<unknown[]>({
    queryKey: fleetKeys.serviceDue,
    queryFn: () => fleetAPI.serviceDue(),
    refetchInterval: 60_000,
  })

  /** Opens a vehicle's own page. */
  const openVehicle = (id: string) => navigate(`/fleet/${id}`)

  const counts: Record<string, number> = {
    all: summary?.total ?? 0,
    on_route: summary?.active ?? 0,
    idle: summary?.idle ?? 0,
    maintenance: summary?.maintenance ?? 0,
    offline: summary?.offline ?? 0,
    archived: summary?.archived ?? 0,
    drafts: summary?.drafts ?? 0,
  }

  const filtered = useMemo(
    () => {
      const q = search.trim().toLowerCase()
      const inFilter = vehicles.filter(v => matchesFilter(v, filter))
      if (!q) return inFilter
      return inFilter.filter(v => [v.plate_number, v.vehicle_model, v.driver_name, v.vehicle_type, ...(v.cargo_types ?? [])].some(t => t?.toLowerCase().includes(q)))
    },
    [vehicles, search, filter],
  )

  const deleteMutation = useMutation({
    mutationFn: (id: string) => vehiclesAPI.delete(id),
    onSuccess: (response: { data?: { archived?: boolean } }, id) => {
      // A vehicle with trips on record is archived by the server, not removed.
      const archived = !!response?.data?.archived
      if (!archived) queryClient.setQueriesData({ queryKey: ['vehicles', 'fleet'] }, (old: Vehicle[] | undefined) => old?.filter(v => v.id !== id))
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      queryClient.invalidateQueries({ queryKey: ['fleet-summary'] })
      toast.success(archived ? 'Vehicle archived. Its trips stay on record.' : 'Vehicle deleted')
    },
    onError: err => toast.error(apiErrorMessage(err, 'Failed to delete vehicle')),
  })

  const handleDelete = async (v: Vehicle) => {
    const ok = await confirm({
      title: `Delete ${v.plate_number}?`,
      message: 'A vehicle with no trips on record is removed for good. One that has completed trips is archived instead, so its history is kept.',
      confirmLabel: 'Delete vehicle',
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
        <div className="min-w-[8rem] max-w-[13rem]">
          <p className="truncate font-medium text-text">{v.plate_number}</p>
          <p className="truncate text-xs text-muted" title={v.vehicle_model || humanize(v.vehicle_type)}>{v.vehicle_model || humanize(v.vehicle_type)}</p>
          {/* Wide screens have their own Driver column */}
          <p className="truncate hidden text-xs text-muted md:block 2xl:hidden" title={v.driver_name ?? undefined}>{v.driver_name || 'No driver'}</p>
          {v.status === 'archived' && v.rejection_reason && <p className="line-clamp-2 text-xs text-danger" title={v.rejection_reason}>Rejected: {v.rejection_reason}</p>}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: v => (
        <div className="max-w-[13rem] space-y-1">
          <StatusPill status={v.status} />
          {v.status === 'maintenance' && openJobs.get(v.id) && <MaintenanceNote job={openJobs.get(v.id)!} className="line-clamp-3 text-xs text-muted" />}
        </div>
      ),
    },
    {
      key: 'load',
      header: 'Load',
      sortValue: v => vehicleLoad(v).pct,
      cell: v => (
        <div className="space-y-1">
          <LoadBar vehicle={v} compact />
          {v.bidding_window_open && <StatusPill tone="info" dot={false}>Bidding window open</StatusPill>}
        </div>
      ),
    },
    {
      key: 'details',
      header: 'Type and cargo',
      hideBelow: '2xl',
      sortValue: v => v.vehicle_type,
      cell: v => (
        <div className="space-y-1 text-sm">
          <p className="whitespace-nowrap text-text">{humanize(v.vehicle_type)}{v.capacity_kg ? <span className="text-muted"> · {v.capacity_kg.toLocaleString('en-IN')} kg</span> : null}</p>
          {containerSize(v) && <p className="whitespace-nowrap text-xs text-muted">Container {containerSize(v)}</p>}
          <CargoChips types={v.cargo_types} max={2} />
        </div>
      ),
    },
    {
      key: 'driver',
      header: 'Driver',
      hideBelow: '2xl',
      sortValue: v => v.driver_name ?? '',
      cell: v => v.driver_name
        ? (
          <div>
            <p className="text-sm text-text">{v.driver_name}</p>
            {v.driver_phone && <p className="text-xs text-muted">{v.driver_phone}</p>}
          </div>
        )
        : <span className="text-sm text-muted">Unassigned</span>,
    },
    {
      key: 'sos',
      header: 'SOS raised',
      sortValue: v => sosCounts.data?.[v.id]?.total ?? 0,
      cell: v => <SosCountBadge counts={sosCounts.data?.[v.id]} loading={sosCounts.isLoading} />,
    },
    {
      key: 'health',
      header: 'Health',
      hideBelow: 'xl',
      sortValue: v => healthById.get(v.id)?.score ?? -1,
      cell: v => {
        const h = healthById.get(v.id)
        if (!h) return <span className="text-muted">{healthQuery.isLoading ? '…' : '—'}</span>
        if (h.score == null) return <span className="text-sm text-muted">Not enough data</span>
        return (
          <span className="inline-flex items-center gap-2">
            <span className="w-7 text-right font-semibold tabular text-text">{h.score}</span>
            <StatusPill tone={bandTone[h.band as HealthBand]}>{bandLabel[h.band as HealthBand]}</StatusPill>
          </span>
        )
      },
    },
    {
      key: 'fuel',
      header: 'Fuel',
      hideBelow: '2xl',
      cell: v => {
        if (!v.fuel_capacity_liters || v.current_fuel_liters == null) return <span className="text-muted">Unknown</span>
        const capacity = v.fuel_capacity_liters
        const current = v.current_fuel_liters
        const pct = Math.round((current / capacity) * 100)
        return (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-text">
            <Fuel size={14} className="text-muted" aria-hidden="true" />
            {current.toLocaleString('en-IN', { maximumFractionDigits: 0 })} / {capacity.toLocaleString('en-IN')} L
            <span className="text-xs text-muted">({pct}%)</span>
          </span>
        )
      },
    },
    {
      key: 'lastSeen',
      header: 'Last seen',
      sortValue: v => lastSeenAt(v)?.getTime() ?? 0,
      cell: v => {
        const pingAt = lastSeenAt(v)
        if (isVehicleLive(v, liveMinutes, now)) return <StatusPill tone="success">Live</StatusPill>
        return <span className="text-sm text-muted">{pingAt ? formatRelative(pingAt, now) : 'No GPS data'}</span>
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      cell: v => (
        // The row opens the vehicle's page; nothing in here should, so clicks stop at this cell.
        <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
          <IconButton label={`Show ${v.plate_number} on the map`} icon={<MapPin size={16} />} size="sm" onClick={() => navigate('/live-map?vehicle=' + v.id)} />
          <IconButton label={`Analytics for ${v.plate_number}`} icon={<BarChart2 size={16} />} size="sm" onClick={() => navigate('/analytics?vehicle=' + v.id)} />
          {role !== 'driver' && (
            <>
              <IconButton label={`Edit ${v.plate_number}`} icon={<Pencil size={16} />} size="sm" onClick={e => { e.stopPropagation(); setEditingVehicle(v) }} />
              <IconButton
                label={v.status === 'on_route' ? `${v.plate_number} is on a route and can't be deleted` : `Delete ${v.plate_number}`}
                icon={<Trash2 size={16} />}
                size="sm"
                disabled={v.status === 'on_route'}
                onClick={e => { e.stopPropagation(); handleDelete(v) }}
              />
            </>
          )}
        </div>
      ),
    },
  ]

  const viewTabs: TabItem<(typeof VIEW_IDS)[number]>[] = [
    { id: 'vehicles', label: 'Vehicles' },
    { id: 'analytics', label: 'Analytics' },
    { id: 'alerts', label: 'Alerts', count: alertSummary.data ? alertSummary.data.open + alertSummary.data.acknowledged : undefined },
    { id: 'service', label: 'Service due', count: serviceDue.data?.length },
  ]

  const exportCsv = () => {
    const csv = toCsv(filtered.map(v => {
      const load = vehicleLoad(v)
      const sos = sosCounts.data?.[v.id]
      return {
        plate_number: v.plate_number,
        type: v.vehicle_type,
        model: v.vehicle_model || '',
        status: v.status,
        capacity_kg: v.capacity_kg ?? '',
        load_kg: load.band === 'unknown' ? '' : load.loadKg,
        load_pct: load.band === 'unknown' ? '' : load.pct,
        container: containerSize(v) ?? '',
        cargo_types: (v.cargo_types ?? []).join('; '),
        fuel_current_l: v.current_fuel_liters ?? '',
        fuel_capacity_l: v.fuel_capacity_liters ?? '',
        driver: v.driver_name || '',
        sos_total: sos?.total ?? 0,
        sos_last_30_days: sos?.last_30_days ?? 0,
        sos_open: sos?.open ?? 0,
        last_seen: lastSeenAt(v)?.toISOString() ?? '',
      }
    }), [
      { key: 'plate_number', header: 'Plate number' },
      { key: 'type', header: 'Type' },
      { key: 'model', header: 'Model' },
      { key: 'status', header: 'Status' },
      { key: 'capacity_kg', header: 'Capacity (kg)' },
      { key: 'load_kg', header: 'Load (kg)' },
      { key: 'load_pct', header: 'Load (% of capacity)' },
      { key: 'container', header: 'Container size' },
      { key: 'cargo_types', header: 'Cargo types' },
      { key: 'fuel_current_l', header: 'Fuel (L)' },
      { key: 'fuel_capacity_l', header: 'Fuel capacity (L)' },
      { key: 'driver', header: 'Driver' },
      { key: 'sos_total', header: 'SOS raised' },
      { key: 'sos_last_30_days', header: 'SOS in last 30 days' },
      { key: 'sos_open', header: 'SOS open' },
      { key: 'last_seen', header: 'Last seen' },
    ])
    downloadCsv(`fleet-${new Date().toISOString().slice(0, 10)}.csv`, csv)
  }

  return (
    <Page>
      <PageHeader
        title="Fleet"
        description={summary ? `${counts.all.toLocaleString('en-IN')} ${counts.all === 1 ? 'vehicle' : 'vehicles'} in your fleet.` : 'Every vehicle, its load, its health and where it is.'}
        actions={(
          <>
            <Button variant="secondary" icon={<Download size={16} />} onClick={exportCsv}>Export CSV</Button>
            {role !== 'driver' && (
              <Button icon={<Plus size={16} />} onClick={() => setIsAddOpen(true)}>Add vehicle</Button>
            )}
          </>
        )}
      >
        <Tabs tabs={viewTabs} value={view} onChange={setView} label="Fleet sections" />
        {view === 'vehicles' && (
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search by plate, model, driver or cargo" label="Search vehicles" className="w-full sm:w-80" />
          <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map(s => (
              <button
                key={s}
                type="button"
                aria-pressed={filter === s}
                onClick={() => setFilter(s)}
                className={
                  'rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ' +
                  (filter === s ? 'bg-brand-soft text-brand' : 'bg-neutral-soft text-muted hover:text-text')
                }
              >
                {STATUS_FILTER_LABELS[s]} · {counts[s] ?? 0}
              </button>
            ))}
          </div>
        </div>
        )}
      </PageHeader>

      <TabPanel id={view}>
      {view === 'analytics' && <FleetAnalyticsView />}
      {view === 'alerts' && (
        <AlertsView
          openId={openId}
          onOpenHandled={() => setSearchParams(params => { params.delete('open'); return params }, { replace: true })}
        />
      )}
      {view === 'service' && <ServiceDueView onOpenVehicle={openVehicle} />}
      {view === 'vehicles' && (
      <DataTable
        caption="Fleet vehicles"
        columns={columns}
        rows={filtered}
        rowKey={v => v.id}
        loading={isLoading}
        error={error ? 'We could not load the fleet.' : undefined}
        onRetry={() => refetch()}
        onRowClick={v => openVehicle(v.id)}
        empty={{
          icon: <Truck size={22} />,
          title: search || filter !== 'all' ? 'No vehicles match' : 'No vehicles yet',
          description: search || filter !== 'all' ? 'Try another status or search term.' : 'Add your first vehicle to get started.',
          action: search || filter !== 'all'
            ? <Button variant="secondary" onClick={() => { setSearch(''); setFilter('all') }}>Clear filters</Button>
            : role !== 'driver' ? <Button icon={<Plus size={16} />} onClick={() => setIsAddOpen(true)}>Add vehicle</Button> : undefined,
        }}
        pageSize={20}
        sort={sort}
        onSortChange={s => setSortParam(serializeSort(s))}
      />
      )}
      </TabPanel>

      {/* The edit (pencil) action opens only this form, with nothing open behind it. */}
      <VehicleWizardModal
        isOpen={isAddOpen || !!editingVehicle}
        onClose={() => { setIsAddOpen(false); setEditingVehicle(null) }}
        initialData={editingVehicle}
      />
    </Page>
  )
}
