import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Gauge, Route as RouteIcon, ShieldAlert, Truck, Weight } from 'lucide-react'
import { fleetAPI } from '@/services/api'
import { Alert, Button, Card, CardBody, CardHeader, Select, Stat, StatusPill, buttonClasses } from '@/components/ui'
import { ChartCard, SimpleBarChart } from '@/components/analytics/charts'
import { formatNumber } from '@/components/analytics/format'
import { formatDay } from '@/utils/display'
import { alertTypeLabel } from './health'

interface FleetAnalytics {
  days: number
  from: string
  to: string
  total_vehicles: number
  by_status: { on_route: number; idle: number; maintenance: number; offline: number }
  utilisation_pct: number | null
  active_in_period: number
  active_in_period_pct: number | null
  capacity: { total_kg: number; loaded_kg: number; loaded_pct: number | null }
  distance: {
    total_km: number
    routes: number
    per_day: { date: string; distance_km: number; routes: number }[]
    top_vehicles: { vehicle_id: string; plate_number: string; distance_km: number; routes: number }[]
  }
  alerts: { open: number; acknowledged: number; by_severity: Record<string, number>; last_30_days_by_type: Record<string, number> }
  sos: { total: number; last_30_days: number; open: number; cancelled: number }
}

const PERIODS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
]

const STATUS_ROWS = [
  { key: 'on_route', label: 'On trip', fill: 'bg-info' },
  { key: 'idle', label: 'Idle / available', fill: 'bg-success' },
  { key: 'maintenance', label: 'Maintenance', fill: 'bg-warning' },
  { key: 'offline', label: 'Offline', fill: 'bg-neutral' },
] as const

/** Fleet-wide numbers: how much is in use, where each vehicle is in its life, how far the fleet drove, what went wrong. */
export default function FleetAnalyticsView() {
  const [days, setDays] = useState('30')
  const query = useQuery<FleetAnalytics>({
    queryKey: ['fleet-analytics', days],
    queryFn: () => fleetAPI.analytics(Number(days)) as Promise<FleetAnalytics>,
    refetchInterval: 60_000,
  })
  const d = query.data
  const loading = query.isLoading

  if (query.isError) {
    return (
      <Alert tone="danger" title="We could not load the fleet analytics" action={<Button variant="secondary" size="sm" onClick={() => query.refetch()}>Try again</Button>}>
        Check your connection and try again.
      </Alert>
    )
  }

  const chartDays = (d?.distance.per_day ?? []).map(p => ({ ...p, label: formatDay(p.date) }))
  const hasDistance = (d?.distance.total_km ?? 0) > 0
  const alertTypes = Object.entries(d?.alerts.last_30_days_by_type ?? {}).sort((a, b) => b[1] - a[1])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-muted">{d ? `${formatDay(d.from)} to ${formatDay(d.to)}. Vehicles that are archived or still drafts are not counted.` : 'Loading the fleet numbers.'}</p>
        <Select label="Period" value={days} onChange={e => setDays(e.target.value)} options={PERIODS} className="w-44" />
      </div>

      <section aria-label="Fleet figures" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5">
        <Stat
          label="Utilisation"
          icon={<Gauge size={18} />}
          loading={loading}
          value={d?.utilisation_pct == null ? '—' : `${d.utilisation_pct}%`}
          hint={d ? (d.total_vehicles === 0 ? 'No vehicles added yet' : `${formatNumber(d.by_status.on_route)} of ${formatNumber(d.total_vehicles)} on a trip now`) : undefined}
        />
        <Stat
          label="Active in period"
          icon={<Truck size={18} />}
          loading={loading}
          value={d ? `${formatNumber(d.active_in_period)} of ${formatNumber(d.total_vehicles)}` : '—'}
          hint={d?.active_in_period_pct == null ? undefined : `${d.active_in_period_pct}% ran at least one trip`}
        />
        <Stat
          label="Distance"
          icon={<RouteIcon size={18} />}
          loading={loading}
          value={d ? `${formatNumber(d.distance.total_km)} km` : '—'}
          hint={d ? `${formatNumber(d.distance.routes)} trip${d.distance.routes === 1 ? '' : 's'} dispatched (planned distance)` : undefined}
        />
        <Stat
          label="Load carried"
          icon={<Weight size={18} />}
          loading={loading}
          value={d?.capacity.loaded_pct == null ? '—' : `${d.capacity.loaded_pct}%`}
          hint={d ? `${formatNumber(d.capacity.loaded_kg)} of ${formatNumber(d.capacity.total_kg)} kg capacity` : undefined}
        />
        <Stat
          label="Open alerts"
          icon={<ShieldAlert size={18} />}
          loading={loading}
          value={d ? formatNumber(d.alerts.open + d.alerts.acknowledged + d.sos.open) : '—'}
          tone={d && d.sos.open > 0 ? 'danger' : d && d.alerts.open > 0 ? 'warning' : 'default'}
          hint={d ? `${formatNumber(d.alerts.open + d.alerts.acknowledged)} fleet alerts, ${formatNumber(d.sos.open)} SOS` : undefined}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Status breakdown" description="Where each vehicle is right now" />
          <CardBody className="space-y-3">
            {STATUS_ROWS.map(row => {
              const n = d?.by_status[row.key] ?? 0
              const share = d && d.total_vehicles > 0 ? Math.round((n / d.total_vehicles) * 100) : 0
              return (
                <div key={row.key} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text">{row.label}</span>
                    <span className="tabular text-muted">{loading ? '…' : `${formatNumber(n)} · ${share}%`}</span>
                  </div>
                  <div role="progressbar" aria-label={`${row.label}: ${share}% of the fleet`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={share} className="h-2 overflow-hidden rounded-full bg-neutral-soft">
                    <div className={`h-full rounded-full ${row.fill}`} style={{ width: `${share}%` }} />
                  </div>
                </div>
              )
            })}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Alerts and SOS" description="What went wrong" />
          <CardBody className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-muted">Fleet alerts open</p>
                <p className="text-lg font-semibold tabular text-text">{loading ? '…' : formatNumber((d?.alerts.open ?? 0) + (d?.alerts.acknowledged ?? 0))}</p>
                <p className="text-xs text-muted">{formatNumber(d?.alerts.acknowledged ?? 0)} acknowledged</p>
              </div>
              <div>
                <p className="text-muted">SOS raised</p>
                <p className="text-lg font-semibold tabular text-text">{loading ? '…' : formatNumber(d?.sos.total ?? 0)}</p>
                <p className="text-xs text-muted">{formatNumber(d?.sos.last_30_days ?? 0)} in the last 30 days, {formatNumber(d?.sos.cancelled ?? 0)} cancelled</p>
              </div>
            </div>
            {alertTypes.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-text">Fleet alerts in the last 30 days</p>
                <div className="flex flex-wrap gap-1.5">
                  {alertTypes.map(([type, n]) => <StatusPill key={type} tone="neutral" dot={false}>{alertTypeLabel(type)}: {n}</StatusPill>)}
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Link to="/fleet?tab=alerts" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>Open fleet alerts</Link>
              <Link to="/emergency" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>Open emergencies</Link>
            </div>
          </CardBody>
        </Card>
      </div>

      <ChartCard
        title="Distance per day"
        description="Planned kilometres of the trips dispatched each day"
        loading={loading}
        empty={!hasDistance}
        emptyTitle="No trips dispatched in this period"
        emptyDescription="Dispatch a trip and its distance shows here."
        height="h-64"
      >
        <SimpleBarChart
          data={chartDays}
          categoryKey="label"
          series={[{ key: 'distance_km', label: 'Distance (km)' }]}
          formatValue={n => `${formatNumber(n)} km`}
          label={`Distance dispatched each day, ${d?.distance.total_km ?? 0} km in total.`}
        />
      </ChartCard>

      <Card>
        <CardHeader title="Most distance" description="Vehicles with the longest trips dispatched in the period" />
        <CardBody>
          {(d?.distance.top_vehicles.length ?? 0) === 0 ? (
            <p className="text-sm text-muted">{loading ? 'Loading…' : 'No vehicle has a dispatched trip in this period.'}</p>
          ) : (
            <ol className="divide-y divide-border">
              {d!.distance.top_vehicles.map(v => (
                <li key={v.vehicle_id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <Link to={`/fleet/${v.vehicle_id}`} className="font-mono text-brand hover:underline">{v.plate_number}</Link>
                  <span className="tabular text-muted">{formatNumber(v.distance_km)} km · {formatNumber(v.routes)} trip{v.routes === 1 ? '' : 's'}</span>
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
