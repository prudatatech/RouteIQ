/**
 * The one thing the driver must do next, from real state (my-route, what is on
 * board, transfers, SOS, the driver's own documents). Pure: no React, no storage.
 *
 * Priority, first match wins:
 *  1. sos_open           an SOS is still open (active or acknowledged)
 *  2. dispatch_blocked   documents block dispatch (setting `block`) and an issue is open
 *  3. cargo_on_hold      goods on the vehicle are on hold for a problem: wait for dispatch
 *  4. no_vehicle         no vehicle yet: register one or wait for dispatch
 *  5. accept_trip        a new trip, or a stop dispatch inserted, waits for a yes
 *  6. receive_goods      a transfer into this vehicle is running (the other truck handed over)
 *     hand_over          a planned transfer out to another vehicle
 *     drop_at_hub        a planned transfer out to a hub
 *  7. record_pickup      parcels scanned at a pickup wait for their details, or the driver is at a pickup
 *  8. depart             goods were picked up and have not left yet
 *  8b. no_stops          the trip has no stops yet: dispatch is still filling it
 *  9. start_trip         the trip is accepted but not started
 * 10. enable_tracking    the trip runs and live tracking is off
 * 11. return_pickup      the next stop's goods are at a hub or in a case and not on board: collect them
 * 11b. pickup_first   the drop's goods were never picked up: record the pickup before the delivery
 * 12. deliver            at a drop (within 200 m): record the delivery, lot by lot
 *     go_to_stop         on the way to the next pending stop (a pickup or a drop)
 * 13. hub_drop           the trip is done but goods are still on board: drop them at a hub
 * 14. trip_done          the trip is done: the trips waiting behind it
 * 15. idle               nothing assigned: dispatch will notify
 *
 * Only what the phone knows is used. A rule whose data is missing (for example the on-board
 * list not loaded yet) does not fire, so an unknown never blocks the driver.
 */
import type { LatLng, MyRouteResponse, RouteStop, DriverRoute } from '../types/route';
import type { OnBoardItem } from '../services/cargo';
import type { VehicleTransfer } from '../hooks/useCargo';
import { getNextStep, isRouteFinished, pendingStops, sortedStops, stopCounts } from './route';

/** A lot (or single consignment) to hand over at a stop; a subset of DropLot so this file stays pure. */
export interface StopLot {
  code: string;
  pieces: number | null;
  label: string | null;
  consigneeName: string | null;
}

export interface UpcomingTrip {
  id: string;
  stops: number;
  first_stop: string | null;
  created_at: string | null;
}

export interface AssignmentWaiting {
  kind: 'route' | 'stop';
  /** A new trip: its stop count and first stop, when known. */
  stops?: number | null;
  firstStop?: string | null;
  /** An inserted stop: its place. */
  stopName?: string | null;
}

export interface NextActionInput {
  routeData: MyRouteResponse | null;
  /** The driver has no vehicle (my-route said so, or registration is not done). */
  noVehicle: boolean;
  assignment: AssignmentWaiting | null;
  isTracking: boolean;
  currentLoc: LatLng | null;
  /** Null until the on-board list is known (never loaded, no cache). */
  onBoard: OnBoardItem[] | null;
  transfers: VehicleTransfer[];
  openSos: boolean;
  /** Dispatch issues that block work (backend: dispatch_blocked). */
  dispatchIssues: string[];
  upcoming: UpcomingTrip[];
  /** Parcels scanned at a pickup whose details are not recorded yet. */
  pickupWaiting: number;
  /** Codes (any case) whose pickup the driver has already recorded on this phone, even if still queued. */
  pickedUpCodes?: ReadonlySet<string>;
  /** The lots to hand over at a stop. */
  lotsAt: (stop: RouteStop) => StopLot[];
}

export type NextAction =
  | { kind: 'sos_open' }
  | { kind: 'dispatch_blocked'; issues: string[] }
  | { kind: 'cargo_on_hold'; items: OnBoardItem[] }
  | { kind: 'no_vehicle' }
  | { kind: 'accept_trip'; assignment: AssignmentWaiting }
  | { kind: 'receive_goods'; transfer: VehicleTransfer }
  | { kind: 'hand_over'; transfer: VehicleTransfer }
  | { kind: 'drop_at_hub'; transfer: VehicleTransfer }
  | { kind: 'record_pickup'; stop: RouteStop | null; scanned: number; pieces: number | null; from: string | null; index: number; total: number }
  | { kind: 'depart'; items: OnBoardItem[] }
  | { kind: 'no_stops'; route: DriverRoute }
  | { kind: 'start_trip'; route: DriverRoute; stops: number }
  | { kind: 'enable_tracking'; route: DriverRoute; stop: RouteStop }
  | { kind: 'return_pickup'; stop: RouteStop; code: string }
  | { kind: 'pickup_first'; stop: RouteStop; code: string; index: number; total: number }
  | { kind: 'deliver'; stop: RouteStop; lots: StopLot[]; index: number; total: number }
  | { kind: 'go_to_stop'; stop: RouteStop; pickup: boolean; distanceM: number | null; index: number; total: number }
  | { kind: 'hub_drop'; items: OnBoardItem[] }
  | { kind: 'trip_done'; upcoming: UpcomingTrip[] }
  | { kind: 'idle'; upcoming: UpcomingTrip[] };

/** A vendor load's pickup stop, or a stop the server typed as a pickup. */
export const isPickupStop = (stop: RouteStop | null | undefined): boolean =>
  stop?.stop_type === 'pickup' || stop?.parcel?.purpose === 'pickup';

/** Statuses of goods still with the sender: they have not been picked up. */
const NOT_PICKED_UP = ['created', 'assigned', 'scheduled'];

/**
 * A drop whose goods the server still has with the sender, and that the driver has neither on board
 * nor recorded a pickup for on this phone. Delivering it would be refused (409), so the app sends
 * the driver to record the pickup first. Unknown data never blocks: a stop with no status passes.
 */
export function needsPickupFirst(stop: RouteStop, onBoard: readonly OnBoardItem[] | null, pickedUpCodes?: ReadonlySet<string>): boolean {
  if (isPickupStop(stop)) return false;
  const code = stop.parcel?.code;
  const status = stop.parcel?.status;
  if (!code || !status || !NOT_PICKED_UP.includes(status)) return false;
  const upper = code.toUpperCase();
  if (onBoard?.some((i) => i.code.toUpperCase() === upper)) return false;
  if (pickedUpCodes && [...pickedUpCodes].some((c) => c.toUpperCase() === upper)) return false;
  return true;
}

/** Consignment statuses off the vehicle that a return pickup can collect (backend: return_pickup). */
const RETURNABLE = ['at_hub', 'exception', 'partially_delivered'];

/** Goods held on the vehicle for a problem (cargo case). */
export const onHoldItems = (items: readonly OnBoardItem[] | null): OnBoardItem[] => (items ?? []).filter((i) => i.status === 'on_hold');

const byPlan = (a: VehicleTransfer, b: VehicleTransfer) =>
  (a.transfer.plannedAt ?? '').localeCompare(b.transfer.plannedAt ?? '') || a.transfer.code.localeCompare(b.transfer.code);

export function getNextAction(input: NextActionInput): NextAction {
  const { routeData, onBoard, transfers } = input;

  if (input.openSos) return { kind: 'sos_open' };
  if (input.dispatchIssues.length > 0) return { kind: 'dispatch_blocked', issues: input.dispatchIssues };
  const held = onHoldItems(onBoard);
  if (held.length > 0) return { kind: 'cargo_on_hold', items: held };
  if (input.noVehicle) return { kind: 'no_vehicle' };
  if (input.assignment) return { kind: 'accept_trip', assignment: input.assignment };

  const sorted = [...transfers].sort(byPlan);
  const receive = sorted.find((t) => t.direction === 'in' && t.transfer.status === 'in_progress');
  if (receive) return { kind: 'receive_goods', transfer: receive };
  const out = sorted.find((t) => t.direction === 'out' && t.transfer.status === 'planned');
  if (out) return { kind: out.transfer.toDepotId && !out.transfer.toVehicleId ? 'drop_at_hub' : 'hand_over', transfer: out };

  const route = routeData?.active ? routeData.route : undefined;
  const finished = isRouteFinished(routeData?.route);
  const counts = stopCounts(route);
  const pending = pendingStops(route);
  const running = !!route && !finished && route.status === 'active';
  const nextStop = pending[0];

  // A pickup in hand: scanned parcels wait for pieces, condition, photos and signature
  if (input.pickupWaiting > 0 && !finished) {
    const at = nextStop && isPickupStop(nextStop) ? nextStop : null;
    return {
      kind: 'record_pickup',
      stop: at,
      scanned: input.pickupWaiting,
      pieces: at ? input.lotsAt(at)[0]?.pieces ?? null : null,
      from: at?.delivery_point?.name ?? null,
      index: Math.min(counts.done + 1, counts.total),
      total: counts.total,
    };
  }

  const awaiting = (onBoard ?? []).filter((i) => i.status === 'picked_up');
  if (awaiting.length > 0) return { kind: 'depart', items: awaiting };

  const step = getNextStep(routeData, input.isTracking, input.currentLoc);

  if (step.kind === 'no_stops') return { kind: 'no_stops', route: step.route };
  if (step.kind === 'start') return { kind: 'start_trip', route: step.route, stops: step.route.stops?.length ?? 0 };
  if (step.kind === 'enable_tracking') return { kind: 'enable_tracking', route: step.route, stop: step.stop };

  if (step.kind === 'navigate' || step.kind === 'arrived') {
    const stop = step.stop;
    const index = Math.min(counts.done + 1, counts.total);
    const pickup = isPickupStop(stop);
    const code = stop.parcel?.code;
    if (
      onBoard &&
      !pickup &&
      code &&
      stop.parcel?.status &&
      RETURNABLE.includes(stop.parcel.status) &&
      !onBoard.some((i) => i.code.toUpperCase() === code.toUpperCase())
    ) {
      return { kind: 'return_pickup', stop, code };
    }
    if (step.kind === 'arrived') {
      if (code && needsPickupFirst(stop, onBoard, input.pickedUpCodes)) return { kind: 'pickup_first', stop, code, index, total: counts.total };
      if (pickup) {
        return {
          kind: 'record_pickup',
          stop,
          scanned: 0,
          pieces: input.lotsAt(stop)[0]?.pieces ?? null,
          from: stop.delivery_point?.name ?? null,
          index,
          total: counts.total,
        };
      }
      return { kind: 'deliver', stop, lots: input.lotsAt(stop), index, total: counts.total };
    }
    return { kind: 'go_to_stop', stop, pickup, distanceM: step.distanceM, index, total: counts.total };
  }

  // Nothing left on the route
  if (running || finished || step.kind === 'completed') {
    const left = (onBoard ?? []).filter((i) => i.status !== 'on_hold');
    if (left.length > 0) return { kind: 'hub_drop', items: left };
    return { kind: 'trip_done', upcoming: input.upcoming };
  }
  return { kind: 'idle', upcoming: input.upcoming };
}

/** The stops after the next one, in order, for the compact list under the card. */
export function restOfStops(route: DriverRoute | null | undefined): RouteStop[] {
  const next = pendingStops(route)[0];
  return sortedStops(route).filter((s) => s.status === 'pending' && s.id !== next?.id);
}
