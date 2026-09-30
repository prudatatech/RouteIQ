import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Coins, IndianRupee, Route, Scale, Truck, Wallet } from 'lucide-react'
import {
  Alert, Button, Card, CardHeader, DataTable, DateRangeControl, presetRange, Stat, buttonClasses, type Column, type DateRangeValue,
} from '@/components/ui'
import { formatDate, formatDay, formatRupees } from '@/utils/display'
import { ChartCard, SimpleBarChart, SimpleLineChart } from './charts'
import { formatNumber } from './format'
import { useFinanceSummary, type FinanceSummary } from './useFinanceSummary'

type RouteRow = FinanceSummary['routes'][number]
type VehicleRow = FinanceSummary['vehicles'][number]
type CorridorRow = FinanceSummary['corridors'][number]

const money = (n: number) => formatRupees(Math.round(n))
const profitClass = (n: number) => (n < 0 ? 'text-danger' : 'text-text')

const routeColumns: Column<RouteRow>[] = [
  {
    key: 'route', header: 'Trip', sortValue: r => r.plate_number ?? '',
    cell: r => (
      <Link to={`/routes/${r.route_id}`} className="font-medium text-brand hover:underline">
        {r.plate_number ?? 'Trip'} · {r.completed_at ? formatDate(r.completed_at) : 'in progress'}
      </Link>
    ),
  },
  { key: 'km', header: 'Distance', align: 'right', hideBelow: 'md', sortValue: r => r.distance_km, cell: r => (r.distance_km != null ? `${formatNumber(r.distance_km)} km` : '—') },
  { key: 'revenue', header: 'Revenue', align: 'right', sortValue: r => r.revenue, cell: r => <span className="tabular">{money(r.revenue)}</span> },
  {
    key: 'costs', header: 'Costs', align: 'right', hideBelow: 'md', sortValue: r => r.costs,
    cell: r => <span className="tabular">{money(r.costs)}{r.fuel_estimated && <span className="text-muted"> (fuel est.)</span>}</span>,
  },
  { key: 'profit', header: 'Profit', align: 'right', sortValue: r => r.profit, cell: r => <span className={`tabular font-medium ${profitClass(r.profit)}`}>{money(r.profit)}</span> },
]

const vehicleColumns: Column<VehicleRow>[] = [
  { key: 'plate', header: 'Truck', sortValue: v => v.plate_number, cell: v => <span className="font-mono text-sm">{v.plate_number}</span> },
  { key: 'revenue', header: 'Revenue', align: 'right', sortValue: v => v.revenue, cell: v => <span className="tabular">{money(v.revenue)}</span> },
  { key: 'costs', header: 'Costs', align: 'right', hideBelow: 'md', sortValue: v => v.costs, cell: v => <span className="tabular">{money(v.costs)}</span> },
  { key: 'profit', header: 'Profit', align: 'right', sortValue: v => v.profit, cell: v => <span className={`tabular font-medium ${profitClass(v.profit)}`}>{money(v.profit)}</span> },
]

const corridorColumns: Column<CorridorRow>[] = [
  { key: 'corridor', header: 'Corridor', sortValue: c => c.pickup, cell: c => `${c.pickup} to ${c.drop}` },
  { key: 'loads', header: 'Loads', align: 'right', sortValue: c => c.loads, cell: c => <span className="tabular">{formatNumber(c.loads)}</span> },
  { key: 'revenue', header: 'Revenue', align: 'right', sortValue: c => c.revenue, cell: c => <span className="tabular font-medium">{money(c.revenue)}</span> },
]

/** Profit and loss from invoices, recorded expenses and the fuel estimate. */
export default function FinanceTab() {
  const [range, setRange] = useState<DateRangeValue>({ preset: '30d', ...presetRange('30d') })
  const summary = useFinanceSummary(range)
  const s = summary.data
  const loading = summary.isLoading
  const rangeLabel = range.from === range.to ? formatDay(range.from) : `${formatDay(range.from)} to ${formatDay(range.to)}`
  const hasData = !!s && (s.revenue > 0 || s.costs.total > 0 || s.invoice_count > 0)
  const chartDays = s?.daily ?? []
  const categoryBars = (s?.costs.by_category ?? []).filter(c => c.amount > 0).map(c => ({ name: c.label, amount: c.amount }))

  return (
    <div className="space-y-6">
      <DateRangeControl value={range} onChange={setRange} />

      {summary.isError && (
        <Alert
          tone="danger"
          title="We could not load profit and loss"
          action={<Button variant="secondary" size="sm" onClick={() => summary.refetch()}>Try again</Button>}
        >
          Check your connection and try again.
        </Alert>
      )}

      {s?.fuel.price_missing && (
        <Alert
          tone="warning"
          title="Fuel price is not set"
          action={<Link to="/admin/settings" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>Set fuel price</Link>}
        >
          Fuel for completed trips is left out of costs until there is a price per litre. Recorded fuel expenses are still counted.
        </Alert>
      )}
      {s && !s.fuel.price_missing && s.fuel.routes_without_fuel_data > 0 && (
        <Alert tone="info" title={`${s.fuel.routes_without_fuel_data} completed ${s.fuel.routes_without_fuel_data === 1 ? 'trip has' : 'trips have'} no fuel estimate`}>
          There is no distance or fuel figure for {s.fuel.routes_without_fuel_data === 1 ? 'it' : 'them'}. Add a fuel expense to count the cost.
        </Alert>
      )}

      <section aria-label={`Profit and loss for ${rangeLabel}`} className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
        <Stat label="Revenue" icon={<IndianRupee size={18} />} loading={loading} value={s ? money(s.revenue) : '—'}
          hint={s ? (s.invoice_count > 0 ? `${formatNumber(s.invoice_count)} invoice${s.invoice_count === 1 ? '' : 's'}, before GST` : 'No invoices in this range') : undefined} />
        <Stat label="Costs" icon={<Wallet size={18} />} loading={loading} value={s ? money(s.costs.total) : '—'}
          hint={s ? (s.costs.fuel_estimated > 0 ? `Includes ${money(s.costs.fuel_estimated)} estimated fuel` : 'Recorded expenses') : undefined} />
        <Stat label="Net profit" icon={<Scale size={18} />} loading={loading} value={s ? money(s.net_profit) : '—'}
          tone={s ? (s.net_profit < 0 ? 'danger' : s.net_profit > 0 ? 'success' : 'default') : 'default'}
          hint="Revenue minus costs" />
        <Stat label="Profit per truck" icon={<Truck size={18} />} loading={loading}
          value={s?.profit_per_truck != null ? money(s.profit_per_truck) : '—'}
          hint={s ? (s.active_trucks > 0 ? `Across ${formatNumber(s.active_trucks)} truck${s.active_trucks === 1 ? '' : 's'} that worked` : 'No truck activity in this range') : undefined} />
        <Stat label="Cost per km" icon={<Route size={18} />} loading={loading}
          value={s?.cost_per_km != null ? formatRupees(s.cost_per_km) : '—'}
          hint={s ? (s.distance_km > 0 ? `Over ${formatNumber(Math.round(s.distance_km))} km of completed trips` : 'No completed trips with distance') : undefined} />
        <Stat label="Not yet paid" icon={<Coins size={18} />} loading={loading} value={s ? money(s.outstanding) : '—'}
          tone={s && s.outstanding > 0 ? 'warning' : 'default'} hint="Issued invoices, with GST" />
      </section>

      <ChartCard
        title="Profit and loss by day"
        description={`Revenue and costs each day, ${rangeLabel}`}
        loading={loading}
        error={summary.isError}
        onRetry={() => summary.refetch()}
        empty={!hasData}
        emptyTitle="No invoices or expenses in this range"
        emptyDescription="Deliver a priced load or add an expense in Finance and it will show here."
        height="h-72"
      >
        <SimpleBarChart
          data={chartDays}
          categoryKey="date"
          formatCategory={formatDay}
          formatValue={money}
          series={[{ key: 'revenue', label: 'Revenue' }, { key: 'costs', label: 'Costs' }]}
          label={`Revenue and costs per day. Revenue ${s ? money(s.revenue) : ''}, costs ${s ? money(s.costs.total) : ''}.`}
        />
      </ChartCard>

      {hasData && (
        <div className="grid gap-6 xl:grid-cols-2">
          <ChartCard title="Net profit by day" description="Revenue minus costs. Below zero means a loss." height="h-64">
            <SimpleLineChart data={chartDays} categoryKey="date" series={{ key: 'profit', label: 'Profit' }} formatValue={money} label="Net profit per day" />
          </ChartCard>
          <ChartCard
            title="Costs by category"
            description="Recorded expenses, plus fuel estimated from trip litres"
            empty={categoryBars.length === 0}
            emptyTitle="No costs in this range"
            emptyDescription="Add an expense in Finance to see where the money goes."
            height="h-64"
          >
            <SimpleBarChart
              data={categoryBars}
              categoryKey="name"
              horizontal
              formatValue={money}
              series={[{ key: 'amount', label: 'Cost' }]}
              label={`Costs by category. ${categoryBars.map(c => `${c.name} ${money(c.amount)}`).join(', ')}.`}
            />
          </ChartCard>
        </div>
      )}

      {hasData && (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader title="Most profitable trips" description="Delivered revenue minus costs tied to the trip" />
            <div className="p-2 sm:p-4">
              <DataTable
                caption="Most profitable trips"
                columns={routeColumns}
                rows={s?.routes ?? []}
                rowKey={r => r.route_id}
                pageSize={10}
                initialSort={{ key: 'profit', direction: 'desc' }}
                empty={{ title: 'No trip has revenue or costs yet', description: 'Trips show here once their deliveries are invoiced or expenses are tied to them.' }}
              />
            </div>
          </Card>
          <Card>
            <CardHeader title="Profit by truck" description="Revenue and costs for each truck that worked in this range" />
            <div className="p-2 sm:p-4">
              <DataTable
                caption="Profit by truck"
                columns={vehicleColumns}
                rows={s?.vehicles ?? []}
                rowKey={v => v.vehicle_id}
                pageSize={10}
                initialSort={{ key: 'profit', direction: 'desc' }}
                empty={{ title: 'No truck activity in this range' }}
              />
            </div>
          </Card>
        </div>
      )}

      {hasData && (s?.corridors.length ?? 0) > 0 && (
        <Card>
          <CardHeader title="Vendor load corridors" description="Revenue from delivered vendor loads by pickup and drop" />
          <div className="p-2 sm:p-4">
            <DataTable
              caption="Vendor load corridors"
              columns={corridorColumns}
              rows={s?.corridors ?? []}
              rowKey={c => `${c.pickup}|${c.drop}`}
              pageSize={10}
              initialSort={{ key: 'revenue', direction: 'desc' }}
            />
          </div>
        </Card>
      )}
    </div>
  )
}
