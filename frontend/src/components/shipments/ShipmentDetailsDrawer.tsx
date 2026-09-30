import { Link } from 'react-router-dom'
import { ExternalLink, FileText, Pencil, Trash2 } from 'lucide-react'
import { Button, Drawer, StatusPill, buttonClasses, humanize } from '@/components/ui'
import { priorityTone, shipmentStatusLabel } from './format'
import { shipmentFlags } from './rules'
import { ShipmentDetailSections, ShipmentRecordSections } from './ShipmentSections'
import { useDeleteShipment } from './useDeleteShipment'
import type { ShipmentRow } from './types'

/** A quick look at one shipment, with the actions that apply to it. The full page is /shipments/:id. */
export default function ShipmentDetailsDrawer({ shipment, onClose, onEdit, onAssign }: {
  shipment: ShipmentRow | null
  onClose: () => void
  onEdit: (s: ShipmentRow) => void
  onAssign: (s: ShipmentRow) => void
}) {
  const del = useDeleteShipment(shipment, onClose)

  if (!shipment) return null

  const s = shipment
  const f = shipmentFlags(s)

  const pageLink = (
    <Link to={`/shipments/${encodeURIComponent(s.id)}`} className={buttonClasses({ variant: f.manifestOnly ? 'primary' : 'secondary' })}>
      <ExternalLink size={16} aria-hidden="true" /> Open full page
    </Link>
  )
  const manifestLink = (
    <Link to={`/shipments/${s.id}/manifest`} className={buttonClasses({ variant: 'secondary' })}>
      <FileText size={16} aria-hidden="true" /> Open manifest
    </Link>
  )

  return (
    <Drawer
      open
      size="full"
      onClose={onClose}
      title={<span className="font-mono">{s.tracking_id}</span>}
      description={
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={s.status} kind="cargo">{shipmentStatusLabel(s.status)}</StatusPill>
          {f.master && <StatusPill tone="brand" dot={false}>Split into lots</StatusPill>}
          {f.lot && s.lot_label && <StatusPill tone="brand" dot={false}>Lot {s.lot_label}</StatusPill>}
          {s.priority && <StatusPill tone={priorityTone[s.priority] ?? 'neutral'} dot={false}>{humanize(s.priority)} priority</StatusPill>}
        </div>
      }
      footer={f.manifestOnly ? (
        <>
          {manifestLink}
          {pageLink}
        </>
      ) : (
        <>
          {f.canDelete && (
            <Button variant="danger" icon={<Trash2 size={16} />} onClick={del.remove} loading={del.isPending} className="sm:mr-auto">
              Delete
            </Button>
          )}
          <Button variant="secondary" icon={<Pencil size={16} />} onClick={() => onEdit(s)}>Edit</Button>
          {manifestLink}
          {pageLink}
        </>
      )}
    >
      <div className="space-y-6">
        <ShipmentDetailSections shipment={s} onAssign={onAssign} />
        <ShipmentRecordSections key={s.id} shipment={s} />
      </div>
    </Drawer>
  )
}
