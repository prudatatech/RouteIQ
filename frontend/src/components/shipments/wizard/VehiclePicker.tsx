import { useMemo, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import clsx from 'clsx'
import { Ban, ChevronDown } from 'lucide-react'
import { Button, EmptyState, StatusPill } from '@/components/ui'
import { DriverLicenceBadge } from '@/components/people/DriverLicenceBadge'
import { fetchDrivingRoute } from '@/components/map'
import { formatKg, formatKm, formatMinutes, formatRelative } from '@/utils/display'
import type { AssignableVehicle, AssignSubject, VehicleAssessment } from '../assignVehicle'
import { NEARBY_VEHICLE_RADIUS_KM, etaCandidates, nearbyVehicles, widerRadius } from './nearbyVehicles'

interface Props {
  vehicles: AssignableVehicle[]
  /** Pickup point; null until one is chosen, and then no distance filter is applied. */
  pickup: { lat: number; lng: number } | null
  weightKg: number
  selectedId: string
  onSelect: (id: string) => void
  /** Offer "No vehicle yet" (direct assignment can be done later). */
  allowNone: boolean
  error?: string
}

const radiusLabel = (km: number | null) => (km === null ? 'any distance' : `${km} km`)

/**
 * Vehicles near the pickup for the wizard's vehicle step: only those within the radius, nearest
 * first, with distance and driving time; vehicles with no position collapsed apart; a way to widen
 * the list when nothing is near. Ranking and blocked reasons are those of Assign vehicle.
 */
export default function VehiclePicker({ vehicles, pickup, weightKg, selectedId, onSelect, allowNone, error }: Props) {
  const pickupKey = pickup ? `${pickup.lat.toFixed(5)},${pickup.lng.toFixed(5)}` : ''
  // Widening applies to one pickup; a new pickup starts again at the base radius.
  const [widened, setWidened] = useState<{ key: string; radius: number | null }>({ key: '', radius: NEARBY_VEHICLE_RADIUS_KM })
  const radiusKm = widened.key === pickupKey ? widened.radius : NEARBY_VEHICLE_RADIUS_KM

  const subject = useMemo<AssignSubject>(() => ({ label: 'New shipment', pickup, weightKg }), [pickup, weightKg])
  const groups = useMemo(
    () => nearbyVehicles(vehicles, subject, radiusKm, { keepId: selectedId || null }),
    [vehicles, subject, radiusKm, selectedId],
  )

  // Driving time to the pickup for the nearest vehicles that can be chosen
  const candidates = useMemo(() => (pickup ? etaCandidates(groups.nearby) : []), [pickup, groups.nearby])
  const etas = useQueries({
    queries: candidates.map(a => ({
      queryKey: ['vehicle-eta', a.vehicle.id, Number(a.vehicle.latitude).toFixed(3), Number(a.vehicle.longitude).toFixed(3), pickupKey],
      queryFn: () => fetchDrivingRoute([{ lat: Number(a.vehicle.latitude), lng: Number(a.vehicle.longitude) }, pickup!]),
      staleTime: 3 * 60_000,
      retry: false,
    })),
  })
  const etaMinutes = new Map<string, number>()
  candidates.forEach((a, i) => {
    const seconds = etas[i]?.data?.durationSeconds
    if (seconds) etaMinutes.set(a.vehicle.id, seconds / 60)
  })

  const wider = widerRadius(radiusKm)
  const showFarther = () => setWidened({ key: pickupKey, radius: wider === undefined ? radiusKm : wider })

  const row = (a: VehicleAssessment) => {
    const v = a.vehicle
    const blocked = a.blockedReason
    const active = selectedId === v.id
    const eta = etaMinutes.get(v.id)
    const seen = v.last_heartbeat ?? v.last_sync
    return (
      <li key={v.id}>
        <label className={clsx(
          'flex items-start gap-3 rounded-control border p-3 transition-colors',
          blocked ? 'cursor-not-allowed bg-surface-subtle opacity-80' : 'cursor-pointer hover:bg-surface-subtle',
          active ? 'border-brand bg-brand-soft' : 'border-border',
        )}>
          <input
            type="radio"
            name="wizard_vehicle"
            checked={active}
            disabled={!!blocked}
            onChange={() => onSelect(v.id)}
            className="mt-1 h-4 w-4 shrink-0 accent-brand"
          />
          <span className="min-w-0 flex-1 space-y-1 text-sm">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-mono font-medium text-text">{v.plate_number}</span>
              <StatusPill status={v.status} />
              <DriverLicenceBadge variant="choice" status={v.driver_licence_status} />
            </span>
            <span className="flex flex-wrap gap-x-3 text-muted">
              {a.distanceKm !== null && <span className="tabular">{formatKm(a.distanceKm)} from pickup{eta ? ` · about ${formatMinutes(eta)} drive` : ''}</span>}
              {a.distanceKm === null && seen && <span>Last seen {formatRelative(seen)}</span>}
              <span className="tabular">{a.freeKg == null ? 'Capacity unknown' : `${formatKg(a.freeKg)} free`}</span>
            </span>
            {blocked && <span className="inline-flex items-center gap-1 text-xs font-medium text-danger"><Ban size={12} aria-hidden="true" />{blocked}</span>}
          </span>
        </label>
      </li>
    )
  }

  const nothingNear = groups.hasPickup && groups.nearby.length === 0

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-text">Vehicle</h3>
        <p className="text-xs text-muted">
          {groups.hasPickup ? `Within ${radiusLabel(radiusKm)} of the pickup, nearest first.` : 'Choose a pickup to see only the vehicles near it.'}
        </p>
      </div>

      {allowNone && (
        <label className={clsx('flex cursor-pointer items-center gap-3 rounded-control border p-3 text-sm', !selectedId ? 'border-brand bg-brand-soft' : 'border-border hover:bg-surface-subtle')}>
          <input type="radio" name="wizard_vehicle" checked={!selectedId} onChange={() => onSelect('')} className="h-4 w-4 shrink-0 accent-brand" />
          <span className="text-text">No vehicle yet <span className="text-muted">(assign one later)</span></span>
        </label>
      )}

      {nothingNear ? (
        <EmptyState
          compact
          title={`No vehicles within ${radiusLabel(radiusKm)} of the pickup`}
          description={groups.fartherCount > 0
            ? `${groups.fartherCount} ${groups.fartherCount === 1 ? 'vehicle is' : 'vehicles are'} farther away.`
            : 'No vehicle with a known position is farther away either.'}
          action={groups.fartherCount > 0 && wider !== undefined
            ? <Button size="sm" variant="secondary" onClick={showFarther}>Show vehicles farther away</Button>
            : undefined}
        />
      ) : (
        <ul className="space-y-2">{groups.nearby.map(row)}</ul>
      )}

      {!nothingNear && groups.fartherCount > 0 && wider !== undefined && (
        <Button size="sm" variant="ghost" onClick={showFarther}>
          Show vehicles farther away ({groups.fartherCount})
        </Button>
      )}

      {groups.unknown.length > 0 && (
        <details className="group rounded-control border border-border" open={groups.unknown.some(a => a.vehicle.id === selectedId)}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium text-text">
            <span>Position unknown ({groups.unknown.length})</span>
            <ChevronDown size={16} aria-hidden="true" className="transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-2 border-t border-border p-3">
            <p className="text-xs text-muted">These vehicles have not reported a position, so their distance to the pickup is not known.</p>
            <ul className="space-y-2">{groups.unknown.map(row)}</ul>
          </div>
        </details>
      )}

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  )
}
