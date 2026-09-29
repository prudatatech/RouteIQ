/**
 * Tab slots of the vehicle page (/fleet/:vehicleId).
 *
 *   LocationTabSlot     -> components/fleet/location/VehicleLocationPanel (GPS, trail, activity, share)
 *   MaintenanceTabSlot  -> VehicleHealthPanel (health score + VehicleMaintenanceTab: condition bars, open job, service history)
 *   FuelTabSlot         -> reported tank level + components/fleet/fuel/VehicleFuelTab (fill-ups, mileage, anomalies)
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
