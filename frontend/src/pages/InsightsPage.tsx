import { useMemo, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CloudOff, Moon, Route as RouteIcon } from 'lucide-react'
import { analyticsAPI } from '@/services/api'
import { trafficAPI } from '@/services/pricing'
import {
  Button, Card, CardBody, CardHeader, DataTable, EmptyState, ErrorState, Page, PageHeader, Skeleton, Stat, StatusPill, buttonClasses,
  type Column,
} from '@/components/ui'
import { formatNumber } from '@/components/analytics/format'

interface Insight {
  id: string
  type: 'delay_risk' | 'idle_vehicle' | 'reroute_suggestion' | 'backhaul_opportunity' | string
  title: string
  insight: string
  vehicle_id?: string
  severity?: 'high' | 'medium' | 'low'
  saved_mins?: number
}

interface DemandRow { city: string; open_loads: number; available_vehicles: number; gap: number }
interface ForecastRow { origin: string; destination: string; loads_last_28_days: number; daily_average: number; expected_next_7_days: number }
interface Demand {
  demand: DemandRow[]
  loads_without_city: number
  vehicles_without_city: number
  forecast: ForecastRow[]
  forecast_method: string
}

/** What the fleet needs attention for, and where loads are wanted. Every figure is read from live data; empty sections say so. */
export default function InsightsPage() {
  const insights = useQuery<Insight[]>({
    queryKey: ['insights', 'live'],
    queryFn: () => analyticsAPI.insights() as Promise<Insight[]>,
    refetchInterval: 30_000,
  })
  const demand = useQuery<Demand>({
    queryKey: ['insights', 'demand'],
    queryFn: () => analyticsAPI.demand() as Promise<Demand>,
    refetchInterval: 5 * 60_000,
  })

  const byType = useMemo(() => {
    const groups: Record<string, Insight[]> = { delay_risk: [], idle_vehicle: [], reroute_suggestion: [], backhaul_opportunity: [] }
    for (const i of insights.data ?? []) (groups[i.type] ??= []).push(i)
    return groups
  }, [insights.data])

  const loading = insights.isLoading
  const count = (type: string) => (insights.isError ? '—' : formatNumber(byType[type]?.length ?? 0))

  return (
    <Page>
      <PageHeader title="Insights" description="What needs attention across the fleet right now, and where loads are wanted." />

      <section aria-label="Summary" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Delay risks" icon={<AlertTriangle size={18} />} loading={loading} value={count('delay_risk')} tone={byType.delay_risk.length > 0 ? 'danger' : 'default'} hint="Vehicles slow and far from their next stop" />
        <Stat label="Idle vehicles" icon={<Moon size={18} />} loading={loading} value={count('idle_vehicle')} tone={byType.idle_vehicle.length > 0 ? 'warning' : 'default'} hint="Idle for a day or more" />
        <Stat label="Reroute suggestions" icon={<RouteIcon size={18} />} loading={loading} value={count('reroute_suggestion')} hint="Faster orders found for trips on the road" />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <InsightCard
          title="Delay risk"
          description="Vehicles that are moving slowly and are far from their next stop."
          query={insights}
          items={byType.delay_risk}
          empty="No vehicle looks delayed right now."
          action={i => i.vehicle_id ? { label: 'Show on map', to: `/live-map?vehicle=${i.vehicle_id}` } : null}
        />
        <InsightCard
          title="Idle vehicles"
          description="Vehicles that have had the idle status for a day or more."
          query={insights}
          items={byType.idle_vehicle}
          empty="No vehicle has been idle for a day or more."
          action={i => i.vehicle_id ? { label: 'View vehicle', to: `/fleet/${i.vehicle_id}` } : null}
        />
        <InsightCard
          title="Reroute suggestions"
          description="Better stop orders found for vehicles on the road. Apply them from Route optimization."
          query={insights}
          items={byType.reroute_suggestion}
          empty="No reroute suggestions right now."
          action={() => ({ label: 'Open Route optimization', to: '/optimize' })}
        />
        <InsightCard
          title="Empty return trips"
          description="Vehicles that have finished their stops and may return empty."
          query={insights}
          items={byType.backhaul_opportunity}
          empty="No vehicle is heading back empty."
          action={() => ({ label: 'Open Bids', to: '/bids' })}
        />
      </div>

      <TrafficIncidentsCard />

      <DemandSection query={demand} />
    </Page>
  )
}

function InsightCard({ title, description, query, items, empty, action }: {
  title: string
  description: string
  query: { isLoading: boolean; isError: boolean; refetch: () => unknown }
  items: Insight[]
  empty: string
  action: (i: Insight) => { label: string; to: string } | null
}) {
  const navigate = useNavigate()
  return (
    <Card>
      <CardHeader title={title} description={description} />
      {query.isLoading ? (
        <CardBody><Skeleton className="h-16 w-full" /></CardBody>
      ) : query.isError ? (
        <ErrorState compact description="We could not load insights. Check your connection and try again." onRetry={() => query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState compact title={empty} />
      ) : (
        <ul className="divide-y divide-border">
          {items.map(i => {
            const a = action(i)
            return (
              <li key={i.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:px-6">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-text">{i.title}</p>
                    {i.severity && <StatusPill status={i.severity} />}
                  </div>
                  <p className="text-sm text-muted">{i.insight}</p>
                </div>
                {a && <Button size="sm" variant="secondary" className="shrink-0" onClick={() => navigate(a.to)}>{a.label}</Button>}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

const demandColumns: Column<DemandRow>[] = [
  { key: 'city', header: 'Pickup city', sortValue: r => r.city, cell: r => r.city },
  { key: 'loads', header: 'Open loads', align: 'right', sortValue: r => r.open_loads, cell: r => <span className="tabular">{formatNumber(r.open_loads)}</span> },
  { key: 'vehicles', header: 'Available vehicles', align: 'right', sortValue: r => r.available_vehicles, cell: r => <span className="tabular">{formatNumber(r.available_vehicles)}</span> },
  {
    key: 'gap', header: 'Balance', align: 'right', sortValue: r => r.gap,
    cell: r => r.gap > 0
      ? <StatusPill tone="warning">{formatNumber(r.gap)} more {r.gap === 1 ? 'load' : 'loads'} than vehicles</StatusPill>
      : r.gap < 0
        ? <StatusPill tone="info">{formatNumber(-r.gap)} spare {r.gap === -1 ? 'vehicle' : 'vehicles'}</StatusPill>
        : <StatusPill tone="success">Balanced</StatusPill>,
  },
]

const forecastColumns: Column<ForecastRow>[] = [
  { key: 'corridor', header: 'Corridor', sortValue: r => `${r.origin} ${r.destination}`, cell: r => `${r.origin} to ${r.destination}` },
  { key: 'past', header: 'Loads, last 28 days', align: 'right', sortValue: r => r.loads_last_28_days, cell: r => <span className="tabular">{formatNumber(r.loads_last_28_days)}</span> },
  { key: 'daily', header: 'Per day, last 7 days', align: 'right', hideBelow: 'md', sortValue: r => r.daily_average, cell: r => <span className="tabular">{r.daily_average.toLocaleString('en-IN')}</span> },
  { key: 'next', header: 'Expected, next 7 days', align: 'right', sortValue: r => r.expected_next_7_days, cell: r => <span className="tabular font-medium">{r.expected_next_7_days.toLocaleString('en-IN')}</span> },
]

function DemandSection({ query }: { query: { data?: Demand; isLoading: boolean; isError: boolean; refetch: () => unknown } }) {
  const data = query.data
  const error = query.isError ? 'We could not load demand figures. Check your connection and try again.' : undefined
  const notes: ReactNode[] = []
  if (data && data.loads_without_city > 0) notes.push(`${formatNumber(data.loads_without_city)} open ${data.loads_without_city === 1 ? 'load has' : 'loads have'} no pickup city and ${data.loads_without_city === 1 ? 'is' : 'are'} not counted.`)
  if (data && data.vehicles_without_city > 0) notes.push(`${formatNumber(data.vehicles_without_city)} available ${data.vehicles_without_city === 1 ? 'vehicle has' : 'vehicles have'} no location name and ${data.vehicles_without_city === 1 ? 'is' : 'are'} not counted. Set it in Fleet.`)

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-text">Demand by pickup city</h2>
          <p className="mt-0.5 text-sm text-muted">Loads waiting for a vehicle, against vehicles that are available, by where the load is picked up.</p>
        </div>
        <DataTable
          caption="Open loads and available vehicles by pickup city"
          columns={demandColumns}
          rows={data?.demand ?? []}
          rowKey={r => r.city}
          loading={query.isLoading}
          error={error}
          onRetry={() => query.refetch()}
          initialSort={{ key: 'gap', direction: 'desc' }}
          empty={{ title: 'No open loads or available vehicles', description: 'Loads waiting for a vehicle appear here, grouped by pickup city.' }}
        />
        {notes.length > 0 && <ul className="space-y-1 text-sm text-muted">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-text">Forecast: loads in the next 7 days</h2>
          <p className="mt-0.5 text-sm text-muted">
            {data?.forecast_method ?? 'An estimate from recent history, not a promise.'} A corridor needs at least 3 loads in that time to be shown.
          </p>
        </div>
        <DataTable
          caption="Forecast of loads per corridor for the next 7 days"
          columns={forecastColumns}
          rows={data?.forecast ?? []}
          rowKey={r => `${r.origin}>${r.destination}`}
          loading={query.isLoading}
          error={error}
          onRetry={() => query.refetch()}
          initialSort={{ key: 'next', direction: 'desc' }}
          empty={{ title: 'Not enough history to forecast', description: 'Forecasts appear once a corridor has at least 3 loads in the last 28 days.' }}
        />
        <p className="text-sm text-muted">
          Want to plan against this? <Link to="/optimize" className={buttonClasses({ variant: 'ghost', size: 'sm' })}>Open Route optimization</Link>
        </p>
      </section>
    </div>
  )
}

/** Live incidents from traffic monitoring on the roads active routes use. */
function TrafficIncidentsCard() {
  const incidents = useQuery({ queryKey: ['traffic', 'incidents'], queryFn: () => trafficAPI.incidents(), refetchInterval: 120_000 })
  const list = incidents.data?.incidents ?? []

  let body: ReactNode
  if (incidents.isLoading) {
    body = <div className="p-4"><Skeleton className="h-16 w-full" /></div>
  } else if (incidents.isError) {
    body = <EmptyState compact icon={<AlertTriangle size={22} />} title="We could not load traffic incidents" description="Check your connection and try again." />
  } else if (!incidents.data?.configured) {
    body = (
      <EmptyState
        compact
        icon={<CloudOff size={22} />}
        title="Traffic data not configured"
        description="Add a TomTom key on the server to see accidents and closures on active routes."
      />
    )
  } else if (list.length === 0) {
    body = <EmptyState compact icon={<RouteIcon size={22} />} title="No incidents on active routes" description="Checked on the latest traffic refresh." />
  } else {
    body = (
      <ul className="divide-y divide-border">
        {list.map(i => (
          <li key={i.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="min-w-0">
              <p className="text-sm font-medium text-text">{i.description || i.type}</p>
              <p className="text-xs text-muted">
                {i.road ? `${i.road} · ` : ''}
                {i.delay_seconds ? `+${Math.round(i.delay_seconds / 60)} min delay · ` : ''}
                {i.affected_route_ids.length} {i.affected_route_ids.length === 1 ? 'route' : 'routes'} affected
              </p>
            </div>
            <StatusPill tone={i.severity >= 3 ? 'danger' : 'warning'}>{i.severity >= 3 ? 'Major' : 'Minor'}</StatusPill>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <Card>
      <CardHeader title="Traffic incidents" description="Accidents and closures on the roads your vehicles use." />
      {body}
    </Card>
  )
}
