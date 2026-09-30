/**
 * margixindia — Demand by corridor
 *
 * Two views built only from real rows:
 *   - demand now: open loads (shipments not yet assigned, vendor requests not yet
 *     assigned) against available vehicles, per origin city
 *   - forecast: loads per corridor (origin city to destination city) per day for
 *     the last 28 days, projected forward as the average of the last 7 days
 * A corridor with fewer than MIN_LOADS loads in the history gets no forecast;
 * with no history at all the result is simply empty.
 */
import { supabase } from '../core/supabase';
import { indianDateKey, startOfIndianDay } from '../core/istDate';
import { selectIn } from './finance.service';

export const HISTORY_DAYS = 28;
export const AVERAGE_DAYS = 7;
export const FORECAST_DAYS = 7;
export const MIN_LOADS = 3;
const MAX_CORRIDORS = 8;

/**
 * City from a free-text address such as "Andheri East, Mumbai, Maharashtra 400093, India".
 * Drops the country, treats the last part as the state, and takes the part before it.
 * A single-part value ("Pune") is the city itself. Returns null for empty text.
 */
export function cityFromAddress(text: string | null | undefined): string | null {
  if (!text) return null;
  const parts = text
    .split(',')
    .map(p => p.trim())
    .filter(Boolean)
    .filter(p => p.toLowerCase() !== 'india');
  if (parts.length === 0) return null;
  const city = (parts.length === 1 ? parts[0] : parts[parts.length - 2]).replace(/\b\d{5,6}\b/g, '').replace(/\s+/g, ' ').trim();
  return city || null;
}

const cityKey = (city: string) => city.toLowerCase();
const titleCase = (s: string) => s.replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());

export interface DemandRow { city: string; open_loads: number; available_vehicles: number; gap: number }

/** Open loads against available vehicles for each origin city; loads first, biggest gap first. */
export function buildDemand(loadOrigins: (string | null)[], vehicleCities: (string | null)[]) {
  const map = new Map<string, DemandRow>();
  const row = (city: string) => {
    const key = cityKey(city);
    let r = map.get(key);
    if (!r) { r = { city: titleCase(city), open_loads: 0, available_vehicles: 0, gap: 0 }; map.set(key, r); }
    return r;
  };
  let loadsWithoutCity = 0;
  let vehiclesWithoutCity = 0;
  for (const c of loadOrigins) c ? row(c).open_loads++ : loadsWithoutCity++;
  for (const c of vehicleCities) c ? row(c).available_vehicles++ : vehiclesWithoutCity++;
  const rows = [...map.values()].map(r => ({ ...r, gap: r.open_loads - r.available_vehicles }));
  rows.sort((a, b) => b.gap - a.gap || b.open_loads - a.open_loads || a.city.localeCompare(b.city));
  return { rows, loadsWithoutCity, vehiclesWithoutCity };
}

export interface ForecastRow {
  origin: string;
  destination: string;
  loads_last_28_days: number;
  daily_average: number;
  expected_next_7_days: number;
}

/**
 * Per corridor: daily counts over the history window, then the mean of the last
 * AVERAGE_DAYS days (zero-load days included) as the daily figure, times FORECAST_DAYS.
 * `today` is the IST date key of the last day of history.
 */
export function buildForecast(loads: { origin: string | null; destination: string | null; day: string }[], today: string): ForecastRow[] {
  const byCorridor = new Map<string, { origin: string; destination: string; days: Map<string, number>; total: number }>();
  for (const l of loads) {
    if (!l.origin || !l.destination) continue;
    const key = `${cityKey(l.origin)}>${cityKey(l.destination)}`;
    let c = byCorridor.get(key);
    if (!c) { c = { origin: titleCase(l.origin), destination: titleCase(l.destination), days: new Map(), total: 0 }; byCorridor.set(key, c); }
    c.days.set(l.day, (c.days.get(l.day) ?? 0) + 1);
    c.total += 1;
  }

  const lastDays: string[] = [];
  const end = new Date(`${today}T00:00:00Z`).getTime();
  for (let i = AVERAGE_DAYS - 1; i >= 0; i--) lastDays.push(new Date(end - i * 86_400_000).toISOString().slice(0, 10));

  return [...byCorridor.values()]
    .filter(c => c.total >= MIN_LOADS)
    .map(c => {
      const recent = lastDays.reduce((sum, d) => sum + (c.days.get(d) ?? 0), 0);
      const daily = recent / AVERAGE_DAYS;
      return {
        origin: c.origin,
        destination: c.destination,
        loads_last_28_days: c.total,
        daily_average: Math.round(daily * 100) / 100,
        expected_next_7_days: Math.round(daily * FORECAST_DAYS * 10) / 10,
      };
    })
    .sort((a, b) => b.loads_last_28_days - a.loads_last_28_days || a.origin.localeCompare(b.origin))
    .slice(0, MAX_CORRIDORS);
}

/** Demand now and the forecast, read from the tables. */
export async function getDemandOverview() {
  const since = startOfIndianDay(HISTORY_DAYS - 1);

  const [{ data: openShipments, error: e1 }, { data: openRequests, error: e2 }, { data: vehicles, error: e3 }] = await Promise.all([
    supabase.from('shipments').select('id, origin_name, origin_address').eq('status', 'created').neq('is_master', true),
    supabase.from('vendor_shipment_requests').select('id, pickup_location').in('status', ['pending', 'approved']),
    supabase.from('vehicles').select('id, current_location_name').eq('status', 'available'),
  ]);
  if (e1) throw new Error(`Failed to read open shipments: ${e1.message}`);
  if (e2) throw new Error(`Failed to read vendor requests: ${e2.message}`);
  if (e3) throw new Error(`Failed to read vehicles: ${e3.message}`);

  const demand = buildDemand(
    [
      ...(openShipments ?? []).map((s: any) => cityFromAddress(s.origin_address) ?? cityFromAddress(s.origin_name)),
      ...(openRequests ?? []).map((r: any) => cityFromAddress(r.pickup_location)),
    ],
    (vehicles ?? []).map((v: any) => cityFromAddress(v.current_location_name)),
  );

  const { data: shipments, error: e4 } = await supabase
    .from('shipments').select('id, origin_name, origin_address, created_at').neq('is_master', true).gte('created_at', since.toISOString());
  if (e4) throw new Error(`Failed to read shipment history: ${e4.message}`);
  const { data: requests, error: e5 } = await supabase
    .from('vendor_shipment_requests').select('id, pickup_location, drop_location, created_at').gte('created_at', since.toISOString());
  if (e5) throw new Error(`Failed to read vendor request history: ${e5.message}`);

  const points = await selectIn<any>('delivery_points', 'shipment_id', (shipments ?? []).map((s: any) => s.id), 'shipment_id, address, name');
  const destByShipment = new Map<string, string | null>();
  for (const p of points) if (!destByShipment.has(p.shipment_id)) destByShipment.set(p.shipment_id, cityFromAddress(p.address) ?? cityFromAddress(p.name));

  const loads = [
    ...(shipments ?? []).map((s: any) => ({
      origin: cityFromAddress(s.origin_address) ?? cityFromAddress(s.origin_name),
      destination: destByShipment.get(s.id) ?? null,
      day: indianDateKey(new Date(s.created_at)),
    })),
    ...(requests ?? []).map((r: any) => ({
      origin: cityFromAddress(r.pickup_location),
      destination: cityFromAddress(r.drop_location),
      day: indianDateKey(new Date(r.created_at)),
    })),
  ];

  return {
    demand: demand.rows,
    loads_without_city: demand.loadsWithoutCity,
    vehicles_without_city: demand.vehiclesWithoutCity,
    forecast: buildForecast(loads, indianDateKey(new Date())),
    forecast_method: `Average loads per day over the last ${AVERAGE_DAYS} days, projected for the next ${FORECAST_DAYS} days. Based on the last ${HISTORY_DAYS} days.`,
  };
}
