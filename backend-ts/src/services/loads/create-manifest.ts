/**
 * margixindia — Putting a vendor load on a vehicle: the manifest and what follows it.
 *
 * One path for both ways a load gets a truck: a company assigning one of its own vehicles
 * (vendor.service assignVehicleToRequest) and a 3PL partner accepting an offer with its own
 * vehicle and driver (tpl-network.service accept). The caller claims the request first; this
 * file checks the vehicle's room, writes the manifest (with the goods lines), puts the load on
 * the vehicle and tells the driver.
 */
import { supabase } from '../../core/supabase';
import { HttpError } from '../../core/errors';
import { OPERATING_VEHICLE_STATUSES } from '../../core/transitions';
import { carrierStamp, ownersOf } from '../../core/org-context';
import { copyItemsToManifest } from './loads.service';
import { notificationService } from '../notification.service';

export interface CapacityVehicle {
  capacity_kg?: number | string | null;
  current_load_kg?: number | string | null;
  available_capacity_kg?: number | string | null;
}

/**
 * Free capacity: what the vehicle reports, else its rated capacity less what it already carries
 * (null when neither is known). Throws 409 when the load does not fit.
 */
export function assertCapacity(vehicle: CapacityVehicle, requiredKg: number | string | null | undefined): { required: number; free: number | null } {
  const required = Number(requiredKg) || 0;
  const rated = Number(vehicle.capacity_kg);
  const free = vehicle.available_capacity_kg != null
    ? Number(vehicle.available_capacity_kg)
    : Number.isFinite(rated) && rated > 0 ? rated - (Number(vehicle.current_load_kg) || 0) : null;
  if (free !== null && required > free) {
    throw new HttpError(409, `This vehicle has ${Math.max(0, Math.round(free)).toLocaleString('en-IN')} kg free and the load needs ${required.toLocaleString('en-IN')} kg`);
  }
  return { required, free };
}

export interface ManifestOptions {
  /**
   * A 3PL partner organisation that runs the trip. The manifest stays with the company the load was
   * awarded to (`carrier_org_id`, from the load) and records the partner in metadata.executed_by_org.
   */
  executedByOrg?: string | null;
  /** The company that stays responsible, when the load row does not say (it wins over the load's own). */
  carrierOrgId?: string | null;
}

/**
 * Inserts the cargo_manifest of a vendor load for a vehicle and copies the goods lines to it.
 * Throws `Failed to create manifest: ...` when the insert fails, so the caller can release its claim.
 */
export async function insertManifest(load: Record<string, any>, vehicleId: string, opts: ManifestOptions = {}): Promise<{ id: string }> {
  // A partner's own org must never be stamped as the carrier of a trip it runs for a company
  const stamp = opts.executedByOrg ? {} : carrierStamp();
  const { data: manifest, error } = await supabase.from('cargo_manifest').insert({
    ...stamp,
    ...ownersOf(load),
    ...(opts.carrierOrgId ? { carrier_org_id: opts.carrierOrgId } : {}),
    ...(opts.executedByOrg ? { metadata: { executed_by_org: opts.executedByOrg } } : {}),
    vehicle_id: vehicleId,
    vendor_request_id: load.id,
    pickup_location: load.pickup_location,
    pickup_lat: load.pickup_lat,
    pickup_lng: load.pickup_lng,
    drop_location: load.drop_location,
    drop_lat: load.drop_lat,
    drop_lng: load.drop_lng,
    capacity_kg: load.required_capacity_kg,
    status: 'scheduled',
    created_at: new Date().toISOString(),
  }).select('id').single();

  if (!error && manifest?.id) await copyItemsToManifest(load, manifest.id);
  if (error) {
    console.error('Failed to create cargo_manifest:', error);
    throw new Error(`Failed to create manifest: ${error.message}`);
  }
  return { id: manifest!.id };
}

/**
 * The load now sits on the vehicle. A vendor load has no trip to hold back in Dispatch, so assigning it
 * always sends it: the vehicle goes on the road (only from an operating status, so a vehicle that went into
 * maintenance meanwhile is left alone) and the driver is told.
 */
export async function putLoadOnVehicle(
  vehicle: CapacityVehicle & { driver_id?: string | null },
  vehicleId: string,
  load: Record<string, any>,
  capacity: { required: number; free: number | null },
): Promise<void> {
  const newLoad = (Number(vehicle.current_load_kg) || 0) + capacity.required;
  const newAvail = Math.max(0, (capacity.free ?? 0) - capacity.required);
  await supabase.from('vehicles').update({
    current_load_kg: newLoad,
    available_capacity_kg: newAvail,
    status: 'on_route',
  }).eq('id', vehicleId).in('status', [...OPERATING_VEHICLE_STATUSES]);

  if (vehicle.driver_id) {
    // Notify the driver instantly so the listener triggers
    await notificationService.sendNotification(
      vehicle.driver_id,
      'New pickup assigned',
      `A new pickup has been scheduled at ${load.pickup_location}.`,
      'cargo_assigned',
      { request_id: load.id, vehicle_id: vehicleId },
    );
  }
}
