import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ArrowRight, Check, Clock, Truck, X } from 'lucide-react'
import clsx from 'clsx'
import {
  Alert, Button, Card, DataTable, EmptyState, ErrorState, Input, Modal, SectionHeader, Skeleton, StatusPill, useConfirm,
  type Column,
} from '@/components/ui'
import { tplNetworkAPI, type TplOffer, type TplOrder } from '@/services/api'
import { useNow } from '@/hooks/useNow'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { errorMessage, formatDateTime, formatKg, formatRelative, formatRupees } from '@/utils/display'
import { ORDER_STEPS, nextOrderStep, orderStepIndex } from './orderSteps'

const shortPlace = (p: string | null | undefined) => (p ?? '').split(',')[0].trim() || '—'

/** `datetime-local` value to an ISO string, or undefined when empty. */
const toIso = (value: string) => (value ? new Date(value).toISOString() : undefined)

/** "12 min", "2 h 5 min" or "3 days": how long an offer has been waiting. */
function waiting(since: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - new Date(since).getTime()) / 60_000))
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours >= 48) return `${Math.floor(hours / 24)} days`
  return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`
}

function AcceptModal({ offer, onClose, onDone }: { offer: TplOffer | null; onClose: () => void; onDone: () => void }) {
  const [pickup, setPickup] = useState('')
  const [delivery, setDelivery] = useState('')
  const [amount, setAmount] = useState('')
  const needsAmount = offer != null && offer.proposed_price == null
  const amountNumber = Number(amount)
  const amountError = amount !== '' && (!Number.isFinite(amountNumber) || amountNumber <= 0) ? 'Enter an amount above 0' : undefined
  const timeError = pickup && delivery && new Date(delivery) <= new Date(pickup) ? 'Delivery must be after pickup' : undefined

  const accept = useMutation({
    mutationFn: () => tplNetworkAPI.accept(offer!.id, {
      pickup_eta: toIso(pickup),
      delivery_eta: toIso(delivery),
      // An amount the partner types is what they will charge, and wins over the rate on their corridor
      ...(amount !== '' ? { agreed_amount: amountNumber } : {}),
    }),
    onSuccess: () => { toast.success('Load accepted. It is now in your orders.'); onDone(); onClose() },
    onError: err => { toast.error(errorMessage(err, 'We could not accept this load. Try again.')); onDone() },
  })

  return (
    <Modal
      open={!!offer}
      onClose={onClose}
      onSubmit={() => accept.mutate()}
      title="Accept this load"
      description={offer ? `${shortPlace(offer.pickup_location)} to ${shortPlace(offer.drop_location)}` : undefined}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            icon={<Check size={16} />}
            loading={accept.isPending}
            disabled={!!amountError || !!timeError || (needsAmount && amount === '')}
          >
            Accept load
          </Button>
        </>
      )}
    >
      {offer && (
        <div className="space-y-4">
          <p className="text-sm text-text">
            {offer.proposed_price != null
              ? <>At your corridor rate on {offer.corridor_name} you will be paid <span className="font-semibold">{formatRupees(offer.proposed_price)}</span>.</>
              : 'There is no rate for this load on your corridor (or it is per km and the distance is not known), so enter the amount you will charge.'}
          </p>
          <Input
            label="Amount (₹)"
            type="number"
            min={0}
            required={needsAmount}
            hint={needsAmount ? undefined : 'Optional. Enter a different amount if you will charge more or less than your rate.'}
            value={amount}
            onChange={e => setAmount(e.target.value)}
            error={amountError}
          />
          <Input
            label="Pickup time"
            type="datetime-local"
            hint="Optional. When your vehicle will reach the pickup."
            value={pickup}
            onChange={e => setPickup(e.target.value)}
          />
          <Input
            label="Delivery time"
            type="datetime-local"
            hint="Optional. If you leave it blank, your SLA commitment sets when delivery is due."
            value={delivery}
            onChange={e => setDelivery(e.target.value)}
            error={timeError}
          />
        </div>
      )}
    </Modal>
  )
}

/** Where an order is on its way, as a line of steps; the current one is marked for screen readers too. */
function OrderProgress({ status }: { status: TplOrder['status'] }) {
  const at = orderStepIndex(status)
  return (
    <ol className="grid grid-cols-4 gap-1.5" aria-label="Order progress">
      {ORDER_STEPS.map((step, i) => (
        <li key={step.status} aria-current={i === at ? 'step' : undefined}>
          <span className={clsx('block h-1.5 rounded-full', i <= at ? 'bg-brand-fill' : 'bg-neutral-soft')} aria-hidden="true" />
          <span className={clsx('mt-1 block truncate text-xs', i === at ? 'font-medium text-text' : 'text-muted')}>{step.label}</span>
        </li>
      ))}
    </ol>
  )
}

/**
 * The partner's Orders page: loads offered to them (accept before another partner takes it), then the orders
 * they accepted, each with the one step to do next, then finished orders and past offers.
 */
export function TplOrdersTab({ canAccept }: { canAccept: boolean }) {
  const queryClient = useQueryClient()
  const { prompt } = useConfirm()
  const now = useNow(30_000)
  const [accepting, setAccepting] = useState<TplOffer | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()

  const offers = useQuery({ queryKey: ['tpl-my-offers'], queryFn: tplNetworkAPI.myOffers })
  const orders = useQuery({ queryKey: ['tpl-my-orders'], queryFn: tplNetworkAPI.myOrders })

  // Opened from a notification: ?open=<offer id> opens that offer to accept, then the param is dropped
  useEffect(() => {
    const openId = searchParams.get('open')
    if (!openId || offers.isLoading) return
    const match = (offers.data ?? []).find(o => o.id === openId && o.status === 'offered')
    if (match) setAccepting(match)
    setSearchParams(params => { params.delete('open'); return params }, { replace: true })
  }, [searchParams, setSearchParams, offers.data, offers.isLoading])
  useRealtimeRefresh('tpl_partner_orders', ['tpl_offers', 'tpl_orders'], [['tpl-my-offers'], ['tpl-my-orders'], ['tpl-my-earnings'], ['tpl-my-stats']])

  const refresh = () => {
    for (const key of ['tpl-my-offers', 'tpl-my-orders', 'tpl-my-earnings', 'tpl-my-stats']) queryClient.invalidateQueries({ queryKey: [key] })
  }

  const decline = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => tplNetworkAPI.decline(id, reason),
    onSuccess: () => toast.success('Load declined'),
    onError: err => toast.error(errorMessage(err, 'We could not decline this load. Try again.')),
    onSettled: refresh,
  })

  const update = useMutation({
    mutationFn: ({ id, status, note }: { id: string; status: 'picked_up' | 'in_transit' | 'delivered'; note?: string }) =>
      tplNetworkAPI.updateOrder(id, status, note),
    onSuccess: (_o, v) => toast.success(v.status === 'delivered' ? 'Marked delivered.' : 'Order updated.'),
    onError: err => toast.error(errorMessage(err, 'We could not update this order. Try again.')),
    onSettled: refresh,
  })

  const askDecline = async (o: TplOffer) => {
    const reason = await prompt({
      title: 'Decline this load?',
      message: `${shortPlace(o.pickup_location)} to ${shortPlace(o.drop_location)}. Dispatch sees your reason.`,
      inputLabel: 'Reason',
      placeholder: 'For example, no vehicle free on that date',
      confirmLabel: 'Decline load',
      tone: 'danger',
      required: true,
    })
    if (reason) decline.mutate({ id: o.id, reason })
  }

  const advance = async (o: TplOrder) => {
    const step = nextOrderStep(o.status)
    if (!step) return
    if (step.status === 'delivered') {
      const note = await prompt({
        title: 'Mark as delivered?',
        message: 'Add a proof of delivery note. Dispatch and the vendor can see it.',
        inputLabel: 'Proof of delivery note',
        placeholder: 'For example, received by A. Kumar at the gate',
        confirmLabel: 'Mark delivered',
        required: true,
      })
      if (note) update.mutate({ id: o.id, status: step.status, note })
      return
    }
    update.mutate({ id: o.id, status: step.status })
  }

  const openOffers = useMemo(() => (offers.data ?? []).filter(o => o.status === 'offered'), [offers.data])
  const pastOffers = useMemo(() => (offers.data ?? []).filter(o => o.status !== 'offered' && o.status !== 'accepted'), [offers.data])
  const allOrders = orders.data ?? []
  const liveOrders = allOrders.filter(o => o.status !== 'delivered' && o.status !== 'cancelled')
  const doneOrders = allOrders.filter(o => o.status === 'delivered' || o.status === 'cancelled')

  const doneColumns: Column<TplOrder>[] = [
    {
      key: 'route', header: 'Trip',
      cell: o => (
        <span className="inline-flex max-w-xs items-center gap-1.5" title={`${o.pickup_location} to ${o.drop_location}`}>
          <span className="truncate">{shortPlace(o.pickup_location)}</span>
          <ArrowRight size={14} aria-label="to" className="shrink-0 text-muted" />
          <span className="truncate">{shortPlace(o.drop_location)}</span>
        </span>
      ),
    },
    { key: 'amount', header: 'Agreed amount', align: 'right', cell: o => <span className="tabular">{formatRupees(o.agreed_amount)}</span>, sortValue: o => Number(o.agreed_amount) },
    { key: 'status', header: 'Status', cell: o => <StatusPill status={o.status} />, sortValue: o => o.status },
    {
      key: 'done', header: 'Finished', hideBelow: 'md',
      cell: o => (o.delivered_at ? `Delivered ${formatRelative(o.delivered_at, now)}` : <span className="text-muted">Cancelled</span>),
      sortValue: o => (o.delivered_at ? new Date(o.delivered_at).getTime() : null),
    },
    { key: 'pod', header: 'Proof of delivery', hideBelow: 'lg', cell: o => <span className="text-sm text-muted">{o.pod_note ?? '—'}</span> },
  ]

  const pastColumns: Column<TplOffer>[] = [
    {
      key: 'route', header: 'Trip',
      cell: o => <span>{shortPlace(o.pickup_location)} to {shortPlace(o.drop_location)}</span>,
    },
    { key: 'price', header: 'Rate', align: 'right', cell: o => <span className="tabular">{o.proposed_price != null ? formatRupees(o.proposed_price) : '—'}</span> },
    { key: 'status', header: 'Outcome', cell: o => <StatusPill status={o.status} /> },
    {
      key: 'detail', header: 'Details', hideBelow: 'md',
      cell: o => <span className="text-sm text-muted">{o.status === 'declined' ? o.decline_reason : o.status === 'taken' ? 'Another partner accepted first' : formatRelative(o.offered_at, now)}</span>,
    },
  ]

  if (offers.error || orders.error) {
    return <ErrorState description="We could not load your orders. Check your connection and try again." onRetry={() => { offers.refetch(); orders.refetch() }} />
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <SectionHeader title="Load offers" description="Accept before another partner does: the first partner to accept gets the load." />
        {!canAccept && <Alert tone="warning">Your account is not active, so you cannot accept loads until it is approved again.</Alert>}
        {offers.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : openOffers.length === 0 ? (
          <Card padded>
            <EmptyState compact icon={<Truck size={22} />} title="No load offers right now" description="When dispatch has a load on one of your corridors, it shows up here and you get a notification." />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {openOffers.map(o => (
              <Card key={o.id} padded className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 text-base font-semibold text-text">
                      {shortPlace(o.pickup_location)} <ArrowRight size={14} aria-label="to" className="text-muted" /> {shortPlace(o.drop_location)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {[o.corridor_name, o.weight_kg != null ? formatKg(o.weight_kg) : null].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <p className="shrink-0 text-lg font-semibold tabular text-text">{o.proposed_price != null ? formatRupees(o.proposed_price) : 'Quote needed'}</p>
                </div>
                <p className="flex items-center gap-1.5 text-sm text-warning">
                  <Clock size={14} aria-hidden="true" /> Waiting {waiting(o.offered_at, now)}, still yours to take
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button icon={<Check size={16} />} disabled={!canAccept || decline.isPending} onClick={() => setAccepting(o)}>Accept</Button>
                  <Button
                    variant="secondary"
                    icon={<X size={16} />}
                    disabled={decline.isPending}
                    loading={decline.isPending && decline.variables?.id === o.id}
                    onClick={() => askDecline(o)}
                  >
                    Decline
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <SectionHeader title="Active orders" description="Loads you accepted. Do the next step as each one moves." />
        {orders.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : liveOrders.length === 0 ? (
          <Card padded>
            <EmptyState compact icon={<Truck size={22} />} title="No active orders" description="Accept a load offer and it appears here." />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {liveOrders.map(o => {
              const step = nextOrderStep(o.status)
              const late = o.due_by != null && new Date(o.due_by).getTime() < now
              return (
                <Card key={o.id} padded className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-1.5 text-base font-semibold text-text" title={`${o.pickup_location} to ${o.drop_location}`}>
                        {shortPlace(o.pickup_location)} <ArrowRight size={14} aria-label="to" className="text-muted" /> {shortPlace(o.drop_location)}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">
                        {[o.weight_kg != null ? formatKg(o.weight_kg) : null, `Accepted ${formatRelative(o.accepted_at, now)}`].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <p className="shrink-0 text-lg font-semibold tabular text-text">{formatRupees(o.agreed_amount)}</p>
                  </div>
                  <OrderProgress status={o.status} />
                  <p className={clsx('text-sm', late ? 'font-medium text-danger' : 'text-muted')}>
                    {o.due_by ? `${late ? 'Was due' : 'Due by'} ${formatDateTime(o.due_by)}` : 'No due time set'}
                  </p>
                  {step && (
                    <Button
                      fullWidth
                      icon={<Truck size={16} />}
                      disabled={update.isPending}
                      loading={update.isPending && update.variables?.id === o.id}
                      onClick={() => advance(o)}
                    >
                      {step.label}
                    </Button>
                  )}
                </Card>
              )
            })}
          </div>
        )}
      </section>

      {doneOrders.length > 0 && (
        <section className="space-y-3">
          <SectionHeader title="Finished orders" />
          <DataTable caption="Finished orders" columns={doneColumns} rows={doneOrders} rowKey={o => o.id} pageSize={10} />
        </section>
      )}

      {pastOffers.length > 0 && (
        <section className="space-y-3">
          <SectionHeader title="Past offers" description="Offers you declined, that another partner took, or that dispatch withdrew." />
          <DataTable caption="Past offers" columns={pastColumns} rows={pastOffers} rowKey={o => o.id} pageSize={10} />
        </section>
      )}

      <AcceptModal key={accepting?.id ?? 'none'} offer={accepting} onClose={() => setAccepting(null)} onDone={refresh} />
    </div>
  )
}
