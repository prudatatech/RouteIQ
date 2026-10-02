import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Check } from 'lucide-react'
import { vendorAPI } from '@/services/api'
import { Alert, Button, Card, EmptyState, ErrorState, Skeleton, StatusPill, useConfirm } from '@/components/ui'
import { errorMessage, formatDate, formatRupees } from '@/utils/display'
import { useCountdown } from './quoteTime'

/** The Quotes card on a posted load: what companies offered, Accept, the countdown, and who won. */
export default function LoadQuotes({ loadId }: { loadId: string }) {
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const quotes = useQuery({
    queryKey: ['vendor', 'load-quotes', loadId],
    queryFn: () => vendorAPI.loadQuotes(loadId),
    // Realtime is not needed: look again every 30 seconds until the load is awarded
    refetchInterval: query => (query.state.data?.awarded ? false : 30_000),
  })
  const data = quotes.data
  const countdown = useCountdown(data && !data.awarded ? data.quote_deadline : null)

  const accept = useMutation({
    mutationFn: (quoteId: string) => vendorAPI.acceptQuote(loadId, quoteId),
    onSuccess: () => {
      toast.success('Quote accepted. The company has been told.')
      queryClient.invalidateQueries({ queryKey: ['vendor'] })
    },
    onError: err => toast.error(errorMessage(err, 'We could not accept this quote. Try again.')),
  })

  const askAccept = async (quote: { id: string; company_name: string; amount_inr: number }) => {
    const ok = await confirm({
      title: `Accept ${quote.company_name}'s quote?`,
      message: `Your load goes to ${quote.company_name} at ${formatRupees(quote.amount_inr)}. The other companies are told it is taken. You cannot undo this.`,
      confirmLabel: 'Accept quote',
    })
    if (ok) accept.mutate(quote.id)
  }

  let body
  if (quotes.isLoading) body = <Skeleton className="h-24 w-full" />
  else if (quotes.isError || !data) body = <ErrorState compact title="We could not load the quotes" description="Check your connection and try again." onRetry={() => quotes.refetch()} />
  else if (data.awarded) {
    body = (
      <Alert tone="success" title={`Awarded to ${data.awarded.company_name} at ${formatRupees(data.awarded.amount_inr)}`}>
        They will assign a vehicle and a driver. You can follow the load below.
      </Alert>
    )
  } else {
    const live = data.quotes.filter(q => q.status === 'submitted')
    body = live.length === 0 ? (
      <EmptyState compact title="No quotes yet" description={data.quote_requested ? 'Quotes usually arrive within 2 hours. This page checks again by itself.' : 'Companies can also accept your budget straight away.'} />
    ) : (
      <ul className="space-y-3">
        {live.map(q => (
          <li key={q.id} className="flex flex-col gap-3 rounded-control border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1 text-sm">
              <p className="font-medium text-text">{q.company_name}</p>
              <p className="text-muted">{q.trips_completed.toLocaleString('en-IN')} {q.trips_completed === 1 ? 'trip' : 'trips'} completed</p>
              <p className="text-muted">
                {q.valid_until && <>Valid until {formatDate(q.valid_until)}</>}
                {q.valid_until && q.pickup_eta && ' · '}
                {q.pickup_eta && <>Pickup by {formatDate(q.pickup_eta)}</>}
              </p>
              {q.notes && <p className="break-words text-text">{q.notes}</p>}
            </div>
            <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
              <span className="text-lg font-semibold tabular text-text">{formatRupees(q.amount_inr)}</span>
              <Button size="sm" icon={<Check size={14} />} loading={accept.isPending && accept.variables === q.id} disabled={accept.isPending} onClick={() => askAccept(q)}>Accept</Button>
            </div>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <Card padded className="space-y-3 !p-4" aria-label="Quotes">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-text">Quotes</h2>
        {countdown && <StatusPill tone={countdown === 'Time is up' ? 'warning' : 'info'}>{countdown}</StatusPill>}
      </div>
      {body}
    </Card>
  )
}
