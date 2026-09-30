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

/**
 * Shipment statuses (docs/cargo-plan.md). The goods are with the consignor until pickup, then on
 * a vehicle or at a hub, and finally with the consignee (delivered) or back with the consignor
 * (returned). `on_hold` and `exception` keep the goods where they are while staff decide.
 * Two moves depend on history and are checked by assertShipmentTransition: on_hold goes back to
 * assigned or created, and exception to cancelled, only for goods that were never picked up.
 */
export const SHIPMENT_TRANSITIONS: TransitionMap = {
  created: ['assigned', 'picked_up', 'on_hold', 'exception', 'cancelled'],
  // assigned -> created: the route it was on was cancelled or deleted, so it is waiting for a vehicle again
  assigned: ['created', 'picked_up', 'on_hold', 'exception', 'cancelled'],
  picked_up: ['in_transit', 'at_hub', 'on_hold', 'exception', 'out_for_delivery', 'delivered', 'partially_delivered', 'lost'],
  in_transit: ['out_for_delivery', 'at_hub', 'on_hold', 'exception', 'delivered', 'partially_delivered', 'lost'],
  out_for_delivery: ['delivered', 'partially_delivered', 'exception', 'on_hold', 'returning', 'lost'],
  at_hub: ['in_transit', 'out_for_delivery', 'on_hold', 'exception', 'returning', 'lost'],
  on_hold: ['in_transit', 'at_hub', 'out_for_delivery', 'returning', 'exception', 'lost', 'assigned', 'created'],
  // exception -> assigned: dispatch put a failed delivery on a vehicle again
  exception: ['assigned', 'picked_up', 'in_transit', 'out_for_delivery', 'at_hub', 'on_hold', 'returning', 'delivered', 'partially_delivered', 'cancelled', 'lost'],
  // The rest still on the vehicle: a re-attempt, accepted later, sent back, or held after a breakdown
  partially_delivered: ['returning', 'out_for_delivery', 'delivered', 'on_hold'],
  // -> on_hold: the vehicle bringing the goods back broke down on the way
  returning: ['returned', 'at_hub', 'exception', 'lost', 'on_hold'],
  delivered: [],
  returned: [],
  lost: [],
  cancelled: [],
};

/** Moves allowed only for goods that were never picked up (still with the consignor). */
const BEFORE_PICKUP_ONLY: Record<string, readonly string[]> = {
  on_hold: ['assigned', 'created'],
  exception: ['cancelled'],
};

/** Statuses in which the goods may be on a vehicle (current_holder says whether they are). */
export const ON_VEHICLE_STATUSES = ['picked_up', 'in_transit', 'out_for_delivery', 'returning', 'on_hold', 'exception', 'partially_delivered'] as const;

/** Final shipment statuses: nothing moves after these. */
export const FINAL_SHIPMENT_STATUSES = ['delivered', 'returned', 'lost', 'cancelled'] as const;

/**
 * assertTransition for shipments, with the moves that depend on history: `pickedUp` is whether
 * the goods ever left the consignor.
 */
export function assertShipmentTransition(from: string, to: string, opts: { pickedUp: boolean }): void {
  assertTransition(SHIPMENT_TRANSITIONS, 'shipment', from, to);
  if (opts.pickedUp && (BEFORE_PICKUP_ONLY[from] ?? []).includes(to)) {
    const label = (s: string) => s.replace(/_/g, ' ');
    throw new HttpError(409, `These goods were already picked up, so this shipment can't go from ${label(from)} to ${label(to)}.`);
  }
}

/**
 * Statuses only the cargo custody, exception and transfer actions set, so each one is backed by
 * a custody event. A raw status PATCH to one of them is refused.
 */
export const CUSTODY_ONLY_SHIPMENT_STATUSES = [
  'in_transit', 'out_for_delivery', 'delivered', 'partially_delivered', 'at_hub',
  'on_hold', 'returning', 'returned', 'lost', 'exception',
] as const;

/** Shipment statuses the PATCH endpoint accepts. A pickup there is recorded as a custody pickup. */
export const SHIPMENT_PATCH_STATUSES = ['created', 'picked_up', 'cancelled'] as const;

/** Statuses a driver may set through the PATCH endpoint; everything after pickup goes through the custody endpoints. */
export const DRIVER_SHIPMENT_STATUSES = ['picked_up'] as const;

/**
 * Vendor loads mirror the shipment rules with a smaller set: scheduled (with the consignor),
 * in_transit (on the vehicle), then delivered, or held, failed, sent back. A load is cancelled
 * only while its goods are not on a vehicle.
 */
export const CARGO_MANIFEST_TRANSITIONS: TransitionMap = {
  scheduled: ['in_transit', 'cancelled', 'on_hold', 'exception'],
  in_transit: ['delivered', 'exception', 'on_hold', 'returning'],
  exception: ['in_transit', 'on_hold', 'returning', 'delivered', 'cancelled'],
  on_hold: ['scheduled', 'in_transit', 'returning', 'exception', 'cancelled'],
  returning: ['returned', 'exception', 'on_hold'],
  delivered: [],
  completed: [],
  cancelled: [],
  returned: [],
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
