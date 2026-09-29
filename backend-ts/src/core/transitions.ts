/**
 * margixindia — Status transitions
 *
 * One place that says which status can follow which, so a client cannot move a
 * route, shipment or cargo manifest to a state its history does not allow
 * (re-opening a completed route, delivering a cancelled shipment, ...).
 * Terminal states have no successors.
 */
import { HttpError } from './errors';

export type TransitionMap = Record<string, readonly string[]>;

export const ROUTE_TRANSITIONS: TransitionMap = {
  optimizing: ['pending', 'cancelled'],
  pending: ['active', 'cancelled'],
  active: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

/** Statuses a route can be moved to through the API. */
export const ROUTE_STATUSES = Object.keys(ROUTE_TRANSITIONS);

export const SHIPMENT_TRANSITIONS: TransitionMap = {
  created: ['assigned', 'picked_up', 'in_transit', 'delivered', 'exception', 'cancelled'],
  // assigned -> created: the route it was on was cancelled or deleted, so it is waiting for a vehicle again
  assigned: ['created', 'picked_up', 'in_transit', 'delivered', 'exception', 'cancelled'],
  picked_up: ['in_transit', 'delivered', 'exception'],
  in_transit: ['delivered', 'exception'],
  // exception -> assigned: dispatch put a failed delivery on a vehicle again
  exception: ['assigned', 'picked_up', 'in_transit', 'delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

/** Shipment statuses the PATCH endpoint accepts (`exception` is set by a failed stop only). */
export const SHIPMENT_PATCH_STATUSES = ['created', 'picked_up', 'in_transit', 'delivered', 'cancelled'] as const;

/** Statuses a driver may set on a shipment; cancelling is for staff. */
export const DRIVER_SHIPMENT_STATUSES = ['picked_up', 'in_transit', 'delivered'] as const;

export const CARGO_MANIFEST_TRANSITIONS: TransitionMap = {
  scheduled: ['in_transit', 'cancelled'],
  in_transit: ['delivered', 'cancelled'],
  delivered: [],
  completed: [],
  cancelled: [],
};

/** Vehicle states in which a vehicle takes part in dispatch. Maintenance and archived vehicles do not. */
export const OPERATING_VEHICLE_STATUSES = ['available', 'on_route', 'idle', 'offline'] as const;

/**
 * A vehicle a driver registered from the app waits in this status until staff
 * approve or reject it. It is not an operating status, so dispatch, bidding
 * and the live map leave it out.
 */
export const PENDING_VEHICLE_STATUS = 'pending_approval';

/**
 * The moves the approval review makes (POST /vehicles/:id/approve and /reject),
 * kept apart from VEHICLE_STATUS_TRANSITIONS so no status endpoint can approve
 * a vehicle without a decision on record. Rejected vehicles are archived and
 * can still be approved later (archived -> available).
 */
export const VEHICLE_REVIEW_TRANSITIONS: TransitionMap = {
  pending_approval: ['available', 'archived'],
  archived: ['available'],
};

/**
 * Which vehicle status can follow which when staff change it. `on_route` is
 * never set by hand (starting a route does it). A vehicle in maintenance,
 * for example after a serious SOS, comes back with "Return to service"
 * (maintenance -> available or idle). Archived is only left through
 * unarchiving (archived -> idle).
 */
export const VEHICLE_STATUS_TRANSITIONS: TransitionMap = {
  available: ['idle', 'on_route', 'maintenance', 'offline', 'archived'],
  idle: ['available', 'on_route', 'maintenance', 'offline', 'archived'],
  on_route: ['available', 'idle', 'maintenance', 'offline'],
  offline: ['available', 'idle', 'on_route', 'maintenance', 'archived'],
  maintenance: ['available', 'idle', 'archived'],
  archived: ['idle', 'available'],
  // Left only through the approval review (VEHICLE_REVIEW_TRANSITIONS)
  pending_approval: [],
};

export function canTransition(map: TransitionMap, from: string, to: string): boolean {
  return (map[from] ?? []).includes(to);
}

/** Throws a 409 that says in plain words why `from` cannot become `to`. */
export function assertTransition(map: TransitionMap, noun: string, from: string, to: string): void {
  if (canTransition(map, from, to)) return;
  const label = (s: string) => s.replace(/_/g, ' ');
  throw new HttpError(409, `This ${noun} is ${label(from)} and can't be changed to ${label(to)}.`);
}
