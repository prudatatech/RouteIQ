import { useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { formatDate, formatKg, formatRupees } from '@/utils/display'
import { supabase, openChannel } from '@/services/supabase'
import { capacityAPI, vendorAPI } from '@/services/api'
import { useAuthStore } from '@/store/authStore'
import { manifestTrackingId } from '@/components/shipments/format'
import {
  Button, DataTable, statusToLabel, Page, PageHeader, SearchInput, StatusPill, Tabs, useConfirm, useTabParam, type Column, type TabItem,
} from '@/components/ui'
import { errorMessage } from '@/utils/display'

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
  /** The price agreed for the load, once dispatch has assigned it. */
  cost: number | null
  cargo_manifest?: { id: string }[]
}

/** A posted load can still be withdrawn until a vehicle is assigned. */
const isCancellable = (r: VendorRequest) => r.status === 'pending' || r.status === 'approved'

export default function VendorShipmentsPage() {
  const [bids, setBids] = useState<VendorBid[]>([])
  const [requests, setRequests] = useState<VendorRequest[]>([])
  const [bidSearch, setBidSearch] = useState('')
  const [requestSearch, setRequestSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const userId = useAuthStore(s => s.userId)
  const navigate = useNavigate()
  const { confirm } = useConfirm()
  const [searchParams, setSearchParams] = useSearchParams()
  const [focus, setFocus] = useState<{ kind: 'bid' | 'request'; id: string } | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  const fetchData = async () => {
    if (!userId) return
    try {
      const [b, r] = await Promise.all([
        capacityAPI.myBids(),
        supabase.from('vendor_shipment_requests').select('*, cargo_manifest(id)').eq('vendor_id', userId).order('created_at', { ascending: false }),
      ])
      if (r.error) throw r.error
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

  // Opened from a notification: ?open=<bid or posted load id> highlights that row and scrolls to its table
  useEffect(() => {
    const openId = searchParams.get('open')
    if (!openId || loading) return
    const kind = requests.some(r => r.id === openId) ? 'request' : bids.some(b => b.id === openId) ? 'bid' : null
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('open')
      if (kind) { next.delete('bidStatus'); next.delete('loadStatus') }
      return next
    }, { replace: true })
    if (!kind) return
    setFocus({ kind, id: openId })
    setBidSearch('')
    setRequestSearch('')
    setTimeout(() => document.getElementById(kind === 'bid' ? 'vendor-bids' : 'vendor-loads')?.scrollIntoView({ block: 'start' }), 0)
  }, [searchParams, setSearchParams, loading, requests, bids])

  const cancelRequest = async (r: VendorRequest) => {
    const ok = await confirm({
      title: 'Cancel this load?',
      message: `The load from ${r.pickup_location ?? 'the pickup'} to ${r.drop_location ?? 'the drop-off'} is withdrawn and dispatch is told. You can post it again later.`,
      confirmLabel: 'Cancel load',
      cancelLabel: 'Keep it',
      tone: 'danger',
    })
    if (!ok) return
    setCancellingId(r.id)
    try {
      await vendorAPI.cancelRequest(r.id)
      toast.success('Load cancelled. Dispatch has been told.')
      await fetchData()
    } catch (err) {
      toast.error(errorMessage(err, 'We could not cancel this load. Try again.'))
    } finally {
      setCancellingId(null)
    }
  }

  // Status tabs are built from whatever statuses actually appear, plus "All" —
  // never a hardcoded/invented status list.
  const bidStatuses = useMemo(() => Array.from(new Set(bids.map(b => b.status))).sort(), [bids])
  const requestStatuses = useMemo(() => Array.from(new Set(requests.map(r => r.status))).sort(), [requests])
  const [bidTab, setBidTab] = useTabParam(['all', ...bidStatuses], 'all', 'bidStatus')
  const [requestTab, setRequestTab] = useTabParam(['all', ...requestStatuses], 'all', 'loadStatus')
  const bidTabs: TabItem<string>[] = [
    { id: 'all', label: 'All', count: bids.length },
    ...bidStatuses.map(s => ({ id: s, label: statusToLabel(s), count: bids.filter(b => b.status === s).length })),
  ]
  const requestTabs: TabItem<string>[] = [
    { id: 'all', label: 'All', count: requests.length },
    ...requestStatuses.map(s => ({ id: s, label: statusToLabel(s), count: requests.filter(r => r.status === s).length })),
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
    { key: 'date', header: 'Date', cell: b => formatDate(b.submitted_at), sortValue: b => b.submitted_at },
    { key: 'amount', header: 'Bid', cell: b => formatRupees(b.bid_amount), sortValue: b => b.bid_amount },
    { key: 'vehicle', header: 'Vehicle', cell: b => b.capacity_windows?.vehicles?.vehicle_type ?? '—', hideOnMobile: true, sortValue: b => b.capacity_windows?.vehicles?.vehicle_type },
    { key: 'weight', header: 'Weight', cell: b => formatKg(b.weight_kg), hideOnMobile: true, sortValue: b => b.weight_kg },
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
    { key: 'date', header: 'Date', cell: r => formatDate(r.created_at), sortValue: r => r.created_at },
    { key: 'route', header: 'Route', cell: r => <span className="break-words">{r.pickup_location ?? '—'} → {r.drop_location ?? '—'}</span>, sortValue: r => r.pickup_location },
    { key: 'weight', header: 'Weight', cell: r => formatKg(r.required_capacity_kg), hideOnMobile: true, sortValue: r => r.required_capacity_kg },
    {
      key: 'price', header: 'Agreed price', align: 'right',
      cell: r => (r.cost ? <span className="tabular">{formatRupees(r.cost)}</span> : <span className="text-muted">Not set yet</span>),
      sortValue: r => r.cost,
    },
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
        if (isCancellable(r)) {
          return (
            <Button size="sm" variant="secondary" loading={cancellingId === r.id} disabled={cancellingId !== null} onClick={() => cancelRequest(r)}>
              Cancel
            </Button>
          )
        }
        const manifestId = r.cargo_manifest?.[0]?.id
        if (!manifestId) return null
        const trackingId = manifestTrackingId(manifestId)
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
        description="Your bids on capacity and the loads you have posted, with the price agreed for each."
        actions={<Button icon={<Plus size={16} />} onClick={() => navigate('/vendor/request')}>Post a load</Button>}
      />

      <section id="vendor-bids" className="scroll-mt-20 space-y-3">
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
          selectedKey={focus?.kind === 'bid' ? focus.id : null}
          loading={loading}
          error={error ?? undefined}
          onRetry={fetchData}
          empty={bids.length > 0
            ? { title: 'No bids match', description: 'Try another status or search.' }
            : { title: 'No bids yet', description: 'Bids you place on capacity windows will show up here.', action: <Button onClick={() => navigate('/vendor/corridor')}>See open capacity</Button> }}
        />
      </section>

      <section id="vendor-loads" className="scroll-mt-20 space-y-3">
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
          selectedKey={focus?.kind === 'request' ? focus.id : null}
          loading={loading}
          error={error ?? undefined}
          onRetry={fetchData}
          empty={requests.length > 0
            ? { title: 'No loads match', description: 'Try another status or search.' }
            : { title: 'No loads posted yet', description: 'Post a load and dispatch will find a vehicle for it.', action: <Button onClick={() => navigate('/vendor/request')}>Post a load</Button> }}
        />
      </section>
    </Page>
  )
}
