import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { DataTable, SearchInput, StatusPill, buttonClasses, type Column } from '@/components/ui'
import { formatKg, useOpenLoads, type OpenLoad } from './data'

const columns: Column<OpenLoad>[] = [
  {
    key: 'tracking', header: 'Tracking ID', sortValue: r => r.tracking_id,
    cell: r => <span className="font-mono text-sm">{r.tracking_id}</span>,
  },
  { key: 'shipper', header: 'Shipper', sortValue: r => r.shipper ?? '', cell: r => r.shipper ?? '—' },
  { key: 'from', header: 'From', hideBelow: 'lg', sortValue: r => r.origin ?? '', cell: r => r.origin ?? '—' },
  {
    key: 'to', header: 'To', sortValue: r => r.destination ?? '',
    cell: r => (
      <span>
        {r.destination ?? 'No drop location'}
        {r.stops > 1 && <span className="text-muted"> +{r.stops - 1} more</span>}
      </span>
    ),
  },
  {
    key: 'weight', header: 'Weight', align: 'right', sortValue: r => r.weight_kg,
    cell: r => (r.weight_kg == null ? <span className="text-muted">Not recorded</span> : <span className="tabular">{formatKg(r.weight_kg)}</span>),
  },
  {
    key: 'priority', header: 'Priority', hideBelow: 'md', sortValue: r => r.priority ?? '',
    cell: r => (r.priority ? <StatusPill tone={r.priority === 'critical' || r.priority === 'high' ? 'warning' : 'neutral'}>{r.priority.charAt(0).toUpperCase() + r.priority.slice(1)}</StatusPill> : '—'),
  },
  {
    key: 'created', header: 'Created', hideBelow: 'xl', sortValue: r => r.created_at,
    cell: r => new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
  },
]

/** Shipments waiting for a vehicle: the loads that can be pooled or carried on a return trip. */
export default function OpenLoadsTab() {
  const [search, setSearch] = useState('')
  const { data = [], isLoading, isError, refetch } = useOpenLoads()

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return data
    return data.filter(l => [l.tracking_id, l.shipper, l.origin, l.destination].some(v => v?.toLowerCase().includes(q)))
  }, [data, search])

  return (
    <div className="space-y-3">
      <SearchInput value={search} onChange={setSearch} placeholder="Search by tracking ID, shipper or city" label="Search open loads" className="sm:max-w-sm" />
      <DataTable
        caption="Open loads"
        columns={columns}
        rows={rows}
        rowKey={r => r.id}
        loading={isLoading}
        error={isError ? 'We could not load open loads. Check your connection and try again.' : undefined}
        onRetry={() => refetch()}
        initialSort={{ key: 'created', direction: 'desc' }}
        empty={data.length === 0
          ? {
              title: 'No open loads',
              description: 'Every shipment is already on a route. New shipments without a vehicle show up here.',
              action: <Link to="/shipments" className={buttonClasses({ variant: 'secondary' })}>Go to Shipments</Link>,
            }
          : { title: 'No matches', description: 'Try a different search.' }}
      />
    </div>
  )
}
