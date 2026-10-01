import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles, Truck } from 'lucide-react'
import {
  BulkActionBar, Button, DataTable, SearchInput, StatusPill, humanize, useRowSelection, type Column,
} from '@/components/ui'
import AssignVehicleModal from '@/components/shipments/AssignVehicleModal'
import { destinationOf, deliveryPointsOf, pickupDateOf, pickupPlace, priorityTone, shipmentStatusLabel } from '@/components/shipments/format'
import type { ShipmentRow } from '@/components/shipments/types'
import { formatDate, formatKg } from '@/utils/display'
import PlaceText from '@/components/shipments/PlaceText'
import { byUrgency, canPickVehicle } from './logic'
import { EWAY_BILL_WARNING } from '@/config/compliance'
import { missingEwayBill } from '@/components/shipments/masterView'

const Place = ({ name, address }: { name?: string | null; address?: string | null }) => (
  <PlaceText name={name} address={address} truncate className="max-w-56" />
)

/**
 * Shipments and lots that are accepted and have no trip. Each row assigns a vehicle in the shared
 * assign screen; a selection goes to the optimizer together.
 */
export default function NeedsVehicleTab({ rows, loading, error, onRetry, onOptimize }: {
  rows: ShipmentRow[]
  loading: boolean
  error: boolean
  onRetry: () => void
  /** Called with the selected shipment ids: opens them in the Optimize tab. */
  onOptimize: (ids: string[]) => void
}) {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [assigning, setAssigning] = useState<ShipmentRow | null>(null)

  const q = search.trim().toLowerCase()
  const visible = useMemo(() => {
    const list = q
      ? rows.filter(s => {
        const dest = destinationOf(s)
        return [s.tracking_id, s.origin_name, s.origin_address, dest?.name, dest?.address, s.consignee_name, s.master_tracking_id]
          .some(v => v?.toLowerCase().includes(q))
      })
      : rows
    return [...list].sort((a, b) => byUrgency(a, b, pickupDateOf))
  }, [rows, q])

  const selection = useRowSelection(visible, s => s.id)

  const columns: Column<ShipmentRow>[] = [
    {
      key: 'shipment',
      header: 'Shipment',
      cell: s => (
        <div className="whitespace-nowrap">
          <div className="font-mono font-medium">{s.tracking_id}</div>
          {(s.parent_shipment_id || s.lot_label) && (
            <div className="text-xs text-muted">Lot {s.lot_label ?? ''}{s.master_tracking_id ? ` of ${s.master_tracking_id}` : ''}</div>
          )}
          {pickupDateOf(s)
            ? <div className="text-xs text-muted">Pickup {formatDate(pickupDateOf(s))}</div>
            : s.created_at && <div className="text-xs text-muted">Created {formatDate(s.created_at)}</div>}
        </div>
      ),
    },
    {
      key: 'priority',
      header: 'Status',
      cell: s => (
        <div className="flex flex-col items-end gap-1 md:items-start">
          <StatusPill status={s.status} kind="cargo">{shipmentStatusLabel(s.status)}</StatusPill>
          {s.priority && (s.priority === 'high' || s.priority === 'critical') && (
            <StatusPill tone={priorityTone[s.priority] ?? 'neutral'} dot={false}>{humanize(s.priority)} priority</StatusPill>
          )}
          {!canPickVehicle(s) && <StatusPill tone="warning" dot={false}>Open to bids</StatusPill>}
          {missingEwayBill(s) && <StatusPill tone="warning" dot={false}>{EWAY_BILL_WARNING}</StatusPill>}
        </div>
      ),
    },
    { key: 'pickup', header: 'Pickup', cell: s => <Place {...pickupPlace(s)} />, hideBelow: 'md' },
    {
      key: 'destination',
      header: 'Destination',
      cell: s => {
        const dest = destinationOf(s)
        const extra = deliveryPointsOf(s).length - 1
        return (
          <div className="min-w-0">
            <Place name={dest?.name} address={dest?.address} />
            {extra > 0 && <div className="text-xs text-muted">+{extra.toLocaleString('en-IN')} more {extra === 1 ? 'stop' : 'stops'}</div>}
          </div>
        )
      },
    },
    {
      key: 'load',
      header: 'Load',
      align: 'right',
      hideBelow: 'lg',
      cell: s => (
        <div className="whitespace-nowrap tabular">
          <div>{formatKg(s.total_weight_kg) ?? '—'}</div>
          {s.total_items != null && <div className="text-xs text-muted">{s.total_items.toLocaleString('en-IN')} {s.total_items === 1 ? 'item' : 'items'}</div>}
        </div>
      ),
    },
    {
      key: 'action',
      header: <span className="sr-only">Action</span>,
      align: 'right',
      cell: s => (
        // Keep button clicks and key presses from opening the row
        <div className="flex justify-end" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
          {canPickVehicle(s) && (
            <Button size="sm" icon={<Truck size={14} />} onClick={() => setAssigning(s)} aria-label={`Assign vehicle to ${s.tracking_id}`}>
              Assign vehicle
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <SearchInput value={search} onChange={setSearch} label="Search shipments that need a vehicle" placeholder="Search by tracking ID, place or consignee" className="max-w-md" />
      <DataTable
        caption="Shipments that need a vehicle"
        columns={columns}
        rows={visible}
        rowKey={s => s.id}
        loading={loading}
        error={error ? 'We could not load shipments. Check your connection and try again.' : undefined}
        onRetry={onRetry}
        onRowClick={s => navigate(`/shipments/${s.id}`)}
        selection={{
          selectedKeys: selection.selectedKeys,
          onToggleRow: key => selection.toggleRow(key),
          onToggleAll: selection.toggleAll,
          isRowSelectable: canPickVehicle,
        }}
        empty={q
          ? { title: 'No shipments match', description: 'Try another search.', action: <Button variant="secondary" onClick={() => setSearch('')}>Clear search</Button> }
          : { title: 'Every shipment has a trip', description: 'Accepted shipments and lots that still need a vehicle show up here.' }}
      />
      <BulkActionBar count={selection.count} onClear={selection.clear}>
        <Button icon={<Sparkles size={16} />} onClick={() => onOptimize(selection.selectedRows.map(s => s.id))}>
          Optimize these
        </Button>
      </BulkActionBar>
      <AssignVehicleModal shipment={assigning} onClose={() => setAssigning(null)} />
    </div>
  )
}
