import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Clock, ShieldCheck, TrendingUp, Zap } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase, openChannel } from '@/services/supabase'
import { useAuthStore } from '@/store/authStore'
import { capacityAPI, publicAPI, vendorAPI, type PublicSpareSpace } from '@/services/api'
import { useVendorContext } from '@/components/vendor/vendorContext'
import { resolvePlace, suggestPlaces } from '@/services/geocoding'
import PlaceBidModal, { type BidFields, type CapacityWindow } from '@/components/vendor/PlaceBidModal'
import MyBids, { type VendorBid } from '@/components/vendor/MyBids'
import type { VendorLoad } from '@/components/vendor/loads'
import { Alert, Button, buttonClasses, Card, EmptyState, ErrorState, Page, PageHeader, Skeleton } from '@/components/ui'
import { formatRupees, formatMinutes, formatDateTime } from '@/utils/display'
import { clearGuestDraft, loadGuestDraft, saveGuestDraft } from '@/utils/guestDraft'

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

/** A bid started before signing in: the space it is for, and what was typed. */
interface BidDraft {
  windowId: string
  window: CapacityWindow
  fields: BidFields
}

/** A public spare-space listing in the shape the bid form takes. */
function toBidWindow(p: PublicSpareSpace): CapacityWindow {
  return {
    id: p.id,
    floor_price: null,
    closes_at: p.departs_to ?? p.departs_from,
    vehicles: { vehicle_type: p.vehicle_type, available_capacity_kg: p.free_kg },
  }
}

function TriggerBadge({ trigger }: { trigger: string | null }) {
  if (trigger === 'mid_route') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-medium text-brand">
        <Zap size={11} /> Mid-trip fill
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
  const [bids, setBids] = useState<VendorBid[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [biddingWindow, setBiddingWindow] = useState<CapacityWindow | null>(null)
  const [claiming, setClaiming] = useState<string | null>(null)
  const [publicSpace, setPublicSpace] = useState<PublicSpareSpace[]>([])
  const [guestBidding, setGuestBidding] = useState<PublicSpareSpace | null>(null)
  const [restoredBid, setRestoredBid] = useState<BidFields | null>(null)
  // The company profile loads a moment after the session; wait for it (up to a few seconds) before judging KYC on a return from sign-in
  const [profileWait, setProfileWait] = useState(false)

  const userId = useAuthStore(s => s.userId)
  const session = useAuthStore(s => s.session)
  const navigate = useNavigate()
  const authInitialized = useAuthStore(s => s.authInitialized)
  const { vendorProfile, isVendor } = useVendorContext()
  const kycApproved = vendorProfile?.kycStatus === 'approved'
  const [params, setParams] = useSearchParams()
  const windowId = params.get('window')
  const bidId = params.get('bid')
  const scrolled = useRef<string | null>(null)

  // Only a bid still being considered (or won) blocks another; after a rejected, lost or expired bid the vendor can bid again
  const myBidWindowIds = useMemo(() => new Set(bids.filter(r => r.status === 'pending' || r.status === 'won').map(r => r.window_id)), [bids])

  // The load a won bid created, so its outcome can open it
  const loads = useQuery<VendorLoad[]>({ queryKey: ['vendor', 'loads'], queryFn: () => vendorAPI.loads() as Promise<VendorLoad[]>, enabled: isVendor })
  const loadOfBid = useMemo(() => new Map((loads.data ?? []).filter(l => l.bid_id).map(l => [l.bid_id as string, l.id])), [loads.data])

  const fetchData = async () => {
    try {
      if (!session) {
        setPublicSpace(await publicAPI.spareSpace())
        setError(null)
        return
      }
      const [w, p, b] = await Promise.all([
        session ? capacityAPI.openWindows() : Promise.resolve([]),
        session ? vendorAPI.passingRoutes().catch(() => []) : Promise.resolve([]),
        session ? capacityAPI.myBids().catch(() => []) : Promise.resolve([]),
      ])
      setWindows(w as OpenWindow[])
      setPassingRoutes(p as PassingRoute[])
      setBids(b as VendorBid[])
      setError(null)
    } catch {
      setError('We could not load return trips. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    // Live updates need a sign-in; a visitor sees the list as of now.
    if (!session) return
    const subW = openChannel('vendor_corr_win').on('postgres_changes', { event: '*', schema: 'public', table: 'capacity_windows' }, fetchData).subscribe()
    const subB = openChannel('vendor_corr_bids').on('postgres_changes', { event: '*', schema: 'public', table: 'capacity_bids' }, fetchData).subscribe()
    return () => { supabase.removeChannel(subW); supabase.removeChannel(subB) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, session])

  // A notification opens ?window=<id> (a return trip that just opened) or ?bid=<id> (a bid's outcome)
  useEffect(() => {
    const target = !loading ? (windowId && windows.some(w => w.id === windowId) ? `window-${windowId}` : bidId ? `bid-${bidId}` : null) : null
    if (!target || scrolled.current === target) return
    scrolled.current = target
    setTimeout(() => document.getElementById(target)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 0)
  }, [loading, windowId, bidId, windows, bids])

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
      navigate(vendorProfile ? '/vendor/company' : '/vendor/onboarding')
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
    if (!kycApproved) {
      toast('Finish your company KYC first. It only takes a few minutes.')
      navigate(vendorProfile ? '/vendor/company' : '/vendor/onboarding')
      return
    }
    setBiddingWindow(w)
  }

  // Bid started before signing in: save it, sign in, and come back to confirm it.
  const continueGuestBid = (fields: BidFields) => {
    if (!guestBidding) return
    const draft: BidDraft = { windowId: guestBidding.id, window: toBidWindow(guestBidding), fields }
    if (!saveGuestDraft('bid', draft)) toast('We could not save your bid on this device, so you may need to fill it in again after signing in.')
    navigate(`/login?as=vendor&next=${encodeURIComponent(`/vendor/return-trips?bid=${guestBidding.id}&resume=1`)}`)
  }

  // Back from sign-in: reopen the bid form with what was typed. The vendor confirms; nothing is placed automatically.
  useEffect(() => {
    if (params.get('resume') !== '1' || !authInitialized || !session || loading) return
    const id = params.get('bid')
    const clearParams = () => setParams(prev => { const n = new URLSearchParams(prev); n.delete('resume'); n.delete('bid'); return n }, { replace: true })
    const draft = loadGuestDraft<BidDraft>('bid')
    if (!id || !draft || draft.windowId !== id) {
      clearParams()
      return
    }
    if (!kycApproved && !vendorProfile && !profileWait) return
    if (!kycApproved) {
      // The vendor has to finish KYC first; the draft stays for a day so they can bid after.
      clearParams()
      toast('Finish your company KYC first. It only takes a few minutes.')
      navigate(vendorProfile ? '/vendor/company' : '/vendor/onboarding')
      return
    }
    setRestoredBid(draft.fields)
    setBiddingWindow(windows.find(w => w.id === id) ?? draft.window)
    clearParams()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, authInitialized, session, loading, kycApproved, vendorProfile, profileWait])

  useEffect(() => {
    if (params.get('resume') !== '1' || !session) return
    const t = setTimeout(() => setProfileWait(true), 3000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!session])

  if (!session) {
    return (
      <Page>
        <PageHeader title="Return trips" description="Spare space on trucks heading back. Pick one and bid to fill it with your load." />
        <Alert tone="info" title="Look around freely">
          You only sign in or create an account when you place a bid. Your bid is kept while you sign in.
        </Alert>
        <section id="open-return-trips" className="space-y-4">
          <h2 className="text-lg font-semibold text-text">Spare space on trucks</h2>
          {error ? (
            <ErrorState compact title="We could not load return trips" description="Check your connection and try again." onRetry={() => { setLoading(true); fetchData() }} />
          ) : loading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-48 w-full" />)}
            </div>
          ) : publicSpace.length === 0 ? (
            <EmptyState
              compact
              title="No spare space listed right now"
              description="Check back soon, or post your load and let trucks come to you."
              action={<Link to="/vendor/request" className={buttonClasses({ variant: 'primary' })}>Post a load</Link>}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {publicSpace.map(sp => (
                <Card key={sp.id} id={`window-${sp.id}`} padded className="flex flex-col gap-3">
                  <div>
                    <p className="text-xs text-muted">{sp.company.name}</p>
                    <p className="text-base font-semibold text-text">{sp.from_city} to {sp.to_city}</p>
                    <p className="text-xs text-muted">Leaves {formatDateTime(sp.departs_from)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted">{sp.vehicle_type || 'Truck'}</p>
                    <p className="text-2xl font-semibold text-text">
                      {sp.free_kg.toLocaleString('en-IN')} <span className="text-sm font-normal text-muted">kg free</span>
                    </p>
                  </div>
                  <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3">
                    <div>
                      <p className="text-xs text-muted">From</p>
                      <p className="text-sm font-medium text-text">{sp.price_per_kg_from != null ? `${formatRupees(sp.price_per_kg_from)} per kg` : 'Name your price'}</p>
                    </div>
                    <Button onClick={() => setGuestBidding(sp)}>Bid</Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>
        {guestBidding && (
          <PlaceBidModal
            guest
            window={toBidWindow(guestBidding)}
            onClose={() => setGuestBidding(null)}
            onPlaced={() => undefined}
            onGuestContinue={continueGuestBid}
          />
        )}
      </Page>
    )
  }

  return (
    <Page>
      <PageHeader title="Return trips" description="Spare space on trucks heading back near you. Bid to fill it with your load, updated live." />

      {isVendor && !kycApproved && (
        <Alert
          tone={vendorProfile?.kycStatus === 'submitted' ? 'info' : 'warning'}
          title={vendorProfile?.kycStatus === 'submitted' ? 'Your KYC is in review' : 'Finish your KYC to bid'}
          action={vendorProfile?.kycStatus === 'submitted' ? undefined : (
            <Link to={vendorProfile ? '/vendor/company' : '/vendor/onboarding'} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
              {vendorProfile ? 'Open company' : 'Set up company'}
            </Link>
          )}
        >
          {vendorProfile?.kycStatus === 'submitted'
            ? 'You can bid once we approve it. We will notify you.'
            : 'You can look at capacity now. Placing a bid needs an approved KYC.'}
        </Alert>
      )}

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-text">Trucks passing near you</h2>
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}
          </div>
        ) : passingRoutes.length === 0 ? (
          <EmptyState compact title="No passing trips right now" description="We will show trucks passing near your locations here." />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {passingRoutes.map(pr => (
              <Card key={pr.id} padded className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-medium text-brand">
                    <Zap size={11} /> Trip match
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
                  Post a load for this truck
                </Button>
              </Card>
            ))}
          </div>
        )}
      </section>

      {windowId && !loading && !error && !windows.some(w => w.id === windowId) && (
        <Alert
          tone="info"
          title="That return trip is no longer open"
          action={<Button variant="secondary" size="sm" onClick={() => setParams(prev => { const next = new URLSearchParams(prev); next.delete('window'); return next }, { replace: true })}>Dismiss</Button>}
        >
          Another vendor may have won it, or its bidding time ended. Trucks with space near you appear below as they open.
        </Alert>
      )}

      <section id="open-return-trips" className="scroll-mt-20 space-y-4">
        <h2 className="text-lg font-semibold text-text">Open return trips</h2>
        {error ? (
          <ErrorState compact title="We could not load return trips" description="Check your connection and try again." onRetry={() => { setLoading(true); fetchData() }} />
        ) : loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-48 w-full" />)}
          </div>
        ) : windows.length === 0 ? (
          <EmptyState compact title="No open return trips near you right now" description="Trucks with free space near your pickup location appear here as soon as a return trip opens. Keep your company address up to date under Company." />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {windows.map(w => {
              const alreadyBid = myBidWindowIds.has(w.id)
              return (
                <Card key={w.id} id={`window-${w.id}`} padded className={`flex min-h-[220px] scroll-mt-24 flex-col gap-3${w.id === windowId ? ' ring-2 ring-brand' : ''}`}>
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

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-text">My bids</h2>
        <MyBids bids={bids} loading={loading} focusId={bidId} loadOfBid={loadOfBid} />
      </section>

      {biddingWindow && (
        <PlaceBidModal
          window={biddingWindow}
          initial={restoredBid ?? undefined}
          restored={!!restoredBid}
          onClose={() => { setBiddingWindow(null); setRestoredBid(null) }}
          onPlaced={() => { clearGuestDraft('bid'); fetchData() }}
        />
      )}
    </Page>
  )
}
