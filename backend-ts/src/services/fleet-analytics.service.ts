/**
 * margixindia — Fleet analytics
 *
 * The numbers behind Fleet > Analytics: how much of the fleet is in use, where every vehicle is
 * in its life (status breakdown), how far the fleet has driven, and what has gone wrong (fleet
 * alerts and SOS). Placeholder vehicles (TEMP-…, DRFT-…) and archived ones are not part of the
 * fleet and are left out, the same rule /vehicles/summary uses, so this page and the Fleet list
 * agree. Distance is the planned distance of the routes dispatched in the period (active or
 * completed); there is no per-trip odometer to add up.
 */
import { OWNED, scopeQuery } from '../core/org-scope';
import { supabase } from '../core/supabase';
import { indianDateKey, startOfIndianDay } from '../core/istDate';
import { isPlaceholderPlate } from '../core/vehicles';
import { alertSummary } from './alerts.service';
import { loadSosCounts } from './sos.service';
import { OWNED, scopeQuery } from '../core/org-scope';

export const FLEET_ANALYTICS_MAX_DAYS = 90;

interface FleetVehicleRow {
  id: string;
  plate_number: string;
  status: string;
  capacity_kg: number | null;
  current_load_kg: number | null;
  available_capacity_kg: number | null;
}

interface RouteRow {
  vehicle_id: string | null;
  total_distance_km: number | null;
  created_at: string;
}

const PAGE = 1000;

/** The vehicles that count as the fleet. */
export function fleetVehicles<T extends { plate_number: string; status: string }>(rows: T[]): T[] {
  return rows.filter(v => !isPlaceholderPlate(v.plate_number) && v.status !== 'archived');
}

/** Load carried by a vehicle: what it reports, or capacity minus what is still free. */
export function loadedKg(v: { capacity_kg: number | null; current_load_kg: number | null; available_capacity_kg: number | null }): number {
  const capacity = Number(v.capacity_kg ?? 0);
  if (v.current_load_kg != null) return Math.max(0, Number(v.current_load_kg));
  if (v.available_capacity_kg != null) return Math.max(0, capacity - Number(v.available_capacity_kg));
  return 0;
}

const pct = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 100) : null);

export async function getFleetAnalytics(days: number) {
  const span = Math.min(Math.max(Math.round(days) || 30, 1), FLEET_ANALYTICS_MAX_DAYS);
  const start = startOfIndianDay(span - 1);
  const end = startOfIndianDay(-1);

  const { data: vehicleRows, error: vErr } = await scopeQuery(supabase
    .from('vehicles')
    .select('id, plate_number, status, capacity_kg, current_load_kg, available_capacity_kg'), OWNED.carrier);
  if (vErr) throw new Error(`Failed to read vehicles: ${vErr.message}`);
  const fleet = fleetVehicles((vehicleRows ?? []) as FleetVehicleRow[]);

  const routes: RouteRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await scopeQuery(supabase
      .from('routes')
      .select('vehicle_id, total_distance_km, created_at')
      .in('status', ['active', 'completed'])
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString()), OWNED.carrier)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Failed to read routes: ${error.message}`);
    routes.push(...((data ?? []) as RouteRow[]));
    if (!data || data.length < PAGE) break;
  }

  // Status breakdown. "idle" joins idle and available, like the Fleet list's filter.
  const byStatus = { on_route: 0, idle: 0, maintenance: 0, offline: 0 };
  for (const v of fleet) {
    if (v.status === 'on_route') byStatus.on_route++;
    else if (v.status === 'idle' || v.status === 'available') byStatus.idle++;
    else if (v.status === 'maintenance') byStatus.maintenance++;
    else if (v.status === 'offline') byStatus.offline++;
  }

  const capacityKg = fleet.reduce((s, v) => s + Number(v.capacity_kg ?? 0), 0);
  const carriedKg = fleet.reduce((s, v) => s + Math.min(loadedKg(v), Number(v.capacity_kg ?? 0)), 0);

  // Distance: total, per day (every day of the period, so gaps show as zero) and per vehicle.
  const fleetIds = new Set(fleet.map(v => v.id));
  const perDay = new Map<string, { distance_km: number; routes: number }>();
  for (let i = span - 1; i >= 0; i--) perDay.set(indianDateKey(startOfIndianDay(i)), { distance_km: 0, routes: 0 });
  const perVehicle = new Map<string, { distance_km: number; routes: number }>();
  let distance = 0;
  for (const r of routes) {
    const km = Number(r.total_distance_km ?? 0);
    distance += km;
    const day = perDay.get(indianDateKey(new Date(r.created_at)));
    if (day) { day.distance_km += km; day.routes++; }
    if (r.vehicle_id && fleetIds.has(r.vehicle_id)) {
      const v = perVehicle.get(r.vehicle_id) ?? { distance_km: 0, routes: 0 };
      v.distance_km += km; v.routes++;
      perVehicle.set(r.vehicle_id, v);
    }
  }
  const plates = new Map(fleet.map(v => [v.id, v.plate_number]));
  const topVehicles = [...perVehicle.entries()]
    .map(([id, v]) => ({ vehicle_id: id, plate_number: plates.get(id) ?? '', distance_km: Math.round(v.distance_km), routes: v.routes }))
    .sort((a, b) => b.distance_km - a.distance_km)
    .slice(0, 10);

  const [alerts, sosCounts] = await Promise.all([alertSummary(), loadSosCounts()]);
  const sos = { total: 0, last_30_days: 0, open: 0, cancelled: 0 };
  for (const [id, c] of Object.entries(sosCounts)) {
    if (!fleetIds.has(id)) continue;
    sos.total += c.total; sos.last_30_days += c.last_30_days; sos.open += c.open; sos.cancelled += c.cancelled;
  }

  return {
    days: span,
    from: indianDateKey(start),
    to: indianDateKey(startOfIndianDay(0)),
    total_vehicles: fleet.length,
    by_status: byStatus,
    /** Share of the fleet on a route right now. */
    utilisation_pct: pct(byStatus.on_route, fleet.length),
    /** Vehicles that were on at least one route dispatched in the period, and their share of the fleet. */
    active_in_period: perVehicle.size,
    active_in_period_pct: pct(perVehicle.size, fleet.length),
    capacity: { total_kg: capacityKg, loaded_kg: Math.round(carriedKg), loaded_pct: pct(carriedKg, capacityKg) },
    distance: {
      total_km: Math.round(distance),
      routes: routes.length,
      per_day: [...perDay.entries()].map(([date, v]) => ({ date, distance_km: Math.round(v.distance_km), routes: v.routes })),
      top_vehicles: topVehicles,
    },
    alerts,
    sos,
  };
}
