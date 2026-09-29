import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Building2, IndianRupee, PackageCheck, Percent } from 'lucide-react'
import { analyticsAPI } from '@/services/api'
import { DataTable, SearchInput, Stat, StatusPill, type Column } from '@/components/ui'
import { ChartCard, SimpleBarChart } from './charts'
import { formatNumber, formatPercent } from './format'
import { formatRupees } from '@/utils/display'

interface VendorRow {
  id: string
  name: string | null
  region: string | null
  /** Requests fulfilled or assigned. */
  deliveries: number
  /** Share of requests fulfilled or assigned; null when the vendor has no requests. */
  sla: number | null
  costPerDelivery: number | null
  kyc_status: string | null
}

const columns: Column<VendorRow>[] = [
  { key: 'name', header: 'Vendor', sortValue: r => r.name ?? '', cell: r => r.name ?? '—' },
  { key: 'city', header: 'City', hideBelow: 'md', sortValue: r => r.region ?? '', cell: r => r.region ?? '—' },
  {
    key: 'loads', header: 'Loads carried', align: 'right', sortValue: r => r.deliveries,
    cell: r => <span className="tabular">{formatNumber(r.deliveries)}</span>,
  },
  {
    key: 'rate', header: 'Fulfilment rate', align: 'right', sortValue: r => r.sla,
    cell: r => <span className="tabular">{formatPercent(r.sla)}</span>,
  },
  {
    key: 'cost', header: 'Average cost', align: 'right', hideBelow: 'lg', sortValue: r => r.costPerDelivery,
    cell: r => <span className="tabular">{formatRupees(r.costPerDelivery)}</span>,
  },
  { key: 'kyc', header: 'KYC', sortValue: r => r.kyc_status ?? '', cell: r => <StatusPill status={r.kyc_status} /> },
]

/** Loads vendors have carried and how reliably, from vendor shipment requests. */
export default function VendorsTab() {
  const [search, setSearch] = useState('')
  const { data = [], isLoading, isError, refetch } = useQuery<VendorRow[]>({
    queryKey: ['analytics', 'vendor-performance'],
    queryFn: () => analyticsAPI.vendorPerformance() as Promise<VendorRow[]>,
    refetchInterval: 60_000,
  })

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? data.filter(v => v.name?.toLowerCase().includes(q) || v.region?.toLowerCase().includes(q)) : data
  }, [data, search])

  const kpis = useMemo(() => {
    const withRate = data.filter(v => v.sla != null)
    const withCost = data.filter(v => v.costPerDelivery != null)
    return {
      loads: data.reduce((s, v) => s + v.deliveries, 0),
      rate: withRate.length ? withRate.reduce((s, v) => s + (v.sla ?? 0), 0) / withRate.length : null,
      cost: withCost.length ? Math.round(withCost.reduce((s, v) => s + (v.costPerDelivery ?? 0), 0) / withCost.length) : null,
    }
  }, [data])

  const top = useMemo(() => data
    .filter(v => v.deliveries > 0)
    .sort((a, b) => b.deliveries - a.deliveries)
    .slice(0, 8)
    .map(v => ({ name: v.name ?? 'Unnamed vendor', loads: v.deliveries })), [data])

  const noValue = isError ? '—' : undefined

  return (
    <div className="space-y-6">
      <section aria-label="Totals" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Stat label="Vendors" icon={<Building2 size={18} />} loading={isLoading} value={noValue ?? formatNumber(data.length)} />
        <Stat label="Loads carried" icon={<PackageCheck size={18} />} loading={isLoading} value={noValue ?? formatNumber(kpis.loads)} hint="Requests assigned or fulfilled" />
        <Stat
          label="Fulfilment rate"
          icon={<Percent size={18} />}
          loading={isLoading}
          value={noValue ?? formatPercent(kpis.rate)}
          hint={kpis.rate == null ? 'No vendor loads yet' : 'Average across vendors with loads'}
        />
        <Stat
          label="Average cost per load"
          icon={<IndianRupee size={18} />}
          loading={isLoading}
          value={noValue ?? formatRupees(kpis.cost)}
          hint={kpis.cost == null ? 'No priced loads yet' : undefined}
        />
      </section>

      <ChartCard
        title="Loads carried by vendor"
        description="Top eight vendors by requests assigned or fulfilled"
        loading={isLoading}
        error={isError}
        onRetry={() => refetch()}
        empty={top.length === 0}
        emptyTitle="No vendor loads yet"
        emptyDescription="Vendors appear here once a shipment request is assigned to them."
      >
        <SimpleBarChart
          data={top}
          categoryKey="name"
          horizontal
          series={[{ key: 'loads', label: 'Loads carried' }]}
          label={`Loads carried by the top ${top.length} vendors.`}
        />
      </ChartCard>

      <div className="space-y-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by vendor or city" label="Search vendors" className="sm:max-w-sm" />
        <DataTable
          caption="Vendor performance"
          columns={columns}
          rows={rows}
          rowKey={r => r.id}
          loading={isLoading}
          error={isError ? 'We could not load vendor figures. Check your connection and try again.' : undefined}
          onRetry={() => refetch()}
          initialSort={{ key: 'loads', direction: 'desc' }}
          empty={data.length === 0
            ? { title: 'No vendors yet', description: 'Vendors appear here once they sign up.' }
            : { title: 'No matches', description: 'Try a different search.' }}
        />
      </div>
    </div>
  )
}
