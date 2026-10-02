/**
 * margixindia — Does this vehicle fit this load? (docs/order-routing.md, "Assigning a vehicle")
 *
 * One place for the rules, so assigning a vehicle and any later check give the same answer:
 *   - a hazmat load needs a vehicle marked hazmat certified;
 *   - a perishable load with a temperature range needs a reefer;
 *   - over-dimensional cargo (ODC) needs an open or trailer body.
 * A vehicle whose body or flags were never filled in counts as "not": the company is told what to fill in.
 */
import { HttpError } from '../../core/errors';

export interface FitLoad {
  hazmat_mixed?: boolean | null;
  special_handling?: string[] | null;
  temp_min_c?: number | string | null;
  temp_max_c?: number | string | null;
  /** The load's goods lines, when known: is_hazmat and is_perishable are read from them. */
  items?: Array<{ is_hazmat?: boolean | null; is_perishable?: boolean | null }> | null;
}

export interface FitVehicle {
  plate_number?: string | null;
  hazmat_certified?: boolean | null;
  is_reefer?: boolean | null;
  body_type?: string | null;
}

const hasValue = (v: unknown) => v !== null && v !== undefined && v !== '';

/** The reason the vehicle does not fit the load, or null when it does. */
export function vehicleFitProblem(load: FitLoad, vehicle: FitVehicle): string | null {
  const name = vehicle.plate_number ? `Vehicle ${vehicle.plate_number}` : 'This vehicle';
  const handling = load.special_handling ?? [];
  const items = load.items ?? [];

  const hazmat = !!load.hazmat_mixed || handling.includes('hazmat') || items.some(i => i.is_hazmat);
  if (hazmat && !vehicle.hazmat_certified) {
    return `${name} is not hazmat certified, and this load carries hazardous goods. Choose a hazmat certified vehicle, or mark this one certified in Fleet if it is.`;
  }

  const perishable = items.some(i => i.is_perishable);
  const hasRange = hasValue(load.temp_min_c) || hasValue(load.temp_max_c);
  if (perishable && hasRange && !(vehicle.is_reefer || vehicle.body_type === 'reefer')) {
    return `${name} is not a reefer, and this load needs a controlled temperature. Choose a refrigerated vehicle.`;
  }

  if (handling.includes('odc') && vehicle.body_type !== 'open' && vehicle.body_type !== 'trailer') {
    return vehicle.body_type
      ? `${name} has a ${vehicle.body_type} body, and over-dimensional cargo needs an open or trailer body.`
      : `${name} has no body type set, and over-dimensional cargo needs an open or trailer body. Set the body type in Fleet.`;
  }
  return null;
}

/** Throws 409 with the reason when the vehicle does not fit the load. */
export function assertVehicleFits(load: FitLoad, vehicle: FitVehicle): void {
  const problem = vehicleFitProblem(load, vehicle);
  if (problem) throw new HttpError(409, problem);
}
