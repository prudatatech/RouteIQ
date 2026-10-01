import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Plus } from 'lucide-react'
import { capacityAPI } from '@/services/api'
import {
  Button, DataTable, SectionHeader, StatusPill, humanize, useConfirm, statusToLabel, type Column,
} from '@/components/ui'
import { errorMessage, formatDateTime, formatKg, formatRupees } from '@/utils/display'
import {
  laneText, returnTripKeys, timeLeft, triggerLabel, vendorName, windowState,
  type Bid, type Board, type CapacityWindow, type Trip, type WindowState,
} from './data'

interface Row {
  window: CapacityWindow
  bids: Bid[]
  state: WindowState
  trip: Trip | null
  /** The bid that won, for an awarded return trip. */
  winner: Bid | null
}

const link = 'font-medium text-text underline decoration-border underline-offset-2 hover:decoration-text'

/** Where a return trip's truck, trip and (once awarded) load can be opened from. */
function TruckCell({ row }: { row: Row }) {
  const v = row.window.vehicles
  return (
    <div className="min-w-0">
      {v?.id
        ? <Link to={`/fleet/${encodeURIComponent(v.id)}`} className={`${link} font-mono`}>{v.plate_number ?? 'Truck'}</Link>
        : <span className="font-mono">Vehicle not found</span>}
      <p className="text-xs text-muted">{[v?.vehicle_type ? humanize(v.vehicle_type) : null, row.window.trigger_type ? triggerLabel[row.window.trigger_type] ?? row.window.trigger_type : null].filter(Boolean).join(' · ')}</p>
    </div>
  )
}

function LaneCell({ row }: { row: Row }) {
  const lane = laneText(row.window.vehicles, row.trip)
  return (
    <div className="min-w-0">
      <p className="text-sm text-text">{lane ?? <span className="text-muted">Location not known</span>}</p>
      {row.trip && <Link to={`/routes/${encodeURIComponent(row.trip.id)}`} className="text-xs text-muted underline decoration-border underline-offset-2 hover:text-text">View trip</Link>}
    </div>
  )
}

/** Open return trips (spare truck space vendors can bid on now), then the ones that ended and how they ended. */
export default function OpenReturnTripsTab({ board, now, focusWindowId, onOpenReturnTrip, onSeeBids }: {
  board: UseQueryResult<Board>
  now: number
  /** A return trip to highlight, from a link. */
  focusWindowId: string | null
  onOpenReturnTrip: () => void
  /** Goes to Bids to decide, on the given return trip. */
  onSeeBids: (windowId: string) => void
}) {
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()

  const rows = useMemo<Row[]>(() => {
    const byWindow = new Map<string, Bid[]>()
    for (const b of board.data?.bids ?? []) byWindow.set(b.window_id, [...(byWindow.get(b.window_id) ?? []), b])
    return (board.data?.windows ?? []).map(w => {
      const bids = byWindow.get(w.id) ?? []
      return {
        window: w,
        bids,
        state: windowState(w, bids, now),
        trip: board.data?.trips[w.vehicle_id] ?? null,
        winner: bids.find(b => b.id === w.winning_bid_id) ?? null,
      }
    })
  }, [board.data, now])

  const open = rows
    .filter(r => r.state === 'open' || r.state === 'upcoming')
    .sort((a, b) => new Date(a.window.closes_at).getTime() - new Date(b.window.closes_at).getTime())
  const ended = rows
    .filter(r => r.state !== 'open' && r.state !== 'upcoming')
    .sort((a, b) => new Date(b.window.closes_at).getTime() - new Date(a.window.closes_at).getTime())

  const end = useMutation({
    mutationFn: ({ id, mode }: { id: string; mode: 'close' | 'cancel' }) =>
      mode === 'close' ? capacityAPI.closeWindow(id) : capacityAPI.cancelWindow(id),
    onSuccess: (_d, { mode }) => toast.success(mode === 'close' ? 'Return trip closed. Vendors can no longer bid.' : 'Return trip cancelled. Waiting bids were turned down.'),
    onError: err => toast.error(errorMessage(err, 'We could not change this return trip. Try again.')),
    onSettled: () => queryClient.invalidateQueries({ queryKey: returnTripKeys.board }),
  })
  const endingId = end.isPending ? end.variables?.id ?? null : null

  const askEnd = async (row: Row, mode: 'close' | 'cancel') => {
    const plate = row.window.vehicles?.plate_number ?? 'this truck'
    const waiting = row.bids.filter(b => b.status === 'pending').length
    const waitingText = waiting === 0
      ? 'No bids have been placed.'
      : mode === 'close'
        ? `The ${waiting === 1 ? 'bid' : `${waiting} bids`} already placed will wait for your decision.`
        : `The ${waiting === 1 ? 'bid' : `${waiting} bids`} already placed will be rejected and the vendors told.`
    const ok = await confirm({
      title: mode === 'close' ? 'Close this return trip now?' : 'Cancel this return trip?',
      message: `Vendors will not be able to bid any more on ${plate}. ${waitingText}`,
      confirmLabel: mode === 'close' ? 'Close return trip' : 'Cancel return trip',
      tone: mode === 'cancel' ? 'danger' : undefined,
    })
    if (ok) end.mutate({ id: row.window.id, mode })
  }

  const bidsCell = (row: Row) => {
    const pending = row.bids.filter(b => b.status === 'pending').length
    if (row.bids.length === 0) return <span className="text-muted">None yet</span>
    return (
      <button type="button" onClick={() => onSeeBids(row.window.id)} className={`${link} tabular text-left`}>
        {row.bids.length.toLocaleString('en-IN')} {row.bids.length === 1 ? 'bid' : 'bids'}
        {pending > 0 && <span className="block text-xs font-normal text-muted no-underline">{pending} to decide</span>}
      </button>
    )
  }

  const openColumns: Column<Row>[] = [
    { key: 'truck', header: 'Truck', cell: r => <TruckCell row={r} />, sortValue: r => r.window.vehicles?.plate_number ?? '' },
    { key: 'lane', header: 'Lane', cell: r => <LaneCell row={r} />, sortValue: r => laneText(r.window.vehicles, r.trip) ?? '' },
    {
      key: 'space', header: 'Space left', align: 'right', sortValue: r => r.window.vehicles?.available_capacity_kg ?? null,
      cell: r => (
        <span className="tabular">
          {formatKg(r.window.vehicles?.available_capacity_kg)}
          {r.window.vehicles?.capacity_kg != null && <span className="block text-xs text-muted">of {formatKg(r.window.vehicles.capacity_kg)}</span>}
        </span>
      ),
    },
    {
      key: 'floor', header: 'Minimum bid', align: 'right', hideBelow: 'lg', sortValue: r => r.window.floor_price,
      cell: r => (r.window.floor_price != null ? <span className="tabular">{formatRupees(r.window.floor_price)}</span> : <span className="text-muted">Set per load</span>),
    },
    {
      key: 'closes', header: 'Closes in', sortValue: r => new Date(r.window.closes_at).getTime(),
      cell: r => (r.state === 'upcoming'
        ? <span className="text-muted">Opens in {timeLeft(r.window.opens_at, now) ?? 'a moment'}</span>
        : <span className="tabular" title={formatDateTime(r.window.closes_at)}>{timeLeft(r.window.closes_at, now) ?? 'Closing'}</span>),
    },
    { key: 'bids', header: 'Bids received', cell: bidsCell, sortValue: r => r.bids.length },
    { key: 'state', header: 'Status', hideBelow: 'md', cell: r => <StatusPill status={r.state} kind="window" /> },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right',
      cell: r => (
        <span className="inline-flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="secondary" disabled={endingId !== null} onClick={() => askEnd(r, 'cancel')}>Cancel</Button>
          <Button size="sm" variant="secondary" loading={endingId === r.window.id} disabled={endingId !== null} onClick={() => askEnd(r, 'close')}>Close now</Button>
        </span>
      ),
    },
  ]

  const outcome = (r: Row) => {
    if (r.state === 'awarded') return r.winner ? `Awarded to ${vendorName(r.winner)}` : 'Awarded'
    if (r.state === 'cancelled') return 'Cancelled'
    if (r.state === 'decide') return 'Bids waiting for a decision'
    return r.bids.length === 0 ? 'Closed with no bids' : 'Closed without a winner'
  }

  const endedColumns: Column<Row>[] = [
    { key: 'truck', header: 'Truck', cell: r => <TruckCell row={r} />, sortValue: r => r.window.vehicles?.plate_number ?? '' },
    { key: 'lane', header: 'Lane', hideBelow: 'md', cell: r => <LaneCell row={r} /> },
    { key: 'ended', header: 'Ended', hideBelow: 'lg', sortValue: r => new Date(r.window.closes_at).getTime(), cell: r => formatDateTime(r.window.closes_at) },
    {
      key: 'outcome', header: 'Outcome', sortValue: r => statusToLabel(r.state, 'window'),
      cell: r => (
        <div className="min-w-0">
          <StatusPill status={r.state} kind="window" />
          <p className="mt-1 text-xs text-muted">{outcome(r)}</p>
        </div>
      ),
    },
    {
      key: 'load', header: 'Load created',
      cell: r => {
        const a = r.winner?.awarded
        if (!a) return r.state === 'decide' ? <button type="button" onClick={() => onSeeBids(r.window.id)} className={`${link} text-left`}>Decide bids</button> : <span className="text-muted">None</span>
        return (
          <span className="flex flex-col gap-0.5 text-sm">
            <Link to={`/shipments/${encodeURIComponent(a.shipment_id)}`} className={`${link} font-mono`}>{a.tracking_id ?? 'Shipment'}</Link>
            {a.route_id && <Link to={`/routes/${encodeURIComponent(a.route_id)}`} className="text-xs text-muted underline decoration-border underline-offset-2 hover:text-text">View trip</Link>}
          </span>
        )
      },
    },
  ]

  const error = board.error ? 'We could not load return trips. Check your connection and try again.' : undefined

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <SectionHeader title="Open now" description="Spare space vendors can bid on. Close a return trip early, or cancel it to turn its bids down." />
        <DataTable
          caption="Open return trips"
          columns={openColumns}
          rows={open}
          rowKey={r => r.window.id}
          loading={board.isLoading}
          error={error}
          onRetry={() => board.refetch()}
          selectedKey={focusWindowId}
          initialSort={{ key: 'closes', direction: 'asc' }}
          empty={{
            title: 'No return trips are open',
            description: 'Open one when a truck has spare space, or wait for a driver to offer it.',
            action: <Button icon={<Plus size={16} />} onClick={onOpenReturnTrip}>Open a return trip</Button>,
          }}
        />
      </section>

      <section className="space-y-3">
        <SectionHeader title="Ended" description="Return trips that were awarded, closed or cancelled, and the load each award created." />
        <DataTable
          caption="Ended return trips"
          columns={endedColumns}
          rows={ended}
          rowKey={r => r.window.id}
          loading={board.isLoading}
          error={error}
          selectedKey={focusWindowId}
          pageSize={10}
          initialSort={{ key: 'ended', direction: 'desc' }}
          empty={{ title: 'Nothing has ended yet', description: 'Awarded, closed and cancelled return trips are listed here.' }}
        />
      </section>
    </div>
  )
}
