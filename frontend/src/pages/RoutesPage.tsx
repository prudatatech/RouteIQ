import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Download, Play, CheckCircle2 } from 'lucide-react'
import { routesAPI, vehiclesAPI } from '@/services/api'
import {
  Button, Page, PageHeader, DataTable, StatusPill, SearchInput, Tabs, TabPanel, statusToLabel, useTabParam, parseSort, serializeSort, useUrlState, type Column,
} from '@/components/ui'
import { getRouteDistance, getRouteDuration, type RouteLike } from '@/utils/routeHelpers'
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

interface RouteRow extends RouteLike {
  id: string
  is_manifest?: boolean
  status: string
  vehicle_id?: string | null
  created_at?: string | null
  updated_at?: string | null
}

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
        return r.id.toLowerCase().includes(needle) || (vehicle?.plate_number ?? '').toLowerCase().includes(needle)
      })
  }, [routes, status, q, vehicleById])

  const tabs = STATUS_TABS.map(id => ({
    id,
    label: id === 'all' ? 'All' : statusToLabel(id, 'route'),
    count: isLoading ? undefined : id === 'all' ? routes.length : routes.filter(r => r.status === id).length,
  }))

  const columns: Column<RouteRow>[] = [
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
        const full = withVehicle(r)
        const distance = getRouteDistance(full)
        if (distance <= 0) return <span className="text-muted">—</span>
        const duration = getRouteDuration(full, distance)
        return <span>{formatKm(distance)} · {formatMinutes(duration)}</span>
      },
      sortValue: r => getRouteDistance(withVehicle(r)),
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
              <Button variant="secondary" size="sm" icon={<Play size={14} />} disabled={isPending} onClick={() => dispatch(r)}>Dispatch</Button>
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
      const full = withVehicle(r)
      const distance = getRouteDistance(full)
      return {
        route_id: r.id.slice(0, 8).toUpperCase(),
        vehicle: vehicle?.plate_number || '',
        status: statusToLabel(r.status, 'route'),
        stops: r.route_stops?.length ?? 0,
        distance_km: distance > 0 ? distance.toFixed(1) : '',
        eta: distance > 0 ? formatMinutes(getRouteDuration(full, distance)) : '',
        updated_at: r.updated_at ?? r.created_at ?? '',
      }
    }), [
      { key: 'route_id', header: 'Route' },
      { key: 'vehicle', header: 'Vehicle' },
      { key: 'status', header: 'Status' },
      { key: 'stops', header: 'Stops' },
      { key: 'distance_km', header: 'Distance (km)' },
      { key: 'eta', header: 'ETA' },
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
          <SearchInput value={q} onChange={setQ} placeholder="Search by vehicle or trip ID" className="max-w-sm" />
        </div>
      </PageHeader>

      <TabPanel id={status}>
        <DataTable
          caption="Routes"
          columns={columns}
          rows={rows}
          rowKey={r => r.id}
          loading={isLoading}
          error={isError ? 'We could not load routes. Check your connection and try again.' : undefined}
          onRetry={refetch}
          empty={{
            title: q || status !== 'all' ? 'No routes match your filters' : 'No routes yet',
            description: q || status !== 'all' ? undefined : 'Routes appear once route optimization plans them.',
          }}
          onRowClick={r => navigate(`/routes/${r.id}`)}
          sort={sort}
          onSortChange={s => setSortParam(serializeSort(s))}
        />
      </TabPanel>
    </Page>
  )
}
