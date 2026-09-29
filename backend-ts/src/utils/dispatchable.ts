/**
 * Which vehicles can take part in dispatch. Same rule as core/vehicles.ts on the fleet branch
 * (statuses available, idle, on_route and offline; not maintenance, archived, or a placeholder
 * plate); this file is a stand-in until the two are merged, then callers should import from there.
 */
import { OPERATING_VEHICLE_STATUSES } from '../core/transitions';

export const DISPATCHABLE_STATUSES = OPERATING_VEHICLE_STATUSES;

/** Placeholder plates: a vehicle that was added as a draft or with a temporary number. */
export function isPlaceholderPlate(plate: unknown): boolean {
  return typeof plate === 'string' && /^(TEMP|DRFT)-/i.test(plate.trim());
}

export function isDispatchable(vehicle: { status?: unknown; plate_number?: unknown } | null | undefined): boolean {
  if (!vehicle) return false;
  return (DISPATCHABLE_STATUSES as readonly string[]).includes(String(vehicle.status)) && !isPlaceholderPlate(vehicle.plate_number);
}
