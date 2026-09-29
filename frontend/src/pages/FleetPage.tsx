import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Plus, Truck, Fuel, BarChart2, Pencil, Trash2, MapPin, Navigation, Wrench, ArchiveRestore, ShieldAlert } from 'lucide-react'
import { vehiclesAPI, telemetryWS } from '@/services/api'
import { formatDateTime, formatRelative } from '@/utils/display'
import {
  Page, PageHeader, Button, IconButton, DataTable, StatusPill, SearchInput, Drawer, DetailList,
  Alert, Tabs, TabPanel, humanize, parseSort, serializeSort, useConfirm, useTabParam, useUrlState, type Column, type TabItem,
} from '@/components/ui'
import { MapView } from '@/components/map'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'
import { supabase, openChannel } from '@/services/supabase'
import VehicleWizardModal from '@/components/fleet/VehicleWizardModal'
import { downloadCsv, toCsv } from '@/utils/csv'
import { expiryStatus } from '@/utils/documentExpiry'
import { fleetAPI } from '@/services/api'
import VehicleHealthPanel from '@/components/fleet/VehicleHealthPanel'
import { VehiclePhotoCard } from '@/components/fleet/photos/VehiclePhotoCard'
import AlertsView from '@/components/fleet/AlertsView'
import RaiseSosModal from '@/components/fleet/RaiseSosModal'
import ServiceDueView from '@/components/fleet/ServiceDueView'
import { apiErrorMessage, bandLabel, bandTone, fleetKeys, formatOdometer, type HealthBand } from '@/components/fleet/health'
import { returnVehicleToService, setVehicleStatus, useLiveMinutes } from '@/components/fleet/vehicleStatus'
import { canReturnToService, isDraftVehicle, isVehicleLive, lastSeenAt } from '@/utils/vehicles'
import { useFleetHealth } from '@/components/fleet/useFleetHealth'

const VIEW_IDS = ['vehicles', 'alerts', 'service'] as const

interface Vehicle {
  id: string
  plate_number: string
  vehicle_type: string
  vehicle_model?: string | null
  status: string
  capacity_kg?: number | null
  current_load_kg?: number | null
  available_capacity_kg?: number | null
  container_length_ft?: number | null
  container_width_ft?: number | null
  container_height_ft?: number | null
  bidding_window_open?: boolean | null
  bidding_window_closes_at?: string | null
  current_fuel_liters?: number | null
  fuel_capacity_liters?: number | null
  latitude?: number | null
  longitude?: number | null
  last_sync?: string | null
  last_heartbeat?: string | null
  driver_name?: string | null
  spark_id?: string | null
  speed_kmh?: number | null
  rc_expiry?: string | null
  insurance_expiry?: string | null
  fitness_expiry?: string | null
  permit_expiry?: string | null
  puc_expiry?: string | null
  odometer_km?: number | null
  /** Set when staff rejected the vehicle a driver registered (it is archived, with the reason). */
  rejection_reason?: string | null
  review_decision?: string | null
}

const DOCUMENT_EXPIRY_LABELS: Record<string, string> = {
  rc_expiry: 'RC', insurance_expiry: 'Insurance', fitness_expiry: 'Fitness', permit_expiry: 'Permit', puc_expiry: 'PUC',
}

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

/** Load and free space for a vehicle; free falls back to capacity minus load when the API does not send it. */
function vehicleLoad(v: Vehicle) {
  const total = v.capacity_kg ?? 0
  const load = Math.max(0, v.current_load_kg ?? (v.available_capacity_kg != null ? total - v.available_capacity_kg : 0))
  const free = Math.max(0, v.available_capacity_kg ?? total - load)
  const pct = total > 0 ? Math.min(100, Math.round((load / total) * 100)) : 0
  return { total, load, free, pct }
}

const hasContainer = (v: Vehicle) => (v.container_length_ft ?? 0) > 0
const containerSize = (v: Vehicle) => `${v.container_length_ft} × ${v.container_width_ft ?? 0} × ${v.container_height_ft ?? 0} ft`

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
  const [detailId, setDetailId] = useState<string | null>(null)
  const [sosOpen, setSosOpen] = useState(false)
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
      queryClient.setQueriesData({ queryKey: ['vehicles'] }, (old: Vehicle[] | undefined) => {
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

  // Opened from a link elsewhere (e.g. global search): ?open=<id> selects the
  // matching vehicle and opens its drawer, then the param is dropped from the URL.
  useEffect(() => {
    const openId = searchParams.get('open')
    if (!openId || isLoading || view === 'alerts') return
    const match = vehicles.find(v => v.id === openId)
    if (match) setDetailVehicle(match)
    setSearchParams(params => { params.delete('open'); return params }, { replace: true })
  }, [searchParams, setSearchParams, vehicles, isLoading, view])

  const healthQuery = useFleetHealth()
  const healthById = useMemo(() => new Map((healthQuery.data ?? []).map(h => [h.vehicle_id, h])), [healthQuery.data])

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

  const openVehicle = (id: string) => {
    const match = vehicles.find(v => v.id === id)
    if (match) setDetailVehicle(match)
    else toast.error('That vehicle is not in the current list. Clear the filters and try again.')
  }

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
      return inFilter.filter(v => [v.plate_number, v.vehicle_model, v.driver_name].some(t => t?.toLowerCase().includes(q)))
    },
    [vehicles, search, filter],
  )

  // Read the open vehicle from the live list so the drawer follows realtime updates.
  const detailVehicle = detailId ? vehicles.find(v => v.id === detailId) ?? null : null
  const setDetailVehicle = (v: Vehicle | null) => setDetailId(v?.id ?? null)

  const deleteMutation = useMutation({
    mutationFn: (id: string) => vehiclesAPI.delete(id),
    onSuccess: (response: { data?: { archived?: boolean } }, id) => {
      // A vehicle with trips on record is archived by the server, not removed.
      const archived = !!response?.data?.archived
      if (!archived) queryClient.setQueriesData({ queryKey: ['vehicles'] }, (old: Vehicle[] | undefined) => old?.filter(v => v.id !== id))
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      queryClient.invalidateQueries({ queryKey: ['fleet-summary'] })
      toast.success(archived ? 'Vehicle archived. Its trips stay on record.' : 'Vehicle deleted')
    },
    onError: (err: { response?: { data?: { detail?: string } } }) => toast.error(err.response?.data?.detail || 'Failed to delete vehicle'),
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

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'available' | 'idle' | 'maintenance' }) => setVehicleStatus(id, status),
    onSuccess: (_data, { status }) => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      queryClient.invalidateQueries({ queryKey: ['fleet-summary'] })
      toast.success(status === 'maintenance' ? 'Vehicle moved to maintenance' : 'Vehicle is back in service')
    },
    onError: err => toast.error(apiErrorMessage(err, 'We could not change the vehicle status.')),
  })

  const handleReturnToService = async (v: Vehicle) => {
    const ok = await confirm({
      title: `Return ${v.plate_number} to service?`,
      message: 'It becomes available for dispatch again. Do this once it is repaired, inspected or safe to drive.',
      confirmLabel: 'Return to service',
    })
    if (!ok) return
    try {
      await returnVehicleToService(v.id)
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      queryClient.invalidateQueries({ queryKey: ['fleet-summary'] })
      toast.success(`${v.plate_number} is back in service`)
    } catch (err) {
      toast.error(apiErrorMessage(err, 'We could not return the vehicle to service.'))
    }
  }

  const handleMaintenance = async (v: Vehicle) => {
    const ok = await confirm({
      title: `Move ${v.plate_number} to maintenance?`,
      message: 'It is not offered for new work until you return it to service.',
      confirmLabel: 'Move to maintenance',
      tone: 'danger',
    })
    if (ok) statusMutation.mutate({ id: v.id, status: 'maintenance' })
  }

  const handleUnarchive = async (v: Vehicle) => {
    const ok = await confirm({
      title: `Restore ${v.plate_number}?`,
      message: v.review_decision === 'rejected' ? 'The vehicle is approved and returns to the fleet as available.' : 'The vehicle returns to the fleet as idle.',
      confirmLabel: 'Restore vehicle',
    })
    if (ok) statusMutation.mutate({ id: v.id, status: 'idle' })
  }

  const columns: Column<Vehicle>[] = [
    {
      key: 'vehicle',
      header: 'Vehicle',
      sortValue: v => v.plate_number,
      cell: v => (
        <div>
          <p className="font-medium text-text">{v.plate_number}</p>
          <p className="text-xs text-muted">{v.vehicle_model || humanize(v.vehicle_type)}</p>
          {v.status === 'archived' && v.rejection_reason && <p className="text-xs text-danger">Rejected: {v.rejection_reason}</p>}
        </div>
      ),
    },
    { key: 'type', header: 'Type', hideBelow: 'md', cell: v => <span>{humanize(v.vehicle_type)}</span> },
    { key: 'status', header: 'Status', cell: v => <StatusPill status={v.status} /> },
    {
      key: 'health',
      header: 'Health',
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
      key: 'capacity',
      header: 'Capacity',
      hideBelow: 'md',
      sortValue: v => vehicleLoad(v).free,
      cell: v => {
        const { total, free, pct } = vehicleLoad(v)
        if (total <= 0) return <span className="text-muted">—</span>
        return (
          <div className="w-32 space-y-1">
            <p className="text-sm text-text">{free.toLocaleString('en-IN')} / {total.toLocaleString('en-IN')} kg free</p>
            <div
              role="progressbar"
              aria-label={`${pct}% loaded`}
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-1.5 overflow-hidden rounded-full bg-neutral-soft"
            >
              <div className={pct >= 90 ? 'h-full bg-warning' : 'h-full bg-brand-fill'} style={{ width: `${pct}%` }} />
            </div>
            {v.bidding_window_open && <StatusPill tone="info" dot={false}>Bidding window open</StatusPill>}
          </div>
        )
      },
    },
    {
      key: 'fuel',
      header: 'Fuel',
      hideBelow: 'lg',
      cell: v => {
        if (!v.fuel_capacity_liters || v.current_fuel_liters == null) return <span className="text-muted">Unknown</span>
        const capacity = v.fuel_capacity_liters
        const current = v.current_fuel_liters
        const pct = Math.round((current / capacity) * 100)
        return (
          <span className="inline-flex items-center gap-1.5 text-sm text-text">
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
        <div className="flex items-center justify-end gap-1">
          <IconButton label={`Show ${v.plate_number} on the map`} icon={<MapPin size={16} />} size="sm" onClick={() => navigate('/live-map?vehicle=' + v.id)} />
          <IconButton label={`Analytics for ${v.plate_number}`} icon={<BarChart2 size={16} />} size="sm" onClick={() => navigate('/analytics?vehicle=' + v.id)} />
          {role !== 'driver' && (
            <>
              <IconButton label={`Edit ${v.plate_number}`} icon={<Pencil size={16} />} size="sm" onClick={() => setEditingVehicle(v)} />
              <IconButton
                label={v.status === 'on_route' ? `${v.plate_number} is on a route and can't be deleted` : `Delete ${v.plate_number}`}
                icon={<Trash2 size={16} />}
                size="sm"
                disabled={v.status === 'on_route'}
                onClick={() => handleDelete(v)}
              />
            </>
          )}
        </div>
      ),
    },
  ]

  const viewTabs: TabItem<(typeof VIEW_IDS)[number]>[] = [
    { id: 'vehicles', label: 'Vehicles' },
    { id: 'alerts', label: 'Alerts', count: alertSummary.data ? alertSummary.data.open + alertSummary.data.acknowledged : undefined },
    { id: 'service', label: 'Service due', count: serviceDue.data?.length },
  ]

  const detailPing = detailVehicle ? lastSeenAt(detailVehicle) : null
  const detailIsLive = !!detailVehicle && isVehicleLive(detailVehicle, liveMinutes, now)

  const exportCsv = () => {
    const csv = toCsv(filtered.map(v => ({
      plate_number: v.plate_number,
      type: v.vehicle_type,
      model: v.vehicle_model || '',
      status: v.status,
      fuel_current_l: v.current_fuel_liters ?? '',
      fuel_capacity_l: v.fuel_capacity_liters ?? '',
      driver: v.driver_name || '',
      last_seen: lastSeenAt(v)?.toISOString() ?? '',
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
        description={summary ? `${counts.all.toLocaleString('en-IN')} ${counts.all === 1 ? 'vehicle' : 'vehicles'} in your fleet.` : 'Every vehicle, its health and where it is.'}
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
          <SearchInput value={search} onChange={setSearch} placeholder="Search by plate, model or driver" label="Search vehicles" className="max-w-xs" />
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map(s => (
              <button
                key={s}
                type="button"
                aria-pressed={filter === s}
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
        )}
      </PageHeader>

      <TabPanel id={view}>
      {view === 'alerts' && (
        <AlertsView
          openId={searchParams.get('open')}
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
        onRowClick={setDetailVehicle}
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

      <VehicleWizardModal
        isOpen={isAddOpen || !!editingVehicle}
        onClose={() => { setIsAddOpen(false); setEditingVehicle(null) }}
        initialData={editingVehicle}
      />

      <Drawer
        open={!!detailVehicle}
        onClose={() => setDetailVehicle(null)}
        title={detailVehicle?.plate_number ?? ''}
        description={detailVehicle?.vehicle_model || (detailVehicle ? humanize(detailVehicle.vehicle_type) : undefined)}
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
                    vehicle_type: detailVehicle.vehicle_type,
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
            {role !== 'driver' && (
              <div className="flex flex-wrap gap-2">
                {!isDraftVehicle(detailVehicle) && detailVehicle.status !== 'archived' && (
                  <Button variant="danger" icon={<ShieldAlert size={16} />} onClick={() => setSosOpen(true)}>Raise SOS</Button>
                )}
                {canReturnToService(detailVehicle) && (
                  <Button icon={<Wrench size={16} />} onClick={() => handleReturnToService(detailVehicle)}>Return to service</Button>
                )}
                {!isDraftVehicle(detailVehicle) && ['available', 'idle', 'offline', 'on_route'].includes(detailVehicle.status) && (
                  <Button variant="secondary" icon={<Wrench size={16} />} onClick={() => handleMaintenance(detailVehicle)}>Move to maintenance</Button>
                )}
                {detailVehicle.status === 'archived' && !isDraftVehicle(detailVehicle) && (
                  <Button variant="secondary" icon={<ArchiveRestore size={16} />} onClick={() => handleUnarchive(detailVehicle)}>Restore vehicle</Button>
                )}
              </div>
            )}
            <DetailList
              columns={2}
              items={[
                { label: 'Status', value: <StatusPill status={detailVehicle.status} /> },
                { label: 'Last seen', value: detailIsLive ? 'Live' : (detailPing ? formatRelative(detailPing, now) : 'No GPS data') },
                { label: 'Driver', value: detailVehicle.driver_name || 'Unassigned' },
                { label: 'GPS device', value: detailVehicle.spark_id || 'Not linked' },
                {
                  label: 'Coordinates',
                  value: detailVehicle.latitude != null
                    ? <span className="font-mono text-xs">{detailVehicle.latitude.toFixed(5)}, {detailVehicle.longitude!.toFixed(5)}</span>
                    : 'Unknown',
                },
                { label: 'Capacity', value: `${(detailVehicle.capacity_kg ?? 0).toLocaleString('en-IN')} kg` },
                { label: 'Current load', value: `${vehicleLoad(detailVehicle).load.toLocaleString('en-IN')} kg (${vehicleLoad(detailVehicle).free.toLocaleString('en-IN')} kg free)` },
                { label: 'Container size', value: hasContainer(detailVehicle) ? containerSize(detailVehicle) : 'Not recorded' },
                {
                  label: 'Bidding window',
                  value: detailVehicle.bidding_window_open
                    ? `Open${detailVehicle.bidding_window_closes_at ? `, closes ${formatDateTime(detailVehicle.bidding_window_closes_at)}` : ''}`
                    : 'Closed',
                },
                {
                  label: 'Fuel',
                  value: detailVehicle.fuel_capacity_liters
                    ? `${(detailVehicle.current_fuel_liters ?? 0).toLocaleString('en-IN')} / ${detailVehicle.fuel_capacity_liters.toLocaleString('en-IN')} L`
                    : 'Tank size not recorded',
                },
                { label: 'Odometer', value: formatOdometer(detailVehicle.odometer_km) },
              ]}
            />
            {(() => {
              const badges = Object.entries(DOCUMENT_EXPIRY_LABELS)
                .map(([key, label]) => ({ label, status: expiryStatus(detailVehicle[key as keyof Vehicle] as string | null | undefined) }))
                .filter((b): b is { label: string; status: NonNullable<ReturnType<typeof expiryStatus>> } => !!b.status)
              if (badges.length === 0) return null
              return (
                <div className="space-y-1.5">
                  <p className="text-sm font-medium text-text">Documents needing attention</p>
                  <div className="flex flex-wrap gap-1.5">
                    {badges.map(b => (
                      <StatusPill key={b.label} tone={b.status.tone} dot={false}>{b.label}: {b.status.label}</StatusPill>
                    ))}
                  </div>
                </div>
              )
            })()}
            {detailVehicle.status === 'archived' && detailVehicle.rejection_reason && (
              <Alert tone="danger" title="Rejected">{detailVehicle.rejection_reason}</Alert>
            )}
            <RaiseSosModal key={detailVehicle.id} vehicleId={detailVehicle.id} plate={detailVehicle.plate_number} open={sosOpen} onClose={() => setSosOpen(false)} />
            <VehiclePhotoCard key={`photos-${detailVehicle.id}`} vehicleId={detailVehicle.id} />
            <VehicleHealthPanel key={detailVehicle.id} vehicleId={detailVehicle.id} plate={detailVehicle.plate_number} />
          </div>
        )}
      </Drawer>
    </Page>
  )
}
