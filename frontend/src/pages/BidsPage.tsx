import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Check, Download, FileCheck, FileX, Plus, X } from 'lucide-react'
import { supabase } from '@/services/supabase'
import { capacityAPI } from '@/services/api'
import {
  Alert, Button, Card, DataTable, DetailList, Drawer, EmptyState, ErrorState, Page, PageHeader, SectionHeader,
  Skeleton, StatusPill, Tabs, TabPanel, useConfirm, useTabParam, statusToLabel, type Column,
} from '@/components/ui'
import OpenWindowModal from '@/components/backhaul/OpenWindowModal'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { errorMessage, formatDateTime, formatKg, formatRelative, formatRupees } from '@/utils/display'
import { downloadCsv, toCsv } from '@/utils/csv'

/** How many recent capacity windows the page loads. */
const WINDOW_LIMIT = 100
/** Windows shown before "Show more". */
const WINDOWS_PER_PAGE = 10
/** Driver confirmations listed at the bottom of the page. */
const CONFIRMATION_LIMIT = 50

interface WindowVehicle {
  plate_number: string | null
  vehicle_type: string | null
  capacity_kg: number | null
  available_capacity_kg: number | null
}

interface CapacityWindow {
  id: string
  opens_at: string
  closes_at: string
  floor_price: number | null
  winning_bid_id: string | null
  trigger_type: string | null
  status: string | null
  vehicles: WindowVehicle | null
}

interface Bid {
  id: string
  window_id: string
  vendor_id: string
  bid_amount: number
  submitted_at: string | null
  status: string
  eway_bill_ref: string | null
  weight_kg: number | null
  load_configuration: string | null
  rejection_reason: string | null
  delivery_points: { name: string | null; address: string | null } | null
  vendor: { company_name: string | null; city: string | null } | null
}

interface DriverConfirmation {
  id: string
  prompted_at: string
  delivered_at: string | null
  action: string | null
  vehicles: { plate_number: string | null } | null
  route_stops: { delivery_points: { name: string | null; address: string | null } | null } | null
}

interface Busy { approvingId: string | null; rejectingId: string | null; any: boolean }

type WindowState = 'open' | 'decide' | 'awarded' | 'closed' | 'upcoming' | 'cancelled'
const TAB_IDS = ['open', 'decide', 'awarded', 'closed', 'all'] as const
type TabId = typeof TAB_IDS[number]

const triggerLabel: Record<string, string> = {
  mid_route: 'Space during a trip',
  return_trip: 'Empty return trip',
  superadmin_dispatch: 'Opened by an admin',
}

const confirmationStatus = (c: DriverConfirmation): { label: string; tone: 'success' | 'warning' | 'danger' | 'info' } => {
  switch (c.action) {
    case 'confirmed': return { label: 'Accepted by driver', tone: 'success' }
    case 'flagged': return { label: 'Declined by driver', tone: 'danger' }
    case 'auto_accepted': return { label: 'Accepted automatically', tone: 'success' }
    case 'auto_accepted_offline': return { label: 'Accepted automatically, driver offline', tone: 'warning' }
    default: return c.delivered_at
      ? { label: 'Driver is reviewing', tone: 'info' }
      : { label: 'Not yet seen by driver', tone: 'warning' }
  }
}

function windowState(w: CapacityWindow, bids: Bid[], now: number): WindowState {
  if (w.status === 'cancelled') return 'cancelled'
  if (w.winning_bid_id) return 'awarded'
  if (new Date(w.opens_at).getTime() > now) return 'upcoming'
  if (new Date(w.closes_at).getTime() > now) return 'open'
  if (bids.some(b => b.status === 'pending')) return 'decide'
  return 'closed'
}

/** Re-renders every `ms` so open/closed states follow the clock. */
function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

async function loadBoard() {
  const { data: windows, error: wErr } = await supabase
    .from('capacity_windows')
    .select('id, opens_at, closes_at, floor_price, winning_bid_id, trigger_type, status, vehicles(plate_number, vehicle_type, capacity_kg, available_capacity_kg)')
    .order('opens_at', { ascending: false })
    .limit(WINDOW_LIMIT)
  if (wErr) throw wErr
  const windowList = (windows ?? []) as unknown as CapacityWindow[]
  if (windowList.length === 0) return { windows: windowList, bids: [] as Bid[] }

  const { data: bids, error: bErr } = await supabase
    .from('capacity_bids')
    .select('id, window_id, vendor_id, bid_amount, submitted_at, status, eway_bill_ref, weight_kg, load_configuration, rejection_reason, delivery_points(name, address)')
    .in('window_id', windowList.map(w => w.id))
    .order('bid_amount', { ascending: false })
  if (bErr) throw bErr
  const bidRows = (bids ?? []) as unknown as Omit<Bid, 'vendor'>[]

  const vendorIds = [...new Set(bidRows.map(b => b.vendor_id))]
  const vendors = new Map<string, Bid['vendor']>()
  if (vendorIds.length > 0) {
    const { data: profiles, error: pErr } = await supabase
      .from('vendor_profiles').select('id, company_name, city').in('id', vendorIds)
    if (pErr) throw pErr
    for (const p of profiles ?? []) vendors.set(p.id, { company_name: p.company_name, city: p.city })
  }
  return {
    windows: windowList,
    bids: bidRows.map(b => ({ ...b, vendor: vendors.get(b.vendor_id) ?? null })),
  }
}

async function loadConfirmations() {
  const { data, error } = await supabase
    .from('driver_confirmations')
    .select('id, prompted_at, delivered_at, action, vehicles(plate_number), route_stops(delivery_points(name, address))')
    .order('prompted_at', { ascending: false })
    .limit(CONFIRMATION_LIMIT)
  if (error) throw error
  return (data ?? []) as unknown as DriverConfirmation[]
}

const vendorName = (b: Bid) => b.vendor?.company_name || 'Unnamed vendor'

export default function BidsPage() {
  const queryClient = useQueryClient()
  const { confirm, prompt } = useConfirm()
  const now = useNow(15_000)
  const [tab, setTab] = useTabParam<TabId>(TAB_IDS, 'open')
  const [shown, setShown] = useState(WINDOWS_PER_PAGE)
  const [selected, setSelected] = useState<{ bid: Bid; window: CapacityWindow } | null>(null)
  const [opening, setOpening] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const [focusWindowId, setFocusWindowId] = useState<string | null>(null)

  const board = useQuery({ queryKey: ['bids-board'], queryFn: loadBoard })
  const confirmations = useQuery({ queryKey: ['driver-confirmations'], queryFn: loadConfirmations })
  useRealtimeRefresh('bids_page', ['capacity_windows', 'capacity_bids'], [['bids-board']])
  useRealtimeRefresh('bids_page_confirmations', ['driver_confirmations'], [['driver-confirmations']])

  useEffect(() => { setShown(prev => (prev === Number.MAX_SAFE_INTEGER ? prev : WINDOWS_PER_PAGE)) }, [tab])

  const bidsByWindow = useMemo(() => {
    const map = new Map<string, Bid[]>()
    for (const b of board.data?.bids ?? []) {
      const list = map.get(b.window_id) ?? []
      list.push(b)
      map.set(b.window_id, list)
    }
    return map
  }, [board.data])

  const windows = useMemo(() => (board.data?.windows ?? []).map(w => {
    const bids = bidsByWindow.get(w.id) ?? []
    return { window: w, bids, state: windowState(w, bids, now) }
  }), [board.data, bidsByWindow, now])

  // Opened from a link (a notification): ?open=<bid id or window id> switches to the tab the window is under, then
  // opens that bid, or scrolls to that window. The param is dropped from the URL.
  useEffect(() => {
    const openId = searchParams.get('open')
    if (!openId || board.isLoading) return
    const byBid = windows.find(w => w.bids.some(b => b.id === openId))
    const found = byBid ?? windows.find(w => w.window.id === openId)
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('open')
      if (found) {
        const t: TabId = found.state === 'open' || found.state === 'upcoming' ? 'open' : found.state === 'cancelled' ? 'closed' : found.state
        if (t === 'open') next.delete('tab'); else next.set('tab', t)
      }
      return next
    }, { replace: true })
    if (!found) return
    setShown(Number.MAX_SAFE_INTEGER)
    if (byBid) setSelected({ bid: byBid.bids.find(b => b.id === openId)!, window: byBid.window })
    else setFocusWindowId(found.window.id)
  }, [searchParams, setSearchParams, windows, board.isLoading])

  useEffect(() => {
    if (!focusWindowId) return
    const el = document.getElementById(`window-${focusWindowId}`)
    if (!el) return
    el.scrollIntoView({ block: 'center' })
    el.focus({ preventScroll: true })
    setFocusWindowId(null)
  }, [focusWindowId, tab, shown])

  const counts = useMemo(() => {
    const c: Record<TabId, number> = { open: 0, decide: 0, awarded: 0, closed: 0, all: windows.length }
    for (const { state } of windows) {
      if (state === 'open' || state === 'upcoming') c.open++
      else if (state === 'cancelled') c.closed++
      else c[state]++
    }
    return c
  }, [windows])

  const visible = useMemo(() => {
    const inTab = windows.filter(({ state }) => {
      if (tab === 'all') return true
      if (tab === 'open') return state === 'open' || state === 'upcoming'
      if (tab === 'closed') return state === 'closed' || state === 'cancelled'
      return state === tab
    })
    const rank = (s: WindowState) => (s === 'open' ? 0 : s === 'decide' ? 1 : s === 'upcoming' ? 2 : 3)
    return inTab.sort((a, b) => {
      if (rank(a.state) !== rank(b.state)) return rank(a.state) - rank(b.state)
      // Open windows closing soonest first; everything else newest first
      if (a.state === 'open') return new Date(a.window.closes_at).getTime() - new Date(b.window.closes_at).getTime()
      return new Date(b.window.opens_at).getTime() - new Date(a.window.opens_at).getTime()
    })
  }, [windows, tab])

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['bids-board'] })
    queryClient.invalidateQueries({ queryKey: ['driver-confirmations'] })
  }

  const approve = useMutation({
    mutationFn: (bidId: string) => capacityAPI.approveBid(bidId),
    onSuccess: () => { toast.success('Bid approved. The pickup and drop-off were added to the vehicle’s route.'); setSelected(null) },
    onError: err => toast.error(errorMessage(err, 'We could not approve this bid. Try again.')),
    onSettled: refresh,
  })

  const reject = useMutation({
    mutationFn: ({ bidId, reason }: { bidId: string; reason: string }) => capacityAPI.rejectBid(bidId, reason),
    onSuccess: () => { toast.success('Bid rejected. The vendor has been told.'); setSelected(null) },
    onError: err => toast.error(errorMessage(err, 'We could not reject this bid. Try again.')),
    onSettled: refresh,
  })

  const endWindow = useMutation({
    mutationFn: ({ id, mode }: { id: string; mode: 'close' | 'cancel' }) =>
      mode === 'close' ? capacityAPI.closeWindow(id) : capacityAPI.cancelWindow(id),
    onSuccess: (_d, { mode }) => toast.success(mode === 'close' ? 'Window closed. Vendors can no longer bid.' : 'Window cancelled. Waiting bids were turned down.'),
    onError: err => toast.error(errorMessage(err, 'We could not change this window. Try again.')),
    onSettled: refresh,
  })
  const endingId = endWindow.isPending ? endWindow.variables?.id ?? null : null

  const askEnd = async (window: CapacityWindow, mode: 'close' | 'cancel', waiting: number) => {
    const ok = await confirm({
      title: mode === 'close' ? 'Close this window now?' : 'Cancel this window?',
      message: mode === 'close'
        ? `Vendors will not be able to bid any more on ${window.vehicles?.plate_number ?? 'this vehicle'}. ${waiting > 0 ? `The ${waiting === 1 ? 'bid' : `${waiting} bids`} already placed will wait for your decision.` : 'No bids have been placed.'}`
        : `Vendors will not be able to bid any more on ${window.vehicles?.plate_number ?? 'this vehicle'}. ${waiting > 0 ? `The ${waiting === 1 ? 'bid' : `${waiting} bids`} already placed will be rejected and the vendors told.` : 'No bids have been placed.'}`,
      confirmLabel: mode === 'close' ? 'Close window' : 'Cancel window',
      tone: mode === 'cancel' ? 'danger' : undefined,
    })
    if (ok) endWindow.mutate({ id: window.id, mode })
  }

  const approvingId = approve.isPending ? approve.variables ?? null : null
  const rejectingId = reject.isPending ? reject.variables?.bidId ?? null : null
  const busy = { approvingId, rejectingId, any: approvingId !== null || rejectingId !== null }

  const askApprove = async (bid: Bid, window: CapacityWindow) => {
    const others = (bidsByWindow.get(window.id) ?? []).filter(b => b.id !== bid.id && b.status === 'pending').length
    const ok = await confirm({
      title: 'Approve this bid?',
      message: (
        <div className="space-y-2">
          <p>
            {vendorName(bid)} gets {formatKg(bid.weight_kg)} of space on {window.vehicles?.plate_number ?? 'this vehicle'} for {formatRupees(bid.bid_amount)}.
          </p>
          <p>
            The pickup at the vendor and the drop-off are added to the vehicle’s route and the driver is asked to confirm them. The vehicle’s free space goes down by this load only.
            {others > 0 && ` The other ${others === 1 ? 'bid' : `${others} bids`} on this vehicle will be marked as not selected.`}
          </p>
        </div>
      ),
      confirmLabel: 'Approve bid',
    })
    if (ok) approve.mutate(bid.id)
  }

  const askReject = async (bid: Bid) => {
    const reason = await prompt({
      title: 'Reject this bid?',
      message: `${vendorName(bid)}’s bid of ${formatRupees(bid.bid_amount)} will be rejected and the vendor notified. This cannot be undone.`,
      inputLabel: 'Reason',
      placeholder: 'Why is this bid being rejected?',
      confirmLabel: 'Reject bid',
      tone: 'danger',
      required: true,
    })
    if (reason) reject.mutate({ bidId: bid.id, reason })
  }

  const tabs = [
    { id: 'open' as const, label: 'Open', count: counts.open },
    { id: 'decide' as const, label: 'Needs a decision', count: counts.decide },
    { id: 'awarded' as const, label: 'Awarded', count: counts.awarded },
    { id: 'closed' as const, label: 'Closed', count: counts.closed },
    { id: 'all' as const, label: 'All', count: counts.all },
  ]

  const emptyText: Record<TabId, string> = {
    open: 'No vehicles are taking bids right now. Open a window for a vehicle with free space, or wait for a driver to offer spare space.',
    decide: 'Nothing is waiting for you. Closed windows with bids to review appear here.',
    awarded: 'No bids have been approved yet.',
    closed: 'No windows closed without a winner.',
    all: 'No capacity windows yet. They open when a driver has spare space on a trip.',
  }

  const exportCsv = () => {
    const csv = toCsv(visible.flatMap(({ window: win, bids, state }) => bids.map(bid => ({
      vehicle: win.vehicles?.plate_number || '',
      vendor: vendorName(bid),
      city: bid.vendor?.city || '',
      bid_amount: bid.bid_amount,
      weight_kg: bid.weight_kg ?? '',
      status: statusToLabel(bid.status, 'bid'),
      window_state: statusToLabel(state, 'window'),
      submitted_at: bid.submitted_at || '',
    }))), [
      { key: 'vehicle', header: 'Vehicle' },
      { key: 'vendor', header: 'Vendor' },
      { key: 'city', header: 'City' },
      { key: 'bid_amount', header: 'Bid amount' },
      { key: 'weight_kg', header: 'Weight (kg)' },
      { key: 'status', header: 'Bid status' },
      { key: 'window_state', header: 'Window' },
      { key: 'submitted_at', header: 'Submitted at' },
    ])
    downloadCsv(`bids-${new Date().toISOString().slice(0, 10)}.csv`, csv)
  }

  return (
    <Page>
      <PageHeader
        title="Bids"
        description={`Vendors bid for spare space on your vehicles. Approve one bid per vehicle; the latest ${WINDOW_LIMIT} windows are shown.`}
        actions={
          <>
            <Button variant="secondary" icon={<Download size={16} />} onClick={exportCsv}>Export CSV</Button>
            <Button icon={<Plus size={16} />} onClick={() => setOpening(true)}>Open a window</Button>
          </>
        }
      >
        <Tabs label="Filter windows by status" tabs={board.isLoading ? tabs.map(t => ({ ...t, count: undefined })) : tabs} value={tab} onChange={setTab} />
      </PageHeader>

      <TabPanel id={tab} className="space-y-4">
        {board.isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 w-full" />)
        ) : board.error ? (
          <Card><ErrorState description="We could not load bids. Check your connection and try again." onRetry={() => board.refetch()} /></Card>
        ) : visible.length === 0 ? (
          <Card><EmptyState title={tab === 'all' ? 'No capacity windows yet' : 'Nothing here'} description={emptyText[tab]} /></Card>
        ) : (
          <>
            {visible.slice(0, shown).map(({ window, bids, state }) => (
              <WindowCard
                key={window.id}
                window={window}
                bids={bids}
                state={state}
                busy={busy}
                onOpen={bid => setSelected({ bid, window })}
                onApprove={bid => askApprove(bid, window)}
                onReject={askReject}
                endingId={endingId}
                onEnd={mode => askEnd(window, mode, bids.filter(b => b.status === 'pending').length)}
              />
            ))}
            {visible.length > shown && (
              <div className="flex justify-center">
                <Button variant="secondary" onClick={() => setShown(s => s + WINDOWS_PER_PAGE)}>
                  Show more ({(visible.length - shown).toLocaleString('en-IN')} left)
                </Button>
              </div>
            )}
          </>
        )}
      </TabPanel>

      <section className="space-y-3">
        <SectionHeader
          title="Driver confirmations"
          description="When a bid is approved, the driver is asked to accept the new stops. If they decline, the award is cancelled and the window opens again; if they don't answer within 2 minutes it is accepted automatically."
        />
        <ConfirmationsTable query={confirmations} />
      </section>

      <OpenWindowModal open={opening} onClose={() => setOpening(false)} />

      <BidDrawer
        selection={selected}
        state={selected ? windowState(selected.window, bidsByWindow.get(selected.window.id) ?? [], now) : null}
        busy={busy}
        onClose={() => setSelected(null)}
        onApprove={() => selected && askApprove(selected.bid, selected.window)}
        onReject={() => selected && askReject(selected.bid)}
      />
    </Page>
  )
}

function WindowCard({ window: win, bids, state, busy, endingId, onEnd, onOpen, onApprove, onReject }: {
  window: CapacityWindow
  bids: Bid[]
  state: WindowState
  busy: Busy
  endingId: string | null
  onEnd: (mode: 'close' | 'cancel') => void
  onOpen: (bid: Bid) => void
  onApprove: (bid: Bid) => void
  onReject: (bid: Bid) => void
}) {
  const vehicle = win.vehicles
  const canDecide = !win.winning_bid_id
  const highest = bids.filter(b => b.status === 'pending').reduce<Bid | null>((top, b) => (!top || b.bid_amount > top.bid_amount ? b : top), null)
  const closesAt = new Date(win.closes_at).getTime()
  const timing = state === 'open'
    ? `Closes ${formatRelative(win.closes_at)}`
    : state === 'upcoming'
      ? `Opens ${formatRelative(win.opens_at)}`
      : `Closed ${formatDateTime(closesAt)}`

  return (
    <Card>
      <div id={`window-${win.id}`} tabIndex={-1} className="flex flex-col gap-3 border-b border-border px-4 py-4 outline-none focus-visible:ring-2 focus-visible:ring-brand/40 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-mono text-lg font-semibold text-text">{vehicle?.plate_number ?? 'Vehicle not found'}</h2>
            <StatusPill status={state} kind="window" />
          </div>
          <p className="text-sm text-muted">
            {[win.trigger_type ? (triggerLabel[win.trigger_type] ?? win.trigger_type) : null, timing].filter(Boolean).join(' · ')}
          </p>
        </div>
        <dl className="grid shrink-0 grid-cols-3 gap-4 text-sm sm:text-right">
          <div>
            <dt className="text-xs text-muted">Minimum bid</dt>
            <dd className="font-medium tabular text-text">{win.floor_price != null ? formatRupees(win.floor_price) : 'Set per load'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Free space now</dt>
            <dd className="font-medium tabular text-text">{formatKg(vehicle?.available_capacity_kg)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Bids</dt>
            <dd className="font-medium tabular text-text">{bids.length.toLocaleString('en-IN')}</dd>
          </div>
        </dl>
      </div>

      {(state === 'open' || state === 'upcoming') && (
        <div className="flex flex-wrap justify-end gap-2 border-b border-border px-4 py-3 sm:px-6">
          <Button size="sm" variant="secondary" disabled={endingId !== null} onClick={() => onEnd('cancel')}>Cancel window</Button>
          <Button size="sm" variant="secondary" loading={endingId === win.id} disabled={endingId !== null} onClick={() => onEnd('close')}>Close now</Button>
        </div>
      )}

      {state === 'closed' && bids.length > 0 && !win.winning_bid_id && (
        <p className="border-b border-border px-4 py-3 text-sm text-muted sm:px-6">This window closed without a winning bid.</p>
      )}

      {bids.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted sm:px-6">{state === 'open' ? 'No bids yet.' : 'No bids were placed.'}</p>
      ) : (
        <ul className="divide-y divide-border" aria-label={`Bids for ${vehicle?.plate_number ?? 'this vehicle'}`}>
          {bids.map(bid => {
            const actionable = canDecide && bid.status === 'pending'
            return (
              <li key={bid.id} className="flex flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center">
                <button
                  type="button"
                  onClick={() => onOpen(bid)}
                  className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-1 rounded-control text-left hover:bg-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand sm:grid-cols-4"
                  aria-label={`View bid from ${vendorName(bid)}`}
                >
                  <span className="col-span-2 min-w-0 sm:col-span-1">
                    <span className="block truncate text-sm font-medium text-text">{vendorName(bid)}</span>
                    <span className="block truncate text-xs text-muted">{bid.vendor?.city ?? 'City not given'}</span>
                  </span>
                  <span className="text-sm">
                    <span className="block font-medium tabular text-text">
                      {formatRupees(bid.bid_amount)}
                      {bid.id === highest?.id && canDecide && <span className="ml-2 text-xs font-normal text-brand">Highest</span>}
                    </span>
                    <span className="block text-xs text-muted">{formatKg(bid.weight_kg)}</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-muted">
                    {bid.eway_bill_ref
                      ? <><FileCheck size={14} aria-hidden="true" className="text-success" /> E-way bill added</>
                      : <><FileX size={14} aria-hidden="true" className="text-warning" /> No e-way bill</>}
                  </span>
                  <span className="flex items-center"><StatusPill status={bid.status} kind="bid" /></span>
                </button>
                {actionable && (
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="secondary" icon={<X size={14} />} disabled={busy.any} loading={busy.rejectingId === bid.id} onClick={() => onReject(bid)}>
                      Reject
                    </Button>
                    <Button size="sm" icon={<Check size={14} />} disabled={busy.any} loading={busy.approvingId === bid.id} onClick={() => onApprove(bid)}>
                      Approve
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

function BidDrawer({ selection, state, busy, onClose, onApprove, onReject }: {
  selection: { bid: Bid; window: CapacityWindow } | null
  state: WindowState | null
  busy: Busy
  onClose: () => void
  onApprove: () => void
  onReject: () => void
}) {
  const bid = selection?.bid
  const win = selection?.window
  const vehicle = win?.vehicles
  const actionable = !!bid && !!win && !win.winning_bid_id && bid.status === 'pending'

  const floor = win?.floor_price != null ? Number(win.floor_price) : null
  const difference = bid && floor != null ? Number(bid.bid_amount) - floor : null
  const free = vehicle?.available_capacity_kg != null ? Number(vehicle.available_capacity_kg) : null
  const tooHeavy = actionable && bid?.weight_kg != null && free != null && Number(bid.weight_kg) > free

  return (
    <Drawer
      open={!!selection}
      onClose={onClose}
      title={bid ? `Bid from ${vendorName(bid)}` : 'Bid'}
      description={vehicle?.plate_number ? `For space on ${vehicle.plate_number}` : undefined}
      footer={actionable ? (
        <>
          <Button variant="secondary" icon={<X size={16} />} disabled={busy.any} loading={busy.rejectingId === bid?.id} onClick={onReject}>Reject bid</Button>
          <Button icon={<Check size={16} />} disabled={busy.any} loading={busy.approvingId === bid?.id} onClick={onApprove}>Approve bid</Button>
        </>
      ) : undefined}
    >
      {bid && win && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={bid.status} kind="bid" />
            {state && <span className="text-sm text-muted">Window: {statusToLabel(state, 'window').toLowerCase()}</span>}
          </div>

          {tooHeavy && (
            <Alert tone="warning" title="Heavier than the free space">
              This load is {formatKg(bid.weight_kg)} but the vehicle has {formatKg(free)} free right now.
            </Alert>
          )}

          {bid.status === 'rejected' && bid.rejection_reason && (
            <Alert tone="danger" title="Rejected">{bid.rejection_reason}</Alert>
          )}

          <DetailList
            items={[
              { label: 'Vendor', value: vendorName(bid) },
              { label: 'City', value: bid.vendor?.city ?? 'Not given' },
              { label: 'Bid amount', value: <span className="tabular">{formatRupees(bid.bid_amount)}</span> },
              {
                label: 'Minimum bid',
                value: floor == null ? 'Set per load by the pricing engine' : (
                  <span className="tabular">
                    {formatRupees(floor)}
                    {difference != null && (
                      <span className="block text-xs text-muted">
                        {difference === 0 ? 'Bid equals the minimum bid' : `${formatRupees(Math.abs(difference))} ${difference > 0 ? 'above' : 'below'} the minimum bid`}
                      </span>
                    )}
                  </span>
                ),
              },
              { label: 'Load weight', value: <span className="tabular">{formatKg(bid.weight_kg)}</span> },
              {
                label: 'Vehicle space',
                value: (
                  <span className="tabular">
                    {formatKg(free)} free now
                    {vehicle?.capacity_kg != null && <span className="block text-xs text-muted">of {formatKg(vehicle.capacity_kg)} total</span>}
                  </span>
                ),
              },
              {
                label: 'Drop-off',
                value: bid.delivery_points
                  ? <>{bid.delivery_points.name}{bid.delivery_points.address && bid.delivery_points.address !== bid.delivery_points.name && <span className="block text-xs text-muted">{bid.delivery_points.address}</span>}</>
                  : 'Not given',
              },
              { label: 'E-way bill', value: bid.eway_bill_ref ? <span className="font-mono">{bid.eway_bill_ref}</span> : 'Not provided' },
              { label: 'Load type', value: bid.load_configuration || 'Not given' },
              { label: 'Submitted', value: formatDateTime(bid.submitted_at) },
              { label: 'Vehicle', value: vehicle?.plate_number ? <span className="font-mono">{vehicle.plate_number}</span> : 'Not found' },
              { label: 'Window closes', value: formatDateTime(win.closes_at) },
            ]}
          />

          {!actionable && bid.status === 'pending' && win.winning_bid_id && (
            <p className="text-sm text-muted">Another bid has already been approved for this vehicle.</p>
          )}
        </div>
      )}
    </Drawer>
  )
}

function ConfirmationsTable({ query }: { query: UseQueryResult<DriverConfirmation[]> }) {
  const columns: Column<DriverConfirmation>[] = [
    {
      key: 'vehicle', header: 'Vehicle',
      cell: c => <span className="font-mono">{c.vehicles?.plate_number ?? 'Unknown'}</span>,
      sortValue: c => c.vehicles?.plate_number ?? '',
    },
    {
      key: 'stop', header: 'New stop',
      cell: c => c.route_stops?.delivery_points?.name ?? 'Stop details unavailable',
    },
    {
      key: 'sent', header: 'Sent',
      cell: c => <span title={formatDateTime(c.prompted_at)}>{formatRelative(c.prompted_at)}</span>,
      sortValue: c => new Date(c.prompted_at).getTime(),
    },
    {
      key: 'status', header: 'Status',
      cell: c => { const s = confirmationStatus(c); return <StatusPill tone={s.tone}>{s.label}</StatusPill> },
      sortValue: c => confirmationStatus(c).label,
    },
  ]
  return (
    <DataTable
      caption="Driver confirmations for approved bids"
      columns={columns}
      rows={query.data ?? []}
      rowKey={c => c.id}
      loading={query.isLoading}
      error={query.error ? 'We could not load driver confirmations. Try again.' : undefined}
      onRetry={() => query.refetch()}
      pageSize={10}
      empty={{ title: 'No confirmations yet', description: 'They appear here after a bid is approved.' }}
    />
  )
}
