import { ArrowRight, Gavel, MapPin, Package } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useVendorContext } from '@/components/vendor/vendorContext'
import { Alert, Card, Page, PlaceSearch } from '@/components/ui'
import type { ResolvedPlace } from '@/services/geocoding'

export default function VendorPortalPage() {
  const navigate = useNavigate()
  const { vendorProfile, isSignedIn, isVendor } = useVendorContext()
  const kycApproved = vendorProfile?.kycStatus === 'approved'

  const goPostLoad = (query?: string, place?: ResolvedPlace | null) => {
    if (!isSignedIn) {
      navigate(`/login?as=vendor&next=${encodeURIComponent('/vendor/request')}`)
      return
    }
    if (!kycApproved) {
      navigate('/vendor/documents')
      return
    }
    const params = new URLSearchParams()
    if (place) {
      params.set('query', place.address)
      params.set('lat', String(place.lat))
      params.set('lng', String(place.lng))
    } else if (query) {
      params.set('query', query)
    }
    navigate(`/vendor/request?${params}`)
  }

  return (
    <Page>
      <section className="space-y-4 py-6 text-center sm:py-10">
        <h1 className="text-2xl font-semibold text-text sm:text-3xl">Where are you shipping today?</h1>
        <p className="mx-auto max-w-2xl text-sm text-muted sm:text-base">
          Find verified fleet capacity, post a load with your own floor price, and track it end to end.
        </p>

        {isVendor && !kycApproved && (
          <div className="mx-auto max-w-2xl pt-2 text-left">
            <Alert tone="warning" title="Complete your KYC to post loads and bid">
              Your company needs an approved KYC before you can post a load or place a bid.{' '}
              <button type="button" onClick={() => navigate('/vendor/documents')} className="font-medium underline">
                Complete company & KYC
              </button>
            </Alert>
          </div>
        )}

        <div className="mx-auto max-w-2xl pt-2">
          <PlaceSearch
            label="Where is your shipment located?"
            placeholder="Search a pickup location"
            value={null}
            onChange={place => { if (place) goPostLoad(undefined, place) }}
          />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <button type="button" onClick={() => navigate('/vendor/corridor')} className="text-left">
          <Card padded className="h-full space-y-3 transition-colors hover:border-brand">
            <div className="flex h-10 w-10 items-center justify-center rounded-control bg-brand-soft text-brand">
              <Gavel size={18} />
            </div>
            <div>
              <p className="text-lg font-semibold text-text">Corridors</p>
              <p className="mt-1 text-sm text-muted">Open capacity windows and active bid markets, updated live.</p>
            </div>
            <span className="inline-flex items-center gap-1 text-sm font-medium text-brand">
              Explore <ArrowRight size={14} />
            </span>
          </Card>
        </button>

        <button type="button" onClick={() => navigate('/vendor/shipments')} className="text-left">
          <Card padded className="h-full space-y-3 transition-colors hover:border-brand">
            <div className="flex h-10 w-10 items-center justify-center rounded-control bg-brand-soft text-brand">
              <Package size={18} />
            </div>
            <div>
              <p className="text-lg font-semibold text-text">My shipments</p>
              <p className="mt-1 text-sm text-muted">Your active bids, posted loads and shipment history.</p>
            </div>
            <span className="inline-flex items-center gap-1 text-sm font-medium text-brand">
              Manage <ArrowRight size={14} />
            </span>
          </Card>
        </button>
      </div>

      <div className="flex justify-center">
        <button
          type="button"
          onClick={() => goPostLoad()}
          className="inline-flex items-center gap-2 text-sm font-medium text-muted hover:text-text"
        >
          <MapPin size={14} /> Or post a load without searching first
        </button>
      </div>
    </Page>
  )
}
