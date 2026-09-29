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
import { Fuel, Navigation } from 'lucide-react'
import { Card, CardBody, CardHeader, DetailList, StatusPill } from '@/components/ui'
import { MapView } from '@/components/map'
import VehicleHealthPanel from '@/components/fleet/VehicleHealthPanel'
import { formatRelative } from '@/utils/display'
import { formatOdometer } from '@/components/fleet/health'
import { lastSeenAt } from '@/utils/vehicles'
import type { Vehicle } from '@/components/fleet/types'

export interface SlotProps {
  vehicle: Vehicle
  /** Reported in within the live limit. */
  isLive: boolean
  /** Clock for "last seen" labels. */
  now: number
}

// ── SLOT: Location ──────────────────────────────────────────
export function LocationTabSlot({ vehicle, isLive, now }: SlotProps) {
  const ping = lastSeenAt(vehicle)
  return (
    <div data-tab-slot="location" className="space-y-4">
      <div className="h-80 overflow-hidden rounded-card border border-border">
        {vehicle.latitude != null && vehicle.longitude != null ? (
          <MapView
            mode="tracking"
            vehicles={[{
              id: vehicle.id,
              position: { lat: vehicle.latitude, lng: vehicle.longitude },
              status: vehicle.status,
              label: vehicle.plate_number,
              vehicle_type: vehicle.vehicle_type,
            }]}
            selectedId={vehicle.id}
            interactive={false}
            ariaLabel={`Map showing ${vehicle.plate_number}`}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted">
            <Navigation size={22} aria-hidden="true" />
            No GPS signal for this vehicle.
          </div>
        )}
      </div>
      <Card>
        <CardBody>
          <DetailList
            columns={3}
            items={[
              { label: 'Last seen', value: isLive ? <StatusPill tone="success">Live</StatusPill> : (ping ? formatRelative(ping, now) : 'No GPS data') },
              {
                label: 'Coordinates',
                value: vehicle.latitude != null && vehicle.longitude != null
                  ? <span className="font-mono text-xs">{vehicle.latitude.toFixed(5)}, {vehicle.longitude.toFixed(5)}</span>
                  : 'Unknown',
              },
              { label: 'Place', value: vehicle.current_location_name || 'Not named' },
              { label: 'GPS device', value: vehicle.spark_id || 'Not linked' },
              { label: 'Speed', value: vehicle.speed_kmh != null ? `${Math.round(vehicle.speed_kmh)} km/h` : 'Not reported' },
            ]}
          />
        </CardBody>
      </Card>
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
    </div>
  )
}
