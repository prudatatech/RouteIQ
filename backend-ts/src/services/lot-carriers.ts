/**
 * Who carries each lot of a split master, and where it drops: added to the master's `lots_summary`
 * in the shipment list and page. A master holds no vehicle, driver or drop of its own, so staff
 * read them from its lots (a delivered lot no longer has `current_vehicle_id`, so the trip stop or
 * the load's vehicle is used).
 */
import { supabase } from '../core/supabase';

type Lot = { id: string; [key: string]: unknown };
type Summary = { lots: Lot[] };
type Carrier = { plate_number: string | null; driver_name: string | null; vehicle_type: string | null };

async function vehiclesById(ids: string[]): Promise<Map<string, Carrier>> {
  const out = new Map<string, Carrier>();
  if (ids.length === 0) return out;
  const { data } = await supabase.from('vehicles').select('id, plate_number, driver_name, vehicle_type').in('id', ids);
  for (const v of (data ?? []) as any[]) out.set(v.id, { plate_number: v.plate_number ?? null, driver_name: v.driver_name ?? null, vehicle_type: v.vehicle_type ?? null });
  return out;
}

/** Adds `plate_number`, `driver_name`, `vehicle_type`, `drop` and `eway_bill_ref` to every lot of the given summaries. */
export async function addLotCarriers(kind: 'shipment' | 'manifest', summaries: Summary[]): Promise<void> {
  const lots = summaries.flatMap(s => s.lots);
  if (lots.length === 0) return;
  const lotIds = lots.map(l => l.id);
  const vehicleOf = new Map<string, string>();
  const dropOf = new Map<string, string>();
  const ewayOf = new Map<string, string>();

  if (kind === 'shipment') {
    const { data: own } = await supabase.from('shipments').select('id, eway_bill_ref').in('id', lotIds);
    for (const r of (own ?? []) as any[]) if (r.eway_bill_ref) ewayOf.set(r.id, r.eway_bill_ref);
    const { data: points } = await supabase.from('delivery_points').select('id, shipment_id, name, address, created_at').in('shipment_id', lotIds);
    const pointRows = ((points ?? []) as any[]).sort((a, b) => Date.parse(a.created_at ?? '') - Date.parse(b.created_at ?? ''));
    for (const p of pointRows) dropOf.set(p.shipment_id, p.name || p.address || '');
    const pointIds = pointRows.map(p => p.id);
    const { data: stops } = pointIds.length ? await supabase.from('route_stops').select('route_id, delivery_point_id').in('delivery_point_id', pointIds) : { data: [] as any[] };
    const routeIds = [...new Set((stops ?? []).map((s: any) => s.route_id))];
    const { data: routes } = routeIds.length ? await supabase.from('routes').select('id, vehicle_id, status').in('id', routeIds).neq('status', 'cancelled') : { data: [] as any[] };
    const routeVehicle = new Map((routes ?? []).map((r: any) => [r.id, r.vehicle_id as string | null]));
    const lotOfPoint = new Map(pointRows.map(p => [p.id, p.shipment_id as string]));
    for (const s of (stops ?? []) as any[]) {
      const lot = lotOfPoint.get(s.delivery_point_id);
      const vehicle = routeVehicle.get(s.route_id);
      if (lot && vehicle && !vehicleOf.has(lot)) vehicleOf.set(lot, vehicle);
    }
  } else {
    const { data: rows } = await supabase.from('cargo_manifest').select('id, vehicle_id, drop_location, eway_bill_ref').in('id', lotIds);
    for (const r of (rows ?? []) as any[]) {
      if (r.vehicle_id) vehicleOf.set(r.id, r.vehicle_id);
      if (r.drop_location) dropOf.set(r.id, r.drop_location);
      if (r.eway_bill_ref) ewayOf.set(r.id, r.eway_bill_ref);
    }
  }

  for (const l of lots) if (!vehicleOf.has(l.id) && typeof l.current_vehicle_id === 'string') vehicleOf.set(l.id, l.current_vehicle_id);
  const vehicles = await vehiclesById([...new Set(vehicleOf.values())]);
  for (const l of lots) {
    const v = vehicles.get(vehicleOf.get(l.id) ?? '');
    l.plate_number = v?.plate_number ?? null;
    l.driver_name = v?.driver_name ?? null;
    l.vehicle_type = v?.vehicle_type ?? null;
    l.drop = dropOf.get(l.id) || null;
    l.eway_bill_ref = ewayOf.get(l.id) || null;
  }
}
