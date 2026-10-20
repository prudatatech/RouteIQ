import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Activity, ArrowRight, CheckCircle2, Clock, HelpCircle, Lock,
  MapPin, Phone, Radio, Search, ShieldCheck, Sparkles, Truck, X
} from 'lucide-react'
import { shipmentsAPI } from '@/services/api'
import { Button } from '@/components/ui/Button'
import { buttonClasses } from '@/components/ui/buttonStyles'
import { ShipmentTracker, type ShipmentTrackingData } from '@/components/tracking/ShipmentTracker'
import type { AxiosError } from 'axios'
import clsx from 'clsx'

const SAMPLE_TRACKING_IDS = ['RTX-MUM-BLR-01', 'CM-LOAD-7824', 'TRK-98124']

/** Public shipment tracking, at `/track` (search) and `/track/:trackingId` (result). No sign-in needed. */
export default function CustomerTrackingPage() {
  const { trackingId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const queryParamId = searchParams.get('id') || searchParams.get('consignment')
  const [searchId, setSearchId] = useState(trackingId ?? queryParamId ?? '')

  // If passed via query param on `/track?id=...`, navigate to `/track/:id`
  useEffect(() => {
    if (queryParamId && !trackingId) {
      navigate(`/track/${encodeURIComponent(queryParamId.trim())}`, { replace: true })
    }
  }, [queryParamId, trackingId, navigate])

  const { data: shipment, isLoading, isError, error, refetch } = useQuery<ShipmentTrackingData>({
    queryKey: ['tracking', trackingId],
    queryFn: () => shipmentsAPI.trackPublicly(trackingId as string),
    enabled: !!trackingId,
    retry: false,
    refetchInterval: (query) => {
      const d = query.state.data
      if (!d) return false
      return ['delivered', 'cancelled'].includes(d.status) ? false : 5000
    },
  })

  // Keep the box in step with the address (back button, shared link).
  useEffect(() => { setSearchId(trackingId ?? '') }, [trackingId])

  const notFound = isError && (error as AxiosError)?.response?.status === 404

  const handleSearch = (idToSearch: string) => {
    const trimmed = idToSearch.trim()
    if (trimmed) {
      navigate(`/track/${encodeURIComponent(trimmed)}`)
    }
  }

  return (
    <div className="min-h-screen bg-bg text-text flex flex-col selection:bg-brand-soft selection:text-brand">
      {/* Top Floating Glassmorphic Navbar */}
      <header className="sticky top-0 z-40 border-b border-border/80 bg-surface/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-content items-center justify-between gap-4 px-4 sm:px-6">
          <Link
            to="/"
            className="group flex min-w-0 items-center gap-2.5 rounded-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <div className="relative flex h-9 w-9 items-center justify-center rounded-control bg-surface-subtle border border-border p-1 shadow-xs transition-transform group-hover:scale-105">
              <img src="/margix-logo.png" alt="" className="h-full w-full object-contain" />
            </div>
            <div className="flex flex-col">
              <span className="text-lg font-extrabold tracking-tight text-text leading-tight">
                Margix<span className="text-brand">India</span>
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted -mt-0.5">
                RouteIQ Telemetry
              </span>
            </div>
          </Link>

          {/* Telemetry Status Indicator */}
          <div className="hidden md:flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            Highway GPS Active • Sub-minute updates
          </div>

          <div className="flex items-center gap-3">
            <a
              href="tel:+9102248901234"
              className="hidden lg:inline-flex items-center gap-1.5 rounded-control px-2.5 py-1 text-xs text-muted hover:bg-surface-subtle hover:text-text transition-colors"
            >
              <Phone size={13} className="text-brand" /> +91 (022) 4890-1234
            </a>
            <Link
              to="/login"
              className={clsx(
                buttonClasses({ variant: 'ghost', size: 'sm' }),
                'text-xs font-bold border border-border/80 hover:border-brand/40 shadow-xs'
              )}
            >
              Staff Portal
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-content flex-1 space-y-8 px-4 py-8 sm:px-6 sm:py-12">
        {/* Hero Search Section */}
        <div className="relative overflow-hidden rounded-3xl border border-border/80 bg-gradient-to-b from-surface via-surface to-surface-subtle p-6 sm:p-10 shadow-raised">
          {/* Subtle decorative mesh glow */}
          <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-brand/10 blur-3xl" />
          <div className="pointer-events-none absolute -left-20 -bottom-20 h-72 w-72 rounded-full bg-emerald-500/10 blur-3xl" />

          <div className="relative z-10 max-w-3xl space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-brand/20 bg-brand-soft px-3.5 py-1 text-xs font-bold uppercase tracking-wider text-brand shadow-xs">
              <Radio size={13} className="animate-pulse" /> Live Highway Telemetry
            </div>

            <h1 className="text-2xl font-black tracking-tight text-text sm:text-4xl lg:text-5xl">
              Track Consignment & Freight <span className="text-brand">Live</span>
            </h1>

            <p className="text-sm text-muted sm:text-base leading-relaxed max-w-2xl">
              Real-time highway tracking powered by connected on-board GPS, electronic proof of delivery (EPOD), and automated traffic-aware arrival countdowns.
            </p>

            {/* Ultra-Modern Search Console Pill */}
            <form
              onSubmit={e => {
                e.preventDefault()
                handleSearch(searchId)
              }}
              className="pt-2"
            >
              <div className="group relative flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-0 rounded-2xl sm:rounded-full border border-border-strong sm:border-border bg-surface p-1.5 shadow-raised transition-all duration-200 focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/15 hover:border-border-strong">
                <div className="relative flex flex-1 items-center min-w-0 pl-3.5 sm:pl-4 pr-2">
                  <Search
                    size={22}
                    aria-hidden="true"
                    className="pointer-events-none text-muted transition-colors group-focus-within:text-brand shrink-0"
                  />
                  <input
                    type="text"
                    value={searchId}
                    onChange={e => setSearchId(e.target.value)}
                    placeholder="Enter Tracking ID (e.g. RTX-MUM-BLR-01 or CM-LOAD-7824)"
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="Tracking ID"
                    className="w-full bg-transparent px-3 py-3 sm:py-3.5 text-base font-semibold tracking-wide text-text placeholder:text-muted/65 placeholder:font-normal placeholder:tracking-normal focus:outline-none"
                  />
                  {searchId && (
                    <button
                      type="button"
                      onClick={() => setSearchId('')}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-subtle hover:text-text transition-colors"
                      aria-label="Clear tracking search"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>

                <Button
                  type="submit"
                  size="lg"
                  disabled={!searchId.trim()}
                  className="h-12 px-7 text-sm font-bold tracking-wide justify-center shrink-0 rounded-xl sm:rounded-full shadow-xs transition-all hover:scale-[1.01] active:scale-[0.99]"
                >
                  Track Consignment <ArrowRight size={16} className="ml-1.5" />
                </Button>
              </div>
            </form>

            {/* Quick Test Demo Chips */}
            <div className="flex flex-wrap items-center gap-2 pt-2 text-xs">
              <span className="font-semibold text-muted flex items-center gap-1">
                <Sparkles size={12} className="text-brand" /> Quick search:
              </span>
              {SAMPLE_TRACKING_IDS.map(sampleId => (
                <button
                  key={sampleId}
                  type="button"
                  onClick={() => {
                    setSearchId(sampleId)
                    handleSearch(sampleId)
                  }}
                  className="rounded-lg border border-border bg-surface px-2.5 py-1 font-mono text-xs font-semibold text-muted transition-all hover:border-brand/40 hover:bg-surface-subtle hover:text-text hover:shadow-xs active:scale-95"
                >
                  {sampleId}
                </button>
              ))}
            </div>

            {/* Value Props Strip */}
            <div className="grid grid-cols-2 gap-3 pt-4 sm:grid-cols-4 border-t border-border/80">
              <div className="flex items-center gap-2 text-xs font-medium text-muted">
                <Activity size={15} className="text-emerald-500 shrink-0" />
                <span>Live Highway Radar</span>
              </div>
              <div className="flex items-center gap-2 text-xs font-medium text-muted">
                <ShieldCheck size={15} className="text-brand shrink-0" />
                <span>Electronic POD Verified</span>
              </div>
              <div className="flex items-center gap-2 text-xs font-medium text-muted">
                <Clock size={15} className="text-amber-500 shrink-0" />
                <span>Dynamic Traffic ETA</span>
              </div>
              <div className="flex items-center gap-2 text-xs font-medium text-muted">
                <Lock size={15} className="text-indigo-500 shrink-0" />
                <span>No Sign-in Required</span>
              </div>
            </div>
          </div>
        </div>

        {/* Tracking Result View */}
        {trackingId ? (
          <div className="pt-2 animate-in fade-in duration-300">
            <ShipmentTracker
              trackingId={trackingId}
              shipment={notFound ? null : shipment}
              isLoading={isLoading}
              error={isError && !notFound ? 'We could not fetch live tracking updates. Check your connection and retry.' : null}
              onRetry={refetch}
            />
          </div>
        ) : (
          /* Empty Initial State: Explanation of Highway Tracking */
          <div className="grid gap-6 md:grid-cols-3 pt-4">
            <div className="rounded-2xl border border-border bg-surface p-6 shadow-xs transition-all hover:border-brand/40 hover:shadow-raised">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-soft text-brand mb-4">
                <Truck size={24} />
              </div>
              <h2 className="text-base font-bold text-text mb-1">1. Highway Telemetry</h2>
              <p className="text-xs text-muted leading-relaxed">
                Every vehicle transmits continuous GPS pings, road speed, and heading directly to the control room, updating your map without page refreshes.
              </p>
            </div>

            <div className="rounded-2xl border border-border bg-surface p-6 shadow-xs transition-all hover:border-brand/40 hover:shadow-raised">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 mb-4">
                <MapPin size={24} />
              </div>
              <h2 className="text-base font-bold text-text mb-1">2. Corridor Waypoints</h2>
              <p className="text-xs text-muted leading-relaxed">
                Follow milestone progress across major national highways, cross-dock transit hubs, and toll checkpoints right up to destination arrival.
              </p>
            </div>

            <div className="rounded-2xl border border-border bg-surface p-6 shadow-xs transition-all hover:border-brand/40 hover:shadow-raised">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 mb-4">
                <ShieldCheck size={24} />
              </div>
              <h2 className="text-base font-bold text-text mb-1">3. Proof of Delivery</h2>
              <p className="text-xs text-muted leading-relaxed">
                Upon delivery, access receiver sign-off records, photo verification of packages, and official timestamped consignment manifests.
              </p>
            </div>
          </div>
        )}
      </main>

      {/* Modern Footer */}
      <footer className="border-t border-border bg-surface py-6 text-center text-xs text-muted">
        <div className="mx-auto max-w-content px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>© {new Date().getFullYear()} MargixIndia Logistics & RouteIQ Platform. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <Link to="/" className="hover:text-text transition-colors">Home</Link>
            <Link to="/login" className="hover:text-text transition-colors">Staff Login</Link>
            <a href="tel:+9102248901234" className="hover:text-text transition-colors">Emergency Dispatch</a>
          </div>
        </div>
      </footer>
    </div>
  )
}

