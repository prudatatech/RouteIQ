import { useEffect, useState } from 'react'
import { Clock, ShieldCheck, TrendingUp, Zap } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/services/supabase'
import { useAuthStore } from '@/store/authStore'
import { formatEta } from '@/utils/timeFormat'
import { capacityAPI, vendorAPI } from '@/services/api'
import { useVendorContext } from '@/components/vendor/vendorContext'
import PlaceBidModal from '@/components/vendor/PlaceBidModal'
import { Alert, Card, EmptyState, Page, PageHeader, Skeleton } from '@/components/ui'

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
  eta_minutes: number
  available_capacity_kg: number
  city: string | null
  routes?: { vehicles?: { vehicle_type?: string } }
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
  const minutes = Math.floor(remaining / 60000)
  const seconds = Math.floor((remaining % 60000) / 1000)
  return (
    <span className={closed ? 'text-danger' : 'text-muted'}>
      {closed ? 'Closed' : `Closes in ${minutes}:${String(seconds).padStart(2, '0')}`}
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
        userId ? supabase.from('capacity_bids').select('window_id').eq('vendor_id', userId) : Promise.resolve({ data: [] as { window_id: string }[] }),
      ])
      setWindows(w as OpenWindow[])
      setPassingRoutes(p as PassingRoute[])
      const bidRows = (b as { data: { window_id: string }[] | null }).data ?? []
      setMyBidWindowIds(new Set(bidRows.map(r => r.window_id)))
      setError(null)
    } catch {
      setError('We could not load corridors. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    const subW = supabase.channel('vendor_corr_win').on('postgres_changes', { event: '*', schema: 'public', table: 'capacity_windows' }, fetchData).subscribe()
    const subB = supabase.channel('vendor_corr_bids').on('postgres_changes', { event: '*', schema: 'public', table: 'capacity_bids' }, fetchData).subscribe()
    return () => { supabase.removeChannel(subW); supabase.removeChannel(subB) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, session])

  const handlePlaceBid = (w: OpenWindow) => {
    if (!session) {
      navigate(`/login?as=vendor&next=${encodeURIComponent('/vendor/corridor')}`)
      return
    }
    if (!kycApproved) {
      navigate('/vendor/documents')
      return
    }
    setBiddingWindow(w)
  }

  return (
    <Page>
      <PageHeader title="Corridors" description="Open capacity windows and passing trucks near you, updated live." />

      {isVendor && !kycApproved && (
        <Alert tone="warning" title="Complete your KYC to bid">
          Your company needs an approved KYC before you can place a bid.
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
                  <span className="text-xs text-muted">{formatEta(pr.eta_minutes)} away</span>
                </div>
                <div className="text-xs text-muted">{pr.routes?.vehicles?.vehicle_type || 'Truck'}</div>
                <p className="text-2xl font-semibold text-text">
                  {pr.available_capacity_kg.toLocaleString('en-IN')} <span className="text-sm font-normal text-muted">kg free</span>
                </p>
                <button
                  type="button"
                  onClick={() => navigate(`/vendor/request?query=${encodeURIComponent(pr.city || '')}`)}
                  className="mt-auto rounded-control border border-border py-2 text-sm font-medium text-text hover:bg-surface-subtle"
                >
                  Claim capacity
                </button>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-text">Open capacity windows</h2>
        {error ? (
          <EmptyState compact title="Could not load windows" description={error} />
        ) : loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-48 w-full" />)}
          </div>
        ) : windows.length === 0 ? (
          <EmptyState compact title="No open windows right now" description="New capacity windows will appear here as vehicles report free space." />
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
                      <p className="text-xs text-muted">Floor price</p>
                      <p className="text-sm font-medium text-text">₹{(w.floor_price ?? 0).toLocaleString('en-IN')}</p>
                    </div>
                    {alreadyBid ? (
                      <span className="inline-flex items-center gap-1.5 rounded-control bg-brand-soft px-3 py-2 text-sm font-medium text-brand">
                        <ShieldCheck size={14} /> Bid placed
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handlePlaceBid(w)}
                        className="rounded-control bg-brand-fill px-4 py-2 text-sm font-medium text-text hover:opacity-90"
                      >
                        Place bid
                      </button>
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
