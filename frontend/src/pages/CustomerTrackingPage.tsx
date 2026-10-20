import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search, MapPin, ArrowRight, ShieldCheck, Activity, Phone } from 'lucide-react'
import { shipmentsAPI } from '@/services/api'
import { Button } from '@/components/ui/Button'
import { buttonClasses } from '@/components/ui/buttonStyles'
import { ShipmentTracker, type ShipmentTrackingData } from '@/components/tracking/ShipmentTracker'
import type { AxiosError } from 'axios'
import clsx from 'clsx'

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

  return (
    <div className="min-h-screen bg-bg text-text flex flex-col">
      {/* Top Navbar */}
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-16 w-full max-w-content items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" className="flex min-w-0 items-center gap-2.5 rounded-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
            <img src="/margix-logo.png" alt="" className="h-8 w-8 shrink-0 object-contain" />
            <span className="text-lg font-bold tracking-tight">
              Margix<span className="text-brand">India</span>
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <a href="tel:+9102248901234" className="hidden sm:inline-flex items-center gap-1.5 text-xs text-muted hover:text-text">
              <Phone size={13} className="text-brand" /> +91 (022) 4890-1234
            </a>
            <Link to="/login" className={clsx(buttonClasses({ variant: 'ghost', size: 'sm' }), 'text-xs font-semibold')}>
              Staff sign in
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-content flex-1 space-y-8 px-4 py-8 sm:px-6 sm:py-12">
        <div className="max-w-2xl space-y-4">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-soft text-brand text-xs font-bold uppercase tracking-wider">
            <MapPin size={13} /> Live Telemetry
          </div>
          <h1 className="text-2xl font-extrabold text-text sm:text-4xl tracking-tight">
            Track a shipment
          </h1>
          <p className="text-sm text-muted sm:text-base leading-relaxed">
            Enter your consignment or tracking ID to see real-time vehicle coordinates, speed, and milestone delivery progress.
          </p>

          <form
            onSubmit={e => {
              e.preventDefault()
              const id = searchId.trim()
              if (id) navigate(`/track/${encodeURIComponent(id)}`)
            }}
            className="flex flex-col gap-2.5 sm:flex-row pt-2"
          >
            <div className="relative flex-1">
              <Search size={18} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="text"
                value={searchId}
                onChange={e => setSearchId(e.target.value)}
                placeholder="e.g. RTX-1A2B3C4D or TRK-98124"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                aria-label="Tracking ID"
                className="h-control w-full rounded-control border border-border-strong bg-surface pl-10 pr-4 text-base text-text placeholder:text-placeholder shadow-xs font-mono uppercase focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 sm:text-sm"
              />
            </div>
            <Button type="submit" size="lg" disabled={!searchId.trim()} className="font-bold justify-center shrink-0">
              Track shipment <ArrowRight size={15} className="ml-1" />
            </Button>
          </form>

          {/* Quick trust badges */}
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted pt-1">
            <span className="flex items-center gap-1.5">
              <Activity size={13} className="text-emerald-500" /> Live Highway GPS updates
            </span>
            <span className="flex items-center gap-1.5">
              <ShieldCheck size={13} className="text-brand" /> Verified Electronic POD
            </span>
          </div>
        </div>

        {trackingId && (
          <div className="pt-2">
            <ShipmentTracker
              trackingId={trackingId}
              shipment={notFound ? null : shipment}
              isLoading={isLoading}
              error={isError && !notFound ? 'Check your connection and try again.' : null}
              onRetry={refetch}
            />
          </div>
        )}
      </main>
    </div>
  )
}
