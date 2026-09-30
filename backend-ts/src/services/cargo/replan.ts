/**
 * margixindia — Putting a consignment's remaining stops on a vehicle
 *
 * Used when goods change vehicle (a transfer, a hub departure), go out again (a re-attempt, a
 * repaired vehicle continuing) or head back (a return leg). A shipment's open drops are its
 * delivery points that no route has completed yet; for a return, only the return point.
 */
import { supabase } from '../../core/supabase';
import { HttpError } from '../../core/errors';
import { OPERATING_VEHICLE_STATUSES } from '../../core/transitions';
import { finalDeliveryPoint, sortDeliveryPoints } from '../../core/destination';
import { haversineKm, isValidPoint, ROAD_FACTOR, type LatLng } from '../geo';
import { createPlannedRoute, routeService } from '../route.service';
import { orderDropsInProcess } from '../optimizer/pooling';
import type { Actor } from './consignment';

/** Average road speed for the straight-line estimates below (the same as public tracking). */
export const ESTIMATE_SPEED_KMPH = 40;

/** Minutes to drive `km` of straight line, road factor included. */
export function estimateMinutes(km: number): number {
  return Math.max(1, Math.round(((km * ROAD_FACTOR) / ESTIMATE_SPEED_KMPH) * 60));
}

interface PointRow {
  id: string;
  name: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  demand_kg: number | null;
  created_at: string | null;
}

/**
 * The delivery points of a shipment still to be visited: those no route stop has completed.
 * For a shipment being returned (rto), only its return point, the one created last.
 */
export async function openDropPoints(shipmentId: string, rto: boolean): Promise<PointRow[]> {
  const { data: points, error } = await supabase
    .from('delivery_points')
    .select('id, name, address, latitude, longitude, demand_kg, created_at')
    .eq('shipment_id', shipmentId);
  if (error) throw new Error(`Failed to read the delivery points: ${error.message}`);
  const all = sortDeliveryPoints((points ?? []) as PointRow[]);
  if (all.length === 0) return [];
  if (rto) {
    const last = finalDeliveryPoint(all);
    return last ? [last] : [];
  }
  const { data: stops } = await supabase.from('route_stops').select('delivery_point_id, status').in('delivery_point_id', all.map(p => p.id));
  const done = new Set((stops ?? []).filter((s: any) => s.status === 'completed').map((s: any) => s.delivery_point_id));
  return all.filter(p => !done.has(p.id));
}

/**
 * Finishes a pending or active route with nothing left to do: completed when a stop was
 * attempted (completed or failed, as complete-stop does), cancelled when every stop was called off.
 */
export async function closeRouteIfDone(routeId: string): Promise<void> {
  const { data: route } = await supabase.from('routes').select('id, status').eq('id', routeId).maybeSingle();
  if (!route || !['pending', 'active'].includes(String(route.status))) return;
  const { data: open } = await supabase.from('route_stops').select('id').eq('route_id', routeId).eq('status', 'pending').limit(1);
  if (open && open.length > 0) return;
  const { data: done } = await supabase.from('route_stops').select('id').eq('route_id', routeId).in('status', ['completed', 'failed']).limit(1);
  try {
    if (done && done.length > 0) {
      if (route.status === 'pending') await routeService.changeStatus(routeId, 'active');
      await routeService.changeStatus(routeId, 'completed');
    } else {
      await routeService.changeStatus(routeId, 'cancelled');
    }
  } catch (e) {
    console.error(`[cargo] Route ${routeId} could not be closed:`, e);
  }
}

/**
 * Closes the pending stops of these points on every route except `keepRouteId`, and finishes the
 * routes left with nothing to do. Returns the vehicles of the routes touched.
 */
export async function cancelOpenStops(pointIds: string[], opts: { keepRouteId?: string | null; as?: 'cancelled' | 'completed' | 'failed' } = {}): Promise<string[]> {
  if (pointIds.length === 0) return [];
  const { data: stops } = await supabase.from('route_stops').select('id, route_id, status').in('delivery_point_id', pointIds).eq('status', 'pending');
  const affected = (stops ?? []).filter((s: any) => s.route_id !== opts.keepRouteId);
  if (affected.length === 0) return [];
  const as = opts.as ?? 'cancelled';
  await supabase
    .from('route_stops')
    .update({ status: as, ...(as === 'completed' ? { actual_arrival_at: new Date().toISOString() } : {}) })
    .in('id', affected.map((s: any) => s.id))
    .eq('status', 'pending');
  const routeIds = [...new Set(affected.map((s: any) => s.route_id as string))];
  const { data: routes } = await supabase.from('routes').select('id, vehicle_id').in('id', routeIds);
  for (const r of routes ?? []) await closeRouteIfDone(r.id);
  return [...new Set((routes ?? []).map((r: any) => r.vehicle_id).filter(Boolean))] as string[];
}

/** The vehicle's newest open route (active first, then pending), or null. */
async function openRouteOf(vehicleId: string): Promise<{ id: string; status: string } | null> {
  const { data } = await supabase.from('routes').select('id, status, created_at').eq('vehicle_id', vehicleId).in('status', ['active', 'pending']);
  const rows = (data ?? []) as { id: string; status: string; created_at?: string }[];
  rows.sort((a, b) => (a.status === b.status ? String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')) : a.status === 'active' ? -1 : 1));
  return rows[0] ?? null;
}

/**
 * Puts the pending stops of a route in driving order from `start` with the in-process optimizer.
 * Stops already completed or failed keep their place; the order is left alone when the optimizer
 * cannot place every stop or no position is known.
 */
async function resequence(routeId: string, start: LatLng | null, vehicle: { id: string; capacity_kg: number | null }): Promise<void> {
  const { data: stops } = await supabase.from('route_stops').select('id, sequence, status, delivery_point_id').eq('route_id', routeId);
  const rows = (stops ?? []) as { id: string; sequence: number; status: string; delivery_point_id: string }[];
  const pending = rows.filter(s => s.status === 'pending');
  if (pending.length < 2 || !start || !isValidPoint(start)) return;
  const { data: points } = await supabase.from('delivery_points').select('id, latitude, longitude, demand_kg').in('id', pending.map(s => s.delivery_point_id));
  const byId = new Map((points ?? []).map((p: any) => [p.id, p]));
  const loads = pending.map(s => {
    const p = byId.get(s.delivery_point_id);
    return { id: s.id, lat: Number(p?.latitude), lng: Number(p?.longitude), weightKg: Number(p?.demand_kg) || 0 };
  });
  if (loads.some(l => !isValidPoint(l))) return;
  let order: string[] | null = null;
  try {
    const capacity = Number(vehicle.capacity_kg) || loads.reduce((sum, l) => sum + l.weightKg, 0) || 1;
    order = (await orderDropsInProcess(start, { id: vehicle.id, capacityKg: Math.max(capacity, loads.reduce((sum, l) => sum + l.weightKg, 0)) }, loads))?.order ?? null;
  } catch (e) {
    console.warn('[cargo] Re-sequencing fell back to the existing order:', e);
  }
  if (!order || order.length !== pending.length) return;
  const base = rows.filter(s => s.status !== 'pending').reduce((max, s) => Math.max(max, Number(s.sequence) || 0), 0);
  // Two passes so no two stops share a sequence midway
  for (const s of pending) await supabase.from('route_stops').update({ sequence: 10_000 + (Number(s.sequence) || 0) }).eq('id', s.id);
  for (let i = 0; i < order.length; i++) await supabase.from('route_stops').update({ sequence: base + i + 1 }).eq('id', order[i]);
}

/**
 * Gives a vehicle stops for these delivery points: pending stops elsewhere are cancelled, the
 * points are added to the vehicle's open route (or a new pending route is saved for it through
 * createPlannedRoute, which tells the driver), and the pending stops are put in driving order
 * from `start` (the vehicle's position when known). Returns the route used.
 */
export async function planStopsOnVehicle(
  points: PointRow[],
  vehicleId: string,
  actor: Actor | null,
  opts: { start?: LatLng | null; note?: string } = {},
): Promise<{ route_id: string | null; created: boolean }> {
  if (points.length === 0) return { route_id: null, created: false };
  const { data: vehicle } = await supabase.from('vehicles').select('id, status, plate_number, capacity_kg, latitude, longitude, driver_id').eq('id', vehicleId).maybeSingle();
  if (!vehicle) throw new HttpError(404, 'Vehicle not found');
  const start = opts.start ?? (isValidPoint({ lat: vehicle.latitude, lng: vehicle.longitude }) ? { lat: Number(vehicle.latitude), lng: Number(vehicle.longitude) } : null);

  let route = await openRouteOf(vehicleId);
  let created = false;
  await cancelOpenStops(points.map(p => p.id), { keepRouteId: route?.id ?? null });

  if (route) {
    const { data: existing } = await supabase.from('route_stops').select('delivery_point_id, sequence, status').eq('route_id', route.id);
    const already = new Set((existing ?? []).filter((s: any) => s.status === 'pending').map((s: any) => s.delivery_point_id));
    const next = (existing ?? []).reduce((max: number, s: any) => Math.max(max, Number(s.sequence) || 0), 0);
    const rows = points.filter(p => !already.has(p.id)).map((p, i) => ({ route_id: route!.id, delivery_point_id: p.id, sequence: next + i + 1, status: 'pending' }));
    if (rows.length > 0) {
      const { error } = await supabase.from('route_stops').insert(rows);
      if (error) throw new Error(`Failed to add the stops: ${error.message}`);
    }
  } else {
    // Straight-line figures for the saved route; the driver's navigation replaces them on the road
    let km = 0;
    let at = start;
    for (const p of points) {
      const here = { lat: Number(p.latitude), lng: Number(p.longitude) };
      if (at && isValidPoint(here)) km += haversineKm(at, here);
      if (isValidPoint(here)) at = here;
    }
    const saved = await createPlannedRoute(
      {
        vehicle_id: vehicleId,
        stops: points.map(p => ({ name: p.name || 'Drop', address: p.address, lat: Number(p.latitude), lng: Number(p.longitude), delivery_point_id: p.id })),
        distance_km: Math.round(km * ROAD_FACTOR * 10) / 10,
        duration_minutes: estimateMinutes(km),
        traffic_delay_minutes: null,
        estimated_fuel_liters: null,
        plan: { source: 'cargo', note: opts.note ?? null, origin: start },
      },
      { id: actor?.id ?? 'system' },
    );
    route = { id: saved.id, status: saved.status };
    created = true;
  }
  await resequence(route.id, start, { id: vehicleId, capacity_kg: vehicle.capacity_kg });
  return { route_id: route.id, created };
}

/**
 * A stop back to the shipment's origin, for a return to origin (RTO). The return point belongs
 * to the shipment, so the stop is completed like any other (complete-stop records it as the
 * return delivery). It goes on `vehicleId` when that vehicle can drive; otherwise only the point
 * is created, for a transfer to pick up. Returns the point and route.
 */
export async function createReturnLeg(
  shipment: { id: string; origin_name?: string | null; origin_address?: string | null; origin_lat?: number | null; origin_lng?: number | null; total_weight_kg?: number | null },
  vehicleId: string | null,
  actor: Actor | null,
): Promise<{ point_id: string; route_id: string | null }> {
  if (shipment.origin_lat == null || shipment.origin_lng == null) {
    throw new HttpError(409, 'This shipment has no pickup location on file, so a return leg cannot be planned.');
  }
  const { data: point, error } = await supabase
    .from('delivery_points')
    .insert({
      name: `Return to ${shipment.origin_name || 'sender'}`,
      address: shipment.origin_address ?? null,
      latitude: shipment.origin_lat,
      longitude: shipment.origin_lng,
      demand_kg: Number(shipment.total_weight_kg) || 0,
      shipment_id: shipment.id,
      status: 'pending',
      created_at: new Date().toISOString(),
    })
    .select('id, name, address, latitude, longitude, demand_kg, created_at')
    .single();
  if (error || !point) throw new Error(`Failed to create the return point: ${error?.message}`);
  if (!vehicleId) return { point_id: point.id, route_id: null };
  const { data: vehicle } = await supabase.from('vehicles').select('status').eq('id', vehicleId).maybeSingle();
  if (!vehicle || !(OPERATING_VEHICLE_STATUSES as readonly string[]).includes(String(vehicle.status))) return { point_id: point.id, route_id: null };
  const planned = await planStopsOnVehicle([point as PointRow], vehicleId, actor, { note: 'Return to origin' });
  return { point_id: point.id, route_id: planned.route_id };
}
