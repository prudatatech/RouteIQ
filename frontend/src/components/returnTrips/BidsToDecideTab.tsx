import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import type { AxiosError } from 'axios'
import toast from 'react-hot-toast'
import { Check, MapPinOff, X } from 'lucide-react'
import { capacityAPI } from '@/services/api'
import {
  Alert, Button, DataTable, DetailList, Drawer, ExportCsvButton, SectionHeader, StatusPill, useConfirm, statusToLabel, type Column,
} from '@/components/ui'
import { errorMessage, formatDateTime, formatKg, formatRelative, formatRupees, formatTime } from '@/utils/display'
import {
  laneText, returnTripKeys, timeLeft, useDriverConfirmations, vendorName, windowState,
  type Bid, type Board, type CapacityWindow, type DriverConfirmation, type Trip, type WindowState,
} from './data'
import VendorLocationModal, { type MissingLocation } from './VendorLocationModal'
import { stripLeadingName } from '@/utils/address'

interface Row {
  bid: Bid
  window: CapacityWindow
  state: WindowState
  trip: Trip | null
  /** Other bids still waiting on the same return trip. */
  rivals: number
  highest: boolean
}

interface Busy { approvingId: string | null; rejectingId: string | null; any: boolean }

const link = 'font-medium text-text underline decoration-border underline-offset-2 hover:decoration-text'
const subLink = 'text-xs text-muted underline decoration-border underline-offset-2 hover:text-text'

/** Whether the load fits the truck's free space, from the bid's weight. */
function fit(bid: Bid, window: CapacityWindow): { fits: boolean | null; text: string } {
  const free = window.vehicles?.available_capacity_kg
  if (bid.weight_kg == null || free == null) return { fits: null, text: 'Space not known' }
  return Number(bid.weight_kg) > Number(free)
    ? { fits: false, text: `Too heavy: ${formatKg(bid.weight_kg)} for ${formatKg(free)} free` }
    : { fits: true, text: `Fits: ${formatKg(bid.weight_kg)} of ${formatKg(free)} free` }
}

// The server accepts for the driver 2 minutes after the stop reached their phone, or 15 minutes after it was sent when it never did.
const AUTO_ACCEPT_SEEN_MS = 2 * 60_000
const AUTO_ACCEPT_UNSEEN_MS = 15 * 60_000

/** When an unanswered confirmation is accepted for the driver, or null once it has been answered. */
const autoAcceptAt = (c: DriverConfirmation): number | null => {
  if (c.action) return null
  return c.delivered_at ? new Date(c.delivered_at).getTime() + AUTO_ACCEPT_SEEN_MS : new Date(c.prompted_at).getTime() + AUTO_ACCEPT_UNSEEN_MS
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

function VendorCell({ bid }: { bid: Bid }) {
  return (
    <div className="min-w-0">
      <Link to={`/admin/users/${encodeURIComponent(bid.vendor_id)}`} onClick={e => e.stopPropagation()} className={link}>{vendorName(bid)}</Link>
      <p className="text-xs text-muted">{bid.vendor?.city ?? 'City not given'}</p>
      {bid.status === 'pending' && bid.vendor && !bid.vendor.has_location && (
        <StatusPill tone="warning" dot={false} className="mt-1"><MapPinOff size={12} aria-hidden="true" /> No pickup location</StatusPill>
      )}
    </div>
  )
}

function TruckCell({ window, trip }: { window: CapacityWindow; trip: Trip | null }) {
  const v = window.vehicles
  const lane = laneText(v, trip)
  return (
    <div className="min-w-0">
      {v?.id
        ? <Link to={`/fleet/${encodeURIComponent(v.id)}`} onClick={e => e.stopPropagation()} className={`${link} font-mono`}>{v.plate_number ?? 'Truck'}</Link>
        : <span className="font-mono">Vehicle not found</span>}
      {lane && <p className="text-xs text-muted">{lane}</p>}
      {trip && <Link to={`/routes/${encodeURIComponent(trip.id)}`} onClick={e => e.stopPropagation()} className={subLink}>View trip</Link>}
    </div>
  )
}

/**
 * Bids waiting for staff to award or reject, then the ones already decided and what each award created,
 * then the drivers' answers to awarded stops.
 */
export default function BidsToDecideTab({ board, now, selectedBidId, onSelectBid, focusWindowId }: {
  board: UseQueryResult<Board>
  now: number
  /** The bid open in the side panel. */
  selectedBidId: string | null
  onSelectBid: (id: string | null) => void
  /** A return trip whose bids to highlight, from a link. */
  focusWindowId: string | null
}) {
  const queryClient = useQueryClient()
  const { confirm, prompt } = useConfirm()
  const confirmations = useDriverConfirmations()
  const [missing, setMissing] = useState<MissingLocation | null>(null)

  const { waiting, decided } = useMemo(() => {
    const data = board.data
    if (!data) return { waiting: [] as Row[], decided: [] as Row[] }
    const windows = new Map(data.windows.map(w => [w.id, w]))
    const byWindow = new Map<string, Bid[]>()
    for (const b of data.bids) byWindow.set(b.window_id, [...(byWindow.get(b.window_id) ?? []), b])
    const rows: Row[] = []
    for (const bid of data.bids) {
      const window = windows.get(bid.window_id)
      if (!window) continue
      const siblings = byWindow.get(window.id) ?? []
      const pending = siblings.filter(b => b.status === 'pending')
      const top = pending.reduce<Bid | null>((t, b) => (!t || b.bid_amount > t.bid_amount ? b : t), null)
      rows.push({
        bid, window, state: windowState(window, siblings, now), trip: data.trips[window.vehicle_id] ?? null,
        rivals: pending.filter(b => b.id !== bid.id).length, highest: top?.id === bid.id,
      })
    }
    // A bid is open to a decision while it is pending and its return trip has no winner
    const canDecide = (r: Row) => r.bid.status === 'pending' && !r.window.winning_bid_id && r.state !== 'cancelled'
    return {
      // Return trips closing soonest first, the highest bid first within one
      waiting: rows.filter(canDecide).sort((a, b) =>
        new Date(a.window.closes_at).getTime() - new Date(b.window.closes_at).getTime() || b.bid.bid_amount - a.bid.bid_amount),
      decided: rows.filter(r => !canDecide(r))
        .sort((a, b) => new Date(b.bid.submitted_at ?? 0).getTime() - new Date(a.bid.submitted_at ?? 0).getTime()),
    }
  }, [board.data, now])

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: returnTripKeys.board })
    queryClient.invalidateQueries({ queryKey: returnTripKeys.confirmations })
  }

  const approve = useMutation({
    mutationFn: (bidId: string) => capacityAPI.approveBid(bidId),
    onSuccess: () => { toast.success('Bid approved. The pickup and drop-off were added to the truck’s trip.'); onSelectBid(null) },
    onError: (err, bidId) => {
      const body = (err as AxiosError<{ code?: string; vendor_id?: string; vendor_name?: string | null }>)?.response?.data
      if (body?.code === 'vendor_location_missing' && body.vendor_id) {
        // The backend has already asked the vendor to add a location
        setMissing({ vendorId: body.vendor_id, vendorName: body.vendor_name || 'This vendor', bidId, vendorAsked: true })
        onSelectBid(null)
        return
      }
      toast.error(errorMessage(err, 'We could not approve this bid. Try again.'))
    },
    onSettled: refresh,
  })

  const reject = useMutation({
    mutationFn: ({ bidId, reason }: { bidId: string; reason: string }) => capacityAPI.rejectBid(bidId, reason),
    onSuccess: () => { toast.success('Bid rejected. The vendor has been told.'); onSelectBid(null) },
    onError: err => toast.error(errorMessage(err, 'We could not reject this bid. Try again.')),
    onSettled: refresh,
  })

  const approvingId = approve.isPending ? approve.variables ?? null : null
  const rejectingId = reject.isPending ? reject.variables?.bidId ?? null : null
  const busy: Busy = { approvingId, rejectingId, any: approvingId !== null || rejectingId !== null }

  const askApprove = async (row: Row) => {
    const { bid, window } = row
    const ok = await confirm({
      title: 'Approve this bid?',
      message: (
        <div className="space-y-2">
          <p>{vendorName(bid)} gets {formatKg(bid.weight_kg)} of space on {window.vehicles?.plate_number ?? 'this truck'} for {formatRupees(bid.bid_amount)}.</p>
          <p>
            The pickup at the vendor and the drop-off are added to the truck’s trip and the driver is asked to confirm them. The truck’s free space goes down by this load only.
            {row.rivals > 0 && ` The other ${row.rivals === 1 ? 'bid' : `${row.rivals} bids`} on this truck will be marked as not selected.`}
          </p>
          {bid.vendor && !bid.vendor.has_location && (
            <p className="font-medium text-warning">This vendor has no pickup location, so the award will fail until one is added.</p>
          )}
        </div>
      ),
      confirmLabel: 'Approve bid',
    })
    if (ok) approve.mutate(bid.id)
  }

  const askReject = async (row: Row) => {
    const reason = await prompt({
      title: 'Reject this bid?',
      message: `${vendorName(row.bid)}’s bid of ${formatRupees(row.bid.bid_amount)} will be rejected and the vendor notified. This cannot be undone.`,
      inputLabel: 'Reason',
      placeholder: 'Why is this bid being rejected?',
      confirmLabel: 'Reject bid',
      tone: 'danger',
      required: true,
    })
    if (reason) reject.mutate({ bidId: row.bid.id, reason })
  }

  const selected = [...waiting, ...decided].find(r => r.bid.id === selectedBidId) ?? null
  const error = board.error ? 'We could not load bids. Check your connection and try again.' : undefined

  const waitingColumns: Column<Row>[] = [
    { key: 'vendor', header: 'Vendor', cell: r => <VendorCell bid={r.bid} />, sortValue: r => vendorName(r.bid) },
    {
      key: 'amount', header: 'Bid', align: 'right', sortValue: r => Number(r.bid.bid_amount),
      cell: r => (
        <span className="tabular">
          {formatRupees(r.bid.bid_amount)}
          {r.highest && r.rivals > 0 && <span className="block text-xs font-normal text-brand">Highest of {r.rivals + 1}</span>}
          {r.window.floor_price != null && <span className="block text-xs text-muted">Minimum {formatRupees(r.window.floor_price)}</span>}
        </span>
      ),
    },
    {
      key: 'fit', header: 'Fit', hideBelow: 'md',
      cell: r => {
        const f = fit(r.bid, r.window)
        return <span className={f.fits === false ? 'text-sm font-medium text-danger' : 'text-sm text-muted'}>{f.text}</span>
      },
      sortValue: r => (fit(r.bid, r.window).fits === false ? 1 : 0),
    },
    { key: 'truck', header: 'Truck', cell: r => <TruckCell window={r.window} trip={r.trip} />, sortValue: r => r.window.vehicles?.plate_number ?? '' },
    {
      key: 'closes', header: 'Return trip', hideBelow: 'lg', sortValue: r => new Date(r.window.closes_at).getTime(),
      cell: r => (r.state === 'open' || r.state === 'upcoming'
        ? <span className="text-sm text-muted">{r.state === 'upcoming' ? 'Opens' : 'Closes'} in {timeLeft(r.state === 'upcoming' ? r.window.opens_at : r.window.closes_at, now) ?? 'a moment'}</span>
        : <span className="text-sm text-muted">Closed {formatRelative(r.window.closes_at, now)}</span>),
    },
    {
      key: 'actions', header: <span className="sr-only">Decide</span>, align: 'right',
      cell: r => (
        <span className="inline-flex flex-wrap justify-end gap-2" onClick={e => e.stopPropagation()}>
          <Button size="sm" variant="secondary" icon={<X size={14} />} disabled={busy.any} loading={busy.rejectingId === r.bid.id} onClick={() => askReject(r)}>Reject</Button>
          <Button size="sm" icon={<Check size={14} />} disabled={busy.any} loading={busy.approvingId === r.bid.id} onClick={() => askApprove(r)}>Approve</Button>
        </span>
      ),
    },
  ]

  const decidedColumns: Column<Row>[] = [
    { key: 'vendor', header: 'Vendor', cell: r => <VendorCell bid={r.bid} />, sortValue: r => vendorName(r.bid) },
    { key: 'amount', header: 'Bid', align: 'right', sortValue: r => Number(r.bid.bid_amount), cell: r => <span className="tabular">{formatRupees(r.bid.bid_amount)}</span> },
    {
      key: 'outcome', header: 'Outcome', sortValue: r => r.bid.status,
      cell: r => (
        <div className="min-w-0">
          <StatusPill status={r.bid.status} kind="bid" />
          {r.bid.status === 'rejected' && r.bid.rejection_reason && <p className="mt-1 max-w-xs truncate text-xs text-muted" title={r.bid.rejection_reason}>{r.bid.rejection_reason}</p>}
        </div>
      ),
    },
    { key: 'truck', header: 'Truck', hideBelow: 'md', cell: r => <TruckCell window={r.window} trip={r.trip} />, sortValue: r => r.window.vehicles?.plate_number ?? '' },
    {
      key: 'load', header: 'Load created',
      cell: r => {
        const a = r.bid.awarded
        if (!a) return <span className="text-muted">None</span>
        return (
          <span className="flex flex-col gap-0.5 text-sm" onClick={e => e.stopPropagation()}>
            <Link to={`/shipments/${encodeURIComponent(a.shipment_id)}`} className={`${link} font-mono`}>{a.tracking_id ?? 'Shipment'}</Link>
            {a.route_id && <Link to={`/routes/${encodeURIComponent(a.route_id)}`} className={subLink}>View trip</Link>}
          </span>
        )
      },
    },
    { key: 'submitted', header: 'Submitted', hideBelow: 'lg', sortValue: r => new Date(r.bid.submitted_at ?? 0).getTime(), cell: r => <span className="text-sm text-muted">{formatRelative(r.bid.submitted_at, now)}</span> },
  ]

  const confirmationColumns: Column<DriverConfirmation>[] = [
    {
      key: 'vehicle', header: 'Truck', sortValue: c => c.vehicles?.plate_number ?? '',
      cell: c => (c.vehicles?.id
        ? <Link to={`/fleet/${encodeURIComponent(c.vehicles.id)}`} className={`${link} font-mono`}>{c.vehicles.plate_number ?? 'Truck'}</Link>
        : <span className="font-mono">{c.vehicles?.plate_number ?? 'Unknown'}</span>),
    },
    {
      key: 'stop', header: 'New stop',
      cell: c => (
        <span className="flex flex-col gap-0.5">
          <span>{c.route_stops?.delivery_points?.name ?? 'Stop details unavailable'}</span>
          {c.route_stops?.route_id && <Link to={`/routes/${encodeURIComponent(c.route_stops.route_id)}`} className={subLink}>View trip</Link>}
        </span>
      ),
    },
    { key: 'sent', header: 'Sent', hideBelow: 'md', sortValue: c => new Date(c.prompted_at).getTime(), cell: c => <span title={formatDateTime(c.prompted_at)}>{formatRelative(c.prompted_at, now)}</span> },
    { key: 'status', header: 'Status', sortValue: c => confirmationStatus(c).label, cell: c => {
        const s = confirmationStatus(c)
        const at = autoAcceptAt(c)
        return (
          <span className="flex flex-col items-start gap-0.5">
            <StatusPill tone={s.tone}>{s.label}</StatusPill>
            {at != null && <span className="text-xs text-muted">{at > now ? `Accepted for the driver at ${formatTime(at)} if no answer` : 'Being accepted for the driver'}</span>}
          </span>
        )
      } },
  ]

  return (
    <div className="space-y-8">
      <div className="flex justify-end">
        <ExportCsvButton
          name="bids"
          rows={[...waiting, ...decided].map(r => ({
            vendor: vendorName(r.bid),
            bid: r.bid.bid_amount,
            status: statusToLabel(r.bid.status, 'bid'),
            truck: r.window.vehicles?.plate_number ?? '',
            submitted: formatDateTime(r.bid.submitted_at),
          }))}
          columns={[
            { key: 'vendor', header: 'Vendor' }, { key: 'bid', header: 'Bid (₹)' }, { key: 'status', header: 'Status' },
            { key: 'truck', header: 'Truck' }, { key: 'submitted', header: 'Submitted' },
          ]}
        />
      </div>

      <section className="space-y-3">
        <SectionHeader title="Waiting for a decision" description="Approve one bid per truck. Select a bid to see the load and the fit." />
        <DataTable
          caption="Bids waiting for a decision"
          columns={waitingColumns}
          rows={waiting}
          rowKey={r => r.bid.id}
          loading={board.isLoading}
          error={error}
          onRetry={() => board.refetch()}
          onRowClick={r => onSelectBid(r.bid.id)}
          rowClassName={r => (focusWindowId === r.window.id ? 'bg-brand-soft' : undefined)}
          selectedKey={selectedBidId}
          empty={{ title: 'Nothing is waiting for you', description: 'Bids from vendors show up here as they come in, and when a return trip closes with bids to review.' }}
        />
      </section>

      <section className="space-y-3">
        <SectionHeader title="Decided" description="Bids that were approved, rejected, not selected or expired, and the shipment and trip an approval created." />
        <DataTable
          caption="Decided bids"
          columns={decidedColumns}
          rows={decided}
          rowKey={r => r.bid.id}
          loading={board.isLoading}
          error={error}
          onRowClick={r => onSelectBid(r.bid.id)}
          selectedKey={selectedBidId}
          pageSize={10}
          empty={{ title: 'No decided bids yet', description: 'They appear here once you approve or reject a bid.' }}
        />
      </section>

      <section className="space-y-3">
        <SectionHeader
          title="Driver confirmations"
          description="When a bid is approved, the driver is asked to accept the new stops. If they decline, the award is cancelled and the return trip opens again; if they do not answer it is accepted for them, 2 minutes after they see it or 15 minutes after it was sent if their phone is offline. The time is shown on each row."
        />
        <DataTable
          caption="Driver confirmations for approved bids"
          columns={confirmationColumns}
          rows={confirmations.data ?? []}
          rowKey={c => c.id}
          loading={confirmations.isLoading}
          error={confirmations.error ? 'We could not load driver confirmations. Try again.' : undefined}
          onRetry={() => confirmations.refetch()}
          pageSize={10}
          empty={{ title: 'No confirmations yet', description: 'They appear here after a bid is approved.' }}
        />
      </section>

      <BidDrawer
        row={selected}
        busy={busy}
        onClose={() => onSelectBid(null)}
        onApprove={() => selected && askApprove(selected)}
        onReject={() => selected && askReject(selected)}
        onSetLocation={() => selected && setMissing({ vendorId: selected.bid.vendor_id, vendorName: vendorName(selected.bid), bidId: selected.bid.id, vendorAsked: false })}
      />
      <VendorLocationModal missing={missing} onClose={() => setMissing(null)} onApprove={id => approve.mutate(id)} />
    </div>
  )
}

function BidDrawer({ row, busy, onClose, onApprove, onReject, onSetLocation }: {
  row: Row | null
  busy: Busy
  onClose: () => void
  onApprove: () => void
  onReject: () => void
  onSetLocation: () => void
}) {
  const bid = row?.bid
  const win = row?.window
  const vehicle = win?.vehicles
  const actionable = !!row && !win?.winning_bid_id && bid?.status === 'pending' && row.state !== 'cancelled'

  const floor = win?.floor_price != null ? Number(win.floor_price) : null
  const difference = bid && floor != null ? Number(bid.bid_amount) - floor : null
  const f = row && bid && win ? fit(bid, win) : null
  const awarded = bid?.awarded

  return (
    <Drawer
      open={!!row}
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
      {row && bid && win && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={bid.status} kind="bid" />
            <span className="text-sm text-muted">Return trip: {statusToLabel(row.state, 'window').toLowerCase()}</span>
          </div>

          {actionable && f?.fits === false && (
            <Alert tone="warning" title="Heavier than the free space">
              This load is {formatKg(bid.weight_kg)} but the truck has {formatKg(vehicle?.available_capacity_kg)} free right now.
            </Alert>
          )}

          {actionable && bid.vendor && !bid.vendor.has_location && (
            <Alert
              tone="warning"
              title="No pickup location"
              action={<Button size="sm" variant="secondary" icon={<MapPinOff size={14} />} onClick={onSetLocation}>Set location</Button>}
            >
              The truck can’t be routed to this vendor until they add one. If you know where they load from, you can set it for them.
            </Alert>
          )}

          {bid.status === 'rejected' && bid.rejection_reason && <Alert tone="danger" title="Rejected">{bid.rejection_reason}</Alert>}

          <DetailList
            items={[
              { label: 'Vendor', value: <Link to={`/admin/users/${encodeURIComponent(bid.vendor_id)}`} className={link}>{vendorName(bid)}</Link> },
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
                label: 'Truck space',
                value: (
                  <span className="tabular">
                    {formatKg(vehicle?.available_capacity_kg)} free now
                    {vehicle?.capacity_kg != null && <span className="block text-xs text-muted">of {formatKg(vehicle.capacity_kg)} total</span>}
                  </span>
                ),
              },
              {
                label: 'Drop-off',
                value: bid.delivery_points
                  ? <>{bid.delivery_points.name}{stripLeadingName(bid.delivery_points.name, bid.delivery_points.address) && <span className="block text-xs text-muted">{stripLeadingName(bid.delivery_points.name, bid.delivery_points.address)}</span>}</>
                  : 'Not given',
              },
              { label: 'E-way bill', value: bid.eway_bill_ref ? <span className="font-mono">{bid.eway_bill_ref}</span> : 'Not provided' },
              { label: 'Load type', value: bid.load_configuration || 'Not given' },
              { label: 'Submitted', value: formatDateTime(bid.submitted_at) },
              {
                label: 'Truck',
                value: vehicle?.id
                  ? <Link to={`/fleet/${encodeURIComponent(vehicle.id)}`} className={`${link} font-mono`}>{vehicle.plate_number ?? 'Truck'}</Link>
                  : 'Not found',
              },
              {
                label: 'Trip',
                value: row.trip ? <Link to={`/routes/${encodeURIComponent(row.trip.id)}`} className={link}>View trip</Link> : 'No trip planned',
              },
              { label: 'Return trip closes', value: formatDateTime(win.closes_at) },
              ...(awarded ? [
                { label: 'Shipment created', value: <Link to={`/shipments/${encodeURIComponent(awarded.shipment_id)}`} className={`${link} font-mono`}>{awarded.tracking_id ?? 'Shipment'}</Link> },
                ...(awarded.route_id ? [{ label: 'Added to trip', value: <Link to={`/routes/${encodeURIComponent(awarded.route_id)}`} className={link}>View trip</Link> }] : []),
              ] : []),
            ]}
          />

          {!actionable && bid.status === 'pending' && win.winning_bid_id && (
            <p className="text-sm text-muted">Another bid has already been approved for this truck.</p>
          )}
        </div>
      )}
    </Drawer>
  )
}
