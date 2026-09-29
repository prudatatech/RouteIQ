import { errorMessage, formatRupees } from '@/utils/display'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useQuery } from '@tanstack/react-query'
import { capacityAPI, vendorAPI } from '@/services/api'
import { PriceSuggestion } from '@/components/pricing/PriceSuggestion'
import { usePriceQuote } from '@/components/pricing/usePriceQuote'
import type { QuoteRequest } from '@/services/pricing'
import { Alert, Button, Input, Modal, Select } from '@/components/ui'
import AddressPicker from '@/components/map/AddressPicker'
import type { ResolvedPlace } from '@/services/geocoding'

const LOAD_CONFIGURATIONS = [
  { value: 'Loose', label: 'Loose' },
  { value: 'Palletized', label: 'Palletized' },
  { value: 'Crated', label: 'Crated' },
  { value: 'Bagged', label: 'Bagged' },
  { value: 'Drums', label: 'Drums' },
  { value: 'Containerized', label: 'Containerized' },
]

interface CapacityWindow {
  id: string
  floor_price: number | null
  closes_at: string
  vehicles?: { vehicle_type?: string | null; available_capacity_kg?: number | null } | null
}

function useCountdown(until: string) {
  const [remaining, setRemaining] = useState(() => new Date(until).getTime() - Date.now())
  useEffect(() => {
    const id = setInterval(() => setRemaining(new Date(until).getTime() - Date.now()), 1000)
    return () => clearInterval(id)
  }, [until])
  return Math.max(0, remaining)
}

export default function PlaceBidModal({ window: w, onClose, onPlaced }: {
  window: CapacityWindow
  onClose: () => void
  onPlaced: () => void
}) {
  const capacityKg = w.vehicles?.available_capacity_kg ?? null
  // The window's minimum bid, when staff set one; otherwise it comes from the price check for this load (see `minimum`)
  const windowMinimum = w.floor_price != null ? Number(w.floor_price) : null

  const [bidAmount, setBidAmount] = useState(windowMinimum ? String(windowMinimum) : '')
  const [weightKg, setWeightKg] = useState('')
  const [dropoff, setDropoff] = useState<ResolvedPlace | null>(null)
  const [dropoffTouched, setDropoffTouched] = useState(false)
  const [ewayBill, setEwayBill] = useState('')
  const [loadConfiguration, setLoadConfiguration] = useState(LOAD_CONFIGURATIONS[0].value)
  const [submitting, setSubmitting] = useState(false)
  const [attempted, setAttempted] = useState(false)

  // Suggested price: the truck collects from the vendor's own address (from the company profile)
  const profile = useQuery({
    queryKey: ['vendor-profile'],
    queryFn: () => vendorAPI.profile() as Promise<{ address?: string | null; latitude?: number | null; longitude?: number | null }>,
  })
  const pickupPoint = profile.data?.latitude != null && profile.data?.longitude != null
    ? { lat: profile.data.latitude, lng: profile.data.longitude, label: profile.data.address ?? null }
    : null
  const quoteInput: QuoteRequest | null = pickupPoint && dropoff && Number(weightKg) > 0
    ? {
        pickup: pickupPoint,
        drop: { lat: dropoff.lat, lng: dropoff.lng, label: dropoff.address },
        weight_kg: Number(weightKg),
        vehicle_type: w.vehicles?.vehicle_type ?? null,
        source: 'bid',
      }
    : null
  const quote = usePriceQuote(quoteInput)
  // Minimum bid: staff's price for the whole window, else the low end of the price check for this load's weight and drop-off
  const minimum = windowMinimum ?? (quote.data?.status === 'ok' ? quote.data.low : null)

  const remainingMs = useCountdown(w.closes_at)
  const closed = remainingMs === 0
  const minutes = Math.floor(remainingMs / 60000)
  const seconds = Math.floor((remainingMs % 60000) / 1000)

  const amount = Number(bidAmount)
  const weight = Number(weightKg)
  const ewayClean = ewayBill.replace(/\s+/g, '')
  const errors = {
    amount: !bidAmount ? 'Enter your bid' : amount <= 0 ? 'Bid must be positive' : minimum !== null && amount < minimum ? `Minimum bid is ${formatRupees(minimum)}` : null,
    weight: !weightKg ? 'Enter the load weight' : weight <= 0 ? 'Weight must be positive' : capacityKg != null && weight > capacityKg ? `Only ${capacityKg.toLocaleString('en-IN')} kg available` : null,
    dropoff: dropoff ? null : 'Choose a drop-off location from the list',
    eway: ewayClean && !/^\d{12}$/.test(ewayClean) ? 'E-way bill number is 12 digits' : null,
  }
  const valid = !Object.values(errors).some(Boolean) && !closed

  const submit = async () => {
    setDropoffTouched(true)
    setAttempted(true)
    if (!valid || !dropoff) return
    setSubmitting(true)
    try {
      await capacityAPI.placeBid({
        window_id: w.id,
        bid_amount: amount,
        weight_kg: weight,
        dropoff_name: dropoff.address.split(', ')[0],
        dropoff_address: dropoff.address,
        dropoff_lat: dropoff.lat,
        dropoff_lng: dropoff.lng,
        eway_bill_ref: ewayClean || undefined,
        load_configuration: loadConfiguration,
      })
      toast.success('Bid placed. You will be notified when it is reviewed.')
      onPlaced()
      onClose()
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to place bid'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      onSubmit={submit}
      title="Place a bid"
      description={`${w.vehicles?.vehicle_type ?? 'Vehicle'} · ${capacityKg != null ? `${capacityKg.toLocaleString('en-IN')} kg free` : 'capacity unknown'}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={submitting} disabled={closed}>Submit bid</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">
            Minimum bid{' '}
            <span className="font-medium text-text">
              {minimum !== null ? formatRupees(minimum) : windowMinimum === null ? 'set for your load' : ''}
            </span>
          </span>
          <span className={closed ? 'font-medium text-danger' : 'text-muted'}>
            {closed ? 'Bidding closed' : <>Closes in <span className="tabular font-medium text-text">{minutes}:{String(seconds).padStart(2, '0')}</span></>}
          </span>
        </div>

        {closed && <Alert tone="danger">This capacity window has closed. Choose another one.</Alert>}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Your bid (₹)" type="number" min={minimum ?? 0} step="1" required
            inputMode="decimal" value={bidAmount} onChange={e => setBidAmount(e.target.value)}
            error={bidAmount || attempted ? errors.amount ?? undefined : undefined}
          />
          <Input
            label="Load weight (kg)" type="number" min={1} max={capacityKg ?? undefined} step="1" required
            inputMode="decimal" value={weightKg} onChange={e => setWeightKg(e.target.value)}
            error={weightKg || attempted ? errors.weight ?? undefined : undefined}
          />
        </div>

        <AddressPicker
          label="Drop-off location" required placeholder="Search the delivery address"
          value={dropoff}
          onChange={place => { setDropoff(place); setDropoffTouched(true) }}
          error={dropoffTouched || attempted ? errors.dropoff ?? undefined : undefined}
          showMap
          mapHeight={170}
        />

        <div className="space-y-2 rounded-control border border-border p-3">
          <p className="text-sm font-medium text-text">Suggested price</p>
          {profile.isSuccess && !pickupPoint ? (
            <p className="text-sm text-muted">Add your warehouse address under Company &amp; KYC to see a suggested price. The truck collects from that address.</p>
          ) : (
            <PriceSuggestion
              query={quote}
              onUse={q => setBidAmount(String(Math.max(q.suggested, minimum ?? 0)))}
              useLabel="Bid this price"
              idle="Enter the load weight and a drop-off location to see a suggested price."
            />
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="E-way bill number" hint="Optional — 12 digits" inputMode="numeric" maxLength={14}
            value={ewayBill} onChange={e => setEwayBill(e.target.value.replace(/[^\d\s]/g, ''))}
            error={errors.eway ?? undefined}
          />
          <Select label="Load type" options={LOAD_CONFIGURATIONS} value={loadConfiguration} onChange={e => setLoadConfiguration(e.target.value)} />
        </div>

        {!ewayClean && (
          <p className="text-xs text-muted">Bids without an e-way bill are flagged for the dispatcher; consignments above ₹50,000 need one before pickup.</p>
        )}
      </div>
    </Modal>
  )
}
