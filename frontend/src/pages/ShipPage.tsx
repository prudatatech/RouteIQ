import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useQuery } from '@tanstack/react-query'
import { Search, Truck } from 'lucide-react'
import { publicAPI, type PublicSpareSpace } from '@/services/api'
import { useAuthStore } from '@/store/authStore'
import { useVendorContext } from '@/components/vendor/vendorContext'
import AddressPicker from '@/components/map/AddressPicker'
import PlaceBidModal, { type BidFields, type CapacityWindow } from '@/components/vendor/PlaceBidModal'
import { PriceSuggestion } from '@/components/pricing/PriceSuggestion'
import { usePriceQuote } from '@/components/pricing/usePriceQuote'
import type { QuoteRequest } from '@/services/pricing'
import type { ResolvedPlace } from '@/services/geocoding'
import {
  Alert, Button, buttonClasses, Card, EmptyState, ErrorState, Input, Page, PageHeader, Select, Skeleton, StatusPill,
} from '@/components/ui'
import { humanize } from '@/components/ui/status'
import { formatDateTime, formatRupees } from '@/utils/display'
import { saveGuestDraft } from '@/utils/guestDraft'

/** What was searched. Kept apart from the form so results only change when the person presses Search. */
interface LaneSearch {
  from: ResolvedPlace
  to: ResolvedPlace
  fromCity: string
  toCity: string
  date: string
  weightKg: number
  vehicleType: string
}

/** The city of a place: from the geocoder's address parts, else the first part of the address. */
function cityOf(place: ResolvedPlace): string {
  return (place.parts?.city ?? place.address.split(',')[0] ?? '').trim()
}

const today = () => new Date().toISOString().slice(0, 10)

function toBidWindow(p: PublicSpareSpace): CapacityWindow {
  return {
    id: p.id,
    floor_price: null,
    closes_at: p.departs_to ?? p.departs_from,
    vehicles: { vehicle_type: p.vehicle_type, available_capacity_kg: p.free_kg },
  }
}

export default function ShipPage() {
  const navigate = useNavigate()
  const session = useAuthStore(s => s.session)
  const { vendorProfile, isVendor } = useVendorContext()
  const kycApproved = vendorProfile?.kycStatus === 'approved'

  const [from, setFrom] = useState<ResolvedPlace | null>(null)
  const [to, setTo] = useState<ResolvedPlace | null>(null)
  const [date, setDate] = useState('')
  const [weight, setWeight] = useState('')
  const [vehicleType, setVehicleType] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [search, setSearch] = useState<LaneSearch | null>(null)
  const [booking, setBooking] = useState<PublicSpareSpace | null>(null)

  const weightNumber = Number(weight)
  const errors = {
    from: from ? undefined : 'Search for the city you are sending from',
    to: to ? undefined : 'Search for the city you are sending to',
    weight: weight && !(weightNumber > 0) ? 'Enter a weight above 0' : undefined,
  }

  const onSearch = (e: FormEvent) => {
    e.preventDefault()
    setAttempted(true)
    if (!from || !to || errors.weight) return
    setSearch({
      from, to, fromCity: cityOf(from), toCity: cityOf(to), date, weightKg: weightNumber > 0 ? weightNumber : 0, vehicleType,
    })
  }

  // Vehicle types come from the companies on the platform, so the list is never out of date.
  const allCompanies = useQuery({ queryKey: ['public', 'companies', 'all'], queryFn: () => publicAPI.companies(), staleTime: 10 * 60_000, retry: false })
  const vehicleTypes = useMemo(
    () => [...new Set((allCompanies.data ?? []).flatMap(c => c.vehicle_types))].sort(),
    [allCompanies.data],
  )

  const space = useQuery({
    queryKey: ['public', 'spare-space', search?.fromCity, search?.toCity, search?.date, search?.vehicleType, search?.weightKg],
    queryFn: () => publicAPI.spareSpace({
      from: search!.fromCity, to: search!.toCity, date: search!.date || undefined,
      vehicle_type: search!.vehicleType || undefined, min_kg: search!.weightKg || undefined,
    }),
    enabled: !!search,
    retry: false,
  })
  const companies = useQuery({
    queryKey: ['public', 'companies', search?.fromCity, search?.vehicleType],
    queryFn: () => publicAPI.companies({ city: search!.fromCity, vehicle_type: search!.vehicleType || undefined }),
    enabled: !!search,
    retry: false,
  })

  const quoteInput: QuoteRequest | null = search && search.weightKg > 0
    ? {
        pickup: { lat: search.from.lat, lng: search.from.lng, label: search.from.address },
        drop: { lat: search.to.lat, lng: search.to.lng, label: search.to.address },
        weight_kg: search.weightKg,
        vehicle_type: search.vehicleType || null,
        date: search.date || null,
      }
    : null
  const quote = usePriceQuote(quoteInput, { guest: true })

  const postThisLoad = () => {
    if (!search) return
    const q = new URLSearchParams({
      from: search.from.address, fromLat: String(search.from.lat), fromLng: String(search.from.lng),
      query: search.to.address, lat: String(search.to.lat), lng: String(search.to.lng),
    })
    if (search.weightKg > 0) q.set('weight', String(search.weightKg))
    navigate(`/vendor/request?${q.toString()}`)
  }

  const bookSpace = (sp: PublicSpareSpace) => {
    if (session && isVendor && !kycApproved) {
      toast('Finish your company KYC first. It only takes a few minutes.')
      navigate(vendorProfile ? '/vendor/company' : '/vendor/onboarding')
      return
    }
    setBooking(sp)
  }

  // A visitor fills in the bid, then signs in; the bid is kept and shown again for confirmation.
  const continueGuestBooking = (fields: BidFields) => {
    if (!booking) return
    const saved = saveGuestDraft('bid', { windowId: booking.id, window: toBidWindow(booking), fields })
    if (!saved) toast('We could not save your bid on this device, so you may need to fill it in again after signing in.')
    navigate(`/login?as=vendor&next=${encodeURIComponent(`/vendor/return-trips?bid=${booking.id}&resume=1`)}`)
  }

  return (
    <Page>
      <PageHeader
        title="Find a truck"
        description="See trucks with spare space, companies and an indicative price for your lane. No account needed to look."
      />

      <Card padded>
        <form noValidate onSubmit={onSearch} className="space-y-4" aria-label="Search a lane">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <AddressPicker
              label="From" required value={from} onChange={setFrom} placeholder="City or address you send from"
              error={attempted ? errors.from : undefined} showMap={false} kind="pickup" allowCurrentLocation={false}
            />
            <AddressPicker
              label="To" required value={to} onChange={setTo} placeholder="City or address you send to"
              error={attempted ? errors.to : undefined} showMap={false} kind="drop" allowCurrentLocation={false}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Input label="Date" type="date" min={today()} value={date} onChange={e => setDate(e.target.value)} hint="Optional" />
            <Input
              label="Weight (kg)" type="number" min={1} inputMode="decimal" value={weight} onChange={e => setWeight(e.target.value)}
              error={errors.weight} hint="Needed for a price"
            />
            <Select
              label="Vehicle type"
              value={vehicleType}
              onChange={e => setVehicleType(e.target.value)}
              options={[{ value: '', label: 'Any vehicle' }, ...vehicleTypes.map(t => ({ value: t, label: humanize(t) }))]}
            />
          </div>
          <Button type="submit" size="lg" icon={<Search size={16} />} className="w-full sm:w-auto">Search</Button>
        </form>
      </Card>

      {!search ? (
        <EmptyState
          icon={<Truck size={22} />}
          title="Search a lane to begin"
          description="Choose where your load starts and where it goes. We show what is available right away."
        />
      ) : (
        <>
          <section aria-labelledby="price-title" className="space-y-3">
            <h2 id="price-title" className="text-lg font-semibold text-text">Indicative price</h2>
            <Card padded>
              {quoteInput ? (
                <PriceSuggestion query={quote} idle="Working out a price." />
              ) : (
                <p className="text-sm text-muted">Add your load weight above and search again to see a price.</p>
              )}
              <p className="mt-3 text-xs text-muted">This is a guide, not a final price. Companies confirm the price when you post your load.</p>
            </Card>
          </section>

          <section aria-labelledby="space-title" className="space-y-3">
            <h2 id="space-title" className="text-lg font-semibold text-text">Trucks with spare space</h2>
            {space.isError ? (
              <ErrorState compact title="We could not load spare space" description="Check your connection and try again." onRetry={() => space.refetch()} />
            ) : space.isLoading ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-44 w-full" />)}
              </div>
            ) : (space.data ?? []).length === 0 ? (
              <EmptyState
                compact
                title="No spare space on this lane right now"
                description="Post your load and companies on this lane can respond."
                action={<Button onClick={postThisLoad}>Post this load</Button>}
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {space.data!.map(sp => (
                  <Card key={sp.id} padded className="flex flex-col gap-3">
                    <div>
                      <p className="text-xs text-muted">{sp.company.name}{sp.company.city ? ` · ${sp.company.city}` : ''}</p>
                      <p className="text-base font-semibold text-text">{sp.from_city} to {sp.to_city ?? 'anywhere on the way'}</p>
                      <p className="text-xs text-muted">Leaves {formatDateTime(sp.departs_from)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted">{sp.vehicle_type ? humanize(sp.vehicle_type) : 'Truck'}</p>
                      <p className="text-2xl font-semibold text-text">
                        {sp.free_kg.toLocaleString('en-IN')} <span className="text-sm font-normal text-muted">kg free</span>
                      </p>
                      <p className="text-sm text-muted">{sp.price_per_kg_from != null ? `From ${formatRupees(sp.price_per_kg_from)} per kg` : 'Name your price'}</p>
                    </div>
                    <Button className="mt-auto" onClick={() => bookSpace(sp)}>Book this space</Button>
                  </Card>
                ))}
              </div>
            )}
          </section>

          <section aria-labelledby="companies-title" className="space-y-3">
            <h2 id="companies-title" className="text-lg font-semibold text-text">Companies near {search.fromCity || 'you'}</h2>
            {companies.isError ? (
              <ErrorState compact title="We could not load companies" onRetry={() => companies.refetch()} />
            ) : companies.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (companies.data ?? []).length === 0 ? (
              <EmptyState compact title="No companies listed for this city yet" description="Post your load and we will find a company for it." />
            ) : (
              <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {companies.data!.map(c => (
                  <li key={c.id}>
                    <Card padded className="h-full space-y-2">
                      <p className="text-base font-semibold text-text">{c.name}</p>
                      {c.city && <p className="text-sm text-muted">{c.city}</p>}
                      <div className="flex flex-wrap gap-1.5">
                        {c.vehicle_types.map(t => <StatusPill key={t} tone="neutral" dot={false}>{humanize(t)}</StatusPill>)}
                      </div>
                      <p className="text-xs text-muted">{c.trips_completed.toLocaleString('en-IN')} trips completed</p>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <Alert
            tone="info"
            title="Do not see what you need?"
            action={<Button onClick={postThisLoad}>Post this load</Button>}
          >
            Post your load with this lane filled in. {session ? '' : 'You sign in only when you post.'}
          </Alert>
        </>
      )}

      {!session && (
        <p className="text-sm text-muted">
          Already have an account? <Link className={buttonClasses({ variant: 'ghost', size: 'sm' })} to="/login?as=vendor&next=%2Fship">Sign in</Link>
        </p>
      )}

      {booking && (
        <PlaceBidModal
          guest={!session}
          window={toBidWindow(booking)}
          onClose={() => setBooking(null)}
          onPlaced={() => undefined}
          onGuestContinue={continueGuestBooking}
        />
      )}
    </Page>
  )
}
