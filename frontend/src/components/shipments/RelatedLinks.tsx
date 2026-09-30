import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { StatusPill, humanize } from '@/components/ui'
import { exceptionTypeLabel } from '@/components/cargo/logic'
import { formatKm, formatRupees } from '@/utils/display'
import { plateOf } from './format'
import { requesterHref } from './requesterHref'
import type { ShipmentOverview } from './types'

const linkClass = 'font-medium text-brand hover:underline'

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 space-y-1 break-words text-sm text-text">{children}</dd>
    </div>
  )
}

const REQUESTER_LABEL = {
  customer_booking: 'Booking',
  vendor_load: 'Vendor load',
  vendor_bid: 'Vendor bid',
  staff: 'Created by',
} as const

const TRIP_SOURCE_LABEL = { optimizer: 'Optimizer', planner: 'Trip planner', vendor_load: 'Vendor load', assigned: 'Picked by hand' } as const

/** Everything this shipment touches, each one a link to its own page (docs/workflow-blueprint.html: everything links to what it touches). */
export default function RelatedLinks({ overview: o }: { overview: ShipmentOverview }) {
  const s = o.shipment
  const requesterLink = requesterHref(o.requester)
  const lots = s.lots_summary?.lots ?? []
  const plate = o.vehicle?.plate_number ?? plateOf(s)
  // A vendor request that has no load yet has no trip, cargo record or invoice to link to
  const requestOnly = o.kind === 'request'

  return (
    <section aria-label="Related" className="space-y-4 rounded-card border border-border bg-surface p-4 sm:p-6">
      <h2 className="text-lg font-semibold text-text">Related</h2>
      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
        <Item label={REQUESTER_LABEL[o.requester.kind]}>
          {o.requester.kind === 'staff'
            ? <span className="text-muted">Staff, in the console</span>
            : requesterLink
              ? <Link to={requesterLink} className={linkClass}>{o.requester.name ?? 'Open'}</Link>
              : <span>{o.requester.name ?? '—'}</span>}
          {o.requester.status && <div><StatusPill status={o.requester.status} kind={o.requester.kind === 'customer_booking' ? 'booking' : o.requester.kind === 'vendor_bid' ? 'bid' : 'request'} /></div>}
        </Item>

        {!requestOnly && (
          <Item label="Trip">
            {o.trip ? (
              <>
                <Link to={`/routes/${o.trip.id}`} className={linkClass}>
                  Trip {o.trip.id.slice(0, 8).toUpperCase()}
                </Link>
                <div className="text-xs text-muted">
                  {TRIP_SOURCE_LABEL[o.trip.source]} · {o.trip.stop_count.toLocaleString('en-IN')} {o.trip.stop_count === 1 ? 'stop' : 'stops'}
                  {o.trip.distance_km ? ` · ${formatKm(o.trip.distance_km)}` : ''}
                </div>
                <div><StatusPill status={o.trip.status} kind="route" /></div>
              </>
            ) : <span className="text-muted">No trip yet</span>}
          </Item>
        )}

        <Item label="Vehicle">
          {o.vehicle && plate
            ? <Link to={`/fleet/${o.vehicle.id}`} className={`${linkClass} font-mono`}>{plate}</Link>
            : <span className="text-muted">Not assigned</span>}
        </Item>

        <Item label="Driver">
          {o.driver
            ? <Link to={`/admin/users/${o.driver.id}`} className={linkClass}>{o.driver.name ?? 'Open driver'}</Link>
            : <span className="text-muted">{o.vehicle ? 'The vehicle has no driver' : 'Not assigned'}</span>}
        </Item>

        {(o.master || lots.length > 0) && (
          <Item label={o.master ? 'Lot of' : `Lots (${lots.length.toLocaleString('en-IN')})`}>
            {o.master
              ? <Link to={`/shipments/${o.master.id}`} className={`${linkClass} font-mono`}>{o.master.tracking_id}</Link>
              : lots.map(l => (
                <div key={l.id}>
                  <Link to={`/shipments/${l.id}`} className={`${linkClass} font-mono`}>{l.code}</Link>
                  <span className="text-xs text-muted"> · {humanize(l.status)}</span>
                </div>
              ))}
          </Item>
        )}

        {!requestOnly && (
          <>
            <Item label="Problems">
              {o.problems.length === 0
                ? <span className="text-muted">None</span>
                : o.problems.map(p => (
                  <div key={p.id}>
                    <Link to={`/cargo/exceptions/${p.id}`} className={linkClass}>{p.code}</Link>
                    <span className="text-xs text-muted"> · {exceptionTypeLabel(p.type)} · {p.open ? 'open' : humanize(p.status)}</span>
                  </div>
                ))}
            </Item>

            <Item label="Transfers">
              {o.transfers.length === 0
                ? <span className="text-muted">None</span>
                : o.transfers.map(t => (
                  <div key={t.id}>
                    <Link to={`/cargo/transfers/${t.id}`} className={linkClass}>{t.code}</Link>
                    <span className="text-xs text-muted"> · {humanize(t.status)}</span>
                  </div>
                ))}
            </Item>

            <Item label="Claims">
              {o.claims.length === 0
                ? <span className="text-muted">None</span>
                : o.claims.map(c => (
                  <div key={c.id}>
                    <Link to={`/cargo?tab=claims&open=${encodeURIComponent(c.id)}`} className={linkClass}>{c.code}</Link>
                    <span className="text-xs text-muted"> · {humanize(c.status)}</span>
                  </div>
                ))}
            </Item>

            <Item label="Invoice">
              {o.invoice
                ? (
                  <>
                    <Link to={`/money/invoices/${o.invoice.id}`} className={linkClass}>{o.invoice.invoice_number ?? 'Open invoice'}</Link>
                    <div className="text-xs text-muted">{o.invoice.total != null ? `${formatRupees(o.invoice.total)} · ` : ''}{humanize(o.invoice.status)}</div>
                  </>
                )
                : <span className="text-muted">{o.price != null && o.price > 0 ? `Not issued yet · ${formatRupees(o.price)}` : 'No price, so no invoice'}</span>}
            </Item>
          </>
        )}

        <Item label="Paperwork">
          <Link to={`/shipments/${s.id}/manifest`} className={linkClass}>Manifest and label</Link>
          {!requestOnly && <div><Link to={`/track/${encodeURIComponent(s.tracking_id)}`} className={linkClass}>Tracking page</Link></div>}
        </Item>
      </dl>
    </section>
  )
}
