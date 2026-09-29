/**
 * margixindia — Route status changes
 *
 * The one place a route's status is changed, whether staff dispatch or cancel
 * it or its driver starts it. Enforces the allowed transitions, applies them
 * only if the route is still in the status the caller saw, and keeps the
 * vehicle's status in step without touching vehicles that are in maintenance
 * or archived. Also holds what routes and vendor loads (cargo manifests) share:
 * how a load looks as a route, and cancelling one.
 */
import { supabase } from '../core/supabase';
import { HttpError } from '../core/errors';
import { CARGO_MANIFEST_TRANSITIONS, OPERATING_VEHICLE_STATUSES, ROUTE_TRANSITIONS, assertTransition } from '../core/transitions';
import { manifestParcelCode } from '../core/parcelCode';
import { notificationService } from './notification.service';
import { stampPlannedArrivals } from './driver-performance.service';

/** Sets a vehicle's status unless it is in maintenance or archived (those are changed by staff only). */
export async function setOperatingVehicleStatus(vehicleId: string | null | undefined, status: 'on_route' | 'available' | 'idle'): Promise<void> {
  if (!vehicleId) return;
  const { error } = await supabase
    .from('vehicles')
    .update({ status })
    .eq('id', vehicleId)
    .in('status', [...OPERATING_VEHICLE_STATUSES]);
  if (error) throw new Error(`Failed to update vehicle: ${error.message}`);
}

/** Alert types that, when serious, take the vehicle out of service. Any other SOS leaves its status alone. */
export const VEHICLE_DOWN_SOS_TYPES = ['breakdown', 'accident'] as const;

/**
 * A serious breakdown or accident puts the vehicle in maintenance so it is not dispatched.
 * Position, heartbeat and telemetry from the driver keep being accepted (only the status is held).
 */
export async function holdVehicleAfterSos(vehicleId: string | null | undefined, alertType: unknown, severity: unknown): Promise<boolean> {
  if (!vehicleId || severity !== 'serious' || !(VEHICLE_DOWN_SOS_TYPES as readonly string[]).includes(String(alertType))) return false;
  const { error } = await supabase
    .from('vehicles')
    .update({ status: 'maintenance' })
    .eq('id', vehicleId)
    .in('status', [...OPERATING_VEHICLE_STATUSES]);
  if (error) throw new Error(`Failed to update vehicle: ${error.message}`);
  return true;
}

// ── Vendor loads (cargo manifests) as routes ────────────────

/** Cargo-manifest statuses that still need the vehicle: the load is waiting or on the truck. */
export const OPEN_MANIFEST_STATUSES = ['scheduled', 'in_transit'] as const;

const MANIFEST_ROUTE_STATUS: Record<string, string> = {
  scheduled: 'pending',
  in_transit: 'active',
  delivered: 'completed',
  completed: 'completed',
  cancelled: 'cancelled',
};

/** The manifest statuses a route-status filter matches. */
export const ROUTE_STATUS_TO_MANIFEST: Record<string, string[]> = {
  pending: ['scheduled'],
  active: ['in_transit'],
  completed: ['delivered', 'completed'],
  cancelled: ['cancelled'],
  optimizing: [],
};

/** The route status a load shows as: scheduled is pending, in transit is active, delivered is completed. */
export function manifestRouteStatus(status: string): string {
  return MANIFEST_ROUTE_STATUS[status] ?? status;
}

/** Pickup is done once the load is on the truck, the drop once it is delivered; a cancelled load has neither. */
export function manifestStopStatuses(status: string): { pickup: string; drop: string } {
  if (status === 'cancelled') return { pickup: 'cancelled', drop: 'cancelled' };
  if (status === 'delivered' || status === 'completed') return { pickup: 'completed', drop: 'completed' };
  if (status === 'in_transit') return { pickup: 'completed', drop: 'pending' };
  return { pickup: 'pending', drop: 'pending' };
}

/** The pickup and drop of a vendor load, shaped like route stops with their delivery points. */
export function manifestRouteStops(m: Record<string, any>, firstSequence = 1) {
  const statuses = manifestStopStatuses(String(m.status));
  const point = (kind: 'pickup' | 'drop') => {
    const location = kind === 'pickup' ? m.pickup_location : m.drop_location;
    return {
      id: `${m.id}_${kind}_dp`,
      name: `${kind === 'pickup' ? 'Pickup' : 'Drop'}: ${(location || '').substring(0, 20)}`,
      address: location,
      latitude: kind === 'pickup' ? m.pickup_lat : m.drop_lat,
      longitude: kind === 'pickup' ? m.pickup_lng : m.drop_lng,
      demand_kg: m.capacity_kg,
    };
  };
  return [
    { id: `${m.id}_pickup`, sequence: firstSequence, status: statuses.pickup, delivery_point_id: `${m.id}_pickup_dp`, delivery_points: point('pickup') },
    { id: `${m.id}_drop`, sequence: firstSequence + 1, status: statuses.drop, delivery_point_id: `${m.id}_drop_dp`, delivery_points: point('drop') },
  ];
}

/** A vendor load as a route: the shape Routes, Route details and the live map read. */
export function manifestAsRoute(m: Record<string, any>) {
  const status = String(m.status);
  return {
    id: m.id,
    vehicle_id: m.vehicle_id,
    status: manifestRouteStatus(status),
    is_manifest: true,
    created_at: m.created_at ?? null,
    // The load has no start or finish columns: it was last changed when it went in transit
    // (started) or when it was delivered (completed).
    started_at: status === 'in_transit' ? (m.updated_at ?? null) : null,
    completed_at: status === 'delivered' || status === 'completed' ? (m.updated_at ?? null) : null,
    updated_at: m.updated_at ?? null,
    total_distance_km: 0,
    total_duration_minutes: 0,
    estimated_fuel_liters: 0,
    optimization_score: null,
    vehicles: m.vehicles ?? null,
    route_stops: manifestRouteStops(m),
  };
}

// ── Vehicle state that follows its work ─────────────────────

/** True when the vehicle has an active route or an unfinished vendor load besides the ones excluded. */
export async function vehicleHasOpenWork(vehicleId: string, exclude: { routeId?: string; manifestId?: string } = {}): Promise<boolean> {
  let routes = supabase.from('routes').select('id').eq('vehicle_id', vehicleId).eq('status', 'active');
  if (exclude.routeId) routes = routes.neq('id', exclude.routeId);
  const { data: activeRoutes, error: routesErr } = await routes.limit(1);
  if (routesErr) throw new Error(`Failed to check the vehicle's routes: ${routesErr.message}`);
  if (activeRoutes && activeRoutes.length > 0) return true;

  let loads = supabase.from('cargo_manifest').select('id').eq('vehicle_id', vehicleId).in('status', [...OPEN_MANIFEST_STATUSES]);
  if (exclude.manifestId) loads = loads.neq('id', exclude.manifestId);
  const { data: openLoads, error: loadsErr } = await loads.limit(1);
  if (loadsErr) throw new Error(`Failed to check the vehicle's loads: ${loadsErr.message}`);
  return Boolean(openLoads && openLoads.length > 0);
}

/**
 * The status a reporting vehicle should have: on_route while it has an active route or a load on
 * board (or has set off for a waiting pickup), otherwise available. A break (idle) is kept until
 * the driver resumes (`resume`), and maintenance or archived are never overridden.
 */
export async function operatingStatusFor(vehicleId: string, current: string, opts: { resume?: boolean } = {}): Promise<string> {
  if (!(OPERATING_VEHICLE_STATUSES as readonly string[]).includes(current) || (current === 'idle' && !opts.resume)) return current;
  const { data: routes } = await supabase.from('routes').select('id').eq('vehicle_id', vehicleId).eq('status', 'active').limit(1);
  if (routes && routes.length > 0) return 'on_route';
  const { data: loads } = await supabase
    .from('cargo_manifest').select('id, status').eq('vehicle_id', vehicleId).in('status', [...OPEN_MANIFEST_STATUSES]);
  const open = loads ?? [];
  if (open.some((l: any) => l.status === 'in_transit')) return 'on_route';
  // Set off for a pickup: the journey was started, so keep the status the start set
  if ((current === 'on_route' || opts.resume) && open.length > 0) return 'on_route';
  return 'available';
}

/** Empties a vehicle's recorded load. Only for a vehicle with no other work. */
export async function resetVehicleLoad(vehicleId: string): Promise<void> {
  const { data: veh } = await supabase.from('vehicles').select('capacity_kg').eq('id', vehicleId).maybeSingle();
  const { error } = await supabase.from('vehicles').update({
    current_load_kg: 0,
    available_capacity_kg: veh ? (veh.capacity_kg || 1000) : 1000,
  }).eq('id', vehicleId);
  if (error) throw new Error(`Failed to update vehicle: ${error.message}`);
}

/** Takes a load's weight off a vehicle (it was reserved on the vehicle when the load was assigned). */
export async function releaseVehicleLoad(vehicleId: string | null | undefined, weightKg: number): Promise<void> {
  if (!vehicleId || !(weightKg > 0)) return;
  const { data: veh } = await supabase.from('vehicles').select('current_load_kg, capacity_kg').eq('id', vehicleId).maybeSingle();
  if (!veh) return;
  const load = Math.max((veh.current_load_kg || 0) - weightKg, 0);
  const { error } = await supabase.from('vehicles').update({
    current_load_kg: load,
    available_capacity_kg: Math.max((veh.capacity_kg || 1000) - load, 0),
  }).eq('id', vehicleId);
  if (error) throw new Error(`Failed to update vehicle: ${error.message}`);
}

/**
 * Dispatch cancels a vendor load. The vendor's request goes back to approved so it can be
 * assigned again, the vehicle gets its capacity back (and is freed if it has nothing else to
 * do) and the driver is told. Cancelling one already cancelled succeeds without doing anything.
 */
export async function cancelManifest(manifestId: string): Promise<{ id: string; status: string; changed: boolean }> {
  const { data: manifest, error } = await supabase
    .from('cargo_manifest')
    .select('id, status, vehicle_id, vendor_request_id, capacity_kg, pickup_location, drop_location')
    .eq('id', manifestId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load the load: ${error.message}`);
  if (!manifest) throw new HttpError(404, 'Load not found');
  if (manifest.status === 'cancelled') return { id: manifest.id, status: 'cancelled', changed: false };
  assertTransition(CARGO_MANIFEST_TRANSITIONS, 'load', manifest.status, 'cancelled');

  const { data: moved, error: moveErr } = await supabase
    .from('cargo_manifest')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', manifest.id)
    .eq('status', manifest.status)
    .select('id')
    .maybeSingle();
  if (moveErr) throw new Error(`Failed to cancel the load: ${moveErr.message}`);
  if (!moved) throw new HttpError(409, 'This load was just changed by someone else. Refresh and try again.');

  // Back to approved so staff can assign it to another vehicle
  if (manifest.vendor_request_id) {
    const { error: requestErr } = await supabase
      .from('vendor_shipment_requests')
      .update({ status: 'approved', assigned_vehicle_id: null, updated_at: new Date().toISOString() })
      .eq('id', manifest.vendor_request_id)
      .eq('status', 'assigned');
    if (requestErr) throw new Error(`Failed to reopen the vendor request: ${requestErr.message}`);
  }

  if (manifest.vehicle_id) {
    await releaseVehicleLoad(manifest.vehicle_id, Number(manifest.capacity_kg) || 0);
    if (!(await vehicleHasOpenWork(manifest.vehicle_id))) await setOperatingVehicleStatus(manifest.vehicle_id, 'available');

    const { data: vehicle } = await supabase.from('vehicles').select('driver_id').eq('id', manifest.vehicle_id).maybeSingle();
    if (vehicle?.driver_id) {
      try {
        await notificationService.sendNotification(
          vehicle.driver_id,
          'Load cancelled',
          `The load ${manifestParcelCode(manifest.id)} (${manifest.pickup_location || 'pickup'} to ${manifest.drop_location || 'drop'}) was cancelled by dispatch.`,
          'route_cancelled',
          { route_id: manifest.id },
        );
      } catch (notifErr) {
        console.warn('Failed to send load cancellation notification:', notifErr);
      }
    }
  }
  return { id: manifest.id, status: 'cancelled', changed: true };
}

// ── Route status ────────────────────────────────────────────

export interface RouteStatusChange {
  id: string;
  status: string;
  vehicle_status: string | null;
  changed: boolean;
}

export const routeService = {
  /**
   * Move a route to `next`. The caller has already been authorised for the
   * route. Asking for the status the route already has succeeds without
   * doing anything, so a retry after a dropped connection is safe. The one
   * exception is a route that is active but was never started (it was created
   * that way): asking for active starts it.
   */
  async changeStatus(routeId: string, next: string): Promise<RouteStatusChange> {
    const { data: route, error } = await supabase
      .from('routes')
      .select('id, status, vehicle_id, started_at')
      .eq('id', routeId)
      .maybeSingle();
    if (error) throw new Error(`Failed to load route: ${error.message}`);
    if (!route) throw new HttpError(404, 'Route not found');

    const { data: vehicle, error: vehicleErr } = await supabase
      .from('vehicles')
      .select('id, status, driver_id')
      .eq('id', route.vehicle_id)
      .maybeSingle();
    if (vehicleErr) throw new Error(`Failed to load vehicle: ${vehicleErr.message}`);

    const firstStart = next === 'active' && !route.started_at && (route.status === 'active' || route.status === 'pending');
    if (route.status === next && !firstStart) return { id: route.id, status: next, vehicle_status: vehicle?.status ?? null, changed: false };
    if (route.status !== next) assertTransition(ROUTE_TRANSITIONS, 'route', route.status, next);

    const starting = next === 'active';
    if (starting && vehicle && !(OPERATING_VEHICLE_STATUSES as readonly string[]).includes(vehicle.status)) {
      throw new HttpError(409, `This route's vehicle is in ${vehicle.status} and can't be dispatched.`);
    }

    // A route is finished by its stops; it cannot be closed with deliveries still to make
    if (next === 'completed') {
      const { data: pending, error: pendingErr } = await supabase
        .from('route_stops').select('id').eq('route_id', route.id).eq('status', 'pending');
      if (pendingErr) throw new Error(`Failed to check the route's stops: ${pendingErr.message}`);
      if (pending && pending.length > 0) {
        const n = pending.length;
        throw new HttpError(409, `${n} ${n === 1 ? 'stop is' : 'stops are'} still pending. Complete or fail ${n === 1 ? 'it' : 'them'} first, or cancel the route instead.`);
      }
    }

    const now = new Date().toISOString();
    let update = supabase
      .from('routes')
      .update({
        status: next,
        updated_at: now,
        ...(starting && !route.started_at ? { started_at: now } : {}),
        ...(next === 'completed' ? { completed_at: now } : {}),
      })
      .eq('id', route.id)
      .eq('status', route.status);
    if (firstStart) update = update.is('started_at', null);
    const { data: updated, error: updateErr } = await update.select('id').maybeSingle();
    if (updateErr) throw new Error(`Failed to update route: ${updateErr.message}`);
    if (!updated) throw new HttpError(409, 'This route was just changed by someone else. Refresh and try again.');

    if (starting) {
      await setOperatingVehicleStatus(route.vehicle_id, 'on_route');
      // Planned arrivals are written once; a repeat leaves the plan alone. Never throws.
      await stampPlannedArrivals(route.id);
    } else if (next === 'completed' || next === 'cancelled') {
      if (next === 'cancelled') {
        // Shipments not yet picked up go back to the queue so they can be planned again
        const { releaseShipmentsFromRoute } = await import('./shipment.service');
        await releaseShipmentsFromRoute(route.id);
        if (vehicle?.driver_id && route.status === 'active') {
          try {
            await notificationService.sendNotification(
              vehicle.driver_id,
              'Route cancelled',
              'Dispatch cancelled your current route. Open the app to see what is next.',
              'route_cancelled',
              { route_id: route.id },
            );
          } catch (e) {
            console.error('[routes] Could not tell the driver about the cancelled route:', e);
          }
        }
      }
      // Free the vehicle only when this was its last running route or load
      if (!(await vehicleHasOpenWork(route.vehicle_id, { routeId: route.id }))) {
        await setOperatingVehicleStatus(route.vehicle_id, 'available');
        await resetVehicleLoad(route.vehicle_id);
      }
    }

    // Tell the driver a route is now theirs to run. Informative only.
    if (firstStart && vehicle?.driver_id) {
      try {
        await notificationService.sendNotification(
          vehicle.driver_id,
          '🚨 Route Activated',
          'Your route has been activated. Open the app to start your journey.',
          'route_activated',
          { route_id: route.id },
        );
      } catch (notifErr) {
        console.warn('Failed to send route activation notification:', notifErr);
      }
    }

    const { data: after } = await supabase.from('vehicles').select('status').eq('id', route.vehicle_id).maybeSingle();
    return { id: route.id, status: next, vehicle_status: after?.status ?? vehicle?.status ?? null, changed: true };
  },
};
