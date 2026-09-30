import { Link } from 'react-router-dom'
import { Card, EmptyState, Skeleton, StatusPill, buttonClasses } from '@/components/ui'
import { formatDate, formatKg, formatRupees } from '@/utils/display'
import { bidNextStep } from './loads'

export interface VendorBid {
  id: string
  window_id: string
  bid_amount: number
  weight_kg: number | null
  status: string
  submitted_at: string
  eway_bill_ref: string | null
  rejection_reason: string | null
  capacity_windows: { trigger_type: string | null; vehicles: { vehicle_type: string | null; plate_number?: string | null } | null } | null
}

/**
 * The vendor's bids on return trips, newest first, each with what to do next. A bid outcome
 * notification opens the page with ?bid=<id>, which highlights that bid.
 */
export default function MyBids({ bids, loading, focusId, loadOfBid }: {
  bids: VendorBid[]
  loading: boolean
  focusId: string | null
  /** The load a won bid created, by bid id. */
  loadOfBid: Map<string, string>
}) {
  if (loading) return <div className="space-y-3">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
  if (bids.length === 0) {
    return <EmptyState compact title="No bids yet" description="Bids you place on return trips show up here, with what happens next." />
  }
  return (
    <ul className="space-y-3">
      {[...bids].sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at))).map(b => {
        const step = bidNextStep(b, loadOfBid.get(b.id) ?? null)
        return (
          <li key={b.id}>
            <Card id={`bid-${b.id}`} padded className={`flex scroll-mt-24 flex-col gap-3 !p-4 sm:flex-row sm:items-start sm:justify-between${b.id === focusId ? ' ring-2 ring-brand' : ''}`}>
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill status={b.status} kind="bid" />
                  <span className="text-xs text-muted">{formatDate(b.submitted_at)}</span>
                </div>
                <p className="text-sm font-medium text-text">
                  {formatRupees(b.bid_amount)} for {formatKg(b.weight_kg)}
                  {b.capacity_windows?.vehicles?.vehicle_type ? <span className="font-normal text-muted"> on a {b.capacity_windows.vehicles.vehicle_type}</span> : null}
                </p>
                <p className="text-sm text-text">{step.text}</p>
                {b.eway_bill_ref && <p className="text-xs text-muted">E-way bill {b.eway_bill_ref}</p>}
              </div>
              {step.cta && (
                step.cta.to.startsWith('#')
                  ? <a href={step.cta.to} className={`${buttonClasses({ variant: 'secondary', size: 'sm' })} shrink-0`}>{step.cta.label}</a>
                  : <Link to={step.cta.to} className={`${buttonClasses({ variant: 'primary', size: 'sm' })} shrink-0`}>{step.cta.label}</Link>
              )}
            </Card>
          </li>
        )
      })}
    </ul>
  )
}
