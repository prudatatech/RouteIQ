import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Check, ExternalLink, Truck, X } from 'lucide-react'
import { Alert, Button, DetailList, Drawer, StatusPill, humanize } from '@/components/ui'
import { buttonClasses } from '@/components/ui/buttonStyles'
import { EscalationPanel } from '@/components/tpl/EscalationPanel'
import VendorLoadCargo from '@/components/cargo/VendorLoadCargo'
import { supabase } from '@/services/supabase'
import type { CustomerBooking } from '@/services/api'
import { formatDate, formatDateTime, formatKg, formatRelative, formatRupees } from '@/utils/display'
import { CustomerDetailsBlock } from './CustomerProfileEditor'
import { bookingNeedsVehicle, customerName, customerRow, loadNeedsVehicle, shipmentHref, shortPlace, vendorName, vendorRow, type VendorRequest } from './model'

/** Link that looks like a secondary button. */
function LinkButton({ to, icon, children }: { to: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return <Link to={to} className={buttonClasses({ variant: 'secondary' })}>{icon}{children}</Link>
}

export function BookingDrawer({ booking, onClose, busy, accepting, cancelling, onAccept, onReject, onAssign }: {
  booking: CustomerBooking | null
  onClose: () => void
  busy: boolean
  accepting: boolean
  cancelling: boolean
  onAccept: (b: CustomerBooking) => void
  onReject: (b: CustomerBooking) => void
  onAssign: (b: CustomerBooking) => void
}) {
  const canAssign = !!booking && bookingNeedsVehicle(booking)
  const canCancel = !!booking && ['requested', 'confirmed', 'assigned'].includes(booking.status)
  const row = booking ? customerRow(booking) : null
  const shipment = row ? shipmentHref(row) : null

  return (
    <Drawer
      open={!!booking}
      onClose={onClose}
      title={booking ? (booking.customer ? customerName(booking) : 'Customer booking') : 'Booking'}
      description={booking ? `${shortPlace(booking.pickup_name)} to ${shortPlace(booking.drop_name)}` : undefined}
      footer={booking && (canCancel || canAssign || shipment) ? (
        <>
          {canCancel && <Button variant="secondary" icon={<X size={16} />} disabled={busy} loading={cancelling} onClick={() => onReject(booking)}>Reject request</Button>}
          {shipment && <LinkButton to={shipment} icon={<ExternalLink size={16} />}>Open shipment</LinkButton>}
          {booking.status === 'requested' && (
            <Button icon={<Check size={16} />} disabled={busy} loading={accepting} onClick={() => onAccept(booking)}>Accept and price</Button>
          )}
          {canAssign && !booking.vehicle_id && (
            <Button icon={<Truck size={16} />} disabled={busy} onClick={() => onAssign(booking)}>Assign vehicle</Button>
          )}
          {canAssign && booking.vehicle_id && (
            <Button variant="secondary" icon={<Truck size={16} />} disabled={busy} onClick={() => onAssign(booking)}>Change vehicle</Button>
          )}
        </>
      ) : undefined}
    >
      {booking && row && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={row.statusTone}>{row.statusLabel}</StatusPill>
            <span className="text-sm text-muted">Requested {formatRelative(booking.created_at)}</span>
          </div>

          {booking.status === 'confirmed' && (
            <Alert tone="info" title="Accepted. Next: assign a vehicle" action={<Button size="sm" icon={<Truck size={16} />} disabled={busy} onClick={() => onAssign(booking)}>Assign vehicle</Button>}>
              The shipment is created and the customer has been told. Choose a vehicle with a driver to put it on the road.
            </Alert>
          )}

          {booking.shipment_status === 'exception' && booking.status !== 'delivered' && booking.status !== 'cancelled' && (
            <Alert tone="danger" title="The delivery attempt failed">
              The driver could not deliver this load and the goods are still on the vehicle. The customer has been told.
              {shipment && (
                <>
                  {' '}Re-attempt, move them to another vehicle or return them from{' '}
                  <Link to={shipment} className="font-medium underline">the shipment page</Link>.
                </>
              )}
            </Alert>
          )}

          {booking.status === 'cancelled' && (
            <Alert tone="danger" title={booking.cancelled_by === 'customer' ? 'Cancelled by the customer' : 'Rejected or cancelled by staff'}>
              {booking.cancel_reason || 'No reason was given.'}
            </Alert>
          )}

          <DetailList
            items={[
              { label: 'Customer', value: [booking.customer ? customerName(booking) : null, booking.customer?.phone].filter(Boolean).join(' · ') || 'Not given' },
              { label: 'Pickup', value: booking.pickup_address },
              { label: 'Drop-off', value: booking.drop_address },
              { label: 'Pickup date', value: formatDate(`${booking.pickup_date}T12:00:00+05:30`) },
              { label: 'Weight', value: <span className="tabular">{formatKg(booking.weight_kg)}</span> },
              { label: 'Load', value: booking.load_type === 'part' ? 'Part load' : 'Full truck' },
              ...(booking.vehicle_type ? [{ label: 'Vehicle asked for', value: humanize(booking.vehicle_type) }] : []),
              { label: 'Quoted price', value: booking.quoted_price != null ? <span className="tabular">{formatRupees(booking.quoted_price)}, before GST</span> : 'Not priced. Quote the customer directly.' },
              ...(booking.tracking_id ? [{ label: 'Tracking ID', value: shipment ? <Link to={shipment} className="font-mono underline">{booking.tracking_id}</Link> : <span className="font-mono">{booking.tracking_id}</span> }] : []),
            ]}
          />

          <CustomerDetailsBlock customerId={booking.customer?.id ?? booking.customer_id} />
        </div>
      )}
    </Drawer>
  )
}

/** The plate of the vehicle a load was given, read from the vehicle list. */
function useAssignedPlate(vehicleId: string | null | undefined) {
  const vehicle = useQuery({
    queryKey: ['vehicle-plate', vehicleId],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicles').select('plate_number').eq('id', vehicleId as string).maybeSingle()
      if (error) throw error
      return data?.plate_number as string | undefined
    },
    enabled: !!vehicleId,
    staleTime: 60_000,
  })
  return vehicle.data
}

export function LoadDrawer({ request, onClose, busy, accepting, rejecting, onAccept, onReject, onAssign }: {
  request: VendorRequest | null
  onClose: () => void
  busy: boolean
  accepting: boolean
  rejecting: boolean
  onAccept: (r: VendorRequest) => void
  onReject: (r: VendorRequest) => void
  onAssign: (r: VendorRequest) => void
}) {
  const open = !!request && (request.status === 'pending' || request.status === 'approved')
  const showPartners = !!request && ['pending', 'approved', 'escalated', 'assigned_to_partner', 'completed'].includes(request.status)
  const assignedPlate = useAssignedPlate(request?.assigned_vehicle_id)
  const row = request ? vendorRow(request) : null
  const shipment = row ? shipmentHref(row) : null
  const cargo = request?.metadata?.cargo
  const consignee = request?.metadata?.consignee
  const declared = cargo?.declaredValue !== undefined && cargo.declaredValue !== '' && Number.isFinite(Number(cargo.declaredValue))
    ? formatRupees(cargo.declaredValue)
    : cargo?.declaredValue || undefined

  return (
    <Drawer
      open={!!request}
      onClose={onClose}
      title={request ? vendorName(request) : 'Load'}
      description={request ? `${shortPlace(request.pickup_location)} to ${shortPlace(request.drop_location)}` : undefined}
      footer={request && (open || shipment) ? (
        <>
          {open && <Button variant="secondary" icon={<X size={16} />} disabled={busy} loading={rejecting} onClick={() => onReject(request)}>Reject request</Button>}
          {shipment && <LinkButton to={shipment} icon={<ExternalLink size={16} />}>Open shipment</LinkButton>}
          {request.status === 'pending' && (
            <Button icon={<Check size={16} />} disabled={busy} loading={accepting} onClick={() => onAccept(request)}>Accept and price</Button>
          )}
          {loadNeedsVehicle(request) && (
            <Button icon={<Truck size={16} />} disabled={busy} onClick={() => onAssign(request)}>Assign vehicle</Button>
          )}
        </>
      ) : undefined}
    >
      {request && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            {row && <StatusPill tone={row.statusTone}>{row.statusLabel}</StatusPill>}
            <span className="text-sm text-muted">Requested {formatRelative(request.created_at)}</span>
          </div>

          {request.status === 'rejected' && request.rejection_reason && (
            <Alert tone="danger" title="Rejected">{request.rejection_reason}</Alert>
          )}

          {request.status === 'approved' && (
            <Alert tone="info" title="Accepted. Next: assign a vehicle" action={<Button size="sm" icon={<Truck size={16} />} disabled={busy} onClick={() => onAssign(request)}>Assign vehicle</Button>}>
              Accepted{request.cost ? ` at ${formatRupees(request.cost)}` : ''}. The vendor has been told. Choose a vehicle with a driver next.
            </Alert>
          )}

          <DetailList
            items={[
              { label: 'Vendor', value: request.vendor_id ? <Link to={`/admin/users/${encodeURIComponent(request.vendor_id)}`} className="underline">{vendorName(request)}</Link> : vendorName(request) },
              { label: 'Pickup', value: request.pickup_location },
              { label: 'Drop-off', value: request.drop_location },
              { label: 'Weight', value: <span className="tabular">{formatKg(request.required_capacity_kg)}</span> },
              ...(request.metadata?.offered_price_inr ? [{ label: 'Vendor’s price', value: <span className="tabular">{formatRupees(request.metadata.offered_price_inr)}</span> }] : []),
              { label: 'Vendor city', value: request.vendor?.city ?? 'Not given' },
              ...(cargo?.name || cargo?.category ? [{ label: 'Goods', value: [cargo.name, cargo.category].filter(Boolean).join(' · ') }] : []),
              ...(cargo?.noOfPackages ? [{ label: 'Packages', value: `${Number(cargo.noOfPackages).toLocaleString('en-IN')}${cargo.packagingType ? ` · ${cargo.packagingType}` : ''}` }] : []),
              ...(declared ? [{ label: 'Declared value', value: declared }] : []),
              ...(cargo?.specialHandling ? [{ label: 'Special handling', value: cargo.specialHandling }] : []),
              ...(consignee?.name ? [{ label: 'Receiver', value: [consignee.name, consignee.contact].filter(Boolean).join(' · ') }] : []),
              ...(cargo?.remarks ? [{ label: 'Notes', value: cargo.remarks }] : []),
              { label: 'Posted', value: formatDateTime(request.created_at) },
              ...(request.assigned_vehicle_id ? [{ label: 'Vehicle', value: <span className="font-mono">{assignedPlate ?? 'Assigned'}</span> }] : []),
              ...(request.cost ? [{ label: 'Agreed price', value: <span className="tabular">{formatRupees(request.cost)}{request.cost_per_km ? ` (${formatRupees(request.cost_per_km)} per km)` : ''}</span> }] : []),
            ]}
          />

          {request.assigned_vehicle_id && <VendorLoadCargo key={request.id} requestId={request.id} />}

          {showPartners && (
            <EscalationPanel key={request.id} source={{ request_id: request.id }} canEscalate={open || request.status === 'escalated'} vendorPrice={request.cost} />
          )}
        </div>
      )}
    </Drawer>
  )
}
