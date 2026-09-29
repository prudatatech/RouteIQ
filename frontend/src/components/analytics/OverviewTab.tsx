import { useQuery } from '@tanstack/react-query'
import { IndianRupee, PackageCheck, Route, Truck } from 'lucide-react'
import { analyticsAPI } from '@/services/api'
import { Alert, Button, Stat } from '@/components/ui'
import { ChartCard, SimpleBarChart } from './charts'
import { formatDay, formatNumber, formatRupees } from './format'

interface FleetOverview {
  trips_today: number
  deliveries_today: number
  running_vehicles: number
  idle_vehicles: number
  total_vehicles: number
  fleet_utilisation_pct: number | null
  total_distance_km: number
  backhaul_loads_today: number
  backhaul_revenue: number
}

interface DayActivity {
  date: string
  trips: number
  deliveries: number
}

const REFRESH_MS = 60_000

/** Today's numbers and the last two weeks of trips and deliveries. */
export default function OverviewTab() {
  const overview = useQuery<FleetOverview>({
    queryKey: ['analytics', 'fleet-overview'],
    queryFn: () => analyticsAPI.fleetOverview(),
    refetchInterval: REFRESH_MS,
  })
  const activity = useQuery<DayActivity[]>({
    queryKey: ['analytics', 'daily-activity', 14],
    queryFn: () => analyticsAPI.dailyActivity(14) as Promise<DayActivity[]>,
    refetchInterval: REFRESH_MS,
  })

  const ov = overview.data
  const loading = overview.isLoading
  const days = activity.data ?? []
  const hasActivity = days.some(d => d.trips > 0 || d.deliveries > 0)

  return (
    <div className="space-y-6">
      {overview.isError ? (
        <Alert
          tone="danger"
          title="We could not load today's figures"
          action={<Button variant="secondary" size="sm" onClick={() => overview.refetch()}>Try again</Button>}
        >
          Check your connection and try again.
        </Alert>
      ) : (
        <section aria-label="Today" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          <Stat
            label="Trips today"
            icon={<Route size={18} />}
            loading={loading}
            value={formatNumber(ov?.trips_today)}
            hint={ov && ov.total_distance_km > 0 ? `${formatNumber(ov.total_distance_km)} km planned` : 'No distance planned yet'}
          />
          <Stat
            label="Deliveries today"
            icon={<PackageCheck size={18} />}
            loading={loading}
            value={formatNumber(ov?.deliveries_today)}
            hint="Shipments marked delivered"
          />
          <Stat
            label="Vehicles on route"
            icon={<Truck size={18} />}
            loading={loading}
            value={ov ? `${formatNumber(ov.running_vehicles)} of ${formatNumber(ov.total_vehicles)}` : '—'}
            hint={ov
              ? (ov.fleet_utilisation_pct == null ? 'No vehicles added yet' : `${ov.fleet_utilisation_pct}% in use · ${formatNumber(ov.idle_vehicles)} idle`)
              : undefined}
          />
          <Stat
            label="Backhaul revenue today"
            icon={<IndianRupee size={18} />}
            loading={loading}
            value={ov && ov.backhaul_loads_today > 0 ? formatRupees(ov.backhaul_revenue) : '—'}
            hint={ov
              ? (ov.backhaul_loads_today > 0
                ? `${formatNumber(ov.backhaul_loads_today)} vendor load${ov.backhaul_loads_today === 1 ? '' : 's'} assigned`
                : 'No vendor loads assigned today')
              : undefined}
          />
        </section>
      )}

      <ChartCard
        title="Trips and deliveries"
        description="Routes dispatched and shipments delivered each day, last 14 days"
        loading={activity.isLoading}
        error={activity.isError}
        onRetry={() => activity.refetch()}
        empty={!hasActivity}
        emptyTitle="No trips or deliveries in the last 14 days"
        emptyDescription="Dispatch a route or deliver a shipment and it will show here."
        height="h-72"
      >
        <SimpleBarChart
          data={days}
          categoryKey="date"
          formatCategory={formatDay}
          series={[{ key: 'trips', label: 'Trips' }, { key: 'deliveries', label: 'Deliveries' }]}
          label={`Trips and deliveries per day. Total ${days.reduce((s, d) => s + d.trips, 0)} trips and ${days.reduce((s, d) => s + d.deliveries, 0)} deliveries.`}
        />
      </ChartCard>
    </div>
  )
}
