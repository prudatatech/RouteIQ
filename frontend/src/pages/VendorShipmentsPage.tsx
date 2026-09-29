import { useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase, openChannel } from '@/services/supabase'
import { capacityAPI } from '@/services/api'
import { useAuthStore } from '@/store/authStore'
import {
  Button, DataTable, Page, PageHeader, SearchInput, StatusPill, Tabs, useTabParam, type Column, type TabItem,
} from '@/components/ui'

interface VendorBid {
  id: string
  bid_amount: number
  weight_kg: number | null
  status: string
  submitted_at: string
  eway_bill_ref: string | null
  rejection_reason: string | null
  capacity_windows: { trigger_type: string | null; vehicles: { vehicle_type: string | null } | null } | null
}

interface VendorRequest {
  id: string
  pickup_location: string | null
  drop_location: string | null
  required_capacity_kg: number | null
  status: string
  created_at: string
  rejection_reason: string | null
  cargo_manifest?: { id: string }[]
}

export default function VendorShipmentsPage() {
  const [bids, setBids] = useState<VendorBid[]>([])
  const [requests, setRequests] = useState<VendorRequest[]>([])
  const [bidSearch, setBidSearch] = useState('')
  const [requestSearch, setRequestSearch] = useState('')
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
    const subB = openChannel('vendor_bids_shipments').on('postgres_changes', { event: '*', schema: 'public', table: 'capacity_bids' }, fetchData).subscribe()
    const subR = openChannel('vendor_reqs_shipments').on('postgres_changes', { event: '*', schema: 'public', table: 'vendor_shipment_requests' }, fetchData).subscribe()
    return () => { supabase.removeChannel(subB); supabase.removeChannel(subR) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  // Status tabs are built from whatever statuses actually appear, plus "All" —
  // never a hardcoded/invented status list.
  const bidStatuses = useMemo(() => Array.from(new Set(bids.map(b => b.status))).sort(), [bids])
  const requestStatuses = useMemo(() => Array.from(new Set(requests.map(r => r.status))).sort(), [requests])
  const [bidTab, setBidTab] = useTabParam(['all', ...bidStatuses], 'all', 'bidStatus')
  const [requestTab, setRequestTab] = useTabParam(['all', ...requestStatuses], 'all', 'loadStatus')
  const bidTabs: TabItem<string>[] = [
    { id: 'all', label: 'All', count: bids.length },
    ...bidStatuses.map(s => ({ id: s, label: s.replace(/_/g, ' '), count: bids.filter(b => b.status === s).length })),
  ]
  const requestTabs: TabItem<string>[] = [
    { id: 'all', label: 'All', count: requests.length },
    ...requestStatuses.map(s => ({ id: s, label: s.replace(/_/g, ' '), count: requests.filter(r => r.status === s).length })),
  ]

  const filteredBids = useMemo(() => {
    const q = bidSearch.trim().toLowerCase()
    return bids
      .filter(b => bidTab === 'all' || b.status === bidTab)
      .filter(b => !q || [
        b.capacity_windows?.vehicles?.vehicle_type, b.status, b.eway_bill_ref, String(b.bid_amount),
      ].some(v => v?.toLowerCase().includes(q)))
  }, [bids, bidTab, bidSearch])

  const filteredRequests = useMemo(() => {
    const q = requestSearch.trim().toLowerCase()
    return requests
      .filter(r => requestTab === 'all' || r.status === requestTab)
      .filter(r => !q || [r.pickup_location, r.drop_location, r.status].some(v => v?.toLowerCase().includes(q)))
  }, [requests, requestTab, requestSearch])

  const bidColumns: Column<VendorBid>[] = [
    { key: 'date', header: 'Date', cell: b => new Date(b.submitted_at).toLocaleDateString('en-IN'), sortValue: b => b.submitted_at },
    { key: 'amount', header: 'Bid', cell: b => `₹${b.bid_amount.toLocaleString('en-IN')}`, sortValue: b => b.bid_amount },
    { key: 'vehicle', header: 'Vehicle', cell: b => b.capacity_windows?.vehicles?.vehicle_type ?? '—', hideOnMobile: true, sortValue: b => b.capacity_windows?.vehicles?.vehicle_type },
    { key: 'weight', header: 'Weight', cell: b => b.weight_kg != null ? `${b.weight_kg.toLocaleString('en-IN')} kg` : '—', hideOnMobile: true, sortValue: b => b.weight_kg },
    {
      key: 'status', header: 'Status', sortValue: b => b.status,
      cell: b => (
        <span className="block">
          <StatusPill status={b.status} />
          {b.status === 'rejected' && b.rejection_reason && <span className="mt-0.5 block text-xs text-muted">{b.rejection_reason}</span>}
        </span>
      ),
    },
  ]

  const requestColumns: Column<VendorRequest>[] = [
    { key: 'date', header: 'Date', cell: r => new Date(r.created_at).toLocaleDateString('en-IN'), sortValue: r => r.created_at },
    { key: 'route', header: 'Route', cell: r => <span className="truncate">{r.pickup_location ?? '—'} → {r.drop_location ?? '—'}</span>, sortValue: r => r.pickup_location },
    { key: 'weight', header: 'Weight', cell: r => r.required_capacity_kg != null ? `${Number(r.required_capacity_kg).toLocaleString('en-IN')} kg` : '—', hideOnMobile: true, sortValue: r => r.required_capacity_kg },
    {
      key: 'status', header: 'Status', sortValue: r => r.status,
      cell: r => (
        <span className="block">
          <StatusPill status={r.status} />
          {r.status === 'rejected' && r.rejection_reason && <span className="mt-0.5 block text-xs text-muted">{r.rejection_reason}</span>}
        </span>
      ),
    },
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-text">Bids</h2>
          <SearchInput value={bidSearch} onChange={setBidSearch} placeholder="Search by vehicle, status or e-way bill" className="max-w-xs" />
        </div>
        {bidStatuses.length > 0 && <Tabs tabs={bidTabs} value={bidTab} onChange={setBidTab} label="Filter bids by status" />}
        <DataTable
          caption="Your bids"
          columns={bidColumns}
          rows={filteredBids}
          rowKey={b => b.id}
          loading={loading}
          error={error ?? undefined}
          onRetry={fetchData}
          empty={{ title: 'No bids yet', description: 'Bids you place on capacity windows will show up here.' }}
        />
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-text">Posted loads</h2>
          <SearchInput value={requestSearch} onChange={setRequestSearch} placeholder="Search by pickup, drop or status" className="max-w-xs" />
        </div>
        {requestStatuses.length > 0 && <Tabs tabs={requestTabs} value={requestTab} onChange={setRequestTab} label="Filter posted loads by status" />}
        <DataTable
          caption="Your posted loads"
          columns={requestColumns}
          rows={filteredRequests}
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
