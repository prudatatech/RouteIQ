import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { PackageOpen } from 'lucide-react'
import { Card, CardHeader, EmptyState, ErrorState, Skeleton, StatusPill } from '@/components/ui'
import { formatKg, formatPieces, pluralize } from '@/utils/display'
import type { OnBoardItem } from '@/services/cargo'
import { onBoardTotals, useOnBoard } from './useOnBoard'
import { ConsignmentLink } from './CargoBits'
import { exceptionTypeLabel } from './logic'

/** One line per consignment on the vehicle: code, status, pieces, weight, next stop and open cases. */
export function OnBoardList({ items, compact, className }: { items: OnBoardItem[]; compact?: boolean; className?: string }) {
  return (
    <ul className={clsx('divide-y divide-border', className)}>
      {items.map(item => {
        const key = item.shipment_id ?? item.manifest_id ?? item.tracking_id ?? ''
        return (
          <li key={key} className={clsx('flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4', compact ? 'py-2' : 'py-3')}>
            <div className="min-w-0 space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <ConsignmentLink c={item} />
                {item.status && <StatusPill status={item.status} kind="cargo" />}
              </div>
              {!compact && item.next_stop && (item.next_stop.name || item.next_stop.address) && (
                <p className="text-xs text-muted">
                  {item.rto ? 'Going back to' : 'Next stop'} {item.next_stop.name || item.next_stop.address}
                </p>
              )}
              {!compact && item.on_hold_reason && item.status === 'on_hold' && <p className="text-xs text-warning">On hold: {item.on_hold_reason}</p>}
              {(item.open_exceptions?.length ?? 0) > 0 && (
                <p className="flex flex-wrap gap-1.5 pt-0.5">
                  {item.open_exceptions!.map(x => (
                    <Link key={x.id} to={`/cargo/exceptions/${x.id}`} className="text-xs font-medium text-danger hover:underline">
                      {x.code}: {exceptionTypeLabel(x.type)}
                    </Link>
                  ))}
                </p>
              )}
            </div>
            <div className="shrink-0 text-sm tabular text-text sm:text-right">
              {item.pieces_total != null && item.pieces_total !== item.pieces_on_board
                ? `${item.pieces_on_board.toLocaleString('en-IN')} of ${formatPieces(item.pieces_total)}`
                : formatPieces(item.pieces_on_board)}
              <span className="text-muted"> · {formatKg(item.weight_kg)}</span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** "Cargo on board" card for a vehicle, with loading, empty and error states. */
export function OnBoardCard({ vehicleId, className, description }: { vehicleId: string; className?: string; description?: string }) {
  const q = useOnBoard(vehicleId, { refetchInterval: 60_000 })
  const items = q.data?.items ?? []
  const totals = onBoardTotals(items)
  return (
    <Card className={className}>
      <CardHeader
        title="Cargo on board"
        description={description ?? (items.length > 0
          ? `${pluralize(totals.consignments, 'shipment')}, ${formatPieces(totals.pieces)}, ${formatKg(totals.weightKg)}`
          : 'Goods the vehicle is holding right now')}
      />
      <div className="px-4 sm:px-6">
        {q.isLoading ? (
          <div className="space-y-2 py-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
        ) : q.isError ? (
          <ErrorState compact title="We could not load the cargo on board" onRetry={() => q.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState compact icon={<PackageOpen size={22} />} title="Nothing on board" description="Shipments picked up by this vehicle appear here until they are delivered or handed over." />
        ) : (
          <OnBoardList items={items} />
        )}
      </div>
    </Card>
  )
}
