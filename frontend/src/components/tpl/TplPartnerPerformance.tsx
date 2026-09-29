import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Star } from 'lucide-react'
import {
  Button, Card, CardHeader, DataTable, ErrorState, Modal, Select, Stat, StatusPill, Textarea, useConfirm, type Column,
} from '@/components/ui'
import { tplNetworkAPI, type TplOrder } from '@/services/api'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { errorMessage, formatDate, formatDateTime, formatRupees, formatMinutes } from '@/utils/display'
import { formatPercent, formatRating } from './stats'

const shortPlace = (p: string | null | undefined) => (p ?? '').split(',')[0].trim() || '—'
const RATING_OPTIONS = [5, 4, 3, 2, 1].map(n => ({ value: String(n), label: `${n} out of 5` }))

function RateModal({ order, onClose }: { order: TplOrder | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [rating, setRating] = useState(order?.rating ? String(order.rating) : '')
  const [note, setNote] = useState(order?.rating_note ?? '')
  const save = useMutation({
    mutationFn: () => tplNetworkAPI.rateOrder(order!.id, Number(rating), note.trim() || undefined),
    onSuccess: () => {
      toast.success('Rating saved')
      queryClient.invalidateQueries({ queryKey: ['tpl-partner-orders'] })
      queryClient.invalidateQueries({ queryKey: ['tpl-partner-stats'] })
      onClose()
    },
    onError: err => toast.error(errorMessage(err, 'We could not save the rating. Try again.')),
  })
  return (
    <Modal
      open={!!order}
      onClose={onClose}
      title="Rate this delivery"
      description={order ? `${shortPlace(order.pickup_location)} to ${shortPlace(order.drop_location)}` : undefined}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} disabled={!rating} onClick={() => save.mutate()}>Save rating</Button>
        </>
      )}
    >
      <div className="space-y-4">
        <Select label="Rating" required placeholder="Choose 1 to 5" options={RATING_OPTIONS} value={rating} onChange={e => setRating(e.target.value)} />
        <Textarea label="Note" hint="Optional. Only staff see this." rows={3} maxLength={500} value={note} onChange={e => setNote(e.target.value)} />
      </div>
    </Modal>
  )
}

/** Staff view of one partner: how they perform, and their orders with rating and payment. */
export function TplPartnerPerformance({ partnerId, slaCommitment }: { partnerId: string; slaCommitment: string | null }) {
  const queryClient = useQueryClient()
  const { prompt, confirm } = useConfirm()
  const [rating, setRating] = useState<TplOrder | null>(null)

  const stats = useQuery({ queryKey: ['tpl-partner-stats', partnerId], queryFn: () => tplNetworkAPI.partnerStats(partnerId) })
  const orders = useQuery({ queryKey: ['tpl-partner-orders', partnerId], queryFn: () => tplNetworkAPI.orders(partnerId) })
  useRealtimeRefresh(`tpl_partner_perf_${partnerId}`, ['tpl_offers', 'tpl_orders'], [['tpl-partner-stats', partnerId], ['tpl-partner-orders', partnerId]])

  const paid = useMutation({
    mutationFn: ({ id, paid: isPaid, reference }: { id: string; paid: boolean; reference?: string }) => tplNetworkAPI.markPaid(id, isPaid, reference),
    onSuccess: (_o, v) => toast.success(v.paid ? 'Marked as paid.' : 'Marked as unpaid.'),
    onError: err => toast.error(errorMessage(err, 'We could not update the payment. Try again.')),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['tpl-partner-orders'] }),
  })

  const askPaid = async (o: TplOrder) => {
    const reference = await prompt({
      title: `Mark ${formatRupees(o.agreed_amount)} as paid?`,
      message: 'The partner is told. Add the payment reference if you have one.',
      inputLabel: 'Payment reference',
      placeholder: 'For example, the bank transfer reference',
      confirmLabel: 'Mark paid',
    })
    if (reference !== null) paid.mutate({ id: o.id, paid: true, reference: reference || undefined })
  }

  const askUnpaid = async (o: TplOrder) => {
    const ok = await confirm({ title: 'Mark as unpaid?', message: 'Use this if the payment was marked by mistake.', confirmLabel: 'Mark unpaid' })
    if (ok) paid.mutate({ id: o.id, paid: false })
  }

  const isLate = (o: TplOrder) => !!o.due_by && new Date(o.delivered_at ?? Date.now()).getTime() > new Date(o.due_by).getTime()

  const columns: Column<TplOrder>[] = [
    { key: 'route', header: 'Route', cell: o => <span>{shortPlace(o.pickup_location)} to {shortPlace(o.drop_location)}</span> },
    { key: 'amount', header: 'Agreed amount', align: 'right', cell: o => <span className="tabular">{formatRupees(o.agreed_amount)}</span>, sortValue: o => Number(o.agreed_amount) },
    {
      key: 'status', header: 'Status',
      cell: o => (
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill status={o.status} />
          {o.status !== 'cancelled' && isLate(o) && <StatusPill tone="danger" dot={false}>{o.status === 'delivered' ? 'Delivered late' : 'Overdue'}</StatusPill>}
        </div>
      ),
      sortValue: o => o.status,
    },
    {
      key: 'due', header: 'Due by', hideBelow: 'lg',
      cell: o => (o.due_by ? formatDateTime(o.due_by) : <span className="text-muted">Not set</span>),
    },
    {
      key: 'rating', header: 'Rating', hideBelow: 'md',
      cell: o => (o.status !== 'delivered' ? <span className="text-muted">After delivery</span> : (
        <Button size="sm" variant="ghost" icon={<Star size={14} />} onClick={() => setRating(o)}>
          {o.rating ? `${o.rating} out of 5` : 'Rate'}
        </Button>
      )),
    },
    {
      key: 'payment', header: 'Payment', align: 'right',
      cell: o => {
        if (o.status !== 'delivered') return <span className="text-muted">After delivery</span>
        return o.paid_at ? (
          <span className="inline-flex items-center gap-2">
            <StatusPill tone="success">Paid {formatDate(o.paid_at)}</StatusPill>
            <Button size="sm" variant="ghost" disabled={paid.isPending} onClick={() => askUnpaid(o)}>Undo</Button>
          </span>
        ) : (
          <Button size="sm" variant="secondary" loading={paid.isPending && paid.variables?.id === o.id} disabled={paid.isPending} onClick={() => askPaid(o)}>Mark paid</Button>
        )
      },
    },
  ]

  const st = stats.data
  return (
    <Card padded>
      <CardHeader title="Performance and orders" description="From the offers this partner answered and the orders they carried." className="-mx-4 -mt-4 sm:-mx-6" />
      <div className="space-y-6 pt-6">
        {stats.error ? (
          <ErrorState compact description="We could not load the partner statistics." onRetry={() => stats.refetch()} />
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat
              label="Acceptance rate"
              value={formatPercent(st?.acceptance_rate)}
              hint={st && st.offers_accepted + st.offers_declined > 0 ? `${st.offers_accepted} accepted, ${st.offers_declined} declined` : 'No offers answered yet'}
              loading={stats.isLoading}
            />
            <Stat
              label="Response time"
              value={formatMinutes(st?.avg_response_minutes)}
              hint={st?.avg_response_minutes != null ? 'Average, offer to answer' : 'No offers answered yet'}
              loading={stats.isLoading}
            />
            <Stat
              label="Orders delivered"
              value={st ? st.orders_completed.toLocaleString('en-IN') : '—'}
              hint={st ? `${st.orders_active.toLocaleString('en-IN')} still active` : undefined}
              loading={stats.isLoading}
            />
            <Stat
              label="SLA breaches"
              value={st ? st.sla_breaches.toLocaleString('en-IN') : '—'}
              tone={st && st.sla_breaches > 0 ? 'warning' : 'default'}
              hint={st ? `Of ${st.sla_measured.toLocaleString('en-IN')} ${st.sla_measured === 1 ? 'order' : 'orders'} with a due time. Commitment: ${slaCommitment || 'not set'}` : undefined}
              loading={stats.isLoading}
            />
            <Stat
              label="Staff rating"
              value={formatRating(st?.rating_avg)}
              hint={st && st.rating_count > 0 ? `${st.rating_count} rated` : 'No ratings yet'}
              loading={stats.isLoading}
            />
          </div>
        )}
        <DataTable
          caption="Partner orders"
          columns={columns}
          rows={orders.data ?? []}
          rowKey={o => o.id}
          loading={orders.isLoading}
          error={orders.error ? 'We could not load this partner’s orders.' : undefined}
          onRetry={() => orders.refetch()}
          empty={{ title: 'No orders yet', description: 'Orders appear here when this partner accepts a load you escalated.' }}
        />
      </div>
      <RateModal key={rating?.id ?? 'none'} order={rating} onClose={() => setRating(null)} />
    </Card>
  )
}
