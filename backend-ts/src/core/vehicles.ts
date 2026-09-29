/**
 * margixindia — Vehicle rules shared by dispatch, the fleet views and the heartbeat monitor.
 *
 * One definition of each, so a truck is never "available" in one screen and
 * "not dispatchable" in another:
 *  - placeholder: an auto-created stand-in (TEMP-… from a driver's first login,
 *    DRFT-… from an unfinished wizard). Not a fleet asset.
 *  - dispatchable: can be offered work.
 *  - live: reported in recently (see `isLive`).
 */
import { supabase } from './supabase';
import { HttpError } from './errors';
import { OPERATING_VEHICLE_STATUSES, PENDING_VEHICLE_STATUS, VEHICLE_STATUS_TRANSITIONS, assertTransition } from './transitions';

export const PLACEHOLDER_PLATE_PREFIXES = ['TEMP-', 'DRFT-'] as const;

/** True for an auto-created placeholder plate (TEMP-… or DRFT-…). */
export function isPlaceholderPlate(plate: string | null | undefined): boolean {
  const p = String(plate ?? '').toUpperCase();
  return PLACEHOLDER_PLATE_PREFIXES.some(prefix => p.startsWith(prefix));
}

/** True for the TEMP-… stand-in created when a driver first signs in. */
export function isTempPlate(plate: string | null | undefined): boolean {
  return String(plate ?? '').toUpperCase().startsWith('TEMP-');
}

/**
 * Statuses in which a vehicle can be offered work. Offline trucks are
 * included (a truck losing signal is still a truck); maintenance and
 * archived are not.
 */
export const DISPATCHABLE_STATUSES = OPERATING_VEHICLE_STATUSES;

export function isDispatchable(vehicle: { status?: string | null; plate_number?: string | null }): boolean {
  return (DISPATCHABLE_STATUSES as readonly string[]).includes(String(vehicle.status ?? ''))
    && !isPlaceholderPlate(vehicle.plate_number);
}

/** True while a driver-registered vehicle waits for staff approval. */
export function isPendingApproval(vehicle: { status?: string | null }): boolean {
  return vehicle.status === PENDING_VEHICLE_STATUS;
}

/** True for a vehicle staff rejected: archived, with the decision kept on the row. */
export function isRejected(vehicle: { status?: string | null; review_decision?: string | null }): boolean {
  return vehicle.status === 'archived' && vehicle.review_decision === 'rejected';
}

/**
 * A driver drives one vehicle. Before giving `driverId` the vehicle `vehicleId`
 * (null for one not created yet) look at what they already have: a real vehicle
 * (approved or waiting for approval) is a 409; a TEMP-… placeholder from their
 * first login is returned so the caller can adopt it (create) or archive it
 * (edit of a different vehicle, approval).
 */
export async function findDriverPlaceholder(driverId: string, vehicleId: string | null): Promise<string | null> {
  const { data: owned, error } = await supabase
    .from('vehicles')
    .select('id, plate_number, status')
    .eq('driver_id', driverId)
    .neq('status', 'archived');
  if (error) throw error;
  const others = (owned ?? []).filter(v => v.id !== vehicleId);
  const real = others.find(v => !isTempPlate(v.plate_number));
  if (real) throw new HttpError(409, `This driver is already assigned to ${real.plate_number}. Reassign or archive that vehicle first.`);
  return others[0]?.id ?? null;
}

/** The newer of last_heartbeat and last_sync, in ms; null when the vehicle never reported. */
export function lastSeenMs(vehicle: { last_heartbeat?: string | null; last_sync?: string | null }): number | null {
  const times = [vehicle.last_heartbeat, vehicle.last_sync].filter(Boolean).map(t => Date.parse(String(t))).filter(Number.isFinite);
  return times.length ? Math.max(...times) : null;
}

/**
 * Live = seen within `liveMinutes` (the GPS-lost limit from the alarm settings,
 * see getAlertThresholds) by heartbeat or sync, whichever is newer.
 */
export function isLive(
  vehicle: { last_heartbeat?: string | null; last_sync?: string | null },
  liveMinutes: number,
  nowMs: number = Date.now(),
): boolean {
  const seen = lastSeenMs(vehicle);
  return seen != null && nowMs - seen <= liveMinutes * 60_000;
}

export interface VehicleStatusChange {
  id: string;
  from: string;
  status: string;
  changed: boolean;
}

/**
 * Check that a vehicle in status `from` may be moved to `next` by staff
 * (VEHICLE_STATUS_TRANSITIONS). `on_route` is set by starting a route, never
 * by hand, and archiving is refused while the vehicle is on an active route.
 */
export async function assertVehicleStatusChange(vehicleId: string, from: string, next: string): Promise<void> {
  if (from === next) return;
  if (next === 'on_route') throw new HttpError(409, 'A vehicle goes on route when a route is started for it, not by hand.');
  assertTransition(VEHICLE_STATUS_TRANSITIONS, 'vehicle', from, next);
  if (next === 'archived') {
    const { data: active, error } = await supabase.from('routes').select('id').eq('vehicle_id', vehicleId).eq('status', 'active').limit(1);
    if (error) throw error;
    if (active && active.length > 0) throw new HttpError(409, "This vehicle is on an active route and can't be archived. Wait for the route to finish, or cancel it first.");
  }
}

/**
 * Move a vehicle to `next`. Asking for the status it already has succeeds
 * without doing anything. Archiving frees the driver link so the driver can
 * be given another vehicle.
 */
export async function changeVehicleStatus(vehicleId: string, next: string): Promise<VehicleStatusChange> {
  const { data: vehicle, error } = await supabase.from('vehicles').select('id, status').eq('id', vehicleId).maybeSingle();
  if (error) throw error;
  if (!vehicle) throw new HttpError(404, 'Vehicle not found');
  const from = String(vehicle.status);
  if (from === next) return { id: vehicle.id, from, status: next, changed: false };
  await assertVehicleStatusChange(vehicleId, from, next);
  const patch: Record<string, unknown> = { status: next };
  if (next === 'archived') patch.driver_id = null;
  const { error: uErr } = await supabase.from('vehicles').update(patch).eq('id', vehicleId).eq('status', from);
  if (uErr) throw uErr;
  return { id: vehicle.id, from, status: next, changed: true };
}
