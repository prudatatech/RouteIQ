/**
 * margixindia — Route status changes
 *
 * The one place a route's status is changed, whether staff dispatch or cancel
 * it or its driver starts it. Enforces the allowed transitions, applies them
 * only if the route is still in the status the caller saw, and keeps the
 * vehicle's status in step without touching vehicles that are in maintenance
 * or archived.
 */
import { supabase } from '../core/supabase';
import { HttpError } from '../core/errors';
import { OPERATING_VEHICLE_STATUSES, ROUTE_TRANSITIONS, assertTransition } from '../core/transitions';
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
   * doing anything, so a retry after a dropped connection is safe.
   */
  async changeStatus(routeId: string, next: string): Promise<RouteStatusChange> {
    const { data: route, error } = await supabase
      .from('routes')
      .select('id, status, vehicle_id')
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

    if (route.status === next) return { id: route.id, status: next, vehicle_status: vehicle?.status ?? null, changed: false };
    assertTransition(ROUTE_TRANSITIONS, 'route', route.status, next);

    const starting = next === 'active' || next === 'in_progress';
    if (starting && vehicle && !(OPERATING_VEHICLE_STATUSES as readonly string[]).includes(vehicle.status)) {
      throw new HttpError(409, `This route's vehicle is in ${vehicle.status} and can't be dispatched.`);
    }

    const now = new Date().toISOString();
    const { data: updated, error: updateErr } = await supabase
      .from('routes')
      .update({
        status: next,
        updated_at: now,
        ...(starting && route.status === 'pending' ? { started_at: now } : {}),
        ...(next === 'completed' ? { completed_at: now } : {}),
      })
      .eq('id', route.id)
      .eq('status', route.status)
      .select('id')
      .maybeSingle();
    if (updateErr) throw new Error(`Failed to update route: ${updateErr.message}`);
    if (!updated) throw new HttpError(409, 'This route was just changed by someone else. Refresh and try again.');

    if (starting) {
      await setOperatingVehicleStatus(route.vehicle_id, 'on_route');
      // Planned arrivals are written once; a repeat leaves the plan alone. Never throws.
      await stampPlannedArrivals(route.id);
    } else if (next === 'completed' || next === 'cancelled') {
      // Free the vehicle only when this was its last running route
      const { data: others, error: othersErr } = await supabase
        .from('routes')
        .select('id')
        .eq('vehicle_id', route.vehicle_id)
        .in('status', ['active', 'in_progress'])
        .neq('id', route.id)
        .limit(1);
      if (othersErr) throw new Error(`Failed to check the vehicle's other routes: ${othersErr.message}`);
      if (!others || others.length === 0) await setOperatingVehicleStatus(route.vehicle_id, 'available');
    }

    // Tell the driver a route is now theirs to run. Informative only.
    if (starting && route.status === 'pending' && vehicle?.driver_id) {
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
