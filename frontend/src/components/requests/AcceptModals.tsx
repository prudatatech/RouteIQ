import { useEffect, useState } from 'react'
import { Button, Input, Modal } from '@/components/ui'
import type { CustomerBooking } from '@/services/api'
import { PriceSuggestion } from '@/components/pricing/PriceSuggestion'
import { usePriceQuote } from '@/components/pricing/usePriceQuote'
import type { QuoteRequest } from '@/services/pricing'
import { formatRupees } from '@/utils/display'
import { estimatedRoadKm, parsePrice } from './pricing'
import type { VendorRequest } from './model'
import { customerName, shortPlace, vendorName } from './model'

/** Accept a customer's booking at a price: their quote, or what staff agreed with them. */
export function AcceptBookingModal({ booking, loading, onClose, onAccept }: {
  booking: CustomerBooking | null
  loading: boolean
  onClose: () => void
  onAccept: (b: CustomerBooking, price: number | null) => void
}) {
  const [entered, setEntered] = useState<{ id: string; price: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!booking) return <Modal open={false} onClose={onClose} title="Accept this request?" />
  const quote = booking.quoted_price != null ? String(booking.quoted_price) : ''
  const price = entered && entered.id === booking.id ? entered.price : quote

  const submit = () => {
    const text = price.trim()
    if (text && !(Number(text) >= 0)) { setError('Enter a price of 0 or more, or leave it empty.'); return }
    setError(null)
    onAccept(booking, text ? Number(text) : null)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Accept and price this request?"
      description={`${customerName(booking)}, ${shortPlace(booking.pickup_name)} to ${shortPlace(booking.drop_name)}. Accepting creates a shipment for dispatch and tells the customer their tracking ID.`}
      size="sm"
      onSubmit={submit}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Not yet</Button>
          <Button type="submit" loading={loading}>Accept request</Button>
        </>
      )}
    >
      <Input
        data-autofocus
        label="Price (₹)"
        type="number"
        inputMode="decimal"
        min={0}
        step="0.01"
        leading="₹"
        value={price}
        error={error ?? undefined}
        hint={booking.quoted_price != null
          ? 'Starts at the customer’s quote, before GST. Change it if you agreed another price. The delivery is invoiced at this price.'
          : 'No quote was given. Enter the agreed price, before GST, so the delivery can be invoiced.'}
        onChange={e => setEntered({ id: booking.id, price: e.target.value })}
      />
    </Modal>
  )
}

/** Accept a vendor's load at a price. A flat price, or a rate per km when the load has coordinates. */
export function AcceptLoadModal({ load, loading, onClose, onAccept }: {
  load: VendorRequest | null
  loading: boolean
  onClose: () => void
  onAccept: (load: VendorRequest, price: { cost?: number; cost_per_km?: number }) => void
}) {
  const [flat, setFlat] = useState('')
  const [perKm, setPerKm] = useState('')
  const [touched, setTouched] = useState(false)
  useEffect(() => { setFlat(''); setPerKm(''); setTouched(false) }, [load?.id])

  const quoteInput: QuoteRequest | null = load
    ? {
        pickup: { lat: load.pickup_lat, lng: load.pickup_lng, label: load.pickup_location },
        drop: { lat: load.drop_lat, lng: load.drop_lng, label: load.drop_location },
        weight_kg: load.required_capacity_kg,
        vehicle_type: load.vehicle_class ?? null,
        load_type: load.load_type ?? null,
        source: 'assign',
      }
    : null
  const quote = usePriceQuote(quoteInput)
  const suggested = quote.data?.status === 'ok' ? quote.data.suggested : null
  const offered = load?.metadata?.offered_price_inr

  // Start at the vendor's own price if they gave one, else the suggestion
  useEffect(() => {
    const start = offered ?? suggested
    if (start) setFlat(prev => (prev === '' && !touched ? String(Math.round(start)) : prev))
  }, [offered, suggested, touched, load?.id])

  if (!load) return <Modal open={false} onClose={onClose} title="Accept this load?" />

  const flatP = parsePrice(flat)
  const perKmP = parsePrice(perKm)
  const roadKm = estimatedRoadKm(load)
  const perKmNeedsFlat = perKmP.value !== undefined && flatP.value === undefined && roadKm === null
  const hasPrice = flatP.value !== undefined || perKmP.value !== undefined
  const existing = load.cost != null && Number(load.cost) > 0

  const submit = () => {
    setTouched(true)
    if (flatP.error || perKmP.error || perKmNeedsFlat) return
    if (!hasPrice && !existing) return
    onAccept(load, {
      ...(flatP.value !== undefined ? { cost: flatP.value } : {}),
      ...(perKmP.value !== undefined ? { cost_per_km: perKmP.value } : {}),
    })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Accept and price this load?"
      description={`${vendorName(load)}, ${shortPlace(load.pickup_location)} to ${shortPlace(load.drop_location)}. The vendor is told the price. A vehicle can be assigned once it is accepted.`}
      size="sm"
      onSubmit={submit}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Not yet</Button>
          <Button type="submit" loading={loading} disabled={!hasPrice && !existing}>Accept at this price</Button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="space-y-2 rounded-control border border-border p-3">
          <p className="text-sm font-medium text-text">Suggested price</p>
          <PriceSuggestion query={quote} onUse={q => { setTouched(true); setFlat(String(q.suggested)) }} useLabel="Use as flat price" />
          {offered ? <p className="text-sm text-muted">The vendor offered <span className="tabular font-medium text-text">{formatRupees(offered)}</span>.</p> : null}
        </div>
        <Input
          label="Flat price (₹)"
          type="number"
          inputMode="decimal"
          min={0}
          leading="₹"
          hint="A fixed price for this load, before GST."
          value={flat}
          onChange={e => { setTouched(true); setFlat(e.target.value) }}
          error={flatP.error}
        />
        <Input
          label="Rate per km (₹)"
          type="number"
          inputMode="decimal"
          min={0}
          hint={
            perKmP.value !== undefined && flatP.value === undefined && roadKm !== null
              ? `With no flat price, the price is this rate x about ${roadKm.toLocaleString('en-IN')} km by road: ${formatRupees(Math.round(perKmP.value * roadKm))}.`
              : 'Optional. With no flat price, the price is this rate x the road distance.'
          }
          value={perKm}
          onChange={e => setPerKm(e.target.value)}
          error={perKmP.error ?? (perKmNeedsFlat ? 'This load has no coordinates to measure a distance. Enter a flat price.' : undefined)}
        />
      </div>
    </Modal>
  )
}
