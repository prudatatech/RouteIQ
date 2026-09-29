import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { routesAPI, vehiclesAPI } from '@/services/api'
import { Page, PageHeader, DataTable, StatusPill, SearchInput, Select, type Column } from '@/components/ui'
import { getRouteDistance, getRouteDuration, type RouteLike } from '@/utils/routeHelpers'
import { formatEta, formatTimeAgo } from '@/utils/timeFormat'

interface Vehicle {
  id: string
  plate_number?: string | null
  vehicle_model?: string | null
  latitude?: number | null
  longitude?: number | null
}

interface RouteRow extends RouteLike {
  id: string
  status: string
  vehicle_id?: string | null
  created_at?: string | null
  updated_at?: string | null
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

export default function RoutesPage() {
  const navigate = useNavigate()
  const [status, setStatus] = useState('all')
  const [q, setQ] = useState('')

  const { data: routes = [], isLoading, isError, refetch } = useQuery<RouteRow[]>({
    queryKey: ['routes'],
    queryFn: () => routesAPI.list({ limit: 50 }) as Promise<RouteRow[]>,
    refetchInterval: 20_000,
  })

  const { data: vehicles = [] } = useQuery<Vehicle[]>({
    queryKey: ['vehicles'],
    queryFn: () => vehiclesAPI.list({ limit: 100 }) as Promise<Vehicle[]>,
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

  const columns: Column<RouteRow>[] = [
    {
      key: 'vehicle',
      header: 'Vehicle',
      cell: r => {
        const vehicle = vehicleById.get(r.vehicle_id ?? '')
        return (
          <div>
            <div className="font-medium text-text">{vehicle?.plate_number || (r.vehicle_id ? r.vehicle_id.slice(0, 8) : 'Unassigned')}</div>
            {vehicle?.vehicle_model && <div className="text-xs text-muted">{vehicle.vehicle_model}</div>}
          </div>
        )
      },
      sortValue: r => vehicleById.get(r.vehicle_id ?? '')?.plate_number ?? '',
    },
    {
      key: 'status',
      header: 'Status',
      cell: r => <StatusPill status={r.status} />,
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
        return <span>{distance.toLocaleString('en-IN', { maximumFractionDigits: 1 })} km · {formatEta(duration)}</span>
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
        return formatTimeAgo(new Date(raw))
      },
      sortValue: r => r.updated_at ?? r.created_at ?? '',
      align: 'right',
      hideOnMobile: true,
    },
  ]

  return (
    <Page>
      <PageHeader title="Routes" description="Every planned route and where it stands.">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Search by vehicle or route ID" className="sm:max-w-xs" />
          <Select
            aria-label="Filter by status"
            value={status}
            onChange={e => setStatus(e.target.value)}
            options={STATUS_OPTIONS}
            className="sm:w-48"
          />
        </div>
      </PageHeader>

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
      />
    </Page>
  )
}
