import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { shipmentsAPI } from '@/services/api'
import { Button } from '@/components/ui/Button'
import { buttonClasses } from '@/components/ui/buttonStyles'
import { ShipmentTracker, type ShipmentTrackingData } from '@/components/tracking/ShipmentTracker'
import type { AxiosError } from 'axios'

/** Public shipment tracking, at `/track` (search) and `/track/:trackingId` (result). No sign-in needed. */
export default function CustomerTrackingPage() {
  const { trackingId } = useParams()
  const navigate = useNavigate()
  const [searchId, setSearchId] = useState(trackingId ?? '')

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
    <div className="min-h-screen bg-bg text-text">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-16 max-w-content items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" className="flex min-w-0 items-center gap-2.5 rounded-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
            <img src="/margix-logo.png" alt="" className="h-8 w-8 shrink-0 object-contain" />
            <span className="text-lg font-semibold">MargixIndia</span>
          </Link>
          <Link to="/login" className={buttonClasses({ variant: 'ghost', size: 'sm' })}>Staff sign in</Link>
        </div>
      </header>

      <main className="mx-auto max-w-content space-y-8 px-4 py-8 sm:px-6 sm:py-12">
        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-semibold text-text sm:text-3xl">Track a shipment</h1>
            <p className="mt-1 text-sm text-muted sm:text-base">Enter your tracking ID to see where it is now.</p>
          </div>

          <form
            onSubmit={e => { e.preventDefault(); const id = searchId.trim(); if (id) navigate(`/track/${encodeURIComponent(id)}`) }}
            className="flex max-w-md flex-col gap-2 sm:flex-row"
          >
            <div className="relative flex-1">
              <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="text"
                value={searchId}
                onChange={e => setSearchId(e.target.value)}
                placeholder="e.g. RTX-1A2B3C4D"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                aria-label="Tracking ID"
                className="h-control w-full rounded-control border border-border-strong bg-surface pl-9 pr-3 text-base text-text placeholder:text-disabled focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 sm:text-sm"
              />
            </div>
            <Button type="submit" disabled={!searchId.trim()}>Track shipment</Button>
          </form>
        </div>

        {trackingId && (
          <ShipmentTracker
            trackingId={trackingId}
            shipment={notFound ? null : shipment}
            isLoading={isLoading}
            error={isError && !notFound ? 'Check your connection and try again.' : null}
            onRetry={refetch}
          />
        )}
      </main>
    </div>
  )
}
