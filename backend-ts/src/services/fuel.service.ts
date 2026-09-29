/**
 * Fuel log: loads a vehicle's fills, runs the calculation engine (fuel-engine.ts) and stores
 * the result. After every change to a vehicle's log the mileage and flags of all its fills are
 * rebuilt, and the vehicle keeps its rolling km per litre (fuel_efficiency_kmpl) and, after a
 * full fill, the litres in the tank (current_fuel_liters).
 */
import { supabase } from '../core/supabase';
import { cacheDeletePattern } from '../core/redis';
import {
  analyzeFills, vehicleStats, vehicleUpdate, averageKmpl,
  type FuelAnalysis, type FuelFill, type FuelFlag, type FuelStats, type GpsSample, GPS_MATCH_WINDOW_MS, round2,
} from './fuel-engine';

export const PAYMENT_MODES = ['cash', 'card', 'upi', 'fuel_card', 'credit', 'other'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const FUEL_LOG_COLUMNS =
  'id, vehicle_id, filled_at, litres, price_per_litre, total_amount, odometer_km, is_full_tank, station_name, payment_mode, ' +
  'fill_latitude, fill_longitude, bill_status, bill_path, logged_by, logged_by_role, reviewed_at, reviewed_by, expense_id, ' +
  'distance_km, litres_used, mileage_kmpl, flags, note, created_at, updated_at';

export interface FuelLogRow {
  id: string;
  vehicle_id: string;
  filled_at: string;
  litres: number;
  price_per_litre: number;
  total_amount: number;
  odometer_km: number | null;
  is_full_tank: boolean;
  station_name: string | null;
  payment_mode: PaymentMode;
  fill_latitude: number | null;
  fill_longitude: number | null;
  bill_status: 'with_bill' | 'no_bill';
  bill_path: string | null;
  logged_by: string | null;
  logged_by_role: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  expense_id: string | null;
  distance_km: number | null;
  litres_used: number | null;
  mileage_kmpl: number | null;
  flags: FuelFlag[];
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface FuelVehicle {
  id: string;
  plate_number: string;
  status: string;
  odometer_km: number | null;
  fuel_capacity_liters: number | null;
  fuel_efficiency_kmpl: number | null;
  current_fuel_liters: number | null;
}

const numOrNull = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** PostgREST returns numeric columns as numbers or strings depending on the client; make them numbers. */
export function normalizeLog(row: any): FuelLogRow {
  return {
    ...row,
    litres: Number(row.litres),
    price_per_litre: Number(row.price_per_litre),
    total_amount: Number(row.total_amount),
    odometer_km: numOrNull(row.odometer_km),
    fill_latitude: numOrNull(row.fill_latitude),
    fill_longitude: numOrNull(row.fill_longitude),
    distance_km: numOrNull(row.distance_km),
    litres_used: numOrNull(row.litres_used),
    mileage_kmpl: numOrNull(row.mileage_kmpl),
    flags: Array.isArray(row.flags) ? row.flags : [],
  };
}

export const toFill = (row: FuelLogRow): FuelFill => ({
  id: row.id,
  filled_at: row.filled_at,
  litres: row.litres,
  price_per_litre: row.price_per_litre,
  total_amount: row.total_amount,
  odometer_km: row.odometer_km,
  is_full_tank: row.is_full_tank,
  bill_status: row.bill_status,
  fill_latitude: row.fill_latitude,
  fill_longitude: row.fill_longitude,
});

/** Newest fill first (also fixes the order when the database does not sort). */
export const newestFirst = (rows: FuelLogRow[]): FuelLogRow[] => [...rows].sort((a, b) => Date.parse(b.filled_at) - Date.parse(a.filled_at));

/** A vehicle's whole log is read for the calculation; this is far above any real fleet's history. */
const MAX_LOG_ROWS = 2000;

export async function loadVehicle(id: string): Promise<FuelVehicle | null> {
  const { data, error } = await supabase
    .from('vehicles')
    .select('id, plate_number, status, odometer_km, fuel_capacity_liters, fuel_efficiency_kmpl, current_fuel_liters')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    ...(data as any),
    odometer_km: numOrNull((data as any).odometer_km),
    fuel_capacity_liters: numOrNull((data as any).fuel_capacity_liters),
    fuel_efficiency_kmpl: numOrNull((data as any).fuel_efficiency_kmpl),
    current_fuel_liters: numOrNull((data as any).current_fuel_liters),
  };
}

export async function loadLogs(vehicleId: string): Promise<FuelLogRow[]> {
  const { data, error } = await supabase
    .from('vehicle_fuel_logs')
    .select(FUEL_LOG_COLUMNS)
    .eq('vehicle_id', vehicleId)
    .order('filled_at', { ascending: false })
    .limit(MAX_LOG_ROWS);
  if (error) throw error;
  return newestFirst((data ?? []).map(normalizeLog));
}

/** GPS points around the fills that carry a fill position, for the "far from the vehicle" check. */
async function loadGps(vehicleId: string, fills: FuelFill[]): Promise<GpsSample[]> {
  const located = fills.filter(f => f.fill_latitude != null && f.fill_longitude != null);
  if (!located.length) return [];
  const times = located.map(f => Date.parse(f.filled_at));
  const from = new Date(Math.min(...times) - GPS_MATCH_WINDOW_MS).toISOString();
  const to = new Date(Math.max(...times) + GPS_MATCH_WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .from('gps_points')
    .select('latitude, longitude, recorded_at')
    .eq('vehicle_id', vehicleId)
    .gte('recorded_at', from)
    .lte('recorded_at', to)
    .limit(5000);
  if (error) throw error;
  return (data ?? []).map((p: any) => ({ lat: Number(p.latitude), lng: Number(p.longitude), at: p.recorded_at }));
}

const sameFlags = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Rebuilds the stored mileage and flags of every fill of the vehicle, then updates the vehicle's
 * rolling km per litre and litres in the tank. Only rows that changed are written.
 */
export async function recomputeVehicle(vehicleId: string): Promise<{ logs: FuelLogRow[]; analysis: FuelAnalysis }> {
  const [vehicle, logs] = await Promise.all([loadVehicle(vehicleId), loadLogs(vehicleId)]);
  const fills = logs.map(toFill);
  const gps = await loadGps(vehicleId, fills);
  const analysis = analyzeFills(fills, { tankCapacityLiters: vehicle?.fuel_capacity_liters ?? null, gps });

  const now = new Date().toISOString();
  for (const log of logs) {
    const a = analysis.annotations.get(log.id)!;
    if (a.distance_km === log.distance_km && a.litres_used === log.litres_used && a.mileage_kmpl === log.mileage_kmpl && sameFlags(a.flags, log.flags)) continue;
    const { error } = await supabase
      .from('vehicle_fuel_logs')
      .update({ distance_km: a.distance_km, litres_used: a.litres_used, mileage_kmpl: a.mileage_kmpl, flags: a.flags, updated_at: now })
      .eq('id', log.id);
    if (error) throw error;
    Object.assign(log, { distance_km: a.distance_km, litres_used: a.litres_used, mileage_kmpl: a.mileage_kmpl, flags: a.flags });
  }

  if (vehicle) {
    const next = vehicleUpdate(fills, analysis, vehicle.fuel_capacity_liters);
    const patch: Record<string, number> = {};
    if (next.fuel_efficiency_kmpl != null && next.fuel_efficiency_kmpl !== vehicle.fuel_efficiency_kmpl) patch.fuel_efficiency_kmpl = next.fuel_efficiency_kmpl;
    if (next.current_fuel_liters != null && next.current_fuel_liters !== vehicle.current_fuel_liters) patch.current_fuel_liters = next.current_fuel_liters;
    if (Object.keys(patch).length) {
      const { error } = await supabase.from('vehicles').update(patch).eq('id', vehicleId);
      if (error) throw error;
      await cacheDeletePattern('vehicles:list:*');
    }
  }
  return { logs, analysis };
}

/** Statistics for one vehicle from its stored log. */
export async function getVehicleStats(vehicleId: string, now = new Date()): Promise<FuelStats & { vehicle_id: string; tank_capacity_liters: number | null; fuel_efficiency_kmpl: number | null }> {
  const [vehicle, logs] = await Promise.all([loadVehicle(vehicleId), loadLogs(vehicleId)]);
  const fills = logs.map(toFill);
  const analysis = analyzeFills(fills, { tankCapacityLiters: vehicle?.fuel_capacity_liters ?? null });
  const stats = vehicleStats(fills, analysis, now, logs.map(l => l.flags));
  return { vehicle_id: vehicleId, tank_capacity_liters: vehicle?.fuel_capacity_liters ?? null, fuel_efficiency_kmpl: vehicle?.fuel_efficiency_kmpl ?? null, ...stats };
}

export interface FleetFuelRow extends FuelStats {
  vehicle_id: string;
  plate_number: string;
  status: string;
}

/** Fuel numbers for every vehicle with a log, and the best and worst by rolling km per litre. */
export async function getFleetSummary(now = new Date()) {
  const { data, error } = await supabase
    .from('vehicle_fuel_logs')
    .select(FUEL_LOG_COLUMNS)
    .order('filled_at', { ascending: false })
    .limit(MAX_LOG_ROWS * 5);
  if (error) throw error;
  const logs = newestFirst((data ?? []).map(normalizeLog));
  const byVehicle = new Map<string, FuelLogRow[]>();
  for (const l of logs) byVehicle.set(l.vehicle_id, [...(byVehicle.get(l.vehicle_id) ?? []), l]);

  const ids = [...byVehicle.keys()];
  const vehicles = new Map<string, FuelVehicle>();
  if (ids.length) {
    const { data: vs, error: vErr } = await supabase
      .from('vehicles')
      .select('id, plate_number, status, odometer_km, fuel_capacity_liters, fuel_efficiency_kmpl, current_fuel_liters')
      .in('id', ids);
    if (vErr) throw vErr;
    for (const v of vs ?? []) vehicles.set((v as any).id, { ...(v as any), fuel_capacity_liters: numOrNull((v as any).fuel_capacity_liters) });
  }

  const rows: FleetFuelRow[] = [];
  const allRolling = [] as ReturnType<typeof analyzeFills>['segments'];
  for (const [vehicleId, list] of byVehicle) {
    const vehicle = vehicles.get(vehicleId);
    if (!vehicle) continue;
    const fills = list.map(toFill);
    const analysis = analyzeFills(fills, { tankCapacityLiters: vehicle.fuel_capacity_liters });
    allRolling.push(...analysis.segments.slice(-5));
    rows.push({ vehicle_id: vehicleId, plate_number: vehicle.plate_number, status: vehicle.status, ...vehicleStats(fills, analysis, now, list.map(l => l.flags)) });
  }

  const ranked = rows.filter(r => r.rolling_avg_kmpl != null).sort((a, b) => b.rolling_avg_kmpl! - a.rolling_avg_kmpl!);
  const n = Math.min(5, Math.ceil(ranked.length / 2));
  const best = ranked.slice(0, n);
  const worst = ranked.slice(n).slice(-Math.min(5, ranked.length - n)).reverse();
  const openLogs = logs.filter(l => !l.reviewed_at);

  return {
    fleet_avg_kmpl: averageKmpl(allRolling),
    month_spend: round2(rows.reduce((s, r) => s + r.month_spend, 0)),
    month_litres: round2(rows.reduce((s, r) => s + r.month_litres, 0)),
    vehicles_with_logs: rows.length,
    vehicles_with_mileage: ranked.length,
    no_bill_to_review: openLogs.filter(l => l.flags.includes('no_bill')).length,
    anomalies_to_review: openLogs.filter(l => l.flags.some(f => f !== 'no_bill')).length,
    best,
    worst,
    vehicles: rows.sort((a, b) => a.plate_number.localeCompare(b.plate_number)),
  };
}
