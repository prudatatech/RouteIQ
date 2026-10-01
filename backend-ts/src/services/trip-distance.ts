/**
 * margixindia — The distance of a trip, and which kind of figure it is.
 *
 * One basis for every screen, the same one driver pay uses (driver-pay.service, routeKm):
 *  - actual:    driven, counted from the trip's GPS points (a finished trip's pay entry)
 *  - planned:   the distance the route was planned with
 *  - estimated: straight lines between the stops (or the pickup and the drop of a vendor load)
 *  - none:      nothing to measure
 * A finished trip shows what its pay entry used, so the trip list, the vehicle page and driver pay
 * agree. A vendor load has no planned distance, so it is an estimate until it is paid.
 */
import { haversineKm, roundKm } from './odometer';
import { selectIn } from './finance.service';

export type DistanceBasis = 'actual' | 'planned' | 'estimated' | 'none';

/** The pay entry's `km_source` in the words the screens use. */
export function basisOfKmSource(source: string | null | undefined): DistanceBasis {
  if (source === 'gps') return 'actual';
  if (source === 'planned') return 'planned';
  if (source === 'estimated') return 'estimated';
  return 'none';
}

const num = (v: unknown): number => (v == null || v === '' || !Number.isFinite(Number(v)) ? 0 : Number(v));
const point = (lat: unknown, lng: unknown) => (lat == null || lng == null || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng)) ? null : { lat: Number(lat), lng: Number(lng) });

/** Straight-line distance through the stops in order, or between a load's pickup and drop. */
function estimateKm(row: any): number {
  if (row.is_manifest) {
    const a = point(row.route_stops?.[0]?.delivery_points?.latitude, row.route_stops?.[0]?.delivery_points?.longitude);
    const b = point(row.route_stops?.[1]?.delivery_points?.latitude, row.route_stops?.[1]?.delivery_points?.longitude);
    return a && b ? haversineKm(a, b) : 0;
  }
  const points = [...(row.route_stops ?? [])].sort((x: any, y: any) => num(x.sequence) - num(y.sequence))
    .map((s: any) => point(s.delivery_points?.latitude, s.delivery_points?.longitude)).filter(Boolean) as { lat: number; lng: number }[];
  let km = 0;
  for (let i = 0; i + 1 < points.length; i++) km += haversineKm(points[i], points[i + 1]);
  return km;
}

/**
 * Sets `distance_km` and `distance_basis` on route rows (routes and vendor loads shown as routes).
 * A finished trip takes its pay entry's distance. A vendor load's `total_distance_km` is 0 in the
 * data, so it carries the same figure; a route's planned `total_distance_km` is left as it is.
 */
export async function attachTripDistance(rows: any[]): Promise<void> {
  const finished = rows.filter(r => r.status === 'completed');
  const routeIds = finished.filter(r => !r.is_manifest).map(r => r.id as string);
  const loadIds = finished.filter(r => r.is_manifest).map(r => r.id as string);

  const byRoute = new Map<string, any>();
  const byLoad = new Map<string, any>();
  try {
    if (routeIds.length > 0) {
      for (const e of await selectIn<any>('driver_pay_entries', 'route_id', routeIds, 'route_id, km, km_source')) byRoute.set(e.route_id, e);
    }
    // A load is paid per journey, keyed on its master and vehicle: look for the load itself and for its master
    if (loadIds.length > 0) await loadEntries(finished, loadIds, byLoad);
  } catch (e) {
    // The distance is still shown from the plan or the stops; a pay lookup must not break the trip list
    console.error('[trip-distance] Could not read the pay entries:', e);
  }

  fill(rows, byRoute, byLoad);
}

async function loadEntries(finished: any[], loadIds: string[], byLoad: Map<string, any>): Promise<void> {
  const masters = new Map<string, string>(); // load id -> master id
  const lots = await selectIn<any>('cargo_manifest', 'id', loadIds, 'id, parent_manifest_id');
  for (const l of lots) masters.set(l.id, l.parent_manifest_id ?? l.id);
  const entries = await selectIn<any>('driver_pay_entries', 'manifest_id', [...new Set(masters.values())], 'manifest_id, vehicle_id, km, km_source');
  for (const r of finished.filter(x => x.is_manifest)) {
    const master = masters.get(r.id) ?? r.id;
    const entry = entries.find((e: any) => e.manifest_id === master && (!r.vehicle_id || e.vehicle_id === r.vehicle_id)) ?? entries.find((e: any) => e.manifest_id === master);
    if (entry) byLoad.set(r.id, entry);
  }
}

function fill(rows: any[], byRoute: Map<string, any>, byLoad: Map<string, any>): void {
  for (const row of rows) {
    const entry = row.is_manifest ? byLoad.get(row.id) : byRoute.get(row.id);
    let km: number;
    let basis: DistanceBasis;
    if (entry && num(entry.km) > 0) {
      km = num(entry.km);
      basis = basisOfKmSource(entry.km_source);
    } else if (num(row.total_distance_km) > 0) {
      km = num(row.total_distance_km);
      basis = 'planned';
    } else {
      km = estimateKm(row);
      basis = km > 0 ? 'estimated' : 'none';
    }
    row.distance_km = roundKm(km);
    row.distance_basis = basis;
    if (row.is_manifest && !(num(row.total_distance_km) > 0)) row.total_distance_km = row.distance_km;
  }
}
