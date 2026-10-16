import type { AxiosError } from 'axios'
import type { QuoteOk } from '@/services/pricing'
import { Alert, Button, Skeleton, StatusPill } from '@/components/ui'
import { type usePriceQuote } from './usePriceQuote'
import { formatKm, formatRupees } from '@/utils/display'
import PriceRecommendationModal from '@/components/load-post/PriceRecommendationModal'

function errorText(err: unknown): string {
  const detail = (err as AxiosError<{ detail?: unknown }>)?.response?.data?.detail
  return typeof detail === 'string' && detail ? detail : 'We could not work out a price. Check the details and try again.'
}

/** The suggested range with the reasons behind it. Shows loading, "no price" and error states. */
export function PriceSuggestion({ query, onUse, useLabel = 'Use suggested price', idle }: {
  query: ReturnType<typeof usePriceQuote>
  /** Puts the suggested price into a form. Leave out when there is nothing to fill in. */
  onUse?: (quote: QuoteOk) => void
  useLabel?: string
  /** Shown before the inputs are complete. */
  idle?: string
}) {
  const { data, isLoading, isFetching, error, fetchStatus } = query

  if (error) return <Alert tone="danger">{errorText(error)}</Alert>
  if (!data && fetchStatus === 'idle' && !isLoading) {
    return idle ? <p className="text-sm text-muted">{idle}</p> : null
  }
  if (!data) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Working out a price">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>
    )
  }
  if (data.status === 'unavailable') {
    return (
      <Alert tone="warning" title="No suggested price yet">
        {data.reason}
        {data.notes.length > 0 && <ul className="mt-1 list-disc pl-5 text-muted">{data.notes.map(n => <li key={n}>{n}</li>)}</ul>}
      </Alert>
    )
  }

  return (
    <div className={isFetching ? 'space-y-4 opacity-70' : 'space-y-4'}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs text-muted">Suggested price</p>
          <p className="text-2xl font-semibold text-text tabular">{formatRupees(data.suggested)}</p>
          <p className="text-sm text-muted tabular">
            Range {formatRupees(data.low)} to {formatRupees(data.high)}{data.per_km_suggested > 0 && ` · ${formatRupees(data.per_km_suggested)} per km`}
          </p>
        </div>
        {onUse && <Button variant="secondary" onClick={() => onUse(data)}>{useLabel}</Button>}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <span className="tabular">{formatKm(data.distance_km)}</span>
        {data.distance_is_estimate
          ? <StatusPill tone="warning" dot={false}>Estimated distance</StatusPill>
          : <StatusPill tone="neutral" dot={false}>{data.distance_source === 'mappls' ? 'Mappls route' : data.distance_source === 'google' ? 'Google route' : 'Road distance'}</StatusPill>}
      </div>

      <PriceRecommendationModal estimate={{ low: data.low, high: data.high, suggested: data.suggested, distance_km: data.distance_km,
        label: 'Actual rate confirmed after carrier assignment', basis: data.basis }} />

      {data.factors.length > 0 && <div>
        <p className="mb-2 text-sm font-medium text-text">How this price was worked out</p>
        <ul className="divide-y divide-border rounded-control border border-border">
          {data.factors.map(f => (
            <li key={f.key} className="flex items-start justify-between gap-4 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-text">{f.label}</p>
                <p className="text-sm text-muted">{f.detail}</p>
              </div>
              {f.amount_inr !== 0 && (
                <span className={f.key === 'rate_card' || f.amount_inr > 0 ? 'shrink-0 text-sm tabular text-text' : 'shrink-0 text-sm tabular text-success'}>
                  {f.key === 'rate_card' ? formatRupees(f.amount_inr) : `${f.amount_inr > 0 ? '+' : '−'}${formatRupees(Math.abs(f.amount_inr))}`}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>}

      {data.notes.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted">
          {data.notes.map(n => <li key={n}>{n}</li>)}
        </ul>
      )}
    </div>
  )
}
