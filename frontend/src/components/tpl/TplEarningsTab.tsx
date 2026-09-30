import { useQuery } from '@tanstack/react-query'
import { IndianRupee } from 'lucide-react'
import { Card, DataTable, EmptyState, ErrorState, SectionHeader, Stat, StatusPill, type Column } from '@/components/ui'
import { tplNetworkAPI, type TplOrder } from '@/services/api'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { formatDate, formatRupees } from '@/utils/display'

const shortPlace = (p: string | null | undefined) => (p ?? '').split(',')[0].trim() || '—'

/** "2026-09" as "September 2026". */
function monthLabel(month: string) {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

const columns: Column<TplOrder>[] = [
  { key: 'route', header: 'Trip', cell: o => <span>{shortPlace(o.pickup_location)} to {shortPlace(o.drop_location)}</span> },
  { key: 'status', header: 'Order', hideBelow: 'md', cell: o => <StatusPill status={o.status} /> },
  {
    key: 'when', header: 'Date', hideBelow: 'md',
    cell: o => formatDate(o.delivered_at ?? o.accepted_at),
    sortValue: o => new Date(o.delivered_at ?? o.accepted_at).getTime(),
  },
  { key: 'amount', header: 'Agreed amount', align: 'right', cell: o => <span className="tabular">{formatRupees(o.agreed_amount)}</span>, sortValue: o => Number(o.agreed_amount) },
  {
    key: 'paid', header: 'Payment',
    cell: o => (o.paid_at
      ? <StatusPill tone="success">Paid {formatDate(o.paid_at)}</StatusPill>
      : o.status === 'delivered'
        ? <StatusPill tone="warning">Payable</StatusPill>
        : <StatusPill tone="neutral">In progress</StatusPill>),
    sortValue: o => (o.paid_at ? 2 : o.status === 'delivered' ? 1 : 0),
  },
]

/**
 * The partner's "Earnings" tab: the amounts agreed on accepted orders, by month. An order is in progress until it
 * is delivered, payable once delivered, and paid when dispatch marks it so; only a delivered order can be paid.
 */
export function TplEarningsTab() {
  const earnings = useQuery({ queryKey: ['tpl-my-earnings'], queryFn: tplNetworkAPI.myEarnings })
  useRealtimeRefresh('tpl_partner_earnings', ['tpl_orders'], [['tpl-my-earnings']])

  if (earnings.error) {
    return <ErrorState description="We could not load your earnings. Check your connection and try again." onRetry={() => earnings.refetch()} />
  }
  const data = earnings.data
  if (!earnings.isLoading && (!data || data.months.length === 0)) {
    return (
      <Card padded>
        <EmptyState
          icon={<IndianRupee size={22} />}
          title="No earnings yet"
          description="Once you accept a load, its agreed amount is listed here: in progress until it is delivered, then payable until dispatch pays it."
        />
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Agreed in total" value={formatRupees(data?.totals.total)} hint="All accepted orders" loading={earnings.isLoading} />
        <Stat label="In progress" value={formatRupees(data?.totals.in_progress)} hint="Accepted, not delivered yet" loading={earnings.isLoading} />
        <Stat label="Payable" value={formatRupees(data?.totals.payable)} tone={data && data.totals.payable > 0 ? 'warning' : 'default'} hint="Delivered, waiting for dispatch to pay" loading={earnings.isLoading} />
        <Stat label="Paid" value={formatRupees(data?.totals.paid)} tone="success" loading={earnings.isLoading} />
      </div>
      {(data?.months ?? []).map(m => (
        <section key={m.month} className="space-y-3">
          <SectionHeader
            title={monthLabel(m.month)}
            description={`${formatRupees(m.total)} agreed · ${formatRupees(m.in_progress)} in progress · ${formatRupees(m.payable)} payable · ${formatRupees(m.paid)} paid`}
          />
          <DataTable caption={`Orders in ${monthLabel(m.month)}`} columns={columns} rows={m.orders} rowKey={o => o.id} />
        </section>
      ))}
    </div>
  )
}
