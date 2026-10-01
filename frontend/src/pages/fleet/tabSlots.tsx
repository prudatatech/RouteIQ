/**
 * Tab slots of the vehicle page (/fleet/:vehicleId).
 *
 *   LocationTabSlot     -> components/fleet/location/VehicleLocationPanel (GPS, trail, activity, share) and TripReplayCard
 *   MaintenanceTabSlot  -> VehicleHealthPanel (health score + VehicleMaintenanceTab: condition bars, open job, service history)
 *   FuelTabSlot         -> reported tank level + components/fleet/fuel/VehicleFuelTab (fill-ups, mileage, anomalies)
 */
import { Fuel } from 'lucide-react'
import { Card, CardBody, CardHeader, humanize } from '@/components/ui'
import { VehicleLocationPanel } from '@/components/fleet/location/VehicleLocationPanel'
import { TripReplayCard } from '@/components/fleet/location/TripReplayCard'
import VehicleFuelTab from '@/components/fleet/fuel/VehicleFuelTab'
import VehicleHealthPanel from '@/components/fleet/VehicleHealthPanel'
import type { Vehicle } from '@/components/fleet/types'
import { lastSeenAt } from '@/utils/vehicles'

export interface SlotProps {
  vehicle: Vehicle
  /** Reported in within the live limit. */
  isLive: boolean
  /** Clock for "last seen" labels. */
  now: number
}

// ── SLOT: Location ──────────────────────────────────────────
export function LocationTabSlot({ vehicle }: SlotProps) {
  return (
    <div data-tab-slot="location" className="space-y-4">
      <VehicleLocationPanel key={vehicle.id} vehicleId={vehicle.id} />
      <TripReplayCard key={`replay-${vehicle.id}`} vehicleId={vehicle.id} plate={vehicle.plate_number} />
    </div>
  )
}

// ── SLOT: Maintenance ───────────────────────────────────────
export function MaintenanceTabSlot({ vehicle }: SlotProps) {
  return (
    <div data-tab-slot="maintenance" className="space-y-4">
      <VehicleHealthPanel key={vehicle.id} vehicleId={vehicle.id} plate={vehicle.plate_number} />
    </div>
  )
}

// ── SLOT: Fuel ──────────────────────────────────────────────
export function FuelTabSlot({ vehicle }: SlotProps) {
  const capacity = vehicle.fuel_capacity_liters ?? 0
  const current = vehicle.current_fuel_liters ?? null
  // The stored level is only a reading when the vehicle's device has reported in
  const reported = lastSeenAt(vehicle) != null
  const pct = reported && capacity > 0 && current != null ? Math.min(100, Math.round((current / capacity) * 100)) : null
  return (
    <div data-tab-slot="fuel" className="space-y-4">
      <Card>
        <CardHeader
          title="Tank level"
          description={vehicle.fuel_type ? `${humanize(vehicle.fuel_type)}, as the vehicle reports it` : 'As the vehicle reports it'}
        />
        <CardBody>
          {pct != null ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="inline-flex min-w-0 items-center gap-1.5 text-text"><Fuel size={16} className="shrink-0 text-muted" aria-hidden="true" /> {current!.toLocaleString('en-IN', { maximumFractionDigits: 0 })} of {capacity.toLocaleString('en-IN')} L</span>
                <span className="tabular text-muted">{pct}%</span>
              </div>
              <div role="progressbar" aria-label={`Fuel ${pct}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 overflow-hidden rounded-full bg-neutral-soft">
                <div className={'h-full rounded-full ' + (pct < 15 ? 'bg-danger' : pct < 30 ? 'bg-warning' : 'bg-success')} style={{ width: `${pct}%` }} />
              </div>
            </div>
          ) : !reported ? (
            <p className="text-sm text-muted">Not reported. The vehicle has not sent a reading yet{capacity > 0 ? `, so its ${capacity.toLocaleString('en-IN')} L tank is shown as unknown.` : '.'}</p>
          ) : (
            <p className="text-sm text-muted">The tank size is not recorded. Add it by editing the vehicle to see the level here.</p>
          )}
        </CardBody>
      </Card>
      <VehicleFuelTab key={vehicle.id} vehicleId={vehicle.id} />
    </div>
  )
}
