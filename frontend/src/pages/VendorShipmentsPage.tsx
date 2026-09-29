import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/services/supabase'
import { capacityAPI } from '@/services/api'
import { useAuthStore } from '@/store/authStore'
import { Button, DataTable, Page, PageHeader, StatusPill, type Column } from '@/components/ui'

interface VendorBid {
  id: string
  bid_amount: number
  weight_kg: number | null
  status: string
  submitted_at: string
  eway_bill_ref: string | null
  capacity_windows: { trigger_type: string | null; vehicles: { vehicle_type: string | null } | null } | null
}

interface VendorRequest {
  id: string
  pickup_location: string | null
  drop_location: string | null
  required_capacity_kg: number | null
  status: string
  created_at: string
  cargo_manifest?: { id: string }[]
}

export default function VendorShipmentsPage() {
  const [bids, setBids] = useState<VendorBid[]>([])
  const [requests, setRequests] = useState<VendorRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const userId = useAuthStore(s => s.userId)
  const navigate = useNavigate()

  const fetchData = async () => {
    if (!userId) return
    try {
      const [b, r] = await Promise.all([
        capacityAPI.myBids(),
        supabase.from('vendor_shipment_requests').select('*, cargo_manifest(id)').eq('vendor_id', userId).order('created_at', { ascending: false }),
      ])
      setBids(b as VendorBid[])
      setRequests((r.data ?? []) as VendorRequest[])
      setError(null)
    } catch {
      setError('We could not load your shipments. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!userId) return
    fetchData()
    const subB = supabase.channel('vendor_bids_shipments').on('postgres_changes', { event: '*', schema: 'public', table: 'capacity_bids' }, fetchData).subscribe()
    const subR = supabase.channel('vendor_reqs_shipments').on('postgres_changes', { event: '*', schema: 'public', table: 'vendor_shipment_requests' }, fetchData).subscribe()
    return () => { supabase.removeChannel(subB); supabase.removeChannel(subR) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  const bidColumns: Column<VendorBid>[] = [
    { key: 'date', header: 'Date', cell: b => new Date(b.submitted_at).toLocaleDateString('en-IN'), sortValue: b => b.submitted_at },
    { key: 'amount', header: 'Bid', cell: b => `₹${b.bid_amount.toLocaleString('en-IN')}`, sortValue: b => b.bid_amount },
    { key: 'vehicle', header: 'Vehicle', cell: b => b.capacity_windows?.vehicles?.vehicle_type ?? '—', hideOnMobile: true },
    { key: 'weight', header: 'Weight', cell: b => b.weight_kg != null ? `${b.weight_kg.toLocaleString('en-IN')} kg` : '—', hideOnMobile: true },
    { key: 'status', header: 'Status', cell: b => <StatusPill status={b.status} /> },
  ]

  const requestColumns: Column<VendorRequest>[] = [
    { key: 'date', header: 'Date', cell: r => new Date(r.created_at).toLocaleDateString('en-IN'), sortValue: r => r.created_at },
    { key: 'route', header: 'Route', cell: r => <span className="truncate">{r.pickup_location ?? '—'} → {r.drop_location ?? '—'}</span> },
    { key: 'weight', header: 'Weight', cell: r => r.required_capacity_kg != null ? `${Number(r.required_capacity_kg).toLocaleString('en-IN')} kg` : '—', hideOnMobile: true },
    { key: 'status', header: 'Status', cell: r => <StatusPill status={r.status} /> },
    {
      key: 'track', header: '', align: 'right',
      cell: r => {
        const manifestId = r.cargo_manifest?.[0]?.id
        if (!manifestId) return null
        const trackingId = `CM-${manifestId.slice(0, 8).toUpperCase()}`
        return (
          <Button size="sm" variant="secondary" onClick={() => navigate(`/track/${trackingId}`)}>Track</Button>
        )
      },
    },
  ]

  return (
    <Page>
      <PageHeader
        title="My shipments"
        description="Your bids and the loads you have posted."
        actions={<Button icon={<Plus size={16} />} onClick={() => navigate('/vendor/request')}>Post a load</Button>}
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-text">Bids</h2>
        <DataTable
          caption="Your bids"
          columns={bidColumns}
          rows={bids}
          rowKey={b => b.id}
          loading={loading}
          error={error ?? undefined}
          onRetry={fetchData}
          empty={{ title: 'No bids yet', description: 'Bids you place on capacity windows will show up here.' }}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-text">Posted loads</h2>
        <DataTable
          caption="Your posted loads"
          columns={requestColumns}
          rows={requests}
          rowKey={r => r.id}
          loading={loading}
          error={error ?? undefined}
          onRetry={fetchData}
          empty={{ title: 'No loads posted yet', action: <Button onClick={() => navigate('/vendor/request')}>Post a load</Button> }}
        />
      </section>
    </Page>
  )
}
