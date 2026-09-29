import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import type { AxiosError } from 'axios'
import { capacityAPI } from '@/services/api'
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
  const floorPrice = w.floor_price ?? 0

  const [bidAmount, setBidAmount] = useState(floorPrice ? String(floorPrice) : '')
  const [weightKg, setWeightKg] = useState('')
  const [dropoff, setDropoff] = useState<ResolvedPlace | null>(null)
  const [dropoffTouched, setDropoffTouched] = useState(false)
  const [ewayBill, setEwayBill] = useState('')
  const [loadConfiguration, setLoadConfiguration] = useState(LOAD_CONFIGURATIONS[0].value)
  const [submitting, setSubmitting] = useState(false)

  const remainingMs = useCountdown(w.closes_at)
  const closed = remainingMs === 0
  const minutes = Math.floor(remainingMs / 60000)
  const seconds = Math.floor((remainingMs % 60000) / 1000)

  const amount = Number(bidAmount)
  const weight = Number(weightKg)
  const ewayClean = ewayBill.replace(/\s+/g, '')
  const errors = {
    amount: !bidAmount ? 'Enter your bid' : amount <= 0 ? 'Bid must be positive' : amount < floorPrice ? `Minimum bid is ₹${floorPrice.toLocaleString('en-IN')}` : null,
    weight: !weightKg ? 'Enter the load weight' : weight <= 0 ? 'Weight must be positive' : capacityKg != null && weight > capacityKg ? `Only ${capacityKg.toLocaleString('en-IN')} kg available` : null,
    dropoff: dropoff ? null : 'Choose a drop-off location from the list',
    eway: ewayClean && !/^\d{12}$/.test(ewayClean) ? 'E-way bill number is 12 digits' : null,
  }
  const valid = !Object.values(errors).some(Boolean) && !closed

  const submit = async () => {
    setDropoffTouched(true)
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
      const e = err as AxiosError<{ error?: string; detail?: string }>
      toast.error(e.response?.data?.error ?? e.response?.data?.detail ?? 'Failed to place bid')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Place a bid"
      description={`${w.vehicles?.vehicle_type ?? 'Vehicle'} · ${capacityKg != null ? `${capacityKg.toLocaleString('en-IN')} kg free` : 'capacity unknown'}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={submitting} disabled={!valid && !submitting}>Submit bid</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">Floor price <span className="font-medium text-text">₹{floorPrice.toLocaleString('en-IN')}</span></span>
          <span className={closed ? 'font-medium text-danger' : 'text-muted'}>
            {closed ? 'Bidding closed' : <>Closes in <span className="tabular font-medium text-text">{minutes}:{String(seconds).padStart(2, '0')}</span></>}
          </span>
        </div>

        {closed && <Alert tone="danger">This capacity window has closed. Choose another one.</Alert>}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Your bid (₹)" type="number" min={floorPrice} step="1" required
            value={bidAmount} onChange={e => setBidAmount(e.target.value)}
            error={bidAmount ? errors.amount : undefined}
          />
          <Input
            label="Load weight (kg)" type="number" min={1} max={capacityKg ?? undefined} step="1" required
            value={weightKg} onChange={e => setWeightKg(e.target.value)}
            error={weightKg ? errors.weight : undefined}
          />
        </div>

        <AddressPicker
          label="Drop-off location" required placeholder="Search the delivery address"
          value={dropoff}
          onChange={place => { setDropoff(place); setDropoffTouched(true) }}
          error={dropoffTouched ? errors.dropoff : undefined}
          showMap
          mapHeight={170}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="E-way bill number" hint="Optional — 12 digits" inputMode="numeric" maxLength={14}
            value={ewayBill} onChange={e => setEwayBill(e.target.value)}
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
