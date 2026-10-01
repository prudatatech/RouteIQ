import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Network } from 'lucide-react'
import { Alert, Button, EmptyState, ErrorState, Input, Skeleton, StatusPill, useConfirm } from '@/components/ui'
import { tplNetworkAPI, type TplOffer, type TplSource } from '@/services/api'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { errorMessage, formatDateTime, formatRelative, formatRupees } from '@/utils/display'
import { rateText } from './constants'

const sourceId = (s: TplSource) => ('request_id' in s ? s.request_id : s.shipment_id)

function offerDetail(o: TplOffer): string {
  switch (o.status) {
    case 'offered': return `Sent ${formatRelative(o.offered_at)}`
    case 'accepted': return `Accepted ${formatRelative(o.responded_at)}${o.pickup_eta ? `, pickup ${formatDateTime(o.pickup_eta)}` : ''}`
    case 'declined': return `Declined: ${o.decline_reason ?? 'no reason given'}`
    case 'taken': return 'Another partner accepted first'
    default: return 'You withdrew this offer'
  }
}

/**
 * Sends a load to the 3PL partners whose corridors match, shows how each answered, and lets staff
 * withdraw open offers. Used in the vendor request drawer and the shipment drawer.
 * `canEscalate` says whether the load is in a state that can still be sent out. For a vendor request,
 * `vendorPrice` is what the vendor pays for it (null when staff have not set one): the vendor's invoice is made
 * from it when the partner delivers, so it can be set here before or after the load is sent.
 */
export function EscalationPanel({ source, canEscalate, vendorPrice }: { source: TplSource; canEscalate: boolean; vendorPrice?: number | null }) {
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const id = sourceId(source)
  const listKey = ['tpl-escalation', id]
  const isRequest = 'request_id' in source
  const [priceInput, setPriceInput] = useState(vendorPrice ? String(vendorPrice) : '')
  const priceNumber = Number(priceInput)
  const priceError = priceInput !== '' && (!Number.isFinite(priceNumber) || priceNumber <= 0) ? 'Enter an amount above 0' : undefined

  const escalation = useQuery({ queryKey: listKey, queryFn: () => tplNetworkAPI.escalations(source) })
  useRealtimeRefresh(`tpl_escalation_${id}`, ['tpl_offers', 'tpl_orders'], [listKey])

  const offers = useMemo(() => escalation.data?.offers ?? [], [escalation.data])
  const order = escalation.data?.order ?? null
  const open = offers.filter(o => o.status === 'offered')
  const holding = new Set(offers.filter(o => o.status === 'offered' || o.status === 'accepted').map(o => o.partner_id))

  const preview = useQuery({
    queryKey: ['tpl-escalation-preview', id],
    queryFn: () => tplNetworkAPI.preview(source),
    enabled: canEscalate && !order,
    retry: false,
  })
  const newPartners = (preview.data?.partners ?? []).filter(p => !holding.has(p.partner_id))

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: listKey })
    queryClient.invalidateQueries({ queryKey: ['tpl-escalation-preview', id] })
    queryClient.invalidateQueries({ queryKey: ['vendor-requests'] })
    queryClient.invalidateQueries({ queryKey: ['shipments'] })
  }

  const send = useMutation({
    mutationFn: () => tplNetworkAPI.escalate(source, isRequest && priceInput !== '' && !priceError ? priceNumber : undefined),
    onSuccess: r => toast.success(`Sent to ${r.created} 3PL ${r.created === 1 ? 'partner' : 'partners'}. The first to accept gets the load.`),
    onError: err => toast.error(errorMessage(err, 'We could not send this load to partners. Try again.')),
    onSettled: refresh,
  })
  const savePrice = useMutation({
    mutationFn: () => tplNetworkAPI.setVendorPrice(id, priceNumber),
    onSuccess: r => toast.success(r.invoice === 'created' ? 'Price saved. The vendor was invoiced.' : 'Price saved.'),
    onError: err => toast.error(errorMessage(err, 'We could not save the price. Try again.')),
    onSettled: refresh,
  })
  const withdrawOne = useMutation({
    mutationFn: (offerId: string) => tplNetworkAPI.withdrawOffer(offerId),
    onSuccess: () => toast.success('Offer withdrawn'),
    onError: err => toast.error(errorMessage(err, 'We could not withdraw this offer. Try again.')),
    onSettled: refresh,
  })
  const withdrawAll = useMutation({
    mutationFn: () => tplNetworkAPI.withdrawAll(source),
    onSuccess: () => toast.success('All open offers withdrawn'),
    onError: err => toast.error(errorMessage(err, 'We could not withdraw the offers. Try again.')),
    onSettled: refresh,
  })

  const askSend = async () => {
    const names = newPartners.map(p => `${p.company_name} (${partnerRate(p)})`).join(', ')
    const ok = await confirm({
      title: `Send to ${newPartners.length} 3PL ${newPartners.length === 1 ? 'partner' : 'partners'}?`,
      message: `${names}. Each one is offered this load at their corridor rate (a partner without a usable rate quotes an amount when accepting), and the first to accept gets it.`,
      confirmLabel: 'Send offers',
    })
    if (ok) send.mutate()
  }

  const partnerRate = (p: { price: number | null; rate: { amount: number; unit: 'per_trip' | 'per_km' } | null }) => {
    if (!p.rate) return 'quotes per load'
    const text = rateText(p.rate.amount, p.rate.unit)
    return p.rate.unit === 'per_km' ? (p.price != null ? `${text}, about ${formatRupees(p.price)}` : `${text}, distance unknown`) : text
  }

  const askWithdrawOne = async (offerId: string, partnerName: string | null | undefined) => {
    const who = partnerName ?? 'this partner'
    const ok = await confirm({
      title: `Withdraw the offer to ${who}?`,
      message: `${who} will be told this load is no longer available to them. Offers to other partners stay open.`,
      confirmLabel: 'Withdraw offer',
      tone: 'danger',
    })
    if (ok) withdrawOne.mutate(offerId)
  }

  const askWithdrawAll = async () => {
    const ok = await confirm({
      title: 'Withdraw every open offer?',
      message: 'Partners who have not answered yet will be told the load is no longer available.',
      confirmLabel: 'Withdraw offers',
      tone: 'danger',
    })
    if (ok) withdrawAll.mutate()
  }

  return (
    <section aria-labelledby={`escalation-${id}`} className="space-y-3">
      <div>
        <h3 id={`escalation-${id}`} className="text-base font-semibold text-text">3PL partners</h3>
        <p className="mt-0.5 text-sm text-muted">
          Offer this load to partners with a corridor from the pickup to the drop-off. The first partner to accept gets it.
        </p>
      </div>

      {isRequest && (
        <div className="flex flex-wrap items-end gap-2">
          <Input
            label="Price for the vendor (₹)"
            type="number"
            min={0}
            className="w-56"
            hint={vendorPrice ? 'What the vendor pays. Their invoice is made from this.' : 'What the vendor pays. Without it the vendor cannot be invoiced.'}
            value={priceInput}
            onChange={e => setPriceInput(e.target.value)}
            error={priceError}
          />
          {(order || !canEscalate) && (
            <Button
              size="sm"
              variant="secondary"
              disabled={priceInput === '' || !!priceError || Number(priceInput) === vendorPrice}
              loading={savePrice.isPending}
              onClick={() => savePrice.mutate()}
            >
              Save price
            </Button>
          )}
        </div>
      )}

      {escalation.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : escalation.error ? (
        <ErrorState compact description="We could not load the partner offers." onRetry={() => escalation.refetch()} />
      ) : (
        <>
          {order && (
            <Alert tone="success" title={`Assigned to ${order.partner_name ?? 'a 3PL partner'}`}>
              <span className="flex flex-wrap items-center gap-2">
                Partner charges {formatRupees(order.agreed_amount)}
                <StatusPill status={order.status} />
                {order.due_by && <span>Due by {formatDateTime(order.due_by)}</span>}
              </span>
            </Alert>
          )}

          {offers.length > 0 && (
            <ul className="divide-y divide-border rounded-control border border-border">
              {offers.map(o => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text">{o.partner_name ?? 'Partner'}</p>
                    <p className="text-xs text-muted">
                      {[o.corridor_name, o.proposed_price != null ? formatRupees(o.proposed_price) : 'Rate to be quoted'].filter(Boolean).join(' · ')}
                    </p>
                    <p className="text-xs text-muted">{offerDetail(o)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill status={o.status} />
                    {o.status === 'offered' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={withdrawOne.isPending || withdrawAll.isPending}
                        loading={withdrawOne.isPending && withdrawOne.variables === o.id}
                        onClick={() => askWithdrawOne(o.id, o.partner_name)}
                      >
                        Withdraw
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {open.length > 1 && (
            <Button size="sm" variant="secondary" loading={withdrawAll.isPending} disabled={withdrawOne.isPending} onClick={askWithdrawAll}>
              Withdraw all open offers
            </Button>
          )}

          {canEscalate && !order && (
            preview.isLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : (preview.error as { response?: { status?: number } } | null)?.response?.status === 409 ? (
              // The load is not free to go to a partner (taken, bidding open, ...): say so quietly, it is not a failure
              <p className="text-sm text-muted">{errorMessage(preview.error, 'This load cannot go to a partner right now.')}</p>
            ) : preview.error ? (
              <ErrorState compact description={errorMessage(preview.error, 'We could not check which partners match.')} onRetry={() => preview.refetch()} />
            ) : newPartners.length === 0 ? (
              offers.length === 0 && (
                <EmptyState
                  compact
                  icon={<Network size={22} />}
                  title="No partner covers this trip"
                  description="No active 3PL partner has a corridor from this pickup to this drop-off. Partners add corridors on their dashboard."
                />
              )
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-text">
                  {newPartners.length.toLocaleString('en-IN')} active {newPartners.length === 1 ? 'partner covers' : 'partners cover'} this trip:{' '}
                  {newPartners.map(p => `${p.company_name} (${partnerRate(p)})`).join(', ')}.
                </p>
                <Button icon={<Network size={16} />} loading={send.isPending} onClick={askSend}>
                  {offers.length > 0 ? 'Send to more partners' : 'Escalate to 3PL partners'}
                </Button>
              </div>
            )
          )}
        </>
      )}
    </section>
  )
}
