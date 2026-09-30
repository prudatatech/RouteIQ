import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, Check, Truck, X } from 'lucide-react'
import { supabase } from '@/services/supabase'
import { bookingsAPI, type CustomerBooking } from '@/services/api'
import {
  Alert, Button, DataTable, DetailList, Drawer, ErrorState, Input, Modal, Page, PageHeader, SearchInput, Select, StatusPill, Tabs, TabPanel,
  humanize, statusToLabel, statusToTone, useConfirm, useTabParam, useUrlState, type Column, type Tone,
} from '@/components/ui'
import { isDraftVehicle } from '@/utils/vehicles'
import { errorMessage, formatDate, formatKg, formatRelative, formatRupees } from '@/utils/display'
import { DriverLicenceBadge } from '@/components/people/DriverLicenceBadge'
import { licenceSuffix } from '@/components/people/docs'
import { useVehicleLicences } from '@/components/people/useVehicleLicences'

const TAB_IDS = ['new', 'active', 'done', 'cancelled', 'all'] as const
type TabId = typeof TAB_IDS[number]

const tabStatuses: Record<Exclude<TabId, 'all'>, CustomerBooking['status'][]> = {
  new: ['requested'],
  active: ['confirmed', 'assigned', 'in_transit'],
  done: ['delivered'],
  cancelled: ['cancelled'],
}

/**
 * What staff and the customer see for a booking. A failed delivery has no booking status of its own,
 * so it shows from the shipment's status.
 */
function statusOf(b: CustomerBooking): { label: string; tone: Tone } {
  if (b.shipment_status === 'exception' && !['delivered', 'cancelled'].includes(b.status)) {
    return { label: 'Delivery failed', tone: 'danger' }
  }
  return { label: statusToLabel(b.status, 'booking'), tone: statusToTone(b.status, 'booking') }
}

/**
 * A booking whose vehicle can be chosen: waiting for one, or already has one. Once the goods are
 * picked up they stay on the vehicle, a failed delivery included, so another vehicle is a cargo
 * transfer or a re-attempt on the shipment's case (the backend refuses a re-assignment).
 */
const canAssignVehicle = (b: CustomerBooking) => b.status === 'confirmed' || b.status === 'assigned'

interface Vehicle {
  id: string
  plate_number: string
  vehicle_type: string | null
  available_capacity_kg: number | null
  status: string
}

const shortPlace = (place: string | null | undefined) => (place ?? '').split(',')[0].trim() || '—'
const customerName = (b: CustomerBooking) => b.customer?.name || b.customer?.phone || 'Customer'

/** Vehicles with enough free space for the booking's weight. */
async function loadVehicles(): Promise<Vehicle[]> {
  const { data, error } = await supabase
    .from('vehicles')
    .select('id, plate_number, vehicle_type, available_capacity_kg, status')
    .order('plate_number')
  if (error) throw error
  return (data ?? []) as Vehicle[]
}

export default function BookingsPage() {
  const queryClient = useQueryClient()
  const { prompt } = useConfirm()
  const [tab, setTab] = useTabParam<TabId>(TAB_IDS, 'new')
  const [search, setSearch] = useUrlState('q', { debounceMs: 300 })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()

  const bookings = useQuery({ queryKey: ['customer-bookings'], queryFn: bookingsAPI.list, refetchInterval: 30_000 })
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['customer-bookings'] })
    // Confirming, assigning or cancelling changes the linked shipment and the vehicle's load.
    queryClient.invalidateQueries({ queryKey: ['shipments'] })
    queryClient.invalidateQueries({ queryKey: ['vehicles'] })
    queryClient.invalidateQueries({ queryKey: ['assignable-vehicles'] })
  }

  const [confirming, setConfirming] = useState<CustomerBooking | null>(null)
  const confirmBooking = useMutation({
    mutationFn: ({ id, price }: { id: string; price: number | null }) => bookingsAPI.confirm(id, price),
    onSuccess: () => { toast.success('Booking confirmed. A shipment was created and the customer has been told.'); setConfirming(null) },
    onError: err => toast.error(errorMessage(err, 'We could not confirm this booking. Try again.')),
    onSettled: refresh,
  })
  const cancelBooking = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => bookingsAPI.cancel(id, reason),
    onSuccess: () => { toast.success('Booking cancelled. The customer has been told.'); setSelectedId(null) },
    onError: err => toast.error(errorMessage(err, 'We could not cancel this booking. Try again.')),
    onSettled: refresh,
  })

  const all = useMemo(() => bookings.data ?? [], [bookings.data])
  const counts = useMemo(() => {
    const c: Record<TabId, number> = { new: 0, active: 0, done: 0, cancelled: 0, all: all.length }
    for (const b of all) {
      const t = (Object.keys(tabStatuses) as Exclude<TabId, 'all'>[]).find(k => tabStatuses[k].includes(b.status))
      if (t) c[t]++
    }
    return c
  }, [all])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return all.filter(b => {
      if (tab !== 'all' && !tabStatuses[tab].includes(b.status)) return false
      if (!q) return true
      return [customerName(b), b.pickup_name, b.drop_name, b.tracking_id ?? ''].some(v => v.toLowerCase().includes(q))
    })
  }, [all, tab, search])

  const selected = all.find(b => b.id === selectedId) ?? null

  // Opened from a link (a notification, global search): ?open=<id> shows the tab the booking is under and
  // opens its drawer, then the param is dropped from the URL.
  useEffect(() => {
    const openId = searchParams.get('open')
    if (!openId || bookings.isLoading) return
    const match = all.find(b => b.id === openId)
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('open')
      const t = match ? (Object.keys(tabStatuses) as Exclude<TabId, 'all'>[]).find(k => tabStatuses[k].includes(match.status)) : null
      if (t) { if (t === 'new') next.delete('tab'); else next.set('tab', t) }
      return next
    }, { replace: true })
    if (match) setSelectedId(match.id)
  }, [searchParams, setSearchParams, all, bookings.isLoading])

  const askCancel = async (b: CustomerBooking) => {
    const reason = await prompt({
      title: 'Cancel this booking?',
      message: `${customerName(b)}’s booking from ${shortPlace(b.pickup_name)} to ${shortPlace(b.drop_name)} will be cancelled${b.shipment_id ? ' and its shipment too' : ''}. The customer is told the reason.`,
      inputLabel: 'Reason',
      placeholder: 'Why is this booking being cancelled?',
      confirmLabel: 'Cancel booking',
      tone: 'danger',
      required: true,
    })
    if (reason) cancelBooking.mutate({ id: b.id, reason })
  }

  const askConfirm = (b: CustomerBooking) => setConfirming(b)

  const columns: Column<CustomerBooking>[] = [
    { key: 'customer', header: 'Customer', cell: b => <span className="font-medium">{customerName(b)}</span>, sortValue: b => customerName(b) },
    {
      key: 'route', header: 'Route',
      cell: b => (
        <span className="inline-flex max-w-xs items-center gap-1.5">
          <span className="truncate" title={b.pickup_address}>{shortPlace(b.pickup_name)}</span>
          <ArrowRight size={14} aria-label="to" className="shrink-0 text-muted" />
          <span className="truncate" title={b.drop_address}>{shortPlace(b.drop_name)}</span>
        </span>
      ),
    },
    { key: 'weight', header: 'Weight', align: 'right', cell: b => <span className="tabular">{formatKg(b.weight_kg)}</span>, sortValue: b => Number(b.weight_kg) },
    { key: 'pickup', header: 'Pickup date', hideBelow: 'lg', cell: b => formatDate(`${b.pickup_date}T12:00:00+05:30`), sortValue: b => b.pickup_date },
    { key: 'price', header: 'Price', align: 'right', hideBelow: 'lg', cell: b => (b.quoted_price != null ? <span className="tabular">{formatRupees(b.quoted_price)}</span> : <span className="text-muted">Not priced</span>), sortValue: b => b.quoted_price },
    { key: 'status', header: 'Status', cell: b => <StatusPill tone={statusOf(b).tone}>{statusOf(b).label}</StatusPill>, sortValue: b => b.status },
  ]

  const tabs = [
    { id: 'new' as const, label: 'New', count: counts.new },
    { id: 'active' as const, label: 'In progress', count: counts.active },
    { id: 'done' as const, label: 'Delivered', count: counts.done },
    { id: 'cancelled' as const, label: 'Cancelled', count: counts.cancelled },
    { id: 'all' as const, label: 'All', count: counts.all },
  ]

  const emptyTitle: Record<TabId, string> = {
    new: 'No new bookings',
    active: 'No bookings in progress',
    done: 'No delivered bookings',
    cancelled: 'No cancelled bookings',
    all: 'No customer bookings yet',
  }

  return (
    <Page>
      <PageHeader
        title="Customer bookings"
        description="Shipments booked by customers in the mobile app. Confirm a booking to create its shipment, then assign a vehicle."
      >
        <div className="space-y-4">
          <Tabs label="Filter bookings by status" tabs={bookings.isLoading ? tabs.map(t => ({ ...t, count: undefined })) : tabs} value={tab} onChange={setTab} />
          <SearchInput value={search} onChange={setSearch} label="Search bookings" placeholder="Search by customer, place or tracking ID" className="max-w-sm" />
        </div>
      </PageHeader>

      <TabPanel id={tab}>
        <DataTable
          caption="Customer bookings"
          columns={columns}
          rows={rows}
          rowKey={b => b.id}
          loading={bookings.isLoading}
          error={bookings.error ? 'We could not load bookings. Check your connection and try again.' : undefined}
          onRetry={() => bookings.refetch()}
          onRowClick={b => setSelectedId(b.id)}
          selectedKey={selectedId}
          empty={{
            title: search ? 'No bookings match your search' : emptyTitle[tab],
            description: search ? 'Try a different customer, place or tracking ID.' : 'Bookings appear here as customers make them.',
            action: search ? <Button variant="secondary" onClick={() => setSearch('')}>Clear search</Button> : undefined,
          }}
        />
      </TabPanel>

      <BookingDrawer
        booking={selected}
        onClose={() => setSelectedId(null)}
        confirming={confirmBooking.isPending && confirmBooking.variables?.id === selected?.id}
        cancelling={cancelBooking.isPending && cancelBooking.variables?.id === selected?.id}
        onConfirm={askConfirm}
        onCancel={askCancel}
        onAssigned={refresh}
      />
      <ConfirmBookingModal
        booking={confirming}
        loading={confirmBooking.isPending}
        onClose={() => setConfirming(null)}
        onConfirm={(b, price) => confirmBooking.mutate({ id: b.id, price })}
      />
    </Page>
  )
}

/** Confirm a booking and set its price: the customer's quote, or what staff agreed with them. */
function ConfirmBookingModal({ booking, loading, onClose, onConfirm }: {
  booking: CustomerBooking | null
  loading: boolean
  onClose: () => void
  onConfirm: (b: CustomerBooking, price: number | null) => void
}) {
  const [entered, setEntered] = useState<{ id: string; price: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!booking) return <Modal open={false} onClose={onClose} title="Confirm this booking?" />
  const quote = booking.quoted_price != null ? String(booking.quoted_price) : ''
  const price = entered && entered.id === booking.id ? entered.price : quote

  const submit = () => {
    const text = price.trim()
    if (text && !(Number(text) >= 0)) { setError('Enter a price of 0 or more, or leave it empty.'); return }
    setError(null)
    onConfirm(booking, text ? Number(text) : null)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Confirm this booking?"
      description="This creates a shipment for dispatch and tells the customer their tracking ID."
      size="sm"
      onSubmit={submit}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Not yet</Button>
          <Button type="submit" loading={loading}>Confirm booking</Button>
        </>
      )}
    >
      <Input
        label="Price (₹)"
        type="number"
        inputMode="decimal"
        min={0}
        step="0.01"
        leading="₹"
        value={price}
        error={error ?? undefined}
        hint={booking.quoted_price != null
          ? 'Starts at the customer\u2019s quote, before GST. Change it if you agreed another price. The delivery is invoiced at this price.'
          : 'No quote was given. Enter the agreed price, before GST, so the delivery can be invoiced.'}
        onChange={e => setEntered({ id: booking.id, price: e.target.value })}
      />
    </Modal>
  )
}

function BookingDrawer({ booking, onClose, confirming, cancelling, onConfirm, onCancel, onAssigned }: {
  booking: CustomerBooking | null
  onClose: () => void
  confirming: boolean
  cancelling: boolean
  onConfirm: (b: CustomerBooking) => void
  onCancel: (b: CustomerBooking) => void
  onAssigned: () => void
}) {
  const [vehicleChoice, setVehicleChoice] = useState<{ bookingId: string; vehicleId: string } | null>(null)
  const vehicleId = vehicleChoice && vehicleChoice.bookingId === booking?.id ? vehicleChoice.vehicleId : ''
  const canAssign = !!booking && canAssignVehicle(booking)
  const canCancel = !!booking && ['requested', 'confirmed', 'assigned'].includes(booking.status)

  const vehicles = useQuery({ queryKey: ['assignable-vehicles'], queryFn: loadVehicles, enabled: canAssign })
  const licences = useVehicleLicences(canAssign)
  const withSpace = useMemo(
    () => (vehicles.data ?? []).filter(v => v.status !== 'maintenance' && !isDraftVehicle(v) && Number(v.available_capacity_kg ?? 0) >= Number(booking?.weight_kg ?? 0)),
    [vehicles.data, booking?.weight_kg],
  )

  const assign = useMutation({
    mutationFn: ({ id, vehicle }: { id: string; vehicle: string }) => bookingsAPI.assign(id, vehicle),
    onSuccess: () => { toast.success('Vehicle assigned. The customer has been told.'); setVehicleChoice(null) },
    onError: err => toast.error(errorMessage(err, 'We could not assign the vehicle. Try again.')),
    onSettled: onAssigned,
  })

  const busy = confirming || cancelling || assign.isPending

  return (
    <Drawer
      open={!!booking}
      onClose={onClose}
      title={booking ? (booking.customer?.name || 'Customer booking') : 'Booking'}
      description={booking ? `${shortPlace(booking.pickup_name)} to ${shortPlace(booking.drop_name)}` : undefined}
      footer={booking && (canCancel || canAssign) ? (
        <>
          {canCancel && <Button variant="secondary" icon={<X size={16} />} disabled={busy} loading={cancelling} onClick={() => onCancel(booking)}>Cancel booking</Button>}
          {booking.status === 'requested' && (
            <Button icon={<Check size={16} />} disabled={busy} loading={confirming} onClick={() => onConfirm(booking)}>Confirm booking</Button>
          )}
          {canAssign && (
            <Button
              icon={<Truck size={16} />}
              disabled={!vehicleId || busy}
              loading={assign.isPending}
              onClick={() => assign.mutate({ id: booking.id, vehicle: vehicleId })}
            >
              Assign vehicle
            </Button>
          )}
        </>
      ) : undefined}
    >
      {booking && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={statusOf(booking).tone}>{statusOf(booking).label}</StatusPill>
            <span className="text-sm text-muted">Booked {formatRelative(booking.created_at)}</span>
          </div>

          {booking.shipment_status === 'exception' && booking.status !== 'delivered' && booking.status !== 'cancelled' && (
            <Alert tone="danger" title="The delivery attempt failed">
              The driver could not deliver this load and the goods are still on the vehicle. The customer has been told.
              {booking.shipment_id && (
                <>
                  {' '}Re-attempt, move them to another vehicle or return them from{' '}
                  <Link to={`/shipments?open=${encodeURIComponent(booking.shipment_id)}`} className="font-medium underline">the shipment’s cargo panel</Link>.
                </>
              )}
            </Alert>
          )}

          {booking.status === 'cancelled' && (
            <Alert tone="danger" title={booking.cancelled_by === 'customer' ? 'Cancelled by the customer' : 'Cancelled by staff'}>
              {booking.cancel_reason || 'No reason was given.'}
            </Alert>
          )}

          <DetailList
            items={[
              { label: 'Customer', value: [booking.customer?.name, booking.customer?.phone, booking.customer?.company].filter(Boolean).join(' · ') || 'Not given' },
              { label: 'Pickup', value: booking.pickup_address },
              { label: 'Drop-off', value: booking.drop_address },
              { label: 'Pickup date', value: formatDate(`${booking.pickup_date}T12:00:00+05:30`) },
              { label: 'Weight', value: <span className="tabular">{formatKg(booking.weight_kg)}</span> },
              { label: 'Load', value: booking.load_type === 'part' ? 'Part load' : 'Full truck' },
              ...(booking.vehicle_type ? [{ label: 'Vehicle asked for', value: humanize(booking.vehicle_type) }] : []),
              { label: 'Quoted price', value: booking.quoted_price != null ? <span className="tabular">{formatRupees(booking.quoted_price)}, before GST</span> : 'Not priced. Quote the customer directly.' },
              ...(booking.tracking_id ? [{ label: 'Tracking ID', value: <span className="font-mono">{booking.tracking_id}</span> }] : []),
            ]}
          />

          {canAssign && (
            <section aria-labelledby="booking-assign-heading" className="space-y-3">
              <div>
                <h3 id="booking-assign-heading" className="text-base font-semibold text-text">Choose a vehicle</h3>
                <p className="mt-0.5 text-sm text-muted">Vehicles with at least {formatKg(booking.weight_kg)} free.</p>
              </div>
              {vehicles.error ? (
                <ErrorState compact description="We could not load vehicles." onRetry={() => vehicles.refetch()} />
              ) : (
                <Select
                  label="Vehicle"
                  placeholder={vehicles.isLoading ? 'Loading vehicles' : withSpace.length === 0 ? 'No vehicle has enough space' : 'Choose a vehicle'}
                  value={vehicleId}
                  onChange={e => setVehicleChoice({ bookingId: booking.id, vehicleId: e.target.value })}
                  options={withSpace.map(v => ({ value: v.id, label: `${v.plate_number}${v.vehicle_type ? ` · ${humanize(v.vehicle_type)}` : ''} · ${formatKg(v.available_capacity_kg)} free${licenceSuffix(licences.get(v.id))}` }))}
                />
              )}
              {vehicleId && <div><DriverLicenceBadge status={licences.get(vehicleId)} /></div>}
              <Alert tone="info">Assigning puts the shipment on the vehicle’s route and tells the customer.</Alert>
            </section>
          )}
        </div>
      )}
    </Drawer>
  )
}
