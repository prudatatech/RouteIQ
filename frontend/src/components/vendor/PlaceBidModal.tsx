import { useEffect, useState } from 'react'
import { X, Loader2, MapPin, Gavel } from 'lucide-react'
import toast from 'react-hot-toast'
import { capacityAPI } from '@/services/api'
import { suggestPlaces, resolvePlace, PlaceSuggestion, ResolvedPlace } from '@/services/geocoding'

const LOAD_CONFIGURATIONS = ['Loose', 'Palletized', 'Crated', 'Bagged', 'Drums', 'Containerized']

interface CapacityWindow {
  id: string
  floor_price: number | null
  closes_at: string
  vehicles?: { plate_number?: string; vehicle_type?: string; available_capacity_kg?: number | null } | null
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
  const [dropSearch, setDropSearch] = useState('')
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([])
  const [dropoff, setDropoff] = useState<ResolvedPlace | null>(null)
  const [ewayBill, setEwayBill] = useState('')
  const [loadConfiguration, setLoadConfiguration] = useState(LOAD_CONFIGURATIONS[0])
  const [submitting, setSubmitting] = useState(false)

  const remainingMs = useCountdown(w.closes_at)
  const closed = remainingMs === 0

  useEffect(() => {
    if (dropoff && dropSearch === dropoff.address) {
      setSuggestions([])
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      suggestPlaces(dropSearch, controller.signal).then(setSuggestions).catch(() => setSuggestions([]))
    }, 400)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [dropSearch, dropoff])

  const selectSuggestion = async (s: PlaceSuggestion) => {
    setDropSearch(s.place_name)
    setSuggestions([])
    const place = await resolvePlace(s).catch(() => null)
    if (!place) {
      toast.error('Could not locate that address. Try a more specific one.')
      setDropoff(null)
      return
    }
    setDropoff(place)
  }

  const amount = Number(bidAmount)
  const weight = Number(weightKg)
  const ewayClean = ewayBill.replace(/\s+/g, '')
  const errors = {
    amount: !bidAmount ? 'Enter your bid' : amount <= 0 ? 'Bid must be positive' : amount < floorPrice ? `Minimum bid is ₹${floorPrice}` : null,
    weight: !weightKg ? 'Enter the load weight' : weight <= 0 ? 'Weight must be positive' : capacityKg != null && weight > capacityKg ? `Only ${capacityKg} kg available` : null,
    dropoff: dropoff ? null : 'Choose a drop-off location from the list',
    eway: ewayClean && !/^\d{12}$/.test(ewayClean) ? 'E-way bill number is 12 digits' : null,
  }
  const valid = !Object.values(errors).some(Boolean) && !closed

  const submit = async () => {
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
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? err.response?.data?.detail ?? 'Failed to place bid')
    } finally {
      setSubmitting(false)
    }
  }

  const minutes = Math.floor(remainingMs / 60000)
  const seconds = Math.floor((remainingMs % 60000) / 1000)
  const fieldClass = 'w-full bg-surface2 border border-border rounded-xl px-4 py-3 text-sm text-text placeholder:text-muted focus:outline-none focus:border-primary'
  const labelClass = 'block text-[10px] font-black text-muted uppercase tracking-widest mb-2'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div
        className="bg-surface border border-border shadow-2xl rounded-3xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="place-bid-title"
      >
        <div className="flex items-start justify-between px-6 py-5 border-b border-border bg-surface2">
          <div>
            <h2 id="place-bid-title" className="text-lg font-black text-text flex items-center gap-2"><Gavel size={18} className="text-primary" /> Place a Bid</h2>
            <p className="text-xs text-muted mt-1 font-mono">
              {w.vehicles?.plate_number} {w.vehicles?.vehicle_type ? `· ${w.vehicles.vehicle_type}` : ''} · {capacityKg ?? '—'} kg free
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-muted hover:text-text hover:bg-surface transition-colors" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div className="flex justify-between text-xs">
            <span className="text-muted">Floor price <span className="font-mono font-bold text-text">₹{floorPrice}</span></span>
            <span className={closed ? 'text-error font-bold' : 'text-muted'}>
              {closed ? 'Bidding closed' : <>Closes in <span className="font-mono font-bold text-text">{minutes}:{String(seconds).padStart(2, '0')}</span></>}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass} htmlFor="bid-amount">Your bid (₹)</label>
              <input id="bid-amount" type="number" min={floorPrice} step="1" value={bidAmount} onChange={e => setBidAmount(e.target.value)} className={fieldClass} />
              {bidAmount && errors.amount && <p className="text-[11px] text-error mt-1">{errors.amount}</p>}
            </div>
            <div>
              <label className={labelClass} htmlFor="bid-weight">Load weight (kg)</label>
              <input id="bid-weight" type="number" min={1} max={capacityKg ?? undefined} step="1" value={weightKg} onChange={e => setWeightKg(e.target.value)} className={fieldClass} />
              {weightKg && errors.weight && <p className="text-[11px] text-error mt-1">{errors.weight}</p>}
            </div>
          </div>

          <div className="relative">
            <label className={labelClass} htmlFor="bid-dropoff">Drop-off location</label>
            <div className="relative">
              <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                id="bid-dropoff"
                type="text"
                value={dropSearch}
                onChange={e => { setDropSearch(e.target.value); setDropoff(null) }}
                placeholder="Search the delivery address"
                className={`${fieldClass} pl-9`}
                autoComplete="off"
              />
            </div>
            {suggestions.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full bg-surface border border-border rounded-xl shadow-xl overflow-hidden">
                {suggestions.map(s => (
                  <li key={s.id}>
                    <button type="button" onClick={() => selectSuggestion(s)} className="w-full text-left px-4 py-2.5 text-sm hover:bg-surface2">
                      <div className="font-bold text-text">{s.text}</div>
                      <div className="text-[11px] text-muted truncate">{s.place_name}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {dropSearch && !dropoff && suggestions.length === 0 && <p className="text-[11px] text-muted mt-1">{errors.dropoff}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass} htmlFor="bid-eway">E-way bill no. <span className="normal-case tracking-normal font-medium">(optional)</span></label>
              <input id="bid-eway" type="text" inputMode="numeric" maxLength={14} value={ewayBill} onChange={e => setEwayBill(e.target.value)} placeholder="12 digits" className={`${fieldClass} font-mono`} />
              {errors.eway && <p className="text-[11px] text-error mt-1">{errors.eway}</p>}
            </div>
            <div>
              <label className={labelClass} htmlFor="bid-load">Load type</label>
              <select id="bid-load" value={loadConfiguration} onChange={e => setLoadConfiguration(e.target.value)} className={fieldClass}>
                {LOAD_CONFIGURATIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {!ewayClean && (
            <p className="text-[11px] text-muted">Bids without an e-way bill are flagged for the dispatcher; consignments above ₹50,000 need one before pickup.</p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border flex justify-end gap-3">
          <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-bold text-muted hover:text-text">Cancel</button>
          <button
            onClick={submit}
            disabled={!valid || submitting}
            className="bg-primary hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />} Submit Bid
          </button>
        </div>
      </div>
    </div>
  )
}
