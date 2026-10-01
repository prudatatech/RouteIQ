import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ExternalLink, MapPin, Truck } from 'lucide-react'
import { Alert, Button, DetailList, StatusPill, Timeline, buttonClasses, humanize, statusToLabel, useConfirm } from '@/components/ui'
import { EscalationPanel } from '@/components/tpl/EscalationPanel'
import InlineTrackingMap from '@/components/map/InlineTrackingMap'
import { MapView } from '@/components/map'
import { shipmentsAPI } from '@/services/api'
import { apiErrorMessage, deliveryPointsOf, destinationOf, isBiddingOpen, isCargoManifest, pickupDateOf, pickupPlace, plateOf, shipmentStatusLabel } from './format'
import { shipmentFlags } from './rules'
import { carrierText, historyEntries, lotCarriers, masterDestinationText, missingEwayBill } from './masterView'
import { EWAY_BILL_WARNING } from '@/config/compliance'
import DriverRating from './DriverRating'
import ParcelLabel from './ParcelLabel'
import PlaceText from './PlaceText'
import MessagesPanel from '@/components/messages/MessagesPanel'
import type { ShipmentHistoryEvent, ShipmentRow } from './types'
import ConsignmentCargo from '@/components/cargo/ConsignmentCargo'
import { refOfShipmentRow } from '@/components/cargo/logic'
import { formatDate, formatDateTime, formatKg, formatRupees } from '@/utils/display'

/**
 * The only statuses the web still sets with PATCH /shipments/:id: back to `created` (off its
 * vehicle) and `cancelled`, both before pickup. Pickup, in transit, delivery and every later state
 * are custody events with counts and proof, recorded from the Cargo section
 * (the backend refuses a raw PATCH to them: 409 with `use: 'cargo_custody'`).
 */
type PatchStatus = 'created' | 'cancelled'

/** A split master holds no goods, so it has no driver to rate or message and no position of its own. */
const OPEN_A_LOT = 'Open a lot to rate its driver, message it or track it.'

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-text">{title}</h3>
      {children}
    </section>
  )
}

/**
 * Where the shipment goes, what it carries, where its goods are and what can be done with them:
 * the first half of a shipment's sections, in the drawer and on the shipment page.
 */
export function ShipmentDetailSections({ shipment: s, onAssign }: { shipment: ShipmentRow; onAssign: (s: ShipmentRow) => void }) {
  const f = shipmentFlags(s)
  const destination = destinationOf(s)
  const stops = deliveryPointsOf(s).length
  const plate = plateOf(s)
  const bidding = isBiddingOpen(s)
  // A split master has no vehicle, driver or drop of its own: they are on its lots
  const carriers = f.master ? lotCarriers(s) : []
  const masterDestination = f.master ? masterDestinationText(s) : null
  const ewayMissing = !f.closed && missingEwayBill(s)

  return (
    <>
      {f.manifestOnly && (
        s.vendor_request_id ? (
          <Alert tone="info" title="Posted by a vendor">
            A vendor posted this load. Its status and vehicle are managed from{' '}
            <Link to={`/requests?open=${encodeURIComponent(s.vendor_request_id)}&source=vendor`} className="font-medium underline">Requests</Link>.
          </Alert>
        ) : (
          <Alert tone="info" title="Booked through a vendor bid">
            This load comes from a vendor bid. Its status and vehicle are managed from{' '}
            <Link to="/bids" className="font-medium underline">Bids</Link>.
          </Alert>
        )
      )}

      <Section title="Trip">
        <DetailList
          columns={1}
          items={[
            { label: 'Pickup', value: s.origin_name || s.origin_address ? <PlaceText {...pickupPlace(s)} /> : null },
            {
              label: 'Destination',
              value: masterDestination
                ? <PlaceText name={masterDestination.headline} address={masterDestination.detail} />
                : destination ? <PlaceText name={destination.name} address={destination.address} /> : null,
            },
            ...(stops > 1 ? [{ label: 'Stops', value: `${stops.toLocaleString('en-IN')} drops, including the destination` }] : []),
          ]}
        />
      </Section>

      <Section title="Cargo and vehicle">
        <DetailList
          items={[
            { label: 'Pieces', value: s.total_items != null ? s.total_items.toLocaleString('en-IN') : null },
            ...(s.consignee_name ? [{ label: 'Receiver', value: [s.consignee_name, s.consignee_phone, s.consignee_gstin].filter(Boolean).join(' · ') }] : []),
            ...(s.split_reason ? [{ label: 'Split', value: statusToLabel(s.split_reason, 'split_reason') }] : []),
            ...(s.declared_value != null ? [{ label: 'Declared value', value: formatRupees(s.declared_value) }] : []),
            ...(s.freight_share != null && !f.master ? [{ label: 'Freight share', value: formatRupees(s.freight_share) }] : []),
            { label: 'Weight', value: formatKg(s.total_weight_kg) },
            ...(s.freight_charge != null ? [{ label: 'Price', value: formatRupees(s.freight_charge) }] : []),
            ...(f.master
              ? [{
                label: 'Per lot',
                value: carriers.length > 0
                  ? <span className="block space-y-0.5">{carriers.map(c => <span key={`${c.plate}-${c.driver}`} className="block font-mono">{carrierText(c)}</span>)}</span>
                  : 'No vehicle on a lot yet',
              }]
              : [
                { label: 'Vehicle', value: plate ? <span className="font-mono">{plate}</span> : (s.vehicle_id ? 'Assigned' : 'Not assigned') },
                { label: 'Driver', value: s.driver_name },
              ]),
            { label: 'Created', value: formatDateTime(s.created_at) },
            ...(pickupDateOf(s) ? [{ label: 'Pickup date', value: formatDate(pickupDateOf(s)) }] : []),
          ]}
        />
        {ewayMissing && (
          <p><StatusPill tone="warning" dot={false}>{EWAY_BILL_WARNING}</StatusPill></p>
        )}
        {s.status === 'exception' && (
          <Alert tone="danger" title="A problem is open on this shipment">
            {f.withSender
              ? 'Work it from its case under Problems, in the case linked below, or assign a vehicle again.'
              : 'The goods are still on the vehicle. Work it from its case under Problems, in the case linked below: re-attempt, move to another vehicle or a hub, or return.'}
          </Alert>
        )}
        {!f.manifestOnly && !f.closed && f.canAssign && (s.status !== 'created' || !s.vehicle_id) && (
          bidding
            ? <Alert tone="info">Open to vendor bids. A vehicle is assigned when you accept a bid, so it can't be assigned by hand while bidding is open.</Alert>
            : <Button variant="secondary" icon={<Truck size={16} />} onClick={() => onAssign(s)}>{f.assignLabel}</Button>
        )}
      </Section>

      <section className="space-y-3" aria-label="Cargo" id="shipment-cargo">
        <ConsignmentCargo
          key={s.id}
          code={s.tracking_id}
          cargoRef={refOfShipmentRow(s)}
          figures={{
            weight_kg: s.total_weight_kg ?? null,
            declared_value: s.declared_value ?? null,
            freight: s.freight_share ?? s.freight_charge ?? null,
          }}
        />
      </section>

      {!f.manifestOnly && !f.master && !s.vehicle_id && !bidding && !['cancelled', 'delivered', 'returned', 'lost'].includes(String(s.status)) && (
        <EscalationPanel key={s.id} source={{ shipment_id: s.id }} canEscalate={s.status === 'created'} />
      )}

      {s.open_bidding && (
        <Section title="Vendor bidding">
          <DetailList
            items={[
              { label: 'State', value: bidding ? 'Bidding open' : 'Bid accepted' },
              { label: 'Minimum bid', value: s.asking_price != null ? formatRupees(s.asking_price) : null },
              { label: 'Opens', value: s.bidding_opens_at ? formatDateTime(s.bidding_opens_at) : null },
              { label: 'Closes', value: s.bidding_closes_at ? formatDateTime(s.bidding_closes_at) : null },
            ]}
          />
        </Section>
      )}
    </>
  )
}

/**
 * Its history, vendor bid, status changes, rating, proof of delivery, label, messages and live
 * location: the second half of a shipment's sections. Give it a `key` of the shipment id so its
 * own state resets when another shipment is shown.
 */
export function ShipmentRecordSections({ shipment: s }: { shipment: ShipmentRow }) {
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const [showMap, setShowMap] = useState(false)
  const f = shipmentFlags(s)

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: PatchStatus }) => shipmentsAPI.updateStatus(id, status),
    onSuccess: (_data, { id, status }) => {
      queryClient.invalidateQueries({ queryKey: ['shipments'] })
      queryClient.invalidateQueries({ queryKey: ['shipment-history', id] })
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      queryClient.invalidateQueries({ queryKey: ['fleet-summary'] })
      queryClient.invalidateQueries({ queryKey: ['cargo'] })
      // The stop leaves its trip and the vehicle is free again
      queryClient.invalidateQueries({ queryKey: ['routes'] })
      toast.success(status === 'created' ? 'Taken off its vehicle. It needs a vehicle again.' : `Status changed to ${shipmentStatusLabel(status).toLowerCase()}`)
    },
    onError: (error: unknown) => toast.error(apiErrorMessage(error, 'We could not change the status. Try again.')),
  })

  const historyQuery = useQuery({
    queryKey: ['shipment-history', s.id],
    queryFn: () => shipmentsAPI.history(s.id) as Promise<{ events: ShipmentHistoryEvent[] }>,
    enabled: !isCargoManifest(s),
  })

  const hasProofFiles = !!(s.photo_url || s.signature_url)
  const proofQuery = useQuery({
    queryKey: ['shipment-proof', s.id],
    queryFn: () => shipmentsAPI.proof(s.id),
    enabled: hasProofFiles,
    // The signed links last 10 minutes
    staleTime: 5 * 60_000,
  })

  const bid = s.capacity_bids
  const signatureIsImage = s.signature_data?.startsWith('data:image')
  const historyEvents = historyQuery.data?.events ?? []
  const deliveredEvent = historyEvents.find(e => e.status === 'delivered')

  const cancelShipment = async () => {
    const ok = await confirm({
      title: `Cancel shipment ${s.tracking_id}?`,
      message: f.master
        ? 'The shipment and every one of its lots are marked as cancelled. You can still see them under Cancelled.'
        : 'The shipment is marked as cancelled. You can still see it under Cancelled.',
      confirmLabel: 'Cancel shipment',
      cancelLabel: 'Keep shipment',
      tone: 'danger',
    })
    if (ok) statusMutation.mutate({ id: s.id, status: 'cancelled' })
  }

  const unassignShipment = async () => {
    const ok = await confirm({
      title: `Take ${s.tracking_id} off its vehicle?`,
      message: 'The shipment goes back to Needs a vehicle, its stop leaves the trip and the driver is told. You can assign it again. If the goods were already picked up, plan a transfer instead.',
      confirmLabel: 'Take off vehicle',
    })
    if (ok) statusMutation.mutate({ id: s.id, status: 'created' })
  }

  return (
    <>
      {!f.manifestOnly && (
        <Section title="Status history">
          {historyQuery.isLoading && <p className="text-sm text-muted">Loading history…</p>}
          {historyQuery.isError && <p className="text-sm text-muted">We could not load the status history.</p>}
          {!historyQuery.isLoading && !historyQuery.isError && (
            <Timeline
              events={historyEntries(historyEvents).map(e => ({
                status: e.status,
                at: e.at,
                label: e.label,
                actorLabel: e.actor ? [e.actor.name, e.actor.role ? humanize(e.actor.role) : null].filter(Boolean).join(' · ') || null : null,
                note: e.note,
              }))}
              formatAt={formatDateTime}
            />
          )}
        </Section>
      )}

      {bid && (
        <Section title={bid.capacity_windows?.trigger_type === 'end_of_route' ? 'Vendor return trip bid' : 'Vendor bid'}>
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

      {!f.manifestOnly && !f.closed && f.canCancel && (
        <Section title="Update status">
          <p className="text-sm text-muted">Record the pickup, the move and the delivery under Where is it now, with the pieces and proof.</p>
          <div className="flex flex-wrap gap-2">
            {s.status === 'assigned' && !f.master && (
              <Button variant="ghost" size="sm" disabled={statusMutation.isPending} onClick={unassignShipment}>
                Take off vehicle
              </Button>
            )}
            <Button variant="ghost" size="sm" disabled={statusMutation.isPending} onClick={cancelShipment}>
              Cancel shipment
            </Button>
          </div>
        </Section>
      )}

      {!f.manifestOnly && s.status === 'delivered' && (
        <Section title="Rate the driver">
          {f.master
            ? <p className="text-sm text-muted">{OPEN_A_LOT}</p>
            : s.vehicle_id
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

      {!f.closed && !f.master && (
        <Section title="Parcel label">
          <ParcelLabel trackingId={s.tracking_id} size={112} />
        </Section>
      )}

      {s.status !== 'cancelled' && <Section title="Messages">
        <MessagesPanel
          target={{ shipment_id: s.id }}
          unavailable={f.master
            ? OPEN_A_LOT
            : s.vehicle_id || f.manifestOnly ? undefined : 'Assign a vehicle to message its driver about this shipment.'}
        />
      </Section>}

      {!f.manifestOnly && (
        <Section title="Live location">
          <div className="flex flex-wrap gap-2">
            {s.vehicle_id && !f.master && (
              <Button variant="secondary" size="sm" icon={<MapPin size={16} />} onClick={() => setShowMap(v => !v)} aria-expanded={showMap}>
                {showMap ? 'Hide map' : 'Show on map'}
              </Button>
            )}
            <Link to={`/track/${encodeURIComponent(s.tracking_id)}`} className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
              <ExternalLink size={16} aria-hidden="true" /> Open tracking page
            </Link>
          </div>
          {f.master
            ? <p className="text-sm text-muted">{OPEN_A_LOT}</p>
            : !s.vehicle_id && !f.closed && <p className="text-sm text-muted">Assign a vehicle to see where this shipment is.</p>}
          {showMap && <InlineTrackingMap trackingId={s.tracking_id} vehicleId={s.vehicle_id} />}
        </Section>
      )}
    </>
  )
}
