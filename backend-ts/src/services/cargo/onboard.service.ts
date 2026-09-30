/**
 * margixindia — Cargo on board a vehicle
 *
 * What a vehicle is carrying right now (goods whose holder is that vehicle), with pieces,
 * weight, the condition last recorded and the next stop. The vehicle page, the SOS panel, the
 * maintenance modal and the driver app read it.
 */
import { supabase } from '../../core/supabase';
import { HttpError } from '../../core/errors';
import { manifestParcelCode } from '../../core/parcelCode';
import { piecesHeld, refOf, vehicleSummary, weightOf, type Consignment } from './consignment';
import { consignmentsOnVehicle } from './exception.service';
import { openExceptionsFor } from './custody.service';

/** The condition last recorded for each consignment (good when none was). */
async function lastConditions(goods: Consignment[]): Promise<Map<string, string>> {
  const out = new Map<string, { at: string; condition: string }>();
  const shipmentIds = goods.filter(c => c.kind === 'shipment').map(c => c.id);
  const manifestIds = goods.filter(c => c.kind === 'manifest').map(c => c.id);
  const rows: any[] = [];
  if (shipmentIds.length) rows.push(...((await supabase.from('cargo_custody_events').select('shipment_id, manifest_id, condition, recorded_at').in('shipment_id', shipmentIds)).data ?? []));
  if (manifestIds.length) rows.push(...((await supabase.from('cargo_custody_events').select('shipment_id, manifest_id, condition, recorded_at').in('manifest_id', manifestIds)).data ?? []));
  for (const e of rows) {
    if (!e.condition) continue;
    const key = e.shipment_id ?? e.manifest_id;
    const prev = out.get(key);
    if (!prev || String(e.recorded_at) > prev.at) out.set(key, { at: String(e.recorded_at), condition: e.condition });
  }
  return new Map([...out.entries()].map(([k, v]) => [k, v.condition]));
}

/** The next pending stop of a shipment on this vehicle's open routes. */
async function nextStops(vehicleId: string, shipmentIds: string[]): Promise<Map<string, any>> {
  const out = new Map<string, any>();
  if (shipmentIds.length === 0) return out;
  const { data: routes } = await supabase.from('routes').select('id').eq('vehicle_id', vehicleId).in('status', ['active', 'pending']);
  const routeIds = (routes ?? []).map((r: any) => r.id);
  if (routeIds.length === 0) return out;
  const { data: stops } = await supabase.from('route_stops').select('id, route_id, delivery_point_id, sequence, status').in('route_id', routeIds).eq('status', 'pending');
  if (!stops || stops.length === 0) return out;
  const { data: points } = await supabase.from('delivery_points').select('id, shipment_id, name, address, latitude, longitude').in('id', stops.map((s: any) => s.delivery_point_id));
  const pointBy = new Map((points ?? []).map((p: any) => [p.id, p]));
  for (const s of [...stops].sort((a: any, b: any) => Number(a.sequence) - Number(b.sequence))) {
    const p: any = pointBy.get(s.delivery_point_id);
    if (!p?.shipment_id || !shipmentIds.includes(p.shipment_id) || out.has(p.shipment_id)) continue;
    out.set(p.shipment_id, { stop_id: s.id, route_id: s.route_id, sequence: s.sequence, name: p.name, address: p.address, lat: p.latitude, lng: p.longitude });
  }
  return out;
}

export async function vehicleOnBoard(vehicleId: string) {
  const vehicle = await vehicleSummary(vehicleId);
  if (!vehicle) throw new HttpError(404, 'Vehicle not found');
  const goods = await consignmentsOnVehicle(vehicleId);
  const conditions = await lastConditions(goods);
  const stops = await nextStops(vehicleId, goods.filter(c => c.kind === 'shipment').map(c => c.id));
  // Lots show their master, so the driver sees "RTX-ABC123-B · 25 pcs" and whose goods they are
  const masterIds = [...new Set(goods.filter(c => c.kind === 'shipment' && c.parentId).map(c => c.parentId!))];
  const masters = new Map<string, string>();
  if (masterIds.length) for (const m of (await supabase.from('shipments').select('id, tracking_id').in('id', masterIds)).data ?? []) masters.set(m.id, m.tracking_id);
  const items = [];
  for (const c of goods) {
    const held = piecesHeld(c.pieces);
    const exceptions = await openExceptionsFor(c);
    items.push({
      ref: refOf(c),
      code: c.code,
      status: c.rawStatus,
      pieces_on_board: held,
      pieces_total: c.pieces.total,
      weight_kg: weightOf(c, held),
      seal_number: c.seal,
      condition: conditions.get(c.id) ?? 'good',
      rto: c.rto,
      on_hold_reason: c.onHoldReason,
      next_stop: c.kind === 'shipment'
        ? stops.get(c.id) ?? null
        : { stop_id: `${c.id}_drop`, route_id: c.id, sequence: 2, name: c.row.drop_location ?? null, address: c.row.drop_location ?? null, lat: c.row.drop_lat ?? null, lng: c.row.drop_lng ?? null },
      open_exceptions: exceptions.map((e: any) => ({ id: e.id, code: e.code, type: e.type, severity: e.severity, status: e.status })),
      lot: c.parentId && c.lotLabel
        ? {
            label: c.lotLabel,
            master: {
              ref: c.kind === 'shipment' ? { shipment_id: c.parentId } : { manifest_id: c.parentId },
              code: c.kind === 'shipment' ? masters.get(c.parentId) ?? null : manifestParcelCode(c.parentId),
            },
          }
        : null,
      consignee_name: c.row.consignee_name ?? null,
      display: `${c.code} · ${held ?? '?'} pcs`,
    });
  }
  return {
    vehicle: { id: vehicle.id, plate_number: vehicle.plate_number, status: vehicle.status, driver_name: vehicle.driver_name ?? null, lat: vehicle.latitude ?? null, lng: vehicle.longitude ?? null },
    totals: {
      consignments: items.length,
      pieces: items.reduce((sum, i) => sum + (i.pieces_on_board ?? 0), 0),
      weight_kg: Math.round(items.reduce((sum, i) => sum + i.weight_kg, 0) * 100) / 100,
    },
    items,
  };
}
