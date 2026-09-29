import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Gauge, Route, UserCheck } from 'lucide-react'
import { analyticsAPI } from '@/services/api'
import { DataTable, SearchInput, Select, Stat, StatusPill, humanize, type Column } from '@/components/ui'
import { ChartCard, SimpleBarChart } from './charts'
import { formatNumber, formatPercent } from './format'

interface DriverRow {
  id: string
  plate_number: string
  vehicle_type: string | null
  status: string | null
  driver_name: string | null
  total_routes: number
  completed_routes: number
  completion_pct: number | null
  total_distance_km: number
}

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'available', label: 'Available' },
  { value: 'on_route', label: 'On route' },
  { value: 'idle', label: 'Idle' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'offline', label: 'Offline' },
]

const columns: Column<DriverRow>[] = [
  {
    key: 'vehicle', header: 'Vehicle', sortValue: r => r.plate_number,
    cell: r => <span className="font-mono text-sm">{r.plate_number}</span>,
  },
  {
    key: 'driver', header: 'Driver', sortValue: r => r.driver_name ?? '',
    cell: r => r.driver_name ?? <span className="text-muted">No driver assigned</span>,
  },
  {
    key: 'type', header: 'Type', hideBelow: 'lg', sortValue: r => r.vehicle_type ?? '',
    cell: r => (r.vehicle_type ? humanize(r.vehicle_type) : '—'),
  },
  {
    key: 'completed', header: 'Trips completed', align: 'right', sortValue: r => r.completed_routes,
    cell: r => <span className="tabular">{formatNumber(r.completed_routes)}</span>,
  },
  {
    key: 'rate', header: 'Completion rate', align: 'right', hideBelow: 'md', sortValue: r => r.completion_pct,
    cell: r => <span className="tabular">{formatPercent(r.completion_pct)}</span>,
  },
  {
    key: 'distance', header: 'Distance', align: 'right', sortValue: r => r.total_distance_km,
    cell: r => <span className="tabular">{formatNumber(r.total_distance_km)} km</span>,
  },
  {
    key: 'status', header: 'Status', sortValue: r => r.status ?? '',
    cell: r => <StatusPill status={r.status} />,
  },
]

/** Work done by each vehicle and its driver, from route history. */
export default function DriversTab() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const { data = [], isLoading, isError, refetch } = useQuery<DriverRow[]>({
    queryKey: ['analytics', 'driver-performance'],
    queryFn: () => analyticsAPI.driverPerformance() as Promise<DriverRow[]>,
    refetchInterval: 60_000,
  })

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return data.filter(d =>
      (!status || d.status === status) &&
      (!q || d.plate_number?.toLowerCase().includes(q) || d.driver_name?.toLowerCase().includes(q)),
    )
  }, [data, search, status])

  const totals = useMemo(() => ({
    trips: data.reduce((s, d) => s + d.completed_routes, 0),
    distance: data.reduce((s, d) => s + d.total_distance_km, 0),
    withDriver: data.filter(d => d.driver_name).length,
  }), [data])

  const top = useMemo(() => [...data]
    .filter(d => d.completed_routes > 0)
    .sort((a, b) => b.completed_routes - a.completed_routes)
    .slice(0, 8)
    .map(d => ({ name: d.driver_name ?? d.plate_number, trips: d.completed_routes })), [data])

  return (
    <div className="space-y-6">
      <section aria-label="Totals" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Trips completed" icon={<Route size={18} />} loading={isLoading} value={isError ? '—' : formatNumber(totals.trips)} hint="All time" />
        <Stat label="Distance driven" icon={<Gauge size={18} />} loading={isLoading} value={isError ? '—' : `${formatNumber(totals.distance)} km`} hint="On completed routes" />
        <Stat
          label="Vehicles with a driver"
          icon={<UserCheck size={18} />}
          loading={isLoading}
          value={isError ? '—' : `${formatNumber(totals.withDriver)} of ${formatNumber(data.length)}`}
        />
      </section>

      <ChartCard
        title="Most trips completed"
        description="Top eight drivers or vehicles by completed routes"
        loading={isLoading}
        error={isError}
        onRetry={() => refetch()}
        empty={top.length === 0}
        emptyTitle="No completed trips yet"
        emptyDescription="Drivers appear here once they complete a route."
      >
        <SimpleBarChart
          data={top}
          categoryKey="name"
          horizontal
          series={[{ key: 'trips', label: 'Trips completed' }]}
          label={`Completed trips for the top ${top.length} drivers.`}
        />
      </ChartCard>

      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          <SearchInput value={search} onChange={setSearch} placeholder="Search by driver or plate" label="Search drivers" className="sm:max-w-sm sm:flex-1" />
          <Select
            label="Vehicle status"
            hideLabel
            value={status}
            onChange={e => setStatus(e.target.value)}
            options={STATUS_OPTIONS}
            className="sm:w-48"
          />
        </div>
        <DataTable
          caption="Driver and vehicle performance"
          columns={columns}
          rows={rows}
          rowKey={r => r.id}
          loading={isLoading}
          error={isError ? 'We could not load driver figures. Check your connection and try again.' : undefined}
          onRetry={() => refetch()}
          initialSort={{ key: 'completed', direction: 'desc' }}
          empty={data.length === 0
            ? { title: 'No vehicles yet', description: 'Add vehicles in Fleet to see how each one is used.' }
            : { title: 'No matches', description: 'Try a different search or status.' }}
        />
      </div>
    </div>
  )
}
