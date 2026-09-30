import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { AlertTriangle, Ban, Truck, User } from 'lucide-react'
import { Button, Checkbox, EmptyState, ErrorState, Modal, SearchInput, Skeleton, StatusPill, humanize, useConfirm } from '@/components/ui'
import LiveMap from '@/components/map/LiveMap'
import { bookingsAPI, fleetAPI, shipmentsAPI, vehiclesAPI, vendorAPI, type CustomerBooking } from '@/services/api'
import { DriverLicenceBadge } from '@/components/people/DriverLicenceBadge'
import { fleetKeys, type FleetAlert } from '@/components/fleet/health'
import type { VendorRequest } from '@/components/requests/model'
import { customerName, shortPlace, vendorName } from '@/components/requests/model'
import { errorMessage, formatKg, formatKm } from '@/utils/display'
import { assessVehicles, type AssignableVehicle, type AssignSubject, type VehicleAssessment } from './assignVehicle'
import type { ShipmentRow } from './types'

/** What happened when the vehicle was assigned, for the caller to show the next step. */
export interface AssignResult {
  kind: 'shipment' | 'booking' | 'vendor'
  vehicleId: string
  plate: string
  /** Ids of the shipment, booking or vendor loads that now have the vehicle. */
  assignedIds: string[]
  failed: { id: string; message: string }[]
}

interface Props {
  /** Give a vehicle to this shipment (the original use of this dialog). */
  shipment?: ShipmentRow | null
  /** ... to this customer booking, which must be accepted first. */
  booking?: CustomerBooking | null
  /** ... or to one or more vendor loads, which must be accepted at a price first. All get the same vehicle. */
  loads?: VendorRequest[] | null
  onClose: () => void
  /** Called after at least one assignment went through, before the dialog closes. */
  onAssigned?: (result: AssignResult) => void
}

function subjectOf({ shipment, booking, loads }: Pick<Props, 'shipment' | 'booking' | 'loads'>): (AssignSubject & { kind: AssignResult['kind']; count: number }) | null {
  if (shipment) {
    const required = (shipment as { required_vehicle_type?: string | null }).required_vehicle_type
    return {
      kind: 'shipment',
      count: 1,
      label: shipment.tracking_id,
      pickup: shipment.origin_lat != null && shipment.origin_lng != null ? { lat: Number(shipment.origin_lat), lng: Number(shipment.origin_lng) } : null,
      weightKg: Number(shipment.total_weight_kg) || 0,
      vehicleType: required ?? null,
    }
  }
  if (booking) {
    return {
      kind: 'booking',
      count: 1,
      label: `${customerName(booking)}, ${shortPlace(booking.pickup_name)} to ${shortPlace(booking.drop_name)}`,
      pickup: booking.pickup_lat != null && booking.pickup_lng != null ? { lat: Number(booking.pickup_lat), lng: Number(booking.pickup_lng) } : null,
      weightKg: Number(booking.weight_kg) || 0,
      vehicleType: booking.vehicle_type,
    }
  }
  if (loads && loads.length > 0) {
    const first = loads[0]
    return {
      kind: 'vendor',
      count: loads.length,
      label: loads.length === 1 ? `${vendorName(first)}, ${shortPlace(first.pickup_location)} to ${shortPlace(first.drop_location)}` : `${loads.length} vendor loads`,
      pickup: first.pickup_lat != null && first.pickup_lng != null ? { lat: Number(first.pickup_lat), lng: Number(first.pickup_lng) } : null,
      weightKg: loads.reduce((sum, r) => sum + (Number(r.required_capacity_kg) || 0), 0),
      vehicleType: null,
    }
  }
  return null
}

/**
 * The one screen for giving a vehicle to work: a shipment, a customer booking or vendor loads. It lists every
 * vehicle with its driver, status, free space against the goods, distance to the pickup, open problems and
 * document warnings, and blocks the ones that cannot take the work (no driver, in maintenance, archived,
 * waiting for approval, not enough space). The server checks the same rules again.
 */
export default function AssignVehicleModal({ shipment = null, booking = null, loads = null, onClose, onAssigned }: Props) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { confirm } = useConfirm()
  const subject = useMemo(() => subjectOf({ shipment, booking, loads }), [shipment, booking, loads])
  const open = subject !== null
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  // Sending the trip to the driver is a choice: unchecked, the trip waits in Dispatch under Trips to send
  const [sendNow, setSendNow] = useState(true)

  const vehicles = useQuery<AssignableVehicle[]>({
    queryKey: ['vehicles', 'assign'],
    queryFn: () => vehiclesAPI.list({ limit: 500 }) as Promise<AssignableVehicle[]>,
    enabled: open,
    staleTime: 15_000,
  })
  const alerts = useQuery<FleetAlert[]>({
    queryKey: fleetKeys.alerts('active'),
    queryFn: () => fleetAPI.alerts('active') as Promise<FleetAlert[]>,
    enabled: open,
    staleTime: 15_000,
  })

  const problemCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const a of alerts.data ?? []) {
      if (a.is_test || a.status === 'resolved') continue
      counts.set(a.vehicle_id, (counts.get(a.vehicle_id) ?? 0) + 1)
    }
    return counts
  }, [alerts.data])

  const assessments = useMemo(
    () => (subject && vehicles.data ? assessVehicles(vehicles.data, subject, problemCounts) : []),
    [vehicles.data, problemCounts, subject],
  )
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return assessments
    return assessments.filter(a => [a.vehicle.plate_number, a.vehicle.driver_name, a.vehicle.vehicle_type, a.vehicle.vehicle_model].some(t => t?.toLowerCase().includes(q)))
  }, [assessments, search])
  const available = assessments.filter(a => !a.blockedReason).length

  const close = () => { setSearch(''); onClose() }

  const assign = async (a: VehicleAssessment) => {
    if (!subject || busyId) return
    const plate = a.vehicle.plate_number
    if (subject.count > 1) {
      const ok = await confirm({
        title: `Assign ${plate} to ${subject.count} loads?`,
        message: 'The vehicle is assigned to every selected load, and the loads are added to its shipments.',
        confirmLabel: 'Assign vehicle',
      })
      if (!ok) return
    }
    setBusyId(a.vehicle.id)
    const assignedIds: string[] = []
    const failed: AssignResult['failed'] = []
    try {
      if (shipment) {
        try { await shipmentsAPI.assignDriver(shipment.id, a.vehicle.id, sendNow); assignedIds.push(shipment.id) }
        catch (err) { failed.push({ id: shipment.id, message: errorMessage(err, 'We could not assign the vehicle. Try again.') }) }
      } else if (booking) {
        try { await bookingsAPI.assign(booking.id, a.vehicle.id, sendNow); assignedIds.push(booking.id) }
        catch (err) { failed.push({ id: booking.id, message: errorMessage(err, 'We could not assign the vehicle. Try again.') }) }
      } else if (loads) {
        for (const load of loads) {
          try { await vendorAPI.assignVehicle(load.id, { vehicle_id: a.vehicle.id, dispatch: sendNow }); assignedIds.push(load.id) }
          catch (err) { failed.push({ id: load.id, message: `${vendorName(load)}: ${errorMessage(err, 'failed')}` }) }
        }
      }
    } finally {
      setBusyId(null)
    }
    for (const key of ['shipments', 'vehicles', 'fleet-summary', 'customer-bookings', 'vendor-requests', 'assign-options']) {
      queryClient.invalidateQueries({ queryKey: [key] })
    }
    if (failed.length > 0) {
      toast.error(assignedIds.length === 0 ? failed[0].message : `Assigned ${assignedIds.length}, ${failed.length} failed: ${failed.slice(0, 3).map(f => f.message).join('; ')}`)
    } else if (!sendNow) {
      toast.success(
        (t) => (
          <span>
            Assigned. Send the trip from Dispatch → Trips to send.{' '}
            <button type="button" className="font-medium underline" onClick={() => { toast.dismiss(t.id); navigate('/routes?status=pending') }}>Open Trips to send</button>
          </span>
        ),
        { duration: 8000 },
      )
    } else {
      toast.success(subject.kind === 'booking' ? 'Vehicle assigned. The customer has been told.' : subject.kind === 'vendor' ? 'Vehicle assigned. The load was added to its shipments.' : 'Vehicle assigned')
    }
    if (assignedIds.length > 0) {
      onAssigned?.({ kind: subject.kind, vehicleId: a.vehicle.id, plate, assignedIds, failed })
      close()
    }
  }

  const mapVehicles = shown
    .filter(a => a.vehicle.latitude != null && a.vehicle.longitude != null)
    .map(a => ({ id: a.vehicle.id, plate_number: a.vehicle.plate_number, status: a.vehicle.status ?? 'unknown', latitude: a.vehicle.latitude as number, longitude: a.vehicle.longitude as number, vehicle_type: a.vehicle.vehicle_type ?? undefined }))

  return (
    <Modal
      open={open}
      onClose={close}
      title="Assign vehicle"
      description={subject
        ? `Choose a vehicle for ${subject.label}, ${formatKg(subject.weightKg)}. ${subject.pickup ? 'Vehicles nearest the pickup are listed first.' : 'The pickup has no position, so distances are not shown.'}`
        : undefined}
      size="xl"
      footer={<Button variant="secondary" onClick={close}>Cancel</Button>}
    >
      <div className="space-y-4">
        {mapVehicles.length > 0 && (
          <div className="hidden h-44 overflow-hidden rounded-card border border-border md:block">
            <LiveMap vehicles={mapVehicles} />
          </div>
        )}
        <Checkbox
          checked={sendNow}
          onChange={e => setSendNow(e.target.checked)}
          label="Send to driver now"
          description="The driver is told and the trip starts. Uncheck to send it later from Dispatch, Trips to send."
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <SearchInput value={search} onChange={setSearch} label="Search vehicles" placeholder="Plate, driver or type" className="w-full sm:max-w-xs" />
          {vehicles.data && <p className="text-sm text-muted">{available} of {assessments.length} {assessments.length === 1 ? 'vehicle' : 'vehicles'} can take this</p>}
        </div>

        {vehicles.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
        ) : vehicles.error ? (
          <ErrorState compact description="We could not load vehicles. Check your connection and try again." onRetry={() => vehicles.refetch()} />
        ) : shown.length === 0 ? (
          <EmptyState compact icon={<Truck size={22} />} title={search ? 'No vehicle matches your search' : 'No vehicles yet'} description={search ? 'Try a plate number or a driver name.' : 'Add a vehicle in Fleet, then come back.'} />
        ) : (
          <ul aria-label="Vehicles" className="space-y-2">
            {shown.map(a => (
              <VehicleRow key={a.vehicle.id} a={a} weightKg={subject?.weightKg ?? 0} busy={busyId === a.vehicle.id} disabled={busyId !== null} onAssign={() => assign(a)} />
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}

function VehicleRow({ a, weightKg, busy, disabled, onAssign }: { a: VehicleAssessment; weightKg: number; busy: boolean; disabled: boolean; onAssign: () => void }) {
  const v = a.vehicle
  const blocked = a.blockedReason
  const fits = a.freeKg == null || weightKg <= 0 || a.freeKg >= weightKg
  return (
    <li className={clsx('rounded-control border border-border p-3', blocked ? 'bg-surface-subtle' : 'bg-surface')}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-sm font-medium text-text">{v.plate_number}</span>
            {(v.vehicle_model || v.vehicle_type) && <span className="text-xs text-muted">{v.vehicle_model || humanize(v.vehicle_type)}</span>}
            <StatusPill status={v.status} />
          </div>
          <p className={clsx('flex items-center gap-1.5 text-sm', v.driver_id ? 'text-text' : 'font-medium text-danger')}>
            <User size={14} aria-hidden="true" className="shrink-0" />
            <span className="truncate">{v.driver_id ? (v.driver_name || 'Driver assigned') : 'No driver'}</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            <DriverLicenceBadge status={v.driver_licence_status} />
            {a.problems > 0 && (
              <StatusPill tone="danger" dot={false}>
                <AlertTriangle size={12} aria-hidden="true" className="mr-1" />{a.problems} open {a.problems === 1 ? 'problem' : 'problems'}
              </StatusPill>
            )}
            {a.warnings.map(w => <StatusPill key={w} tone="warning" dot={false}>{w}</StatusPill>)}
          </div>
        </div>
        <div className="flex items-end justify-between gap-4 sm:flex-col sm:items-end sm:text-right">
          <div className="space-y-0.5 text-sm">
            <p className={clsx('tabular', !fits && 'font-medium text-danger')}>
              {a.freeKg == null ? 'Capacity unknown' : <>{formatKg(a.freeKg)} free</>}
              {a.freeKg != null && weightKg > 0 && <span className="text-muted"> for {formatKg(weightKg)}</span>}
            </p>
            <p className="tabular text-muted">{a.distanceKm == null ? 'Distance unknown' : `${formatKm(a.distanceKm)} from pickup`}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            {blocked && <span className="inline-flex items-center gap-1 text-xs font-medium text-danger"><Ban size={12} aria-hidden="true" />{blocked}</span>}
            <Button
              size="sm"
              variant={blocked ? 'secondary' : 'primary'}
              loading={busy}
              disabled={!!blocked || disabled}
              onClick={onAssign}
              aria-label={`Assign ${v.plate_number}`}
            >
              Assign
            </Button>
          </div>
        </div>
      </div>
    </li>
  )
}
