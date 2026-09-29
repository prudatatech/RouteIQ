/**
 * Tab slots of the vehicle page (/fleet/:vehicleId).
 *
 * Location, Maintenance and Fuel are built as their own components and wired in here, one slot each.
 * Until then a slot shows what the old Fleet drawer showed for that subject, from the vehicle's own
 * fields, so no feature is lost. To wire a feature in after merge, replace the body of its slot with
 * the feature's component (props: the vehicle) and delete the fallback:
 *
 *   LocationTabSlot     -> components/fleet/location/VehicleLocationPanel     (GPS, trail, share)
 *   MaintenanceTabSlot  -> components/fleet/maintenance/VehicleMaintenanceTab (+ VehicleConditionCard)
 *   FuelTabSlot         -> components/fleet/fuel/VehicleFuelTab
 *
 * Every slot renders inside <div data-tab-slot="...">, which is what to look for.
 */
import { Fuel } from 'lucide-react'
import { Card, CardBody, CardHeader, DetailList } from '@/components/ui'
import { VehicleLocationPanel } from '@/components/fleet/location/VehicleLocationPanel'
import VehicleFuelTab from '@/components/fleet/fuel/VehicleFuelTab'
import VehicleHealthPanel from '@/components/fleet/VehicleHealthPanel'
import { formatOdometer } from '@/components/fleet/health'
import type { Vehicle } from '@/components/fleet/types'

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
  const pct = capacity > 0 && current != null ? Math.min(100, Math.round((current / capacity) * 100)) : null
  return (
    <div data-tab-slot="fuel" className="space-y-4">
      <Card>
        <CardHeader title="Fuel" description="What the vehicle reports" />
        <CardBody className="space-y-4">
          {pct != null && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="inline-flex items-center gap-1.5 text-text"><Fuel size={14} className="text-muted" aria-hidden="true" /> {current!.toLocaleString('en-IN', { maximumFractionDigits: 0 })} of {capacity.toLocaleString('en-IN')} L</span>
                <span className="tabular text-muted">{pct}%</span>
              </div>
              <div role="progressbar" aria-label={`Fuel ${pct}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 overflow-hidden rounded-full bg-neutral-soft">
                <div className={'h-full rounded-full ' + (pct < 15 ? 'bg-danger' : pct < 30 ? 'bg-warning' : 'bg-success')} style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}
          <DetailList
            items={[
              { label: 'Fuel', value: vehicle.fuel_capacity_liters ? `${(vehicle.current_fuel_liters ?? 0).toLocaleString('en-IN')} / ${vehicle.fuel_capacity_liters.toLocaleString('en-IN')} L` : 'Tank size not recorded' },
              { label: 'Fuel type', value: vehicle.fuel_type ? vehicle.fuel_type.toUpperCase() : 'Not recorded' },
              { label: 'Odometer', value: formatOdometer(vehicle.odometer_km) },
            ]}
          />
        </CardBody>
      </Card>
      <VehicleFuelTab key={vehicle.id} vehicleId={vehicle.id} />
    </div>
  )
}
