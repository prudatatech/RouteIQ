/**
 * margixindia — Cargo transfers: transshipment to a relief vehicle, or a move to a hub
 *
 *   planned ──handover-out──▶ in_progress ──handover-in──▶ completed
 *      └──────────────cancel──────────▶ cancelled
 *
 * The from-driver (or staff) counts the pieces out; the to-driver, hub staff or staff count them
 * in. Fewer in than planned opens a shortage case. On completion the goods move: their current
 * vehicle changes (or the hub holds them), the vehicles' loads follow, the remaining drops are
 * put on the new vehicle's route in driving order, and e-way bill Part B is marked as needing an
 * update when the vehicle changed. The consignor, consignee and vendor hear about it.
 */
import { z } from 'zod';
import { supabase } from '../../core/supabase';
import { HttpError } from '../../core/errors';
import { isStaff, getDriverVehicleIds } from '../../core/ownership';
import { canTransition, OPERATING_VEHICLE_STATUSES, SHIPMENT_TRANSITIONS } from '../../core/transitions';
import { isPlaceholderPlate } from '../../core/vehicles';
import type { TokenData } from '../../core/auth';
import { ShipmentService } from '../shipment.service';
import { releaseVehicleLoad } from '../route.service';
import { recordJourneyAfterTransferSafe } from '../driver-pay.service';
import {
  CONDITIONS, RefSchema, addPieces, assertNotMaster, piecesHeld, piecesPatch, refColumns, reload, resolveRef, weightOf, writeConsignment,
  type Actor, type Condition, type Consignment,
} from './consignment';
import { insertWithCode } from './exception.service';
import { notifyOwner, notifyStaffSafe, notifyVehicleDriver } from './notify';
import { openDropPoints, planStopsOnVehicle, cancelOpenStops } from './replan';

export const PlanTransferSchema = z.object({
  exception_id: z.string().uuid().nullable().optional(),
  from_vehicle_id: z.string().uuid(),
  to_vehicle_id: z.string().uuid().nullable().optional(),
  to_depot_id: z.string().uuid().nullable().optional(),
  items: z.array(z.object({ ref: RefSchema, pieces: z.number().int().min(0).max(100_000) })).min(1).max(50),
  meet_lat: z.number().min(-90).max(90).nullable().optional(),
  meet_lng: z.number().min(-180).max(180).nullable().optional(),
  meet_address: z.string().trim().max(300).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
}).refine(v => !!v.to_vehicle_id !== !!v.to_depot_id, { message: 'Choose either a vehicle (to_vehicle_id) or a hub (to_depot_id)' });

const conditionSchema = z.enum(CONDITIONS as unknown as [string, ...string[]]).nullable().optional();
export const HandoverSchema = z.object({
  items: z.array(z.object({
    ref: RefSchema,
    pieces_out: z.number().int().min(0).max(100_000).optional(),
    pieces_in: z.number().int().min(0).max(100_000).optional(),
    condition: conditionSchema,
  })).min(1).max(50),
  photo_paths: z.array(z.string().max(300)).max(10).optional(),
  signature_path: z.string().max(300).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const TRANSFER_STATUSES = ['planned', 'in_progress', 'completed', 'cancelled'] as const;

const TRANSFER_COLUMNS =
  'id, code, exception_id, from_vehicle_id, to_vehicle_id, to_depot_id, status, meet_lat, meet_lng, meet_address, planned_at, started_at, completed_at, new_route_id, ' +
  'eway_part_b_required, eway_part_b_updated_at, eway_part_b_ref, created_by, note';

async function loadTransfer(id: string): Promise<any> {
  const { data, error } = await supabase.from('cargo_transfers').select(TRANSFER_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to read the transfer: ${error.message}`);
  if (!data) throw new HttpError(404, 'Transfer not found');
  return data;
}

async function transferItems(transferId: string): Promise<any[]> {
  const { data, error } = await supabase.from('cargo_transfer_items').select('*').eq('transfer_id', transferId);
  if (error) throw new Error(`Failed to read the transfer items: ${error.message}`);
  return data ?? [];
}

/** Free capacity of a vehicle in kg: what dispatch last worked out, else capacity less the load on it. */
export function freeKg(v: { capacity_kg?: number | null; available_capacity_kg?: number | null; current_load_kg?: number | null }): number | null {
  if (v.available_capacity_kg != null) return Number(v.available_capacity_kg);
  if (!Number(v.capacity_kg)) return null;
  return Math.max(0, Number(v.capacity_kg) - (Number(v.current_load_kg) || 0));
}

/** Staff, or the driver of one of these vehicles. */
async function assertDriverOf(user: TokenData, vehicleIds: (string | null)[], what: string): Promise<void> {
  if (isStaff(user)) return;
  if (user.role !== 'driver') throw new HttpError(403, 'Only drivers and staff take part in a transfer');
  const mine = await getDriverVehicleIds(user.user_id);
  if (!vehicleIds.some(v => v && mine.includes(v))) throw new HttpError(403, `Only the ${what} or staff can do this`);
}

export async function planTransfer(input: z.infer<typeof PlanTransferSchema>, actor: Actor): Promise<any> {
  const parsed = PlanTransferSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);
  const body = parsed.data;

  const { data: from } = await supabase.from('vehicles').select('id, plate_number').eq('id', body.from_vehicle_id).maybeSingle();
  if (!from) throw new HttpError(404, 'The vehicle holding the goods was not found');
  if (body.exception_id) {
    const { data: exc } = await supabase.from('cargo_exceptions').select('id, status').eq('id', body.exception_id).maybeSingle();
    if (!exc) throw new HttpError(404, 'Cargo case not found');
  }

  const goods: { c: Consignment; pieces: number; partial: boolean }[] = [];
  for (const item of body.items) {
    const c = await resolveRef(item.ref);
    await assertNotMaster(c, 'Transfer the goods');
    if (goods.some(g => g.c.id === c.id)) throw new HttpError(400, `${c.code} is listed twice`);
    if (c.holder !== 'vehicle' || c.vehicleId !== from.id) throw new HttpError(409, `${c.code} is not on ${from.plate_number}.`);
    const held = piecesHeld(c.pieces);
    // Fewer pieces than are on board: the consignment is split first into a lot that moves and a
    // lot that stays (docs/cargo-plan.md, Lots); the transfer then moves the moving lot whole
    if (held != null && item.pieces > held) throw new HttpError(409, `${c.code} has ${held} pieces on board.`);
    if (held != null && item.pieces < 1) throw new HttpError(400, `Move at least one piece of ${c.code}`);
    if (held == null && item.pieces < 1) throw new HttpError(400, `Count the pieces of ${c.code}`);
    goods.push({ c, pieces: item.pieces, partial: held != null && item.pieces < held });
  }

  // One open transfer per consignment
  const shipmentIds = goods.filter(g => g.c.kind === 'shipment').map(g => g.c.id);
  const manifestIds = goods.filter(g => g.c.kind === 'manifest').map(g => g.c.id);
  const open: any[] = [];
  if (shipmentIds.length) open.push(...((await supabase.from('cargo_transfer_items').select('transfer_id, shipment_id, manifest_id').in('shipment_id', shipmentIds)).data ?? []));
  if (manifestIds.length) open.push(...((await supabase.from('cargo_transfer_items').select('transfer_id, shipment_id, manifest_id').in('manifest_id', manifestIds)).data ?? []));
  if (open.length) {
    const { data: active } = await supabase.from('cargo_transfers').select('id, code').in('id', [...new Set(open.map(o => o.transfer_id))]).in('status', ['planned', 'in_progress']);
    if (active && active.length > 0) throw new HttpError(409, `These goods are already on transfer ${active[0].code}.`, { transfer_id: active[0].id });
  }

  const weight = goods.reduce((sum, g) => sum + weightOf(g.c, g.pieces), 0);
  const partialOpen = goods.filter(g => g.partial);
  let toVehicle: any = null;
  if (body.to_vehicle_id) {
    if (body.to_vehicle_id === from.id) throw new HttpError(400, 'Choose a different vehicle');
    const { data } = await supabase
      .from('vehicles').select('id, plate_number, status, driver_id, capacity_kg, available_capacity_kg, current_load_kg').eq('id', body.to_vehicle_id).maybeSingle();
    if (!data) throw new HttpError(404, 'The relief vehicle was not found');
    if (!(OPERATING_VEHICLE_STATUSES as readonly string[]).includes(String(data.status)) || isPlaceholderPlate(data.plate_number)) {
      throw new HttpError(409, `${data.plate_number ?? 'That vehicle'} is ${String(data.status).replace(/_/g, ' ')} and can't take the goods.`);
    }
    const free = freeKg(data);
    if (free != null && weight > free) throw new HttpError(409, `${data.plate_number} has ${Math.round(free)} kg free and these goods weigh ${Math.round(weight)} kg.`);
    toVehicle = data;
  }
  let depot: any = null;
  if (body.to_depot_id) {
    const { data } = await supabase.from('depots').select('id, name, address').eq('id', body.to_depot_id).maybeSingle();
    if (!data) throw new HttpError(404, 'Hub not found');
    depot = data;
  }

  // Split the partial items now that the transfer is known to be possible: the moving lot goes on it
  const splits: { from: { ref: any; code: string }; moving: { ref: any; code: string; label: string; pieces: number }; staying: { ref: any; code: string; label: string; pieces: number } }[] = [];
  for (const g of partialOpen) {
    const { splitConsignment } = await import('./lots.service');
    const result = await splitConsignment(g.c, { reason: 'partial_transfer', lots: [{ pieces: g.pieces }] }, actor, { via: 'transfer' });
    const [moving, staying] = result.lots;
    splits.push({
      from: { ref: result.source.ref, code: result.source.code },
      moving: { ref: moving.ref, code: moving.code, label: moving.label, pieces: moving.pieces },
      staying: { ref: staying.ref, code: staying.code, label: staying.label, pieces: staying.pieces },
    });
    g.c = await resolveRef(moving.ref);
  }

  const transfer = await insertWithCode('cargo_transfers', 'TRF', {
    exception_id: body.exception_id ?? null,
    from_vehicle_id: from.id,
    to_vehicle_id: toVehicle?.id ?? null,
    to_depot_id: depot?.id ?? null,
    status: 'planned',
    meet_lat: body.meet_lat ?? null,
    meet_lng: body.meet_lng ?? null,
    meet_address: body.meet_address ?? null,
    planned_at: new Date().toISOString(),
    eway_part_b_required: false,
    created_by: ['admin', 'manager', 'superadmin'].includes(actor.role) ? actor.id : null,
    note: body.note ?? null,
  }, TRANSFER_COLUMNS);
  const { error: itemsErr } = await supabase.from('cargo_transfer_items').insert(goods.map(g => ({ transfer_id: transfer.id, ...refColumns(g.c), pieces_planned: g.pieces })));
  if (itemsErr) {
    await supabase.from('cargo_transfers').delete().eq('id', transfer.id);
    throw new Error(`Failed to save the transfer items: ${itemsErr.message}`);
  }

  const where = body.meet_address ? ` at ${body.meet_address}` : '';
  const target = toVehicle ? toVehicle.plate_number : `the ${depot.name} hub`;
  const summary = `${goods.length} consignment(s), ${goods.reduce((s, g) => s + g.pieces, 0)} pieces`;
  await notifyVehicleDriver(from.id, 'Cargo transfer planned', `Hand over ${summary} to ${target}${where}. Count them out in the app.`, 'cargo_transfer_planned', { transfer_id: transfer.id, code: transfer.code });
  if (toVehicle) await notifyVehicleDriver(toVehicle.id, 'Cargo transfer planned', `Collect ${summary} from ${from.plate_number}${where}. Count them in when you receive them.`, 'cargo_transfer_planned', { transfer_id: transfer.id, code: transfer.code });
  await notifyStaffSafe(`Transfer ${transfer.code} planned`, `${summary} from ${from.plate_number} to ${target}.`, 'cargo_transfer_planned', { transfer_id: transfer.id, code: transfer.code });
  const view = await getTransfer(transfer.id);
  // `lots` names the two lots of the first split too, for clients that move one consignment at a time
  return splits.length > 0 ? { ...view, splits, lots: { moving: splits[0].moving, staying: splits[0].staying } } : view;
}

function matchItems(items: any[], body: z.infer<typeof HandoverSchema>['items'], refs: Consignment[]): { item: any; c: Consignment; input: (typeof body)[number] }[] {
  const out = [];
  for (const item of items) {
    const idx = refs.findIndex(c => c.id === (item.shipment_id ?? item.manifest_id));
    if (idx < 0) throw new HttpError(400, 'Count every consignment on the transfer');
    out.push({ item, c: refs[idx], input: body[idx] });
  }
  return out;
}

async function resolveBodyRefs(body: z.infer<typeof HandoverSchema>['items'], items: any[]): Promise<Consignment[]> {
  const refs: Consignment[] = [];
  for (const b of body) refs.push(await resolveRef(b.ref));
  const ids = new Set(items.map(i => i.shipment_id ?? i.manifest_id));
  for (const c of refs) if (!ids.has(c.id)) throw new HttpError(400, `${c.code} is not on this transfer`);
  if (refs.length !== items.length) throw new HttpError(400, 'Count every consignment on the transfer');
  return refs;
}

export async function handoverOut(id: string, input: unknown, user: TokenData): Promise<any> {
  const parsed = HandoverSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);
  const body = parsed.data;
  const transfer = await loadTransfer(id);
  await assertDriverOf(user, [transfer.from_vehicle_id], 'driver handing over');
  if (transfer.status !== 'planned') throw new HttpError(409, `This transfer is ${transfer.status.replace(/_/g, ' ')}.`);
  const actor: Actor = { id: user.user_id, role: user.role };
  const items = await transferItems(id);
  const pairs = matchItems(items, body.items, await resolveBodyRefs(body.items, items));
  for (const p of pairs) {
    if (p.input.pieces_out == null) throw new HttpError(400, 'pieces_out is required for each consignment');
    if (p.input.pieces_out > p.item.pieces_planned) throw new HttpError(409, `${p.c.code}: ${p.input.pieces_out} counted out, but only ${p.item.pieces_planned} were planned.`);
  }

  const { data: claimed } = await supabase
    .from('cargo_transfers').update({ status: 'in_progress', started_at: new Date().toISOString() })
    .eq('id', id).eq('status', 'planned').select('id').maybeSingle();
  if (!claimed) throw new HttpError(409, 'This transfer was just changed by someone else. Refresh and try again.');

  const { recordHandover } = await import('./custody.service');
  const { openException } = await import('./exception.service');
  for (const p of pairs) {
    await supabase.from('cargo_transfer_items').update({ pieces_out: p.input.pieces_out }).eq('id', p.item.id);
    let exceptionId: string | null = transfer.exception_id ?? null;
    const missing = p.item.pieces_planned - p.input.pieces_out!;
    if (missing > 0) {
      exceptionId = (await openException({
        type: 'shortage', severity: 'high', source: user.role === 'driver' ? 'driver' : 'custody',
        description: `Transfer ${transfer.code}: ${p.input.pieces_out} of ${p.item.pieces_planned} pieces of ${p.c.code} were found to hand over.`,
        items: [{ consignment: p.c, pieces_affected: missing, condition: 'shortage' }], vehicle_id: transfer.from_vehicle_id,
      }, actor)).id;
    }
    await recordHandover(p.c, 'out', {
      pieces: p.input.pieces_out!, condition: (p.input.condition ?? null) as Condition | null,
      photo_paths: body.photo_paths, signature_path: body.signature_path, notes: body.notes ?? null,
    }, actor, { transferId: id, exceptionId, fromVehicleId: transfer.from_vehicle_id, toVehicleId: transfer.to_vehicle_id, toDepotId: transfer.to_depot_id });
  }
  return getTransfer(id);
}

/** Puts a vendor load's weight on a vehicle (the mirror of releaseVehicleLoad). */
async function reserveVehicleLoad(vehicleId: string, weightKg: number): Promise<void> {
  if (!(weightKg > 0)) return;
  const { data: veh } = await supabase.from('vehicles').select('current_load_kg, capacity_kg').eq('id', vehicleId).maybeSingle();
  if (!veh) return;
  const load = (Number(veh.current_load_kg) || 0) + weightKg;
  await supabase.from('vehicles').update({ current_load_kg: load, available_capacity_kg: Math.max((Number(veh.capacity_kg) || 0) - load, 0) }).eq('id', vehicleId);
}

/** The status goods take when they reach the other side of a transfer. */
function statusAfterTransfer(c: Consignment, toHub: boolean): string {
  if (toHub) return 'at_hub';
  if (c.rto) return canTransition(SHIPMENT_TRANSITIONS, c.status, 'returning') || c.status === 'returning' ? 'returning' : c.status;
  if (c.status === 'on_hold' || c.status === 'picked_up') return 'in_transit';
  return c.status;
}

export async function handoverIn(id: string, input: unknown, user: TokenData): Promise<any> {
  const parsed = HandoverSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);
  const body = parsed.data;
  const transfer = await loadTransfer(id);
  if (transfer.to_depot_id && !isStaff(user)) throw new HttpError(403, 'Hub staff receive goods at a hub');
  await assertDriverOf(user, [transfer.to_vehicle_id], 'receiving driver');
  if (transfer.status === 'planned') throw new HttpError(409, 'The goods have not been handed over yet (handover-out comes first).');
  if (transfer.status !== 'in_progress') throw new HttpError(409, `This transfer is ${transfer.status.replace(/_/g, ' ')}.`);
  const actor: Actor = { id: user.user_id, role: user.role };
  const items = await transferItems(id);
  const pairs = matchItems(items, body.items, await resolveBodyRefs(body.items, items));
  for (const p of pairs) {
    if (p.input.pieces_in == null) throw new HttpError(400, 'pieces_in is required for each consignment');
  }

  const vehicleChanged = !!transfer.to_vehicle_id;
  const { data: claimed } = await supabase
    .from('cargo_transfers').update({ status: 'completed', completed_at: new Date().toISOString(), eway_part_b_required: vehicleChanged })
    .eq('id', id).eq('status', 'in_progress').select('id').maybeSingle();
  if (!claimed) throw new HttpError(409, 'This transfer was just changed by someone else. Refresh and try again.');

  const { recordHandover, exceptionTypeFor, revisedEta } = await import('./custody.service');
  const { openException, resolveIfSettled } = await import('./exception.service');
  const { data: caseRow } = transfer.exception_id
    ? await supabase.from('cargo_exceptions').select('type').eq('id', transfer.exception_id).maybeSingle()
    : { data: null };
  const because = caseRow?.type === 'vehicle_breakdown' ? ' after a breakdown' : caseRow?.type === 'vehicle_accident' ? ' after an accident' : '';
  const start = transfer.meet_lat != null && transfer.meet_lng != null ? { lat: Number(transfer.meet_lat), lng: Number(transfer.meet_lng) } : null;
  let newRouteId: string | null = null;
  const opened: string[] = [];

  for (const p of pairs) {
    const c = await reload(p.c);
    const piecesIn = p.input.pieces_in!;
    const piecesOut = p.item.pieces_out ?? p.item.pieces_planned;
    await supabase.from('cargo_transfer_items').update({ pieces_in: piecesIn, condition_in: p.input.condition ?? null }).eq('id', p.item.id);

    // Everything planned but not received is short
    const short = Math.max(0, p.item.pieces_planned - piecesIn);
    let pieces = c.pieces;
    if (short > 0 && pieces.total != null) pieces = addPieces(pieces, { short });
    if (piecesIn < piecesOut) {
      opened.push((await openException({
        type: 'shortage', severity: 'high', source: user.role === 'driver' ? 'driver' : 'custody',
        description: `Transfer ${transfer.code}: ${piecesIn} pieces of ${c.code} received against ${piecesOut} handed over.`,
        items: [{ consignment: c, pieces_affected: piecesOut - piecesIn, condition: 'shortage' }], vehicle_id: transfer.to_vehicle_id ?? transfer.from_vehicle_id,
      }, actor)).id);
    } else if (piecesIn > piecesOut) {
      opened.push((await openException({
        type: 'excess', severity: 'low', source: 'custody',
        description: `Transfer ${transfer.code}: ${piecesIn} pieces of ${c.code} received against ${piecesOut} handed over.`,
        items: [{ consignment: c, pieces_affected: piecesIn - piecesOut, condition: 'excess' }], vehicle_id: transfer.to_vehicle_id ?? transfer.from_vehicle_id,
      }, actor)).id);
    }
    const condType = exceptionTypeFor((p.input.condition ?? null) as Condition | null);
    if (condType === 'damage' || condType === 'seal_tamper') {
      opened.push((await openException({
        type: condType, source: 'custody', description: `Transfer ${transfer.code}: ${c.code} received ${String(p.input.condition).replace(/_/g, ' ')}.`,
        items: [{ consignment: c, pieces_affected: piecesIn, condition: p.input.condition as Condition }], vehicle_id: transfer.to_vehicle_id ?? transfer.from_vehicle_id,
      }, actor)).id);
    }

    // Move the goods
    const toHub = !!transfer.to_depot_id;
    let next = statusAfterTransfer(c, toHub);
    if (toHub && !canTransition(SHIPMENT_TRANSITIONS, c.status, 'at_hub') && c.status !== 'at_hub') {
      // Out for delivery or partly delivered goods reach a hub through a hold
      await writeConsignment(c, { status: 'on_hold', on_hold_reason: `Transfer ${transfer.code} to a hub` });
      Object.assign(c, await reload(c));
      next = 'at_hub';
    }
    const previous = c.status;
    await writeConsignment(c, {
      status: next,
      current_holder: toHub ? 'hub' : 'vehicle',
      current_vehicle_id: toHub ? null : transfer.to_vehicle_id,
      current_depot_id: toHub ? transfer.to_depot_id : null,
      on_hold_reason: null,
      ...piecesPatch(pieces),
      ...(c.kind === 'manifest' && !toHub ? { vehicle_id: transfer.to_vehicle_id } : {}),
      // A new vehicle: e-way bill Part B is due for these goods (for a partial transfer, only the moving lot)
      ...(vehicleChanged ? { eway_part_b_required: true } : {}),
    });
    const moved = await reload(c);
    await recordHandover(moved, 'in', {
      pieces: piecesIn, condition: (p.input.condition ?? null) as Condition | null,
      photo_paths: body.photo_paths, signature_path: body.signature_path, notes: body.notes ?? null,
    }, actor, { transferId: id, exceptionId: transfer.exception_id ?? opened[0] ?? null, fromVehicleId: transfer.from_vehicle_id, toVehicleId: transfer.to_vehicle_id, toDepotId: transfer.to_depot_id });
    if (next !== previous && c.kind === 'shipment') await ShipmentService.afterStatusChange(c.id, next, actor);

    // Loads and stops follow the goods
    const kg = weightOf(c, piecesIn);
    if (c.kind === 'manifest') {
      await releaseVehicleLoad(transfer.from_vehicle_id, Number(c.row.capacity_kg) || 0);
      if (transfer.to_vehicle_id) await reserveVehicleLoad(transfer.to_vehicle_id, Number(c.row.capacity_kg) || kg);
    } else if (transfer.to_vehicle_id) {
      const planned = await planStopsOnVehicle(await openDropPoints(c.id, c.rto), transfer.to_vehicle_id, actor, { start, note: `Transfer ${transfer.code}` });
      newRouteId = newRouteId ?? planned.route_id;
    } else {
      const { data: points } = await supabase.from('delivery_points').select('id').eq('shipment_id', c.id);
      await cancelOpenStops((points ?? []).map((pt: any) => pt.id));
    }

    const eta = toHub ? null : await revisedEta(moved);
    const text = toHub
      ? `Your goods were moved to our ${(await supabase.from('depots').select('name').eq('id', transfer.to_depot_id).maybeSingle()).data?.name ?? ''} hub${because}.`.replace('our  hub', 'our hub')
      : `Your goods were moved to another truck${because}.${eta ? ` New ETA ${eta.eta_text}.` : ''}`;
    await notifyOwner(moved, toHub ? 'Your goods are at a hub' : 'Your goods are on another truck', text, 'cargo_transfer_completed', { transfer_id: id, ...(eta ? { eta_at: eta.eta_at } : {}) });
  }

  await ShipmentService.recalculateVehicleCapacity(transfer.from_vehicle_id);
  if (transfer.to_vehicle_id) await ShipmentService.recalculateVehicleCapacity(transfer.to_vehicle_id);
  // If that was the last of the loads on the first vehicle, the first driver's journey ends at the handover
  for (const masterId of new Set(pairs.filter(p => p.c.kind === 'manifest').map(p => p.c.parentId ?? p.c.id))) {
    await recordJourneyAfterTransferSafe(masterId, transfer.from_vehicle_id);
  }
  if (newRouteId) await supabase.from('cargo_transfers').update({ new_route_id: newRouteId }).eq('id', id);
  await notifyStaffSafe(
    `Transfer ${transfer.code} completed`,
    `${pairs.length} consignment(s) moved${vehicleChanged ? '. Update e-way bill Part B for the new vehicle.' : ' to the hub.'}`,
    'cargo_transfer_completed',
    { transfer_id: id, code: transfer.code, eway_part_b_required: vehicleChanged },
  );
  if (transfer.exception_id) {
    await resolveIfSettled(transfer.exception_id, vehicleChanged ? 'transshipped' : 'moved_to_hub', actor, `Transfer ${transfer.code} completed`);
  }
  const view = await getTransfer(id);
  return { ...view, exceptions_opened: opened };
}

export async function cancelTransfer(id: string, reason: string | null): Promise<any> {
  const transfer = await loadTransfer(id);
  if (transfer.status === 'cancelled') return getTransfer(id);
  if (transfer.status === 'in_progress') throw new HttpError(409, 'The goods are being handed over. Finish with handover-in instead.');
  if (transfer.status !== 'planned') throw new HttpError(409, `This transfer is ${transfer.status}.`);
  const { data: claimed } = await supabase
    .from('cargo_transfers').update({ status: 'cancelled', note: [transfer.note, reason ? `Cancelled: ${reason}` : 'Cancelled'].filter(Boolean).join('. ').slice(0, 500) })
    .eq('id', id).eq('status', 'planned').select('id').maybeSingle();
  if (!claimed) throw new HttpError(409, 'This transfer was just changed by someone else. Refresh and try again.');
  const text = `Transfer ${transfer.code} was cancelled by dispatch.`;
  await notifyVehicleDriver(transfer.from_vehicle_id, 'Cargo transfer cancelled', text, 'cargo_transfer_planned', { transfer_id: id, cancelled: true });
  if (transfer.to_vehicle_id) await notifyVehicleDriver(transfer.to_vehicle_id, 'Cargo transfer cancelled', text, 'cargo_transfer_planned', { transfer_id: id, cancelled: true });
  return getTransfer(id);
}

export async function setEwayPartB(id: string, ref: unknown): Promise<any> {
  if (typeof ref !== 'string' || !ref.trim() || ref.trim().length > 60) throw new HttpError(400, 'eway_part_b_ref must be 1 to 60 characters');
  const transfer = await loadTransfer(id);
  if (transfer.status === 'cancelled') throw new HttpError(409, 'This transfer was cancelled.');
  await supabase.from('cargo_transfers').update({ eway_part_b_ref: ref.trim(), eway_part_b_updated_at: new Date().toISOString() }).eq('id', id);
  // Part B is updated for the goods this transfer moved
  for (const item of await transferItems(id)) {
    const table = item.shipment_id ? 'shipments' : 'cargo_manifest';
    await supabase.from(table).update({ eway_part_b_required: false }).eq('id', item.shipment_id ?? item.manifest_id).eq('eway_part_b_required', true);
  }
  return getTransfer(id);
}

export async function getTransfer(id: string): Promise<any> {
  const transfer = await loadTransfer(id);
  const items = await transferItems(id);
  const vehicleIds = [transfer.from_vehicle_id, transfer.to_vehicle_id].filter(Boolean);
  const { data: vehicles } = await supabase.from('vehicles').select('id, plate_number, driver_name, latitude, longitude, status').in('id', vehicleIds);
  const byId = new Map((vehicles ?? []).map((v: any) => [v.id, v]));
  let depot = null;
  if (transfer.to_depot_id) depot = (await supabase.from('depots').select('id, name, address, latitude, longitude').eq('id', transfer.to_depot_id).maybeSingle()).data ?? null;
  let exception = null;
  if (transfer.exception_id) exception = (await supabase.from('cargo_exceptions').select('id, code, type, status').eq('id', transfer.exception_id).maybeSingle()).data ?? null;
  const itemViews = [];
  for (const i of items) {
    let code: string | null = null;
    let status: string | null = null;
    try {
      const c = await resolveRef(i.shipment_id ? { shipment_id: i.shipment_id } : { manifest_id: i.manifest_id });
      code = c.code;
      status = c.rawStatus;
    } catch {
      // the consignment was removed; the transfer row stays for the record
    }
    itemViews.push({ id: i.id, ref: i.shipment_id ? { shipment_id: i.shipment_id } : { manifest_id: i.manifest_id }, code, status, pieces_planned: i.pieces_planned, pieces_out: i.pieces_out, pieces_in: i.pieces_in, condition_in: i.condition_in });
  }
  return {
    ...transfer,
    from_vehicle: byId.get(transfer.from_vehicle_id) ?? null,
    to_vehicle: transfer.to_vehicle_id ? byId.get(transfer.to_vehicle_id) ?? null : null,
    to_depot: depot,
    exception,
    items: itemViews,
  };
}

export async function listTransfers(filters: { status?: string }, user: TokenData): Promise<any[]> {
  let q = supabase.from('cargo_transfers').select(TRANSFER_COLUMNS).order('planned_at', { ascending: false }).limit(200);
  if (filters.status) {
    if (!(TRANSFER_STATUSES as readonly string[]).includes(filters.status)) throw new HttpError(400, `status must be one of: ${TRANSFER_STATUSES.join(', ')}`);
    q = q.eq('status', filters.status);
  }
  const { data, error } = await q;
  if (error) throw new Error(`Failed to list transfers: ${error.message}`);
  let rows = (data ?? []) as any[];
  if (!isStaff(user)) {
    const mine = await getDriverVehicleIds(user.user_id);
    rows = rows.filter((t: any) => mine.includes(t.from_vehicle_id) || (t.to_vehicle_id && mine.includes(t.to_vehicle_id)));
  }
  const out = [];
  for (const t of rows) out.push(await getTransfer(t.id));
  return out;
}

/** Staff see any transfer; a driver those of their own vehicle. */
export async function assertCanSeeTransfer(user: TokenData, id: string): Promise<void> {
  const t = await loadTransfer(id);
  await assertDriverOf(user, [t.from_vehicle_id, t.to_vehicle_id], 'drivers of the two vehicles');
}

