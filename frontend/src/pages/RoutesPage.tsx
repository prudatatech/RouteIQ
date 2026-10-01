import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Download, Play, CheckCircle2 } from 'lucide-react'
import { routesAPI, vehiclesAPI } from '@/services/api'
import {
  Button, Page, PageHeader, DataTable, StatusPill, SearchInput, Tabs, TabPanel, statusToLabel, useTabParam, parseSort, serializeSort, useUrlState, type Column,
} from '@/components/ui'
import { tripCarries, tripCode, tripFigures, type TripLike } from '@/utils/tripFigures'
import { canCompleteRoute, canDispatchRoute, completeBlockedReason, useRouteStatusActions } from '@/hooks/useRouteStatusActions'
import { downloadCsv, toCsv } from '@/utils/csv'
import { formatMinutes, formatRelative, formatKm } from '@/utils/display'

interface Vehicle {
  id: string
  plate_number?: string | null
  vehicle_model?: string | null
  latitude?: number | null
  longitude?: number | null
}

interface RouteRow extends TripLike {
  vehicle_id?: string | null
  created_at?: string | null
  updated_at?: string | null
}

/** How many shipment codes a row names before "+ more". */
const CARRIES_SHOWN = 2

const STATUS_TABS = ['all', 'pending', 'optimizing', 'active', 'completed', 'cancelled'] as const
type StatusTab = typeof STATUS_TABS[number]

export default function RoutesPage() {
  const navigate = useNavigate()
  const [status, setStatus] = useTabParam<StatusTab>(STATUS_TABS, 'all', 'status')
  const [q, setQ] = useUrlState('q', { debounceMs: 300 })
  const { dispatch, complete, isPending } = useRouteStatusActions()
  const [sortParam, setSortParam] = useUrlState('sort')
  const sort = parseSort(sortParam)

  const { data: routes = [], isLoading, isError, refetch } = useQuery<RouteRow[]>({
    queryKey: ['routes'],
    queryFn: () => routesAPI.list({ limit: 200 }) as Promise<RouteRow[]>,
    refetchInterval: 20_000,
  })

  const { data: vehicles = [] } = useQuery<Vehicle[]>({
    queryKey: ['vehicles'],
    queryFn: () => vehiclesAPI.list({ limit: 500 }) as Promise<Vehicle[]>,
  })

  const vehicleById = useMemo(() => new Map(vehicles.map(v => [v.id, v])), [vehicles])

  const withVehicle = (r: RouteRow): RouteRow => {
    const vehicle = vehicleById.get(r.vehicle_id ?? '')
    return vehicle ? { ...r, vehicles: { latitude: vehicle.latitude, longitude: vehicle.longitude } } : r
  }

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return routes
      .filter(r => status === 'all' || r.status === status)
      .filter(r => {
        if (!needle) return true
        const vehicle = vehicleById.get(r.vehicle_id ?? '')
        return r.id.toLowerCase().includes(needle)
          || tripCode(r).toLowerCase().includes(needle)
          || (vehicle?.plate_number ?? '').toLowerCase().includes(needle)
          || tripCarries(r).some(code => code.toLowerCase().includes(needle))
      })
  }, [routes, status, q, vehicleById])

  const tabs = STATUS_TABS.map(id => ({
    id,
    label: id === 'all' ? 'All' : statusToLabel(id, 'route'),
    count: isLoading ? undefined : id === 'all' ? routes.length : routes.filter(r => r.status === id).length,
  }))

  const columns: Column<RouteRow>[] = [
    {
      key: 'trip',
      header: 'Trip',
      cell: r => {
        const carries = tripCarries(r)
        return (
          <div className="min-w-0">
            <div className="whitespace-nowrap font-mono font-medium text-text">{tripCode(r)}</div>
            {carries.length > 0 && (
              <div className="max-w-56 truncate text-xs text-muted" title={carries.join(', ')}>
                {carries.slice(0, CARRIES_SHOWN).join(', ')}{carries.length > CARRIES_SHOWN ? ` + ${(carries.length - CARRIES_SHOWN).toLocaleString('en-IN')} more` : ''}
              </div>
            )}
          </div>
        )
      },
      sortValue: r => tripCode(r),
    },
    {
      key: 'vehicle',
      header: 'Vehicle',
      cell: r => {
        const vehicle = vehicleById.get(r.vehicle_id ?? '')
        return (
          <div>
            <div className="font-medium text-text">{vehicle?.plate_number || (r.vehicle_id ? 'Vehicle not found' : 'Unassigned')}</div>
            {vehicle?.vehicle_model && <div className="text-xs text-muted">{vehicle.vehicle_model}</div>}
          </div>
        )
      },
      sortValue: r => vehicleById.get(r.vehicle_id ?? '')?.plate_number ?? '',
    },
    {
      key: 'status',
      header: 'Status',
      cell: r => <StatusPill status={r.status} kind="route" />,
      sortValue: r => r.status,
    },
    {
      key: 'stops',
      header: 'Stops',
      cell: r => (r.route_stops?.length ?? 0).toLocaleString('en-IN'),
      sortValue: r => r.route_stops?.length ?? 0,
      align: 'right',
      hideBelow: 'md',
    },
    {
      key: 'distance',
      header: 'Distance / ETA',
      cell: r => {
        const f = tripFigures(withVehicle(r))
        if (f.kind === 'none') return <span className="text-muted">—</span>
        const km = f.distanceKm != null ? formatKm(f.distanceKm) : null
        if (f.kind === 'actual') {
          return (
            <div className="whitespace-nowrap">
              <div>Took {formatMinutes(f.durationMinutes ?? 0)}</div>
              {km && <div className="text-xs text-muted">{km} planned</div>}
            </div>
          )
        }
        const parts = [km, f.durationMinutes != null ? formatMinutes(f.durationMinutes) : null].filter(Boolean).join(' · ')
        return <span className={f.distanceIsPlanned ? 'whitespace-nowrap text-muted' : 'whitespace-nowrap'}>{f.distanceIsPlanned ? `Planned ${parts}` : parts}</span>
      },
      sortValue: r => {
        const f = tripFigures(withVehicle(r))
        return f.kind === 'none' ? 0 : f.distanceKm ?? 0
      },
      hideBelow: 'md',
    },
    {
      key: 'updated',
      header: 'Updated',
      cell: r => {
        const raw = r.updated_at ?? r.created_at
        if (!raw) return <span className="text-muted">—</span>
        return formatRelative(raw)
      },
      sortValue: r => r.updated_at ?? r.created_at ?? '',
      align: 'right',
      hideOnMobile: true,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      cell: r => {
        const showDispatch = canDispatchRoute(r)
        const showComplete = canCompleteRoute(r)
        if (!showDispatch && !showComplete) return null
        return (
          // Keep button clicks and key presses from opening the row.
          <div className="flex justify-end" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
            {showDispatch && (
              <Button variant="secondary" size="sm" icon={<Play size={14} />} disabled={isPending} onClick={() => dispatch(r)}>Send to driver</Button>
            )}
            {showComplete && (
              <Button
                variant="secondary"
                size="sm"
                icon={<CheckCircle2 size={14} />}
                disabled={isPending || completeBlockedReason(r) !== null}
                title={completeBlockedReason(r) ?? undefined}
                onClick={() => complete(r)}
              >
                Mark completed
              </Button>
            )}
          </div>
        )
      },
    },
  ]

  const exportCsv = () => {
    const csv = toCsv(rows.map(r => {
      const vehicle = vehicleById.get(r.vehicle_id ?? '')
      const f = tripFigures(withVehicle(r))
      return {
        trip: tripCode(r),
        carries: tripCarries(r).join(' '),
        vehicle: vehicle?.plate_number || '',
        status: statusToLabel(r.status, 'route'),
        stops: r.route_stops?.length ?? 0,
        distance_km: f.kind !== 'none' && f.distanceKm != null ? f.distanceKm.toFixed(1) : '',
        distance_basis: f.kind !== 'none' && f.distanceKm != null ? (f.distanceIsPlanned || f.kind === 'planned' ? 'planned' : 'actual') : '',
        duration: f.kind === 'none' || f.durationMinutes == null ? '' : formatMinutes(f.durationMinutes),
        duration_basis: f.kind === 'none' ? '' : f.kind === 'actual' ? 'actual' : 'planned',
        updated_at: r.updated_at ?? r.created_at ?? '',
      }
    }), [
      { key: 'trip', header: 'Trip' },
      { key: 'carries', header: 'Shipments' },
      { key: 'vehicle', header: 'Vehicle' },
      { key: 'status', header: 'Status' },
      { key: 'stops', header: 'Stops' },
      { key: 'distance_km', header: 'Distance (km)' },
      { key: 'distance_basis', header: 'Distance basis' },
      { key: 'duration', header: 'Time' },
      { key: 'duration_basis', header: 'Time basis' },
      { key: 'updated_at', header: 'Updated at' },
    ])
    downloadCsv(`routes-${new Date().toISOString().slice(0, 10)}.csv`, csv)
  }

  return (
    <Page>
      <PageHeader
        title="Trips"
        description="Every planned trip and where it stands."
        actions={<Button variant="secondary" icon={<Download size={16} />} onClick={exportCsv}>Export CSV</Button>}
      >
        <div className="space-y-4">
          <Tabs label="Filter trips by status" tabs={tabs} value={status} onChange={setStatus} />
          <SearchInput value={q} onChange={setQ} placeholder="Search by trip, vehicle or shipment" className="max-w-sm" />
        </div>
      </PageHeader>

      <TabPanel id={status}>
        <DataTable
          caption="Trips"
          columns={columns}
          rows={rows}
          rowKey={r => r.id}
          loading={isLoading}
          error={isError ? 'We could not load trips. Check your connection and try again.' : undefined}
          onRetry={refetch}
          empty={{
            title: q || status !== 'all' ? 'No trips match your filters' : 'No trips yet',
            description: q || status !== 'all' ? undefined : 'Trips appear once trip optimization plans them.',
          }}
          onRowClick={r => navigate(`/routes/${r.id}`)}
          sort={sort}
          onSortChange={s => setSortParam(serializeSort(s))}
        />
      </TabPanel>
    </Page>
  )
}
