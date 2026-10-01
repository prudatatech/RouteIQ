import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ArrowRight, Check, Download, ExternalLink, Truck, X } from 'lucide-react'
import { supabase } from '@/services/supabase'
import { bookingsAPI, vendorAPI, type CustomerBooking } from '@/services/api'
import {
  Alert, BulkActionBar, Button, DataTable, Page, PageHeader, SearchInput, Select, StatusPill, Tabs, TabPanel,
  useConfirm, useOpenOnWork, useRowSelection, useTabParam, useUrlState, type Column,
} from '@/components/ui'
import { buttonClasses } from '@/components/ui/buttonStyles'
import AssignVehicleModal, { type AssignResult } from '@/components/shipments/AssignVehicleModal'
import { AcceptBookingModal, AcceptLoadModal } from '@/components/requests/AcceptModals'
import { BookingDrawer, LoadDrawer } from '@/components/requests/RequestDrawers'
import {
  SOURCES, STAGE_IDS, STAGE_LABELS, customerRow, priceText, primaryLabel, shipmentHref, shortPlace, stageCounts, vendorName, vendorRow, customerName,
  type RequestRow, type RequestSource, type StageId, type VendorRequest,
} from '@/components/requests/model'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { downloadCsv, toCsv } from '@/utils/csv'
import { errorMessage, formatDate, formatDateTime, formatKg, formatRelative } from '@/utils/display'

/** How many recent vendor loads the inbox loads. */
const REQUEST_LIMIT = 500

async function loadVendorRequests(): Promise<VendorRequest[]> {
  const { data, error } = await supabase
    .from('vendor_shipment_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(REQUEST_LIMIT)
  if (error) throw error
  const rows = data ?? []
  const vendorIds = [...new Set(rows.map(r => r.vendor_id).filter(Boolean))]
  const vendors = new Map<string, VendorRequest['vendor']>()
  if (vendorIds.length > 0) {
    const { data: profiles, error: pErr } = await supabase
      .from('vendor_profiles').select('id, company_name, city').in('id', vendorIds)
    if (pErr) throw pErr
    for (const p of profiles ?? []) vendors.set(p.id, { company_name: p.company_name, city: p.city })
  }
  return rows.map(r => ({ ...r, vendor: vendors.get(r.vendor_id) ?? null })) as VendorRequest[]
}

type SourceFilter = 'all' | RequestSource
const SOURCE_FILTERS = ['all', ...SOURCES] as const

const SOURCE_LABELS: Record<SourceFilter, string> = { all: 'All sources', customer: 'Customer bookings', vendor: 'Vendor loads' }

/** A step the person can take right now, shown after an action so they never have to hunt for it. */
interface NextStep {
  key: string
  title: string
  body: string
  action?: { label: string; run: () => void }
  shipmentTo?: string | null
}

const EMPTY_TITLES: Record<StageId, string> = {
  accept: 'Nothing waiting to be accepted',
  accepted: 'Nothing waiting for a vehicle',
  progress: 'Nothing in progress',
  done: 'Nothing done yet',
  closed: 'Nothing rejected or cancelled',
  all: 'No requests yet',
}

export default function RequestsPage() {
  const queryClient = useQueryClient()
  const { confirm, prompt } = useConfirm()
  const [tab, setTab] = useTabParam<StageId>(STAGE_IDS, 'accept')
  const [source, setSource] = useTabParam<SourceFilter>(SOURCE_FILTERS, 'all', 'source')
  const [search, setSearch] = useUrlState('q', { debounceMs: 300 })
  const [selected, setSelected] = useState<{ source: RequestSource; id: string } | null>(null)
  const [accepting, setAccepting] = useState<{ source: RequestSource; id: string } | null>(null)
  const [assigning, setAssigning] = useState<{ source: RequestSource; ids: string[] } | null>(null)
  const [next, setNext] = useState<NextStep | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()

  const bookings = useQuery({ queryKey: ['customer-bookings'], queryFn: bookingsAPI.list, refetchInterval: 30_000 })
  const loads = useQuery({ queryKey: ['vendor-requests'], queryFn: loadVendorRequests })
  useRealtimeRefresh('vendor_requests_page', ['vendor_shipment_requests'], [['vendor-requests']])

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['customer-bookings'] }),
      queryClient.invalidateQueries({ queryKey: ['vendor-requests'] }),
      // Accepting, assigning or cancelling changes the linked shipment and the vehicle's load
      queryClient.invalidateQueries({ queryKey: ['shipments'] }),
      queryClient.invalidateQueries({ queryKey: ['vehicles'] }),
    ])
  }

  const allBookings = useMemo(() => bookings.data ?? [], [bookings.data])
  const allLoads = useMemo(() => loads.data ?? [], [loads.data])
  const every = useMemo(() => [...allBookings.map(customerRow), ...allLoads.map(vendorRow)], [allBookings, allLoads])
  const inSource = useMemo(() => every.filter(r => source === 'all' || r.source === source), [every, source])
  const counts = useMemo(() => stageCounts(inSource), [inSource])
  // Open on the first stage that has requests, not on an empty "To accept"
  useOpenOnWork(['accept', 'accepted', 'progress', 'done'] as const, bookings.isLoading || loads.isLoading ? {} : counts, tab, setTab)
  const sourceCounts = useMemo(() => ({ all: every.length, customer: allBookings.length, vendor: allLoads.length }), [every.length, allBookings.length, allLoads.length])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = inSource.filter(r => {
      if (tab !== 'all' && r.stage !== tab) return false
      if (!q) return true
      return [r.requester, r.pickup, r.drop, r.trackingId ?? ''].some(v => v.toLowerCase().includes(q))
    })
    // What has waited longest comes first where someone has to act; elsewhere the newest
    const dir = tab === 'accept' || tab === 'accepted' ? 1 : -1
    return list.sort((a, b) => (Date.parse(a.createdAt) - Date.parse(b.createdAt)) * dir)
  }, [inSource, tab, search])

  const loading = bookings.isLoading || loads.isLoading
  const failed = bookings.error && loads.error

  const rowOf = (s: { source: RequestSource; id: string } | null) => (s ? every.find(r => r.source === s.source && r.id === s.id) ?? null : null)
  const selectedRow = rowOf(selected)

  // Opened from a link (a notification, global search, an old page): ?open=<id> shows the tab the request is
  // under and opens its drawer, then the param is dropped from the URL.
  useEffect(() => {
    const openId = searchParams.get('open')
    if (!openId || loading) return
    const hint = searchParams.get('source')
    const match = every.find(r => r.id === openId && (hint !== 'customer' && hint !== 'vendor' ? true : r.source === hint))
    setSearchParams(prev => {
      const nextParams = new URLSearchParams(prev)
      nextParams.delete('open')
      if (match) {
        if (match.stage === 'accept') nextParams.delete('tab'); else nextParams.set('tab', match.stage)
        if (nextParams.get('source') && nextParams.get('source') !== match.source) nextParams.set('source', match.source)
      }
      return nextParams
    }, { replace: true })
    if (match) setSelected({ source: match.source, id: match.id })
  }, [searchParams, setSearchParams, every, loading])

  const selection = useRowSelection(rows, r => r.key)
  const isBulkSelectable = (r: RequestRow) => r.source === 'vendor' && (r.stage === 'accept' || r.stage === 'accepted')
  const selectedLoads = useMemo(() => selection.selectedRows.filter(isBulkSelectable).map(r => r.vendor!), [selection.selectedRows])

  // ── Accept & price ─────────────────────────────────────────
  const acceptBooking = useMutation({
    mutationFn: ({ id, price }: { id: string; price: number | null }) => bookingsAPI.confirm(id, price),
    onSuccess: async (_data, vars) => {
      setAccepting(null)
      await refresh()
      toast.success('Accepted. A shipment was created and the customer has been told.')
      const key = { source: 'customer' as const, id: vars.id }
      setNext({
        key: `customer:${vars.id}`,
        title: 'Accepted. Next: assign a vehicle',
        body: 'The shipment is created and the customer has been told.',
        action: { label: 'Assign vehicle', run: () => setAssigning({ source: key.source, ids: [key.id] }) },
      })
    },
    onError: err => toast.error(errorMessage(err, 'We could not accept this booking. Try again.')),
  })
  const acceptLoad = useMutation({
    mutationFn: ({ id, price }: { id: string; price: { cost?: number; cost_per_km?: number } }) => vendorAPI.approveRequest(id, price),
    onSuccess: async (_data, vars) => {
      setAccepting(null)
      await refresh()
      toast.success('Accepted. The vendor has been told the price.')
      setNext({
        key: `vendor:${vars.id}`,
        title: 'Accepted. Next: assign a vehicle',
        body: 'The vendor has been told the price. Choose a vehicle with a driver.',
        action: { label: 'Assign vehicle', run: () => setAssigning({ source: 'vendor', ids: [vars.id] }) },
      })
    },
    onError: err => toast.error(errorMessage(err, 'We could not accept this load. Try again.')),
  })

  // ── Reject / cancel, always with a reason ──────────────────
  const rejectBooking = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => bookingsAPI.cancel(id, reason),
    onSuccess: () => { toast.success('Done. The customer has been told.'); setSelected(null) },
    onError: err => toast.error(errorMessage(err, 'We could not do that. Try again.')),
    onSettled: refresh,
  })
  const rejectLoad = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => vendorAPI.rejectRequest(id, reason),
    onSuccess: () => { toast.success('Rejected. The vendor has been told.'); setSelected(null) },
    onError: err => toast.error(errorMessage(err, 'We could not reject this load. Try again.')),
    onSettled: refresh,
  })

  const askRejectBooking = async (b: CustomerBooking) => {
    const early = b.status === 'requested'
    const reason = await prompt({
      title: early ? 'Reject this request?' : 'Cancel this request?',
      message: `${b.customer ? customerName(b) : 'The customer'}’s booking from ${shortPlace(b.pickup_name)} to ${shortPlace(b.drop_name)} will be ${early ? 'rejected' : 'cancelled'}${b.shipment_id ? ' and its shipment too' : ''}. The customer is told the reason.`,
      inputLabel: 'Reason',
      placeholder: early ? 'Why is this request being rejected?' : 'Why is this request being cancelled?',
      confirmLabel: early ? 'Reject request' : 'Cancel request',
      tone: 'danger',
      required: true,
    })
    if (reason) rejectBooking.mutate({ id: b.id, reason })
  }
  const askRejectLoad = async (r: VendorRequest) => {
    const reason = await prompt({
      title: 'Reject this request?',
      message: `${vendorName(r)}’s load from ${shortPlace(r.pickup_location)} to ${shortPlace(r.drop_location)} will be rejected and the vendor told the reason.`,
      inputLabel: 'Reason',
      placeholder: 'Why is this request being rejected?',
      confirmLabel: 'Reject request',
      tone: 'danger',
      required: true,
    })
    if (reason) rejectLoad.mutate({ id: r.id, reason })
  }

  // ── Bulk actions on vendor loads ───────────────────────────
  async function runBulk<T>(items: T[], action: (item: T) => Promise<void>, labelFor: (item: T) => string) {
    setBulkBusy(true)
    let ok = 0
    const failures: string[] = []
    for (const item of items) {
      try { await action(item); ok++ } catch (err) { failures.push(`${labelFor(item)}: ${errorMessage(err, 'failed')}`) }
    }
    setBulkBusy(false)
    return { ok, failures }
  }
  const reportBulk = (verb: string, ok: number, failures: string[]) => {
    if (failures.length === 0) toast.success(`${verb} ${ok} ${ok === 1 ? 'load' : 'loads'}`)
    else toast.error(`${verb} ${ok}, ${failures.length} failed: ${failures.slice(0, 3).join('; ')}${failures.length > 3 ? '…' : ''}`)
  }

  const bulkAccept = async () => {
    const targets = selectedLoads.filter(r => r.status === 'pending')
    if (targets.length === 0) { toast.error('Only new loads can be accepted'); return }
    const priced = targets.filter(r => r.metadata?.offered_price_inr)
    const agreed = await confirm({
      title: `Accept ${targets.length} ${targets.length === 1 ? 'load' : 'loads'} at the vendors’ prices?`,
      message: priced.length === targets.length
        ? 'Each load is accepted at the price its vendor offered, and each vendor is told.'
        : `${targets.length - priced.length} of them have no offered price and will fail. Accept those one at a time so you can set a price.`,
      confirmLabel: 'Accept loads',
    })
    if (!agreed) return
    const { ok, failures } = await runBulk(targets, r => vendorAPI.approveRequest(r.id, { cost: Number(r.metadata?.offered_price_inr) || undefined }), vendorName)
    selection.clear()
    await refresh()
    reportBulk('Accepted', ok, failures)
  }

  const bulkReject = async () => {
    const targets = selectedLoads
    if (targets.length === 0) return
    const reason = await prompt({
      title: `Reject ${targets.length} ${targets.length === 1 ? 'load' : 'loads'}?`,
      message: 'The same reason is sent to every vendor whose load is rejected.',
      inputLabel: 'Reason',
      placeholder: 'Why are these loads being rejected?',
      confirmLabel: 'Reject loads',
      tone: 'danger',
      required: true,
    })
    if (!reason) return
    const { ok, failures } = await runBulk(targets, r => vendorAPI.rejectRequest(r.id, reason), vendorName)
    selection.clear()
    await refresh()
    reportBulk('Rejected', ok, failures)
  }

  const assignableSelected = selectedLoads.filter(r => r.status === 'approved')

  const onAssigned = (result: AssignResult) => {
    selection.clear()
    const shipmentTo = result.kind === 'shipment' ? null : (() => {
      const id = result.assignedIds[0]
      const row = every.find(r => r.id === id)
      return row ? shipmentHref(row) : null
    })()
    setNext({
      key: result.assignedIds.join(','),
      title: `Assigned to ${result.plate}. Next: dispatch`,
      body: result.assignedIds.length > 1
        ? `${result.assignedIds.length} loads are on ${result.plate}. Open the shipment to follow it.`
        : 'The requester has been told. Open the shipment to follow it to the road.',
      shipmentTo,
    })
  }

  const assignTarget = useMemo(() => {
    if (!assigning) return { booking: null, loads: null }
    if (assigning.source === 'customer') return { booking: allBookings.find(b => b.id === assigning.ids[0]) ?? null, loads: null }
    const list = allLoads.filter(r => assigning.ids.includes(r.id))
    return { booking: null, loads: list.length > 0 ? list : null }
  }, [assigning, allBookings, allLoads])

  const acceptingBooking = accepting?.source === 'customer' ? allBookings.find(b => b.id === accepting.id) ?? null : null
  const acceptingLoad = accepting?.source === 'vendor' ? allLoads.find(r => r.id === accepting.id) ?? null : null

  const act = (row: RequestRow) => {
    const ref = { source: row.source, id: row.id }
    if (row.action === 'accept') setAccepting(ref)
    else if (row.action === 'assign') setAssigning({ ...ref, ids: [row.id] })
    else setSelected(ref)
  }

  const columns: Column<RequestRow>[] = [
    {
      key: 'requester', header: 'Requester', sortValue: r => r.requester,
      cell: r => (
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {r.requesterHref
              ? <Link to={r.requesterHref} onClick={e => e.stopPropagation()} className="font-medium underline-offset-2 hover:underline">{r.requester}</Link>
              : <span className="font-medium">{r.requester}</span>}
            <StatusPill tone="neutral" dot={false}>{r.source === 'customer' ? 'Customer' : 'Vendor'}</StatusPill>
          </div>
          <StatusPill tone={r.statusTone}>{r.statusLabel}</StatusPill>
        </div>
      ),
    },
    {
      key: 'route', header: 'Pickup → drop',
      cell: r => (
        // On a phone the places wrap instead of being cut off at the card edge
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 md:inline-flex md:max-w-xs md:flex-nowrap">
          <span className="break-words md:truncate" title={r.pickup}>{shortPlace(r.pickup)}</span>
          <ArrowRight size={14} aria-label="to" className="shrink-0 text-muted" />
          <span className="break-words md:truncate" title={r.drop}>{shortPlace(r.drop)}</span>
        </span>
      ),
    },
    {
      key: 'goods', header: 'Goods', hideBelow: 'lg', sortValue: r => r.weightKg,
      cell: r => (
        <span className="tabular">
          {r.pieces != null && <>{r.pieces.toLocaleString('en-IN')} {r.pieces === 1 ? 'piece' : 'pieces'}, </>}
          {r.weightKg != null ? formatKg(r.weightKg) : '—'}
        </span>
      ),
    },
    {
      key: 'wanted', header: 'Wanted', hideBelow: 'lg', sortValue: r => r.wantedDate,
      cell: r => r.wantedDate ? formatDate(`${r.wantedDate}T12:00:00+05:30`) : <span className="text-muted">Any day</span>,
    },
    {
      key: 'price', header: 'Price', align: 'right', hideBelow: 'lg', sortValue: r => r.price,
      cell: r => <span className={r.price == null ? 'whitespace-nowrap text-muted' : 'whitespace-nowrap tabular'}>{priceText(r)}</span>,
    },
    {
      key: 'age', header: 'Received', hideBelow: 'xl', sortValue: r => Date.parse(r.createdAt),
      cell: r => <span title={formatDateTime(r.createdAt)}>{formatRelative(r.createdAt)}</span>,
    },
    {
      key: 'action', header: 'Next step', align: 'right',
      cell: r => {
        const href = r.action === 'open' ? shipmentHref(r) : null
        return (
          // The row opens its drawer on click; the button does its own thing
          <span onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
            {href ? (
              <Link to={href} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>Open shipment</Link>
            ) : r.action ? (
              <Button size="sm" variant={r.action === 'open' ? 'secondary' : 'primary'} icon={r.action === 'assign' ? <Truck size={14} /> : r.action === 'accept' ? <Check size={14} /> : undefined} onClick={() => act(r)}>{primaryLabel(r)}</Button>
            ) : <span className="text-muted">None</span>}
          </span>
        )
      },
    },
  ]

  const tabs = STAGE_IDS.map(id => ({ id, label: STAGE_LABELS[id], count: loading ? undefined : counts[id] }))

  const exportCsv = () => {
    const csv = toCsv(rows.map(r => ({
      source: r.source === 'customer' ? 'Customer' : 'Vendor',
      requester: r.requester,
      pickup: r.pickup,
      drop: r.drop,
      pieces: r.pieces ?? '',
      weight_kg: r.weightKg ?? '',
      wanted: r.wantedDate ?? '',
      price: r.price ?? '',
      status: r.statusLabel,
      requested_at: r.createdAt,
    })), [
      { key: 'source', header: 'Source' },
      { key: 'requester', header: 'Requester' },
      { key: 'pickup', header: 'Pickup' },
      { key: 'drop', header: 'Drop-off' },
      { key: 'pieces', header: 'Pieces' },
      { key: 'weight_kg', header: 'Weight (kg)' },
      { key: 'wanted', header: 'Wanted date' },
      { key: 'price', header: 'Price (₹)' },
      { key: 'status', header: 'Status' },
      { key: 'requested_at', header: 'Requested at' },
    ])
    downloadCsv(`requests-${new Date().toISOString().slice(0, 10)}.csv`, csv)
  }

  const selectedBooking = selectedRow?.customer ?? null
  const selectedLoad = selectedRow?.vendor ?? null

  return (
    <Page>
      <PageHeader
        title="Requests"
        description="Everything customers and vendors ask us to move. Accept and price a request, then assign a vehicle."
        actions={<Button variant="secondary" icon={<Download size={16} />} onClick={exportCsv}>Export CSV</Button>}
      >
        <div className="space-y-4">
          <Tabs label="Filter requests by stage" tabs={tabs} value={tab} onChange={setTab} />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <SearchInput value={search} onChange={setSearch} label="Search requests" placeholder="Search by requester, place or tracking ID" className="w-full sm:max-w-sm" />
            <Select
              label="Source"
              hideLabel
              className="w-full sm:w-56"
              value={source}
              onChange={e => setSource(e.target.value as SourceFilter)}
              options={SOURCE_FILTERS.map(s => ({ value: s, label: `${SOURCE_LABELS[s]}${loading ? '' : ` (${sourceCounts[s]})`}` }))}
            />
          </div>
        </div>
      </PageHeader>

      <p className="text-sm text-muted">
        Shipments that staff create go straight to <Link to="/shipments" className="font-medium text-brand hover:underline">Shipments</Link> and do not appear here.
      </p>

      {next && (
        <Alert
          tone="success"
          title={next.title}
          action={(
            <div className="flex flex-wrap items-center gap-2">
              {next.action && <Button size="sm" icon={<Truck size={14} />} onClick={() => { next.action!.run(); setNext(null) }}>{next.action.label}</Button>}
              {next.shipmentTo && <Link to={next.shipmentTo} className={buttonClasses({ variant: 'secondary', size: 'sm' })}><ExternalLink size={14} className="mr-1.5" />Open shipment</Link>}
              <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={() => setNext(null)}>Dismiss</Button>
            </div>
          )}
        >
          {next.body}
        </Alert>
      )}

      <TabPanel id={tab}>
        <DataTable
          caption="Requests"
          columns={columns}
          rows={rows}
          rowKey={r => r.key}
          loading={loading}
          error={failed ? 'We could not load requests. Check your connection and try again.' : undefined}
          onRetry={() => { bookings.refetch(); loads.refetch() }}
          onRowClick={r => setSelected({ source: r.source, id: r.id })}
          selectedKey={selectedRow?.key ?? null}
          empty={{
            title: search ? 'No requests match your search' : EMPTY_TITLES[tab],
            description: search ? 'Try a different requester, place or tracking ID.' : 'Bookings from the customer app and loads from the vendor portal appear here.',
            action: search ? <Button variant="secondary" onClick={() => setSearch('')}>Clear search</Button> : undefined,
          }}
          selection={{
            selectedKeys: selection.selectedKeys,
            onToggleRow: key => selection.toggleRow(key),
            onToggleAll: (pageRows, checked) => selection.toggleAll(pageRows, checked),
            isRowSelectable: isBulkSelectable,
          }}
        />

        <div className="mt-3">
          <BulkActionBar count={selection.count} onClear={selection.clear}>
            <Button size="sm" variant="secondary" disabled={bulkBusy} loading={bulkBusy} onClick={bulkAccept}>Accept at offered price</Button>
            <Button size="sm" variant="secondary" disabled={bulkBusy} onClick={bulkReject}>Reject selected (one reason)</Button>
            {assignableSelected.length > 0 && (
              <Button size="sm" icon={<Truck size={14} />} disabled={bulkBusy} onClick={() => setAssigning({ source: 'vendor', ids: assignableSelected.map(r => r.id) })}>
                Assign one vehicle to {assignableSelected.length} {assignableSelected.length === 1 ? 'load' : 'loads'}
              </Button>
            )}
          </BulkActionBar>
        </div>
      </TabPanel>

      <BookingDrawer
        booking={selectedBooking}
        onClose={() => setSelected(null)}
        busy={acceptBooking.isPending || rejectBooking.isPending}
        accepting={acceptBooking.isPending && acceptBooking.variables?.id === selectedBooking?.id}
        cancelling={rejectBooking.isPending && rejectBooking.variables?.id === selectedBooking?.id}
        onAccept={b => setAccepting({ source: 'customer', id: b.id })}
        onReject={askRejectBooking}
        onAssign={b => setAssigning({ source: 'customer', ids: [b.id] })}
      />
      <LoadDrawer
        request={selectedLoad}
        onClose={() => setSelected(null)}
        busy={acceptLoad.isPending || rejectLoad.isPending}
        accepting={acceptLoad.isPending && acceptLoad.variables?.id === selectedLoad?.id}
        rejecting={rejectLoad.isPending && rejectLoad.variables?.id === selectedLoad?.id}
        onAccept={r => setAccepting({ source: 'vendor', id: r.id })}
        onReject={askRejectLoad}
        onAssign={r => setAssigning({ source: 'vendor', ids: [r.id] })}
      />

      <AcceptBookingModal
        booking={acceptingBooking}
        loading={acceptBooking.isPending}
        onClose={() => setAccepting(null)}
        onAccept={(b, price) => acceptBooking.mutate({ id: b.id, price })}
      />
      <AcceptLoadModal
        load={acceptingLoad}
        loading={acceptLoad.isPending}
        onClose={() => setAccepting(null)}
        onAccept={(r, price) => acceptLoad.mutate({ id: r.id, price })}
      />

      <AssignVehicleModal
        booking={assignTarget.booking}
        loads={assignTarget.loads}
        onClose={() => setAssigning(null)}
        onAssigned={onAssigned}
      />
    </Page>
  )
}
