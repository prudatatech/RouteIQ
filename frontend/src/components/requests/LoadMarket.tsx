import { useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { companyLoadsAPI } from '@/services/api'
import { DataTable, StatusPill, Tabs, useTabParam, type Column } from '@/components/ui'
import { useCountdown } from '@/components/vendor/quoteTime'
import { formatDate, formatKg, formatRupees } from '@/utils/display'
import type { MarketLoad, MarketTab } from '@/types/routing'
import PriorityBadge from './PriorityBadge'
import { freightRange } from './quoteRules'

const MARKET_TABS: readonly MarketTab[] = ['new', 'quoted', 'won', 'lost']
const MARKET_LABELS: Record<MarketTab, string> = { new: 'New', quoted: 'Quoted', won: 'Won', lost: 'Lost' }
const EMPTY_TITLES: Record<MarketTab, string> = {
  new: 'No new loads right now',
  quoted: 'You have not quoted on any load',
  won: 'No won loads yet',
  lost: 'No lost loads',
}

/** The badge: a quote is wanted, and how long is left. */
function QuoteBadge({ load }: { load: MarketLoad }) {
  const left = useCountdown(load.quote_requested ? load.quote_deadline : null)
  if (!load.quote_requested) return <span className="text-muted">{freightRange(load) ? 'Book in range' : 'Direct accept'}</span>
  return <StatusPill tone={left === 'Time is up' ? 'warning' : 'info'}>{left ? `Quote wanted, ${left}` : 'Quote wanted'}</StatusPill>
}

const columns: Column<MarketLoad>[] = [
  { key: 'number', header: 'Load', sortValue: r => r.load_number, cell: r => <span className="font-mono font-medium">{r.load_number}</span> },
  {
    key: 'lane', header: 'Lane',
    cell: r => (
      <span className="flex flex-wrap items-center gap-x-1.5">
        <span className="break-words">{r.pickup_city}</span>
        <ArrowRight size={14} aria-label="to" className="shrink-0 text-muted" />
        <span className="break-words">{r.delivery_city}</span>
      </span>
    ),
  },
  {
    key: 'date', header: 'Pickup date', hideBelow: 'lg', sortValue: r => r.pickup_date,
    cell: r => (r.pickup_date ? formatDate(r.pickup_date) : <span className="text-muted">Any day</span>),
  },
  { key: 'weight', header: 'Weight', hideBelow: 'lg', align: 'right', sortValue: r => r.weight_kg, cell: r => <span className="tabular">{formatKg(r.weight_kg)}</span> },
  { key: 'value', header: 'Value', hideBelow: 'xl', align: 'right', sortValue: r => r.declared_value, cell: r => <span className="tabular">{r.declared_value ? formatRupees(r.declared_value) : '—'}</span> },
  { key: 'priority', header: 'Priority', cell: r => <PriorityBadge priority={r.priority} /> },
  {
    key: 'range', header: 'Recommended freight', align: 'right', sortValue: r => r.price_min_inr ?? r.budget_inr,
    cell: r => {
      const range = freightRange(r)
      if (range) return <span className="tabular" data-testid={`range-${r.id}`}>{formatRupees(range.min)} – {formatRupees(range.max)}</span>
      return <span className="tabular">{r.budget_inr ? formatRupees(r.budget_inr) : <span className="text-muted">Not given</span>}</span>
    },
  },
  { key: 'quote', header: 'Quote', cell: r => <QuoteBadge load={r} /> },
  {
    key: 'mine', header: 'My quote', align: 'right', sortValue: r => r.my_quote?.amount_inr,
    cell: r => (r.my_quote ? <span className="tabular font-medium">{formatRupees(r.my_quote.amount_inr)}</span> : <span className="text-muted">None</span>),
  },
]

/** The loads this company can quote on: New, Quoted, Won and Lost. A row opens the load drawer. */
export default function LoadMarket({ onOpen, selectedId }: { onOpen: (id: string) => void; selectedId?: string | null }) {
  const [tab, setTab] = useTabParam<MarketTab>(MARKET_TABS, 'new', 'market')
  const market = useQuery({
    queryKey: ['company', 'market', tab],
    queryFn: () => companyLoadsAPI.market(tab),
    refetchInterval: 30_000,
  })

  return (
    <div className="space-y-3">
      <Tabs label="Filter loads" tabs={MARKET_TABS.map(id => ({ id, label: MARKET_LABELS[id] }))} value={tab} onChange={setTab} />
      <DataTable
        caption="New loads"
        columns={columns}
        rows={market.data ?? []}
        rowKey={r => r.id}
        loading={market.isLoading}
        error={market.isError ? 'We could not load the loads. Check your connection and try again.' : undefined}
        onRetry={() => market.refetch()}
        onRowClick={r => onOpen(r.id)}
        selectedKey={selectedId ?? null}
        empty={{ title: EMPTY_TITLES[tab], description: 'Loads from vendors on your lanes appear here.' }}
      />
    </div>
  )
}
