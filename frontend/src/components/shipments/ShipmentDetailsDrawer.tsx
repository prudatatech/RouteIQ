import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ExternalLink, FileText, MapPin, Pencil, Trash2, Truck } from 'lucide-react'
import {
  Alert, Button, DetailList, Drawer, StatusPill, Timeline, buttonClasses, humanize, useConfirm,
} from '@/components/ui'
import { EscalationPanel } from '@/components/tpl/EscalationPanel'
import InlineTrackingMap from '@/components/map/InlineTrackingMap'
import { MapView } from '@/components/map'
import { shipmentsAPI } from '@/services/api'
import {
  apiErrorMessage, deliveryPointsOf, destinationOf, isBiddingOpen, isCargoManifest, pickupDateOf, plateOf, priorityTone, shipmentStatusLabel,
} from './format'
import DriverRating from './DriverRating'
import ParcelLabel from './ParcelLabel'
import MessagesPanel from '@/components/messages/MessagesPanel'
import type { ShipmentHistoryEvent, ShipmentRow } from './types'
import ConsignmentCargo from '@/components/cargo/ConsignmentCargo'
import { refOfShipmentRow } from '@/components/cargo/logic'
import { formatDate, formatDateTime, formatKg, formatRupees } from '@/utils/display'

/**
 * The only statuses the web still sets with PATCH /shipments/:id: back to `created` (off its
 * vehicle) and `cancelled`, both before pickup. Pickup, in transit, delivery and every later state
 * are custody events with counts and proof, recorded from the Cargo section of this drawer
 * (the backend refuses a raw PATCH to them: 409 with `use: 'cargo_custody'`).
 */
type PatchStatus = 'created' | 'cancelled'

/** Mirrors the backend rule in ShipmentService.deleteShipment: once a shipment
 * has moved, deleting it would erase real history. Cancel it instead. */
const UNDELETABLE_STATUSES = new Set([
  'picked_up', 'in_transit', 'delivered', 'out_for_delivery', 'at_hub', 'partially_delivered', 'on_hold', 'returning', 'returned', 'lost',
])

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
    mutationFn: ({ id, status }: { id: string; status: PatchStatus }) => shipmentsAPI.updateStatus(id, status),
    onSuccess: (_data, { id, status }) => {
      queryClient.invalidateQueries({ queryKey: ['shipments'] })
      queryClient.invalidateQueries({ queryKey: ['shipment-history', id] })
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      queryClient.invalidateQueries({ queryKey: ['fleet-summary'] })
      queryClient.invalidateQueries({ queryKey: ['cargo'] })
      toast.success(`Status changed to ${shipmentStatusLabel(status).toLowerCase()}`)
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

  const historyQuery = useQuery({
    queryKey: ['shipment-history', shipment?.id],
    queryFn: () => shipmentsAPI.history(shipment!.id) as Promise<{ events: ShipmentHistoryEvent[] }>,
    enabled: !!shipment && !isCargoManifest(shipment),
  })

  const hasProofFiles = !!(shipment?.photo_url || shipment?.signature_url)
  const proofQuery = useQuery({
    queryKey: ['shipment-proof', shipment?.id],
    queryFn: () => shipmentsAPI.proof(shipment!.id),
    enabled: !!shipment && hasProofFiles,
    // The signed links last 10 minutes
    staleTime: 5 * 60_000,
  })

  if (!shipment) return null

  const s = shipment
  const manifestOnly = isCargoManifest(s)
  const destination = destinationOf(s)
  const stops = deliveryPointsOf(s).length
  const plate = plateOf(s)
  const closed = ['delivered', 'cancelled', 'returned', 'lost'].includes(s.status ?? '')
  // Mirrors the backend rule (SHIPMENT_TRANSITIONS): cancelled only before pickup. Everything the
  // goods do after that (pickup, in transit, hubs, delivery, holds, returns) is a custody event or
  // a case action in the Cargo section, not a plain status change.
  const beforePickup = s.status === 'created' || s.status === 'assigned'
  const canCancel = beforePickup
  // A vehicle can be (re)assigned while the goods are still with the sender. Goods on a vehicle
  // (a failed delivery included) move by a transfer or a re-attempt; assignDriver refuses them.
  const withSender = !s.current_holder || s.current_holder === 'consignor'
  const canAssign = beforePickup || (s.status === 'exception' && withSender)
  const assignLabel = s.status === 'exception' ? 'Assign again' : s.status === 'assigned' ? 'Change vehicle' : 'Assign vehicle'
  const canDelete = !UNDELETABLE_STATUSES.has(s.status ?? '')
  const bid = s.capacity_bids
  const signatureIsImage = s.signature_data?.startsWith('data:image')
  const historyEvents = historyQuery.data?.events ?? []
  const deliveredEvent = historyEvents.find(e => e.status === 'delivered')

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

  const unassignShipment = async () => {
    const ok = await confirm({
      title: `Take ${s.tracking_id} off its vehicle?`,
      message: 'The shipment goes back to created, its stop leaves the route and the driver is told. You can assign it again.',
      confirmLabel: 'Take off vehicle',
    })
    if (ok) statusMutation.mutate({ id: s.id, status: 'created' })
  }


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
          {s.priority && <StatusPill tone={priorityTone[s.priority] ?? 'neutral'} dot={false}>{humanize(s.priority)} priority</StatusPill>}
        </div>
      }
      footer={manifestOnly ? manifestLink : (
        <>
          {canDelete && (
            <Button variant="danger" icon={<Trash2 size={16} />} onClick={remove} loading={deleteMutation.isPending} className="sm:mr-auto">
              Delete
            </Button>
          )}
          <Button variant="secondary" icon={<Pencil size={16} />} onClick={() => onEdit(s)}>Edit</Button>
          {manifestLink}
        </>
      )}
    >
      <div className="space-y-6">
        {manifestOnly && (
          s.vendor_request_id ? (
            <Alert tone="info" title="Posted by a vendor">
              A vendor posted this load. Its status and vehicle are managed from{' '}
              <Link to={`/vendor-requests?open=${encodeURIComponent(s.vendor_request_id)}`} className="font-medium underline">Vendor loads</Link>.
            </Alert>
          ) : (
            <Alert tone="info" title="Booked through a vendor bid">
              This load comes from a cargo manifest. Its status and vehicle are managed from{' '}
              <Link to="/bids" className="font-medium underline">Bids</Link>.
            </Alert>
          )
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
              ...(s.freight_charge != null ? [{ label: 'Price', value: formatRupees(s.freight_charge) }] : []),
              { label: 'Vehicle', value: plate ? <span className="font-mono">{plate}</span> : (s.vehicle_id ? 'Assigned' : 'Not assigned') },
              { label: 'Driver', value: s.driver_name },
              { label: 'Created', value: formatDateTime(s.created_at) },
              ...(pickupDateOf(s) ? [{ label: 'Pickup date', value: formatDate(pickupDateOf(s)) }] : []),
            ]}
          />
          {s.status === 'exception' && (
            <Alert tone="danger" title="A problem is open on this shipment">
              {withSender
                ? 'Work it from its case under Cargo below, or assign a vehicle again.'
                : 'The goods are still on the vehicle. Work it from its case under Cargo below: re-attempt, move to another vehicle or a hub, or return.'}
            </Alert>
          )}
          {!manifestOnly && !closed && canAssign && (s.status !== 'created' || !s.vehicle_id) && (
            isBiddingOpen(s)
              ? <Alert tone="info">Open to vendor bids. A vehicle is assigned when you accept a bid, so it can't be assigned by hand while bidding is open.</Alert>
              : <Button variant="secondary" icon={<Truck size={16} />} onClick={() => onAssign(s)}>{assignLabel}</Button>
          )}
        </Section>

        <section className="space-y-3" aria-label="Cargo">
          <ConsignmentCargo key={s.id} code={s.tracking_id} cargoRef={refOfShipmentRow(s)} />
        </section>

        {!manifestOnly && !s.vehicle_id && !isBiddingOpen(s) && (
          <EscalationPanel key={s.id} source={{ shipment_id: s.id }} canEscalate={s.status === 'created'} />
        )}

        {s.open_bidding && (
          <Section title="Vendor bidding">
            <DetailList
              items={[
                { label: 'State', value: isBiddingOpen(s) ? 'Bidding open' : 'Bid accepted' },
                { label: 'Minimum bid', value: s.asking_price != null ? formatRupees(s.asking_price) : null },
                { label: 'Opens', value: s.bidding_opens_at ? formatDateTime(s.bidding_opens_at) : null },
                { label: 'Closes', value: s.bidding_closes_at ? formatDateTime(s.bidding_closes_at) : null },
              ]}
            />
          </Section>
        )}

        {!manifestOnly && (
          <Section title="Status history">
            {historyQuery.isLoading && <p className="text-sm text-muted">Loading history…</p>}
            {historyQuery.isError && <p className="text-sm text-muted">We could not load the status history.</p>}
            {!historyQuery.isLoading && !historyQuery.isError && (
              <Timeline
                events={historyEvents.map((e): { status: string; at: string; actorLabel?: string | null; note?: string | null } => ({
                  status: e.status,
                  at: e.at,
                  actorLabel: e.actor ? [e.actor.name, e.actor.role ? humanize(e.actor.role) : null].filter(Boolean).join(' · ') || null : null,
                  note: e.status === 'exception' ? [e.note, 'Delivery attempt failed'].filter(Boolean).join(' · ') : e.note,
                }))}
                formatAt={formatDateTime}
              />
            )}
          </Section>
        )}

        {bid && (
          <Section title={bid.capacity_windows?.trigger_type === 'end_of_route' ? 'Vendor backhaul bid' : 'Vendor bid'}>
            <DetailList
              items={[
                { label: 'Vendor', value: bid.vendor_profiles?.company_name },
                { label: 'Bid amount (before GST)', value: formatRupees(bid.bid_amount) },
                { label: 'E-way bill', value: bid.eway_bill_ref ? <span className="font-mono">{bid.eway_bill_ref}</span> : null },
                { label: 'Load', value: bid.load_configuration },
              ]}
            />
          </Section>
        )}

        {!manifestOnly && !closed && canCancel && (
          <Section title="Update status">
            <p className="text-sm text-muted">Record the pickup, the move and the delivery under Cargo above, with the pieces and proof.</p>
            <div className="flex flex-wrap gap-2">
              {s.status === 'assigned' && (
                <Button variant="ghost" size="sm" disabled={statusMutation.isPending} onClick={unassignShipment}>
                  Take off vehicle
                </Button>
              )}
              {canCancel && (
                <Button variant="ghost" size="sm" disabled={statusMutation.isPending} onClick={cancelShipment}>
                  Cancel shipment
                </Button>
              )}
            </div>
          </Section>
        )}

        {!manifestOnly && s.status === 'delivered' && (
          <Section title="Rate the driver">
            {s.vehicle_id
              ? <DriverRating shipmentId={s.id} rating={s.driver_rating} note={s.driver_rating_note} />
              : <p className="text-sm text-muted">This delivery has no vehicle on record, so there is no driver to rate.</p>}
          </Section>
        )}

        {(s.received_by || s.signature_data || hasProofFiles) && (
          <Section title="Proof of delivery">
            <DetailList
              columns={1}
              items={[
                { label: 'Received by', value: s.received_by },
                { label: 'When', value: formatDateTime(deliveredEvent?.at) },
                {
                  label: 'Signature',
                  value: proofQuery.data?.signature_url
                    ? <img src={proofQuery.data.signature_url} alt={`Signature of ${s.received_by || 'the receiver'}`} className="h-24 max-w-full rounded-control border border-border bg-white" />
                    : s.signature_data
                      ? (signatureIsImage
                        ? <img src={s.signature_data} alt={`Signature of ${s.received_by || 'the receiver'}`} className="h-24 max-w-full rounded-control border border-border bg-surface" />
                        : s.signature_data)
                      : (s.signature_url && proofQuery.isLoading ? 'Loading…' : null),
                },
                {
                  label: 'Photo',
                  value: proofQuery.data?.photo_url
                    ? <a href={proofQuery.data.photo_url} target="_blank" rel="noreferrer"><img src={proofQuery.data.photo_url} alt="Photo of the delivery" className="max-h-48 max-w-full rounded-control border border-border" /></a>
                    : (s.photo_url && proofQuery.isLoading ? 'Loading…' : null),
                },
              ]}
            />
            {hasProofFiles && proofQuery.isError && <p className="text-sm text-muted">We could not load the photo and signature. Close and reopen this shipment to try again.</p>}
            {deliveredEvent?.location && (
              <div className="space-y-1.5">
                <p className="text-sm text-muted">Delivered near</p>
                <div className="overflow-hidden rounded-control border border-border">
                  <MapView
                    mode="tracking"
                    height={160}
                    points={[{
                      id: 'pod-location',
                      kind: 'drop',
                      label: `Delivered near ${deliveredEvent.location.lat.toFixed(4)}, ${deliveredEvent.location.lng.toFixed(4)}`,
                      position: deliveredEvent.location,
                    }]}
                  />
                </div>
              </div>
            )}
          </Section>
        )}

        {!closed && (
          <Section title="Parcel label">
            <ParcelLabel trackingId={s.tracking_id} size={112} />
          </Section>
        )}

        <Section title="Messages">
          <MessagesPanel
            target={{ shipment_id: s.id }}
            unavailable={s.vehicle_id || manifestOnly ? undefined : 'Assign a vehicle to message its driver about this shipment.'}
          />
        </Section>

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
