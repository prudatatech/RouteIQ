import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Clock, ShieldCheck, TrendingUp, Zap } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase, openChannel } from '@/services/supabase'
import { useAuthStore } from '@/store/authStore'
import { capacityAPI, vendorAPI } from '@/services/api'
import { useVendorContext } from '@/components/vendor/vendorContext'
import { resolvePlace, suggestPlaces } from '@/services/geocoding'
import PlaceBidModal from '@/components/vendor/PlaceBidModal'
import { Alert, Button, buttonClasses, Card, EmptyState, ErrorState, Page, PageHeader, Skeleton } from '@/components/ui'
import { formatRupees, formatMinutes } from '@/utils/display'

interface OpenWindow {
  id: string
  trigger_type: string | null
  opens_at: string
  closes_at: string
  floor_price: number | null
  vehicles: { vehicle_type: string | null; available_capacity_kg: number | null } | null
}

interface PassingRoute {
  id: string
  /** Minutes for the truck to reach you from where it is now; null when it could not be worked out. */
  eta_minutes: number | null
  available_capacity_kg: number
  city: string | null
  routes?: {
    vehicles?: {
      vehicle_type?: string
    }
  }
}

function TriggerBadge({ trigger }: { trigger: string | null }) {
  if (trigger === 'mid_route') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-medium text-brand">
        <Zap size={11} /> Mid-route fill
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-info-soft px-2.5 py-0.5 text-xs font-medium text-info">
      <TrendingUp size={11} /> Empty return
    </span>
  )
}

function useCountdown(until: string) {
  const [remaining, setRemaining] = useState(() => new Date(until).getTime() - Date.now())
  useEffect(() => {
    const id = setInterval(() => setRemaining(new Date(until).getTime() - Date.now()), 1000)
    return () => clearInterval(id)
  }, [until])
  return Math.max(0, remaining)
}

function ClosesIn({ until }: { until: string }) {
  const remaining = useCountdown(until)
  const closed = remaining === 0
  const hours = Math.floor(remaining / 3_600_000)
  const minutes = Math.floor((remaining % 3_600_000) / 60000)
  const seconds = Math.floor((remaining % 60000) / 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    <span className={closed ? 'text-danger' : 'text-muted'}>
      {closed ? 'Closed' : `Closes in ${hours > 0 ? `${hours}:${pad(minutes)}` : minutes}:${pad(seconds)}`}
    </span>
  )
}

export default function VendorCorridorPage() {
  const [windows, setWindows] = useState<OpenWindow[]>([])
  const [passingRoutes, setPassingRoutes] = useState<PassingRoute[]>([])
  const [myBidWindowIds, setMyBidWindowIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [biddingWindow, setBiddingWindow] = useState<OpenWindow | null>(null)
  const [claiming, setClaiming] = useState<string | null>(null)

  const userId = useAuthStore(s => s.userId)
  const session = useAuthStore(s => s.session)
  const navigate = useNavigate()
  const { vendorProfile, isVendor } = useVendorContext()
  const kycApproved = vendorProfile?.kycStatus === 'approved'

  const fetchData = async () => {
    try {
      const [w, p, b] = await Promise.all([
        session ? capacityAPI.openWindows() : Promise.resolve([]),
        session ? vendorAPI.passingRoutes().catch(() => []) : Promise.resolve([]),
        userId ? supabase.from('capacity_bids').select('window_id, status').eq('vendor_id', userId) : Promise.resolve({ data: [] as { window_id: string; status: string }[] }),
      ])
      setWindows(w as OpenWindow[])
      setPassingRoutes(p as PassingRoute[])
      const bidRows = (b as { data: { window_id: string; status: string }[] | null }).data ?? []
      // Only a bid still being considered (or won) blocks another; after a rejected, lost or expired bid the vendor can bid again
      setMyBidWindowIds(new Set(bidRows.filter(r => r.status === 'pending' || r.status === 'won').map(r => r.window_id)))
      setError(null)
    } catch {
      setError('We could not load corridors. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    const subW = openChannel('vendor_corr_win').on('postgres_changes', { event: '*', schema: 'public', table: 'capacity_windows' }, fetchData).subscribe()
    const subB = openChannel('vendor_corr_bids').on('postgres_changes', { event: '*', schema: 'public', table: 'capacity_bids' }, fetchData).subscribe()
    return () => { supabase.removeChannel(subW); supabase.removeChannel(subB) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, session])

  /** Send the vendor to post-a-load with the passing truck's current position pre-set as the drop point. */
  // Opens post-a-load with the city the truck passes already placed on the map.
  // The truck's own position stays private; the city is resolved by place search.
  const claimCapacity = async (pr: PassingRoute) => {
    if (!isVendor) {
      navigate('/vendor/request')
      return
    }
    if (!kycApproved) {
      toast('Finish your company KYC first. It only takes a few minutes.')
      navigate(vendorProfile ? '/vendor/documents' : '/vendor/onboarding')
      return
    }
    const city = pr.city?.trim()
    if (!city) {
      navigate('/vendor/request')
      return
    }
    setClaiming(pr.id)
    const [first] = await suggestPlaces(city).catch(() => [])
    const place = first ? await resolvePlace(first).catch(() => null) : null
    setClaiming(null)
    navigate(place
      ? `/vendor/request?query=${encodeURIComponent(place.address)}&lat=${place.lat}&lng=${place.lng}`
      : `/vendor/request?query=${encodeURIComponent(city)}`)
  }

  const handlePlaceBid = (w: OpenWindow) => {
    if (!session) {
      navigate(`/login?as=vendor&next=${encodeURIComponent('/vendor/corridor')}`)
      return
    }
    if (!kycApproved) {
      toast('Finish your company KYC first. It only takes a few minutes.')
      navigate(vendorProfile ? '/vendor/documents' : '/vendor/onboarding')
      return
    }
    setBiddingWindow(w)
  }

  if (!session) {
    return (
      <Page>
        <PageHeader title="Corridors" description="Open capacity windows and passing trucks near you, updated live." />
        <EmptyState
          title="Sign in to see live capacity"
          description="Open capacity windows and passing trucks are shown to signed-in vendors."
          action={(
            <Link to={`/login?as=vendor&next=${encodeURIComponent('/vendor/corridor')}`} className={buttonClasses({ variant: 'primary' })}>
              Sign in
            </Link>
          )}
        />
      </Page>
    )
  }

  return (
    <Page>
      <PageHeader title="Corridors" description="Open capacity windows and passing trucks near you, updated live." />

      {isVendor && !kycApproved && (
        <Alert
          tone={vendorProfile?.kycStatus === 'submitted' ? 'info' : 'warning'}
          title={vendorProfile?.kycStatus === 'submitted' ? 'Your KYC is in review' : 'Finish your KYC to bid'}
          action={vendorProfile?.kycStatus === 'submitted' ? undefined : (
            <Link to={vendorProfile ? '/vendor/documents' : '/vendor/onboarding'} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
              {vendorProfile ? 'Open company & KYC' : 'Set up company'}
            </Link>
          )}
        >
          {vendorProfile?.kycStatus === 'submitted'
            ? 'You can bid once we approve it. We will notify you.'
            : 'You can look at capacity now. Placing a bid needs an approved KYC.'}
        </Alert>
      )}

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-text">Live capacity near you</h2>
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}
          </div>
        ) : passingRoutes.length === 0 ? (
          <EmptyState compact title="No passing routes right now" description="We will show trucks passing near your locations here." />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {passingRoutes.map(pr => (
              <Card key={pr.id} padded className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-medium text-brand">
                    <Zap size={11} /> Route match
                  </span>
                  <span className="text-xs text-muted">{pr.eta_minutes != null ? `${formatMinutes(pr.eta_minutes)} away` : 'Nearby'}</span>
                </div>
                <div className="text-xs text-muted">{pr.routes?.vehicles?.vehicle_type || 'Truck'}</div>
                <p className="text-2xl font-semibold text-text">
                  {pr.available_capacity_kg.toLocaleString('en-IN')} <span className="text-sm font-normal text-muted">kg free</span>
                </p>
                <Button
                  variant="secondary"
                  className="mt-auto"
                  loading={claiming === pr.id}
                  disabled={claiming !== null}
                  onClick={() => claimCapacity(pr)}
                >
                  Claim capacity
                </Button>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-text">Open capacity windows</h2>
        {error ? (
          <ErrorState compact title="We could not load corridors" description="Check your connection and try again." onRetry={() => { setLoading(true); fetchData() }} />
        ) : loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-48 w-full" />)}
          </div>
        ) : windows.length === 0 ? (
          <EmptyState compact title="No open windows near you right now" description="Trucks with free space near your pickup location appear here as soon as a window opens. Keep your company address up to date under Company &amp; KYC." />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {windows.map(w => {
              const alreadyBid = myBidWindowIds.has(w.id)
              return (
                <Card key={w.id} padded className="flex min-h-[220px] flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <TriggerBadge trigger={w.trigger_type} />
                    <div className="flex items-center gap-1 text-xs">
                      <Clock size={12} className="text-muted" />
                      <ClosesIn until={w.closes_at} />
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-muted">{w.vehicles?.vehicle_type || 'Vehicle'}</p>
                    <p className="text-2xl font-semibold text-text">
                      {(w.vehicles?.available_capacity_kg ?? 0).toLocaleString('en-IN')} <span className="text-sm font-normal text-muted">kg free</span>
                    </p>
                  </div>

                  <div className="mt-auto flex items-center justify-between border-t border-border pt-3">
                    <div>
                      <p className="text-xs text-muted">Minimum bid</p>
                      <p className="text-sm font-medium text-text">{w.floor_price != null ? formatRupees(w.floor_price) : 'Set for your load'}</p>
                    </div>
                    {alreadyBid ? (
                      <span className="inline-flex items-center gap-1.5 rounded-control bg-brand-soft px-3 py-2 text-sm font-medium text-brand">
                        <ShieldCheck size={14} /> Bid placed
                      </span>
                    ) : (
                      <Button
                        disabled={new Date(w.closes_at).getTime() <= Date.now()}
                        onClick={() => handlePlaceBid(w)}
                      >
                        Place bid
                      </Button>
                    )}
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </section>

      {biddingWindow && (
        <PlaceBidModal window={biddingWindow} onClose={() => setBiddingWindow(null)} onPlaced={fetchData} />
      )}
    </Page>
  )
}
