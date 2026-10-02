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
import { isDispatchable } from '../core/vehicles';
import { notificationService } from './notification.service';
import { stampPlannedArrivals } from './driver-performance.service';
import { recordTripPaySafe } from './driver-pay.service';
import { syncOdometerAfterTripSafe } from './odometer-sync.service';
import type { CargoHoldContext } from './shipment.service';
import { carrierStamp } from '../core/org-context';
import { OWNED, orgFilter, scopeQuery } from '../core/org-scope';

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
 * Goods on board are never stranded: they go on hold on a cargo case (vehicle_accident or
 * vehicle_breakdown) linked to the SOS, and stay on the vehicle until staff plan them.
 */
export async function holdVehicleAfterSos(
  vehicleId: string | null | undefined,
  alertType: unknown,
  severity: unknown,
  sosAlertId?: string | null,
  actor?: { id: string; role: string } | null,
): Promise<boolean> {
  if (!vehicleId || severity !== 'serious' || !(VEHICLE_DOWN_SOS_TYPES as readonly string[]).includes(String(alertType))) return false;
  const { error } = await supabase
    .from('vehicles')
    .update({ status: 'maintenance' })
    .eq('id', vehicleId)
    .in('status', [...OPERATING_VEHICLE_STATUSES]);
  if (error) throw new Error(`Failed to update vehicle: ${error.message}`);
  const { holdCargoOnVehicle } = await import('./cargo/exception.service');
  await holdCargoOnVehicle(vehicleId, {
    source: 'sos',
    type: alertType === 'accident' ? 'vehicle_accident' : 'vehicle_breakdown',
    reason: `Serious ${String(alertType)} reported by SOS.`,
    sosAlertId: sosAlertId ?? null,
  }, actor ?? null);
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

/** True while goods are on the vehicle (held on a case, or waiting for a re-attempt). */
export async function vehicleHoldsCargo(vehicleId: string): Promise<boolean> {
  const [ships, loads] = await Promise.all([
    supabase.from('shipments').select('id').eq('current_vehicle_id', vehicleId).eq('current_holder', 'vehicle').limit(1),
    supabase.from('cargo_manifest').select('id').eq('current_vehicle_id', vehicleId).eq('current_holder', 'vehicle').limit(1),
  ]);
  return (ships.data?.length ?? 0) > 0 || (loads.data?.length ?? 0) > 0;
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
 *
 * Goods already on the truck are never stranded by a cancel: the load goes on_hold on a cargo
 * case instead (`hold` says why), keeps its vehicle, and staff plan a transfer, hub drop or
 * return. Returns the status the load ended in and, then, the case.
 */
export async function cancelManifest(
  manifestId: string,
  hold?: CargoHoldContext,
  actor?: { id: string; role: string } | null,
): Promise<{ id: string; status: string; changed: boolean; exception_id?: string }> {
  const { data: manifest, error } = await supabase
    .from('cargo_manifest')
    .select('id, status, vehicle_id, vendor_request_id, capacity_kg, pickup_location, drop_location, current_holder, current_vehicle_id')
    .eq('id', manifestId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load the load: ${error.message}`);
  if (!manifest) throw new HttpError(404, 'Load not found');
  if (manifest.status === 'cancelled') return { id: manifest.id, status: 'cancelled', changed: false };

  const onBoard = manifest.current_holder === 'vehicle' || (manifest.current_holder == null && manifest.status === 'in_transit');
  if (onBoard) {
    if (manifest.status === 'on_hold') return { id: manifest.id, status: 'on_hold', changed: false };
    const vehicleId = manifest.current_vehicle_id ?? manifest.vehicle_id;
    if (!vehicleId) throw new HttpError(409, 'This load is on a vehicle that is not recorded. Record where the goods are first.');
    const { holdCargoOnVehicle } = await import('./cargo/exception.service');
    const held = await holdCargoOnVehicle(
      vehicleId,
      hold ?? { source: 'manual', type: 'other', reason: `The load ${manifestParcelCode(manifest.id)} was cancelled while its goods were on board.` },
      actor ?? null,
      { shipmentIds: [], manifestIds: [manifest.id] },
    );
    return { id: manifest.id, status: 'on_hold', changed: true, exception_id: held?.exception_id };
  }
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
  async changeStatus(routeId: string, next: string, opts: { cargoHold?: CargoHoldContext; actor?: { id: string; role: string } | null } = {}): Promise<RouteStatusChange> {
    const { data: route, error } = await supabase
      .from('routes')
      .select('id, status, vehicle_id, started_at')
      .eq('id', routeId)
      .maybeSingle();
    if (error) throw new Error(`Failed to load route: ${error.message}`);
    if (!route) throw new HttpError(404, 'Trip not found');

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
      throw new HttpError(409, `This trip's vehicle is in ${vehicle.status} and can't be dispatched.`);
    }

    // A trip nobody drives would be "sent" to no one: no notice, nothing in any app
    if (starting && route.status === 'pending' && vehicle && !vehicle.driver_id) {
      throw new HttpError(409, "This trip's vehicle has no driver. Give it a driver before sending the trip.");
    }

    // A route is finished by its stops; it cannot be closed with deliveries still to make
    if (next === 'completed') {
      const { data: pending, error: pendingErr } = await supabase
        .from('route_stops').select('id').eq('route_id', route.id).eq('status', 'pending');
      if (pendingErr) throw new Error(`Failed to check the route's stops: ${pendingErr.message}`);
      if (pending && pending.length > 0) {
        const n = pending.length;
        throw new HttpError(409, `${n} ${n === 1 ? 'stop is' : 'stops are'} still pending. Complete or fail ${n === 1 ? 'it' : 'them'} first, or cancel the trip instead.`);
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
    if (!updated) throw new HttpError(409, 'This trip was just changed by someone else. Refresh and try again.');

    if (starting) {
      await setOperatingVehicleStatus(route.vehicle_id, 'on_route');
      // Planned arrivals are written once; a repeat leaves the plan alone. Never throws.
      await stampPlannedArrivals(route.id);
    } else if (next === 'completed' || next === 'cancelled') {
      if (next === 'cancelled') {
        // Shipments not yet picked up go back to the queue so they can be planned again
        const { releaseShipmentsFromRoute } = await import('./shipment.service');
        await releaseShipmentsFromRoute(route.id, opts.actor ?? null, opts.cargoHold);
        if (vehicle?.driver_id && route.status === 'active') {
          try {
            await notificationService.sendNotification(
              vehicle.driver_id,
              'Trip cancelled',
              'Dispatch cancelled your current trip. Open the app to see what is next.',
              'route_cancelled',
              { route_id: route.id },
            );
          } catch (e) {
            console.error('[routes] Could not tell the driver about the cancelled route:', e);
          }
        }
      }
      // Free the vehicle only when this was its last running route or load, and no goods wait on it
      if (!(await vehicleHasOpenWork(route.vehicle_id, { routeId: route.id })) && !(await vehicleHoldsCargo(route.vehicle_id))) {
        await setOperatingVehicleStatus(route.vehicle_id, 'available');
        await resetVehicleLoad(route.vehicle_id);
      }
    }

    // The trip is sent: this is the one moment the driver hears about it, with a link to open it.
    if (firstStart && vehicle?.driver_id) {
      try {
        const { data: stopRows } = await supabase.from('route_stops').select('id').eq('route_id', route.id);
        const stops = stopRows?.length ?? 0;
        await notificationService.sendNotification(
          vehicle.driver_id,
          'New trip',
          stops > 0
            ? `Dispatch sent you a trip with ${stops} ${stops === 1 ? 'stop' : 'stops'}. Open the app to start your journey.`
            : 'Dispatch sent you a trip. Open the app to start your journey.',
          'route_activated',
          { route_id: route.id, link: `/routes/${route.id}` },
        );
      } catch (notifErr) {
        console.warn('Failed to send the trip notification:', notifErr);
      }
    }

    // The driver earns the trip when it is finished (once: a retry finds the entry)
    if (next === 'completed') {
      await recordTripPaySafe({ route_id: route.id });
      // ...and its distance goes onto the vehicle's odometer, from the same distance (when a reading exists)
      await syncOdometerAfterTripSafe(route.vehicle_id);
    }

    const { data: after } = await supabase.from('vehicles').select('status').eq('id', route.vehicle_id).maybeSingle();
    return { id: route.id, status: next, vehicle_status: after?.status ?? vehicle?.status ?? null, changed: true };
  },
};

// ── Routes planned in the route planner ─────────────────────

export interface PlannedRouteStopInput {
  name: string;
  address?: string | null;
  lat: number;
  lng: number;
  /** An existing delivery point (a shipment's drop) to reuse instead of creating one. */
  delivery_point_id?: string | null;
}

export interface PlannedRouteInput {
  vehicle_id: string;
  /** In driving order; the last one is the destination. The start is kept in `plan`, not as a stop. */
  stops: PlannedRouteStopInput[];
  distance_km: number;
  duration_minutes: number;
  traffic_delay_minutes: number | null;
  estimated_fuel_liters: number | null;
  /** Origin, departure, road options and provider, kept with the route. */
  plan: Record<string, unknown>;
}

/**
 * Saves a route built in the route planner as a pending route for the vehicle, stopping at the
 * planned places in order. Stops that are a shipment's drop reuse its delivery point; every other
 * place gets a new one. Dispatching it later is the same as for any route (changeStatus).
 */
export async function createPlannedRoute(input: PlannedRouteInput, actor: { id: string }): Promise<{ id: string; vehicle_id: string; status: string; stops: { delivery_point_id: string; sequence: number }[] }> {
  const { data: vehicle, error: vErr } = await scopeQuery(supabase.from('vehicles').select('id, status, plate_number, driver_id, carrier_org_id').eq('id', input.vehicle_id), OWNED.carrier).maybeSingle();
  if (vErr) throw new Error(vErr.message);
  if (!vehicle) throw new HttpError(404, 'Vehicle not found');
  if (!isDispatchable(vehicle as { status?: string | null; plate_number?: string | null })) {
    throw new HttpError(409, `That vehicle is ${String((vehicle as any).status).replace('_', ' ')} and can't take a trip.`);
  }

  const reuseIds = input.stops.map(s => s.delivery_point_id).filter((id): id is string => !!id);
  if (reuseIds.length > 0) {
    const { data: found, error } = await supabase.from('delivery_points').select('id, shipments!delivery_points_shipment_id_fkey(carrier_org_id)').in('id', reuseIds);
    if (error) throw new Error(error.message);
    // A stop that is part of another company's shipment is not this company's to plan
    const mineOnly = orgFilter(OWNED.carrier);
    const foreign = (found ?? []).some((d: any) => {
      const sh = Array.isArray(d.shipments) ? d.shipments[0] : d.shipments;
      return !!mineOnly && !!sh?.carrier_org_id && sh.carrier_org_id !== mineOnly.id;
    });
    if (foreign) throw new HttpError(404, 'Delivery point not found');
    const known = new Set((found ?? []).map((d: any) => d.id));
    if (reuseIds.some(id => !known.has(id))) throw new HttpError(400, 'One of the stops refers to a delivery point that no longer exists.');
  }

  const newRows = input.stops.filter(s => !s.delivery_point_id).map(s => ({
    name: s.name, address: s.address ?? null, latitude: s.lat, longitude: s.lng, status: 'pending',
  }));
  let created: { id: string }[] = [];
  if (newRows.length > 0) {
    const { data, error } = await supabase.from('delivery_points').insert(newRows).select('id');
    if (error || !data || data.length !== newRows.length) throw new Error(error?.message ?? 'Could not save the stops');
    created = data as { id: string }[];
  }
  const removeCreated = async () => { if (created.length) await supabase.from('delivery_points').delete().in('id', created.map(c => c.id)); };

  let next = 0;
  const pointIds = input.stops.map(s => s.delivery_point_id ?? created[next++].id);

  const { data: route, error: routeErr } = await supabase
    .from('routes')
    .insert({
      // The company that runs the vehicle owns the trip
      ...((vehicle as { carrier_org_id?: string | null }).carrier_org_id ? { carrier_org_id: (vehicle as { carrier_org_id: string }).carrier_org_id } : carrierStamp()),
      vehicle_id: input.vehicle_id,
      depot_id: null,
      status: 'pending',
      total_distance_km: input.distance_km,
      total_duration_minutes: input.duration_minutes,
      estimated_fuel_liters: input.estimated_fuel_liters,
      traffic_delay_minutes: input.traffic_delay_minutes ?? 0,
      waypoints: [],
      plan: { ...input.plan, created_by: actor.id },
    })
    .select()
    .single();
  if (routeErr || !route) {
    await removeCreated();
    throw new Error(routeErr?.message ?? 'Could not save the route');
  }

  const stopRows = pointIds.map((delivery_point_id, i) => ({ route_id: route.id, delivery_point_id, sequence: i + 1, status: 'pending' }));
  const { error: stopsErr } = await supabase.from('route_stops').insert(stopRows);
  if (stopsErr) {
    await supabase.from('routes').delete().eq('id', route.id);
    await removeCreated();
    throw new Error(stopsErr.message);
  }

  // No driver notification here: the trip waits in Dispatch under "Trips to send" and the driver is
  // told when it is sent (changeStatus to active).
  return { id: route.id, vehicle_id: route.vehicle_id, status: route.status, stops: stopRows.map(s => ({ delivery_point_id: s.delivery_point_id, sequence: s.sequence })) };
}
