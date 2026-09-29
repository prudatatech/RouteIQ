import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ExternalLink, FileText, MapPin, Pencil, Trash2, Truck } from 'lucide-react'
import {
  Alert, Button, DetailList, Drawer, StatusPill, buttonClasses, humanize, statusToLabel, useConfirm,
} from '@/components/ui'
import InlineTrackingMap from '@/components/map/InlineTrackingMap'
import { shipmentsAPI } from '@/services/api'
import {
  apiErrorMessage, deliveryPointsOf, destinationOf, formatDateTime, formatKg, formatRupees, isCargoManifest, plateOf, priorityTone,
} from './format'
import type { ShipmentRow } from './types'

const FORWARD_STATUSES = ['picked_up', 'in_transit', 'delivered'] as const
const statusAction: Record<(typeof FORWARD_STATUSES)[number], string> = {
  picked_up: 'Mark picked up',
  in_transit: 'Mark in transit',
  delivered: 'Mark delivered',
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-text">{title}</h3>
      {children}
    </section>
  )
}

/** Everything about one shipment, with the actions that apply to it. */
export default function ShipmentDetailsDrawer({ shipment, onClose, onEdit, onAssign }: {
  shipment: ShipmentRow | null
  onClose: () => void
  onEdit: (s: ShipmentRow) => void
  onAssign: (s: ShipmentRow) => void
}) {
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const [showMap, setShowMap] = useState(false)

  useEffect(() => { setShowMap(false) }, [shipment?.id])

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => shipmentsAPI.updateStatus(id, status),
    onSuccess: (_data, { status }) => {
      queryClient.invalidateQueries({ queryKey: ['shipments'] })
      toast.success(`Status changed to ${statusToLabel(status).toLowerCase()}`)
    },
    onError: (error: unknown) => toast.error(apiErrorMessage(error, 'We could not change the status. Try again.')),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => shipmentsAPI.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipments'] })
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      queryClient.invalidateQueries({ queryKey: ['fleet-summary'] })
      toast.success('Shipment deleted')
      onClose()
    },
    onError: (error: unknown) => toast.error(apiErrorMessage(error, 'We could not delete the shipment. Try again.')),
  })

  if (!shipment) return null

  const s = shipment
  const manifestOnly = isCargoManifest(s)
  const destination = destinationOf(s)
  const stops = deliveryPointsOf(s).length
  const plate = plateOf(s)
  const closed = s.status === 'delivered' || s.status === 'cancelled'
  const bid = s.capacity_bids
  const signatureIsImage = s.signature_data?.startsWith('data:image')

  const remove = async () => {
    const ok = await confirm({
      title: `Delete shipment ${s.tracking_id}?`,
      message: 'The shipment, its stops and its history are removed. This cannot be undone.',
      confirmLabel: 'Delete shipment',
      tone: 'danger',
    })
    if (ok) deleteMutation.mutate(s.id)
  }

  const cancelShipment = async () => {
    const ok = await confirm({
      title: `Cancel shipment ${s.tracking_id}?`,
      message: 'The shipment is marked as cancelled. You can still see it under Cancelled.',
      confirmLabel: 'Cancel shipment',
      cancelLabel: 'Keep shipment',
      tone: 'danger',
    })
    if (ok) statusMutation.mutate({ id: s.id, status: 'cancelled' })
  }

  const manifestLink = (
    <Link to={`/shipments/${s.id}/manifest`} className={buttonClasses({ variant: 'secondary' })}>
      <FileText size={16} aria-hidden="true" /> Open manifest
    </Link>
  )

  return (
    <Drawer
      open
      onClose={onClose}
      title={<span className="font-mono">{s.tracking_id}</span>}
      description={
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={s.status} />
          {s.priority && <StatusPill tone={priorityTone[s.priority] ?? 'neutral'} dot={false}>{humanize(s.priority)} priority</StatusPill>}
        </div>
      }
      footer={manifestOnly ? manifestLink : (
        <>
          <Button variant="danger" icon={<Trash2 size={16} />} onClick={remove} loading={deleteMutation.isPending} className="sm:mr-auto">
            Delete
          </Button>
          <Button variant="secondary" icon={<Pencil size={16} />} onClick={() => onEdit(s)}>Edit</Button>
          {manifestLink}
        </>
      )}
    >
      <div className="space-y-6">
        {manifestOnly && (
          <Alert tone="info" title="Booked through a vendor bid">
            This load comes from a cargo manifest. Its status and vehicle are managed from Bids.
          </Alert>
        )}

        <Section title="Route">
          <DetailList
            columns={1}
            items={[
              { label: 'Pickup', value: s.origin_name || s.origin_address ? <PlaceText name={s.origin_name} address={s.origin_address} /> : null },
              { label: 'Destination', value: destination ? <PlaceText name={destination.name} address={destination.address} /> : null },
              ...(stops > 1 ? [{ label: 'Stops', value: `${stops.toLocaleString('en-IN')} drops, including the destination` }] : []),
            ]}
          />
        </Section>

        <Section title="Cargo and vehicle">
          <DetailList
            items={[
              { label: 'Items', value: s.total_items != null ? s.total_items.toLocaleString('en-IN') : null },
              { label: 'Weight', value: formatKg(s.total_weight_kg) },
              { label: 'Vehicle', value: plate ? <span className="font-mono">{plate}</span> : (s.vehicle_id ? 'Assigned' : 'Not assigned') },
              { label: 'Driver', value: s.driver_name },
              { label: 'Created', value: formatDateTime(s.created_at) },
            ]}
          />
          {!manifestOnly && !s.vehicle_id && !closed && (
            <Button variant="secondary" icon={<Truck size={16} />} onClick={() => onAssign(s)}>Assign vehicle</Button>
          )}
        </Section>

        {bid && (
          <Section title={bid.capacity_windows?.trigger_type === 'end_of_route' ? 'Vendor backhaul bid' : 'Vendor bid'}>
            <DetailList
              items={[
                { label: 'Vendor', value: bid.vendor_profiles?.company_name },
                { label: 'Bid amount', value: formatRupees(bid.bid_amount) },
                { label: 'E-way bill', value: bid.eway_bill_ref ? <span className="font-mono">{bid.eway_bill_ref}</span> : null },
                { label: 'Load', value: bid.load_configuration },
              ]}
            />
          </Section>
        )}

        {!manifestOnly && !closed && (
          <Section title="Update status">
            <div className="flex flex-wrap gap-2">
              {FORWARD_STATUSES.filter(st => st !== s.status).map(st => (
                <Button
                  key={st}
                  variant="secondary"
                  size="sm"
                  disabled={statusMutation.isPending}
                  loading={statusMutation.isPending && statusMutation.variables?.status === st}
                  onClick={() => statusMutation.mutate({ id: s.id, status: st })}
                >
                  {statusAction[st]}
                </Button>
              ))}
              <Button variant="ghost" size="sm" disabled={statusMutation.isPending} onClick={cancelShipment}>
                Cancel shipment
              </Button>
            </div>
          </Section>
        )}

        {(s.received_by || s.signature_data) && (
          <Section title="Proof of delivery">
            <DetailList
              columns={1}
              items={[
                { label: 'Received by', value: s.received_by },
                {
                  label: 'Signature',
                  value: s.signature_data
                    ? (signatureIsImage
                      ? <img src={s.signature_data} alt={`Signature of ${s.received_by || 'the receiver'}`} className="h-24 max-w-full rounded-control border border-border bg-surface" />
                      : s.signature_data)
                    : null,
                },
              ]}
            />
          </Section>
        )}

        {!manifestOnly && (
          <Section title="Live location">
            <div className="flex flex-wrap gap-2">
              {s.vehicle_id && (
                <Button variant="secondary" size="sm" icon={<MapPin size={16} />} onClick={() => setShowMap(v => !v)} aria-expanded={showMap}>
                  {showMap ? 'Hide map' : 'Show on map'}
                </Button>
              )}
              <Link to={`/track/${encodeURIComponent(s.tracking_id)}`} className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
                <ExternalLink size={16} aria-hidden="true" /> Open tracking page
              </Link>
            </div>
            {!s.vehicle_id && <p className="text-sm text-muted">Assign a vehicle to see where this shipment is.</p>}
            {showMap && <InlineTrackingMap trackingId={s.tracking_id} />}
          </Section>
        )}
      </div>
    </Drawer>
  )
}

function PlaceText({ name, address }: { name?: string | null; address?: string | null }) {
  return (
    <span>
      <span className="block">{name || address}</span>
      {name && address && address !== name && <span className="block text-xs text-muted">{address}</span>}
    </span>
  )
}
