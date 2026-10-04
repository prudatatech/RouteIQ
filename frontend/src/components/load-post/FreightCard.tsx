import { Card, Skeleton } from '@/components/ui'
import type { AssistResult } from '@/types/load'
import { inr } from './logic'
import PriceRecommendationModal from './PriceRecommendationModal'

/**
 * The recommended freight for the route, from the server's estimate. There is nothing to type: logistic companies can
 * book the load at any price in the range. While the estimate is being worked out: a skeleton; with none: a plain line.
 */
export default function FreightCard({ assist, loading }: { assist: AssistResult | null; loading?: boolean }) {
  const est = loading ? null : assist?.estimate ?? null
  return (
    <Card padded className="space-y-1.5 !p-4" aria-label="Recommended freight" data-testid="freight-card">
      <h3 className="text-sm font-medium text-text">Recommended freight</h3>
      {est ? (
        <>
          <p className="text-2xl font-semibold tabular text-text" data-testid="freight-range">{inr(est.low)} – {inr(est.high)}</p>
          <p className="text-xs text-muted">For about {Math.round(est.distance_km).toLocaleString('en-IN')} km. {est.label}</p>
          <p className="text-sm text-text">Logistic companies can book your load at any price in this range.</p>
          {est.suggested !== undefined && <p className="text-sm text-text">Suggested midpoint: {inr(est.suggested)}</p>}
          <PriceRecommendationModal estimate={est} />
        </>
      ) : loading ? (
        <div data-testid="freight-skeleton" className="space-y-2" aria-busy="true">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-full max-w-sm" />
        </div>
      ) : (
        <p className="text-sm text-muted" data-testid="freight-none">We will share the range once a logistic company reviews the trip.</p>
      )}
    </Card>
  )
}
