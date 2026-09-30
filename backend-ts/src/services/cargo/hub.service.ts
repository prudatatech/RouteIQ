/**
 * margixindia — Hubs: depots holding goods between legs
 *
 * Goods arrive by a hub_in custody event or a transfer to the depot, and leave by hub_out.
 * The inventory shows what each hub holds, since when (ageing) and where it goes next.
 */
import { supabase } from '../../core/supabase';
import { HttpError } from '../../core/errors';
import { piecesHeld, refOf, toConsignment, weightOf, SHIPMENT_CUSTODY_COLUMNS, MANIFEST_CUSTODY_COLUMNS, type Consignment } from './consignment';
import { openExceptionsFor } from './custody.service';
import { openDropPoints } from './replan';

async function goodsAtHubs(depotId?: string): Promise<Consignment[]> {
  let ships = supabase.from('shipments').select(SHIPMENT_CUSTODY_COLUMNS).eq('current_holder', 'hub');
  let loads = supabase.from('cargo_manifest').select(MANIFEST_CUSTODY_COLUMNS).eq('current_holder', 'hub');
  if (depotId) {
    ships = ships.eq('current_depot_id', depotId);
    loads = loads.eq('current_depot_id', depotId);
  }
  const [s, m] = await Promise.all([ships, loads]);
  if (s.error) throw new Error(`Failed to read goods at hubs: ${s.error.message}`);
  if (m.error) throw new Error(`Failed to read loads at hubs: ${m.error.message}`);
  return [
    ...(s.data ?? []).map((r: any) => toConsignment('shipment', r)),
    ...(m.data ?? []).map((r: any) => toConsignment('manifest', r)),
  ].filter(c => c.depotId && (!depotId || c.depotId === depotId));
}

/** When each consignment reached the hub: its latest hub_in or handover into the hub. */
async function arrivals(goods: Consignment[], depotId?: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const shipmentIds = goods.filter(c => c.kind === 'shipment').map(c => c.id);
  const manifestIds = goods.filter(c => c.kind === 'manifest').map(c => c.id);
  const rows: any[] = [];
  if (shipmentIds.length) rows.push(...((await supabase.from('cargo_custody_events').select('shipment_id, manifest_id, kind, to_depot_id, recorded_at').in('shipment_id', shipmentIds)).data ?? []));
  if (manifestIds.length) rows.push(...((await supabase.from('cargo_custody_events').select('shipment_id, manifest_id, kind, to_depot_id, recorded_at').in('manifest_id', manifestIds)).data ?? []));
  for (const e of rows) {
    if (!['hub_in', 'handover_in'].includes(e.kind) || !e.to_depot_id || (depotId && e.to_depot_id !== depotId)) continue;
    const key = e.shipment_id ?? e.manifest_id;
    if (!out.has(key) || String(e.recorded_at) > String(out.get(key))) out.set(key, e.recorded_at);
  }
  return out;
}

export async function listHubs() {
  const { data: depots, error } = await supabase.from('depots').select('id, name, address, latitude, longitude').order('name', { ascending: true });
  if (error) throw new Error(`Failed to read hubs: ${error.message}`);
  const goods = await goodsAtHubs();
  const since = await arrivals(goods);
  const now = Date.now();
  return (depots ?? []).map((d: any) => {
    const here = goods.filter(c => c.depotId === d.id);
    const oldest = here.map(c => since.get(c.id)).filter((t): t is string => !!t).sort()[0] ?? null;
    return {
      ...d,
      consignments: here.length,
      pieces: here.reduce((sum, c) => sum + (piecesHeld(c.pieces) ?? 0), 0),
      weight_kg: Math.round(here.reduce((sum, c) => sum + weightOf(c, piecesHeld(c.pieces)), 0) * 100) / 100,
      oldest_since: oldest,
      oldest_age_hours: oldest ? Math.round(((now - Date.parse(oldest)) / 3600_000) * 10) / 10 : null,
    };
  });
}

export async function hubInventory(depotId: string) {
  const { data: depot } = await supabase.from('depots').select('id, name, address, latitude, longitude').eq('id', depotId).maybeSingle();
  if (!depot) throw new HttpError(404, 'Hub not found');
  const goods = await goodsAtHubs(depotId);
  const since = await arrivals(goods, depotId);
  const now = Date.now();
  const items = [];
  for (const c of goods) {
    let nextLeg: { name: string | null; address: string | null; lat: number | null; lng: number | null } | null = null;
    if (c.kind === 'shipment') {
      const points = await openDropPoints(c.id, c.rto);
      const p = points[0];
      if (p) nextLeg = { name: p.name, address: p.address, lat: p.latitude, lng: p.longitude };
    } else {
      nextLeg = { name: c.row.drop_location ?? null, address: c.row.drop_location ?? null, lat: c.row.drop_lat ?? null, lng: c.row.drop_lng ?? null };
    }
    const at = since.get(c.id) ?? null;
    const exceptions = await openExceptionsFor(c);
    items.push({
      ref: refOf(c),
      code: c.code,
      status: c.rawStatus,
      pieces: piecesHeld(c.pieces),
      pieces_total: c.pieces.total,
      weight_kg: weightOf(c, piecesHeld(c.pieces)),
      since: at,
      age_hours: at ? Math.round(((now - Date.parse(at)) / 3600_000) * 10) / 10 : null,
      rto: c.rto,
      on_hold_reason: c.onHoldReason,
      next_leg: nextLeg,
      open_exceptions: exceptions.map((e: any) => ({ id: e.id, code: e.code, type: e.type, severity: e.severity, status: e.status })),
    });
  }
  items.sort((a, b) => String(a.since ?? '').localeCompare(String(b.since ?? '')));
  return { depot, items };
}
