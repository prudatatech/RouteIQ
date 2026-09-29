import { useEffect, useState } from 'react'
import { supabase } from '@/services/supabase'
import { useAuthStore } from '@/store/authStore'
import VendorTrackerCard from '@/components/vendor/VendorTrackerCard'
import { EmptyState, Page, PageHeader, SearchInput, Skeleton } from '@/components/ui'

interface TrackableRequest {
  id: string
  tracking_id: string
}

export default function VendorTrackingPage() {
  const [active, setActive] = useState<TrackableRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [searchedId, setSearchedId] = useState('')
  const userId = useAuthStore(s => s.userId)

  useEffect(() => {
    if (!userId) return
    const load = async () => {
      const { data } = await supabase
        .from('vendor_shipment_requests')
        .select('id, cargo_manifest(id)')
        .eq('vendor_id', userId)
        .order('created_at', { ascending: false })
      setActive(
        (data ?? [])
          .filter((r: any) => r.cargo_manifest && r.cargo_manifest.length > 0)
          .map((r: any) => ({ id: r.id, tracking_id: `CM-${r.cargo_manifest[0].id.slice(0, 8).toUpperCase()}` })),
      )
      setLoading(false)
    }
    load()
  }, [userId])

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSearchedId(search.trim().toUpperCase())
  }

  return (
    <Page>
      <PageHeader title="Tracking" description="Live position and status of your assigned shipments." />

      <form onSubmit={submitSearch} className="max-w-sm">
        <SearchInput label="Tracking ID" value={search} onChange={setSearch} placeholder="Search by tracking ID (e.g. CM-1A2B3C4D)" />
      </form>

      {searchedId && (
        <VendorTrackerCard key={searchedId} trackingId={searchedId} />
      )}

      {!searchedId && (
        loading ? (
          <div className="space-y-4">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-64 w-full" />)}</div>
        ) : active.length === 0 ? (
          <EmptyState title="No active shipments" description="Once a vehicle is assigned to one of your loads, you can track it here." />
        ) : (
          <div className="space-y-4">
            {active.map(r => <VendorTrackerCard key={r.id} trackingId={r.tracking_id} />)}
          </div>
        )
      )}
    </Page>
  )
}
