/**
 * margixindia — Lots: one consignment split across drops, trucks and hubs (docs/cargo-plan.md, Lots)
 *
 * A consignment (a shipment or a vendor load) is split into lots, the way a consignment note is
 * split into child notes: each lot has its own pieces, weight, value, freight share, consignee,
 * drop, truck, POD, invoice and e-way bill, and keeps a link to the master. Once split, the master
 * holds no goods of its own (only the pieces it had already delivered): its status and holder are
 * rolled up from its lots after every change (rollupMaster), and its pieces are the sum.
 *
 * The tree is flat. A lot split again makes lots of the same master (labels A1, A2 …), and the lot
 * that was split keeps only the pieces it had already accounted for.
 *
 * Splits happen at a multi-drop booking, a partial transfer, a hub cross-dock, a remainder after
 * a partial delivery, or by hand. Only goods with one holder in one place can be split, and the
 * pieces, weight, declared value and freight are conserved: the last lot takes the rounding
 * remainder. Each split and merge is a custody event on the master and on every lot, in the
 * custody log and (for shipments) the shipment_logs hash chain.
 */
import crypto from 'crypto';
import { z } from 'zod';
import { supabase } from '../../core/supabase';
import { HttpError } from '../../core/errors';
import { getDriverVehicleIds, isStaff } from '../../core/ownership';
import { OPERATING_VEHICLE_STATUSES } from '../../core/transitions';
import { isPlaceholderPlate } from '../../core/vehicles';
import { finalDeliveryPoint } from '../../core/destination';
import type { TokenData } from '../../core/auth';
import { DropInputSchema, type DropInput, type ShipmentCreate } from '../../schemas';
import { ShipmentService, markAssigned, type LogActor } from '../shipment.service';
import { InvoiceService } from '../invoice.service';
import {
  MANIFEST_CUSTODY_COLUMNS, SHIPMENT_CUSTODY_COLUMNS, RefSchema, manifestStatusFor, piecesHeld, plannedVehicleOf, refColumns, refOf,
  reload, resolveRef, toConsignment, vehicleSummary, wasPickedUp, weightOf, writeConsignment,
  type Actor, type Consignment, type Holder, type Pieces, type RefKind,
} from './consignment';
import { openExceptionsFor, piecesView, recordLotEvent, timelineOf, type PiecesView, type WhereView } from './custody.service';
import { cancelOpenStops, openDropPoints, planStopsOnVehicle } from './replan';
import { carrierStamp, ownersOf } from '../../core/org-context';

export const SPLIT_REASONS = ['multi_drop', 'partial_transfer', 'hub_crossdock', 'partial_delivery_remainder', 'manual'] as const;
export type SplitReason = typeof SPLIT_REASONS[number];

const REASON_TEXT: Record<SplitReason, string> = {
  multi_drop: 'one lot per drop',
  partial_transfer: 'part moved to another vehicle',
  hub_crossdock: 'cross-docked at the hub',
  partial_delivery_remainder: 'the rest goes to another consignee',
  manual: 'split by staff',
};

/** Statuses after which goods are settled: nothing is held any more. */
const FINAL = ['delivered', 'returned', 'lost', 'cancelled'];
const MOVING = ['picked_up', 'in_transit', 'out_for_delivery', 'returning'];
/** Custody kinds after which a lot has left: it can no longer be merged. */
const LEFT_KINDS = [
  'pickup', 'departed', 'delivery', 'partial_delivery', 'refused', 'undelivered', 'handover_out', 'handover_in',
  'hub_in', 'hub_out', 'return_pickup', 'return_delivery', 'lost',
];

const round2 = (n: number) => Math.round(n * 100) / 100;
const tableOf = (kind: RefKind) => (kind === 'shipment' ? 'shipments' : 'cargo_manifest');
const columnsOf = (kind: RefKind) => (kind === 'shipment' ? SHIPMENT_CUSTODY_COLUMNS : MANIFEST_CUSTODY_COLUMNS);
const parentColumn = (kind: RefKind) => (kind === 'shipment' ? 'parent_shipment_id' : 'parent_manifest_id');
const weightColumn = (kind: RefKind) => (kind === 'shipment' ? 'total_weight_kg' : 'capacity_kg');

// ── Request shapes ──────────────────────────────────────────

const DropSchema = z.object({
  name: z.string().trim().max(200).nullable().optional(),
  address: z.string().trim().min(1, 'drop.address is required').max(500),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const GSTIN = z.string().trim().toUpperCase().regex(/^[0-9]{2}[0-9A-Z]{13}$/, 'consignee_gstin must be a 15-character GSTIN');

export const LotInputSchema = z.object({
  pieces: z.number().int().min(1, 'Each lot needs at least one piece').max(100_000),
  weight_kg: z.number().min(0).max(1_000_000).nullable().optional(),
  declared_value: z.number().min(0).max(10_000_000_000).nullable().optional(),
  freight_share: z.number().min(0).max(99_999_999.99).nullable().optional(),
  consignee_name: z.string().trim().min(1).max(200).nullable().optional(),
  consignee_phone: z.string().trim().min(6).max(20).nullable().optional(),
  consignee_gstin: GSTIN.nullable().optional(),
  drop: DropSchema.nullable().optional(),
  to_vehicle_id: z.string().uuid().nullable().optional(),
  to_depot_id: z.string().uuid().nullable().optional(),
  eway_bill_ref: z.string().trim().min(1).max(60).nullable().optional(),
}).refine(l => !(l.to_vehicle_id && l.to_depot_id), { message: 'Send a lot to a vehicle or to a hub, not both' });
export type LotInput = z.infer<typeof LotInputSchema>;

export const SplitSchema = z.object({
  ref: RefSchema,
  reason: z.enum(SPLIT_REASONS).default('manual'),
  lots: z.array(LotInputSchema).min(1).max(26),
  /** Free text for the record, added to the split events. */
  note: z.string().trim().max(300).nullable().optional(),
});

export const MergeSchema = z.object({ refs: z.array(RefSchema).min(2, 'Name at least two lots to merge').max(26) });

export const LotEwaySchema = z.object({ ref: RefSchema, eway_bill_ref: z.string().trim().min(1).max(60) });

export { DropInputSchema, type DropInput };

// ── Labels ──────────────────────────────────────────────────

/** The label of the n-th lot of a master: A, B … Z, AA, AB … */
export function lotLabel(seq: number): string {
  let n = seq;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/**
 * The label of the n-th lot made from lot `parent`: its letter and a number (A → A1, A2). Lots of
 * A1 go on numbering under the same letter (A3, A4), so every label is a letter and a number.
 */
export function childLabel(parent: string, n: number): string {
  const root = /^[A-Z]+/.exec(parent.toUpperCase())?.[0] ?? parent;
  return `${root}${n}`;
}

// ── Conservation ────────────────────────────────────────────

/**
 * Splits `total` across lots. Lots that name their own figure keep it; the rest share what is left
 * by pieces; the last lot takes the rounding remainder. When every lot names its figure they must
 * add up to the total within `tolerance`. Figures are rounded to 2 decimals.
 */
export function allocate(total: number, pieces: number[], given: (number | null | undefined)[], opts: { tolerance: number; label: string }): number[] {
  const n = pieces.length;
  const out = new Array<number>(n).fill(0);
  const named = given.map(g => g != null);
  const namedSum = given.reduce<number>((s, g) => s + (g ?? 0), 0);
  const sumBut = (skip: number) => out.reduce((s, v, i) => (i === skip ? s : s + v), 0);
  if (named.every(Boolean)) {
    if (Math.abs(namedSum - total) > opts.tolerance + 1e-9) {
      throw new HttpError(400, `The lots' ${opts.label} add up to ${round2(namedSum)}, but the goods being split have ${round2(total)}.`);
    }
    for (let i = 0; i < n; i++) out[i] = round2(given[i]!);
    out[n - 1] = Math.max(0, round2(total - sumBut(n - 1)));
    return out;
  }
  const rest = total - namedSum;
  if (rest < -opts.tolerance - 1e-9) {
    throw new HttpError(400, `The lots' ${opts.label} add up to ${round2(namedSum)}, more than the ${round2(total)} being split.`);
  }
  const freePieces = pieces.reduce((s, p, i) => (named[i] ? s : s + p), 0);
  let lastFree = -1;
  for (let i = 0; i < n; i++) {
    if (named[i]) out[i] = round2(given[i]!);
    else {
      out[i] = freePieces > 0 ? round2((Math.max(0, rest) * pieces[i]) / freePieces) : 0;
      lastFree = i;
    }
  }
  out[lastFree] = Math.max(0, round2(total - sumBut(lastFree)));
  return out;
}

// ── Reading lots ────────────────────────────────────────────

async function loadById(kind: RefKind, id: string): Promise<Consignment | null> {
  const { data, error } = await supabase.from(tableOf(kind)).select(columnsOf(kind)).eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to read the consignment: ${error.message}`);
  return data ? toConsignment(kind, data) : null;
}

async function fullRow(c: { kind: RefKind; id: string }): Promise<Record<string, any>> {
  const { data, error } = await supabase.from(tableOf(c.kind)).select('*').eq('id', c.id).maybeSingle();
  if (error) throw new Error(`Failed to read the consignment: ${error.message}`);
  if (!data) throw new HttpError(404, 'Shipment not found');
  return data;
}

/** The lots of a master, in lot order (merged and emptied lots included, as cancelled). */
export async function lotsOf(kind: RefKind, masterId: string): Promise<Consignment[]> {
  const { data, error } = await supabase.from(tableOf(kind)).select(columnsOf(kind)).eq(parentColumn(kind), masterId);
  if (error) throw new Error(`Failed to read the lots: ${error.message}`);
  return ((data ?? []) as any[])
    .sort((a, b) => Number(a.lot_seq) - Number(b.lot_seq) || String(a.lot_label).localeCompare(String(b.lot_label)))
    .map(r => toConsignment(kind, r));
}

/** The master of a lot, the master itself, or null for a consignment that was never split. */
export async function masterOf(c: Consignment): Promise<Consignment | null> {
  if (c.isMaster) return c;
  if (!c.parentId) return null;
  return loadById(c.kind, c.parentId);
}

/** Open transfers (planned or in progress) carrying this consignment. */
async function openTransfersOf(c: { kind: RefKind; id: string }): Promise<{ id: string; code: string; status: string }[]> {
  const column = c.kind === 'shipment' ? 'shipment_id' : 'manifest_id';
  const { data: items } = await supabase.from('cargo_transfer_items').select('transfer_id').eq(column, c.id);
  const ids = [...new Set((items ?? []).map((i: any) => i.transfer_id))];
  if (ids.length === 0) return [];
  const { data } = await supabase.from('cargo_transfers').select('id, code, status').in('id', ids).in('status', ['planned', 'in_progress']);
  return (data ?? []) as any[];
}

// ── Rollup ──────────────────────────────────────────────────

export interface RollupLot {
  status: string;
  holder: Holder;
  pieces: Pieces;
  /** The lot is in an open cargo case. */
  openCase: boolean;
}

type OwnPieces = { delivered: number; short: number; returned: number };

const settled = (l: RollupLot) => ['delivered', 'returned', 'lost'].includes(l.status) || (l.status === 'partially_delivered' && (piecesHeld(l.pieces) ?? 0) === 0);

/**
 * A master's status from its lots (the contract's rollup). Every lot delivered: delivered. All
 * settled with some delivered and some returned, lost or short: partially_delivered. All returned:
 * returned. While lots are still open: on_hold if one is held, exception if one has an open case
 * (or failed a delivery), in_transit if one is moving (returning when all that are open are),
 * at_hub, partially_delivered when some were delivered, then assigned or created. `own` is what
 * the master delivered itself before it was split. Cancelled lots (merged or emptied) are ignored.
 */
export function rollupStatus(lots: RollupLot[], own: OwnPieces): string {
  const live = lots.filter(l => l.status !== 'cancelled');
  const anyDelivered = own.delivered > 0 || live.some(l => l.pieces.delivered > 0 || l.status === 'delivered');
  if (live.length === 0) return own.delivered > 0 ? (own.short + own.returned > 0 ? 'partially_delivered' : 'delivered') : 'cancelled';
  if (live.every(settled)) {
    const clean = own.short + own.returned === 0 && live.every(l => l.status === 'delivered' && l.pieces.short === 0 && l.pieces.returned === 0);
    if (clean) return 'delivered';
    if (anyDelivered) return 'partially_delivered';
    if (live.every(l => l.status === 'lost')) return 'lost';
    return live.some(l => l.status === 'returned') ? 'returned' : 'lost';
  }
  const open = live.filter(l => !settled(l));
  if (open.some(l => l.status === 'on_hold')) return 'on_hold';
  if (live.some(l => l.openCase) || open.some(l => l.status === 'exception')) return 'exception';
  if (open.some(l => MOVING.includes(l.status))) return open.every(l => l.status === 'returning') ? 'returning' : 'in_transit';
  if (open.some(l => l.status === 'at_hub')) return 'at_hub';
  if (anyDelivered) return 'partially_delivered';
  if (open.some(l => l.status === 'assigned')) return 'assigned';
  return 'created';
}

/**
 * A master's holder from its lots: the one holder of the goods still held; when they differ,
 * vehicle if any lot is on a vehicle, else hub. With nothing held: consignee when anything was
 * delivered, else consignor.
 */
export function rollupHolder(lots: RollupLot[], own: OwnPieces): Holder {
  const live = lots.filter(l => l.status !== 'cancelled');
  const open = live.filter(l => !settled(l) && (piecesHeld(l.pieces) ?? 1) > 0);
  if (open.length === 0) {
    const delivered = own.delivered > 0 || live.some(l => l.pieces.delivered > 0);
    return delivered ? 'consignee' : 'consignor';
  }
  const holders = new Set(open.map(l => l.holder));
  if (holders.size === 1) return open[0].holder;
  return holders.has('vehicle') ? 'vehicle' : 'hub';
}

/** Ids of the lots that are in an open case. */
async function lotsInOpenCases(kind: RefKind, lots: Consignment[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (lots.length === 0) return out;
  const column = kind === 'shipment' ? 'shipment_id' : 'manifest_id';
  const { data: items } = await supabase.from('cargo_exception_items').select('exception_id, shipment_id, manifest_id').in(column, lots.map(l => l.id));
  const caseIds = [...new Set((items ?? []).map((i: any) => i.exception_id))];
  if (caseIds.length === 0) return out;
  const { data: open } = await supabase.from('cargo_exceptions').select('id').in('id', caseIds).in('status', ['open', 'investigating', 'action_planned']);
  const openIds = new Set((open ?? []).map((e: any) => e.id));
  for (const i of (items ?? []) as any[]) if (openIds.has(i.exception_id)) out.add(i.shipment_id ?? i.manifest_id);
  return out;
}

/**
 * Whether a consignment is settled: nothing of it is still on a vehicle, at a hub, returning or
 * on hold. A master is settled when all its live lots are; anything else when it is delivered,
 * returned or lost, or partially delivered with no piece left to hold.
 */
export async function consignmentSettled(kind: RefKind, id: string): Promise<boolean> {
  const c = await loadById(kind, id);
  if (!c) return false;
  if (c.isMaster) {
    const lots = (await lotsOf(kind, id)).filter(l => l.status !== 'cancelled');
    return lots.length > 0 && lots.every(l => settled({ status: l.status, holder: l.holder, pieces: l.pieces, openCase: false }));
  }
  return settled({ status: c.status, holder: c.holder, pieces: c.pieces, openCase: false });
}

function rollupInput(lots: Consignment[], inCases: Set<string>): RollupLot[] {
  return lots.map(l => ({ status: l.status, holder: l.holder, pieces: l.pieces, openCase: inCases.has(l.id) }));
}

/** What follows a master's rolled-up status change: its log, its invoice, the customer's booking, the vendor. */
async function afterMasterStatus(master: Consignment, status: string, actor: Actor | null, lotsCount: number): Promise<void> {
  if (master.kind === 'shipment') {
    await ShipmentService.recordShipmentLog(master.id, status, null, null, { rollup: true, lots: lotsCount }, actor ? { id: actor.id, role: actor.role } : null);
    if (status === 'delivered' || status === 'partially_delivered') await InvoiceService.onShipmentDelivered(master.id);
    // A failed delivery of one lot is told to the customer on that lot, not again for the whole
    if (status !== 'exception') {
      try {
        const { onShipmentStatus } = await import('../customer-bookings.service');
        await onShipmentStatus(master.id, status);
      } catch (e) {
        console.error('Failed to update the customer booking:', e);
      }
    }
    return;
  }
  const { vendorService } = await import('../vendor.service');
  const to = manifestStatusFor(status);
  if (to === 'in_transit' && master.rawStatus === 'scheduled') await vendorService.notifyVendorLoadEvent(master.id, 'picked_up');
  if (to === 'delivered') {
    await InvoiceService.onManifestDelivered(master.id);
    if (master.row.vendor_request_id) await supabase.from('vendor_shipment_requests').update({ status: 'completed' }).eq('id', master.row.vendor_request_id);
    await vendorService.notifyVendorLoadEvent(master.id, 'delivered');
  }
}

/**
 * Works a master's status and holder out again from its lots and writes them (compare-and-set on
 * the status read; re-read and retried when someone else wrote first). Called after every lot
 * write. The master's own piece counters are never touched: they record what it delivered itself.
 */
export async function rollupMaster(kind: RefKind, masterId: string, actor: Actor | null): Promise<{ status: string; holder: Holder } | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const master = await loadById(kind, masterId);
    if (!master || !master.isMaster) return null;
    const lots = await lotsOf(kind, masterId);
    const inCases = await lotsInOpenCases(kind, lots);
    const own = master.pieces;
    const status = rollupStatus(rollupInput(lots, inCases), own);
    const holder = rollupHolder(rollupInput(lots, inCases), own);
    const stored = kind === 'shipment' ? status : manifestStatusFor(status);
    if (stored === master.rawStatus && holder === master.holder) return { status, holder };
    const { data, error } = await supabase
      .from(tableOf(kind))
      .update({ status: stored, current_holder: holder, current_vehicle_id: null, current_depot_id: null, ...(kind === 'manifest' ? { updated_at: new Date().toISOString() } : {}) })
      .eq('id', masterId)
      .eq('status', master.rawStatus)
      .select('id')
      .maybeSingle();
    if (error) throw new Error(`Failed to update the master: ${error.message}`);
    if (!data) continue;
    if (stored !== master.rawStatus) await afterMasterStatus(master, status, actor, lots.filter(l => l.rawStatus !== 'cancelled').length);
    return { status, holder };
  }
  console.error(`[cargo] The rollup of ${kind} ${masterId} kept losing to other writes`);
  return null;
}

// ── Views ───────────────────────────────────────────────────

export interface LotView {
  ref: { shipment_id: string } | { manifest_id: string };
  code: string;
  label: string | null;
  seq: number | null;
  status: string;
  current_holder: Holder;
  vehicle: { id: string; plate_number: string | null } | null;
  depot: { id: string; name: string | null } | null;
  pieces: PiecesView;
  weight_kg: number;
  declared_value: number | null;
  freight_share: number | null;
  drop: { name: string | null; address: string | null; lat: number | null; lng: number | null } | null;
  consignee: { name: string | null; phone: string | null; gstin: string | null } | null;
  eway_bill_ref: string | null;
  eway_part_b_required: boolean;
  split_reason: string | null;
  open_exceptions: { id: string; code: string; type: string; severity: string; status: string; sla_due_at: string | null }[];
}

const numOrNull = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

async function dropOf(l: Consignment): Promise<LotView['drop']> {
  if (l.kind === 'manifest') {
    return l.row.drop_location || l.row.drop_lat != null ? { name: l.row.drop_location ?? null, address: l.row.drop_location ?? null, lat: numOrNull(l.row.drop_lat), lng: numOrNull(l.row.drop_lng) } : null;
  }
  const { data } = await supabase.from('delivery_points').select('id, name, address, latitude, longitude, created_at').eq('shipment_id', l.id);
  const last = finalDeliveryPoint((data ?? []) as any[]);
  return last ? { name: last.name ?? null, address: last.address ?? null, lat: numOrNull(last.latitude), lng: numOrNull(last.longitude) } : null;
}

export async function lotView(l: Consignment, opts: { redacted?: boolean } = {}): Promise<LotView> {
  // The vehicle chain, the hub, the open cases and the drop are independent reads
  const vehicleP = (async () => {
    const vehicleId = l.holder === 'vehicle' || l.holder === 'consignor' ? l.vehicleId ?? (await plannedVehicleOf(l)) : null;
    return vehicleId ? await vehicleSummary(vehicleId) : null;
  })();
  const depotP = (async (): Promise<LotView['depot']> => {
    if (l.holder === 'hub' && l.depotId) {
      const { data } = await supabase.from('depots').select('id, name').eq('id', l.depotId).maybeSingle();
      return data ? { id: data.id, name: data.name ?? null } : { id: l.depotId, name: null };
    }
    return null;
  })();
  const [vehicle, depot, open, drop] = await Promise.all([vehicleP, depotP, openExceptionsFor(l), dropOf(l)]);
  const consignee = l.row.consignee_name || l.row.consignee_phone
    ? { name: l.row.consignee_name ?? null, phone: l.row.consignee_phone ?? null, gstin: l.row.consignee_gstin ?? null }
    : null;
  return {
    ref: refOf(l),
    code: l.code,
    label: l.lotLabel,
    seq: l.row.lot_seq != null ? Number(l.row.lot_seq) : null,
    status: l.rawStatus,
    current_holder: l.holder,
    vehicle: vehicle ? { id: vehicle.id, plate_number: vehicle.plate_number ?? null } : null,
    depot,
    pieces: piecesView(l.pieces, l.holder),
    weight_kg: l.weightKg,
    declared_value: numOrNull(l.row.declared_value),
    freight_share: opts.redacted ? null : numOrNull(l.row.freight_share),
    drop,
    consignee,
    eway_bill_ref: l.row.eway_bill_ref ?? null,
    eway_part_b_required: l.row.eway_part_b_required === true,
    split_reason: l.row.split_reason ?? null,
    open_exceptions: open.map((e: any) => ({ id: e.id, code: e.code, type: e.type, severity: e.severity, status: e.status, sla_due_at: e.sla_due_at ?? null })),
  };
}

export interface LotTotals {
  /** The pieces added up, in the shape of `where.pieces`. */
  pieces: PiecesView;
  lots: number;
  pieces_total: number | null;
  delivered: number;
  damaged: number;
  short: number;
  returned: number;
  held: number;
  by_holder: { consignor: number; vehicle: number; hub: number };
  weight_kg: number;
  /** "60 of 100 delivered · 25 at Patna hub · 15 on HR55AB1234" */
  progress_text: string;
}

/** The master's pieces added up: its own record plus every lot's (conservation makes these the whole). */
export function lotTotals(master: Consignment, lots: Consignment[], views: LotView[]): LotTotals {
  const own = master.pieces;
  const sum = (f: (p: Pieces) => number) => lots.reduce((s, l) => s + f(l.pieces), 0);
  const byHolder = { consignor: 0, vehicle: 0, hub: 0 };
  const places = new Map<string, number>();
  lots.forEach((l, i) => {
    const held = piecesHeld(l.pieces) ?? 0;
    if (held <= 0 || FINAL.includes(l.rawStatus)) return;
    if (l.holder === 'consignor' || l.holder === 'vehicle' || l.holder === 'hub') byHolder[l.holder] += held;
    const v = views[i];
    const place = l.holder === 'hub'
      ? `at ${v?.depot?.name ? `${v.depot.name} hub` : 'a hub'}`
      : l.holder === 'vehicle' ? `on ${v?.vehicle?.plate_number ?? 'a vehicle'}` : 'waiting for pickup';
    places.set(place, (places.get(place) ?? 0) + held);
  });
  const delivered = own.delivered + sum(p => p.delivered);
  const short = own.short + sum(p => p.short);
  const returned = own.returned + sum(p => p.returned);
  const parts = [`${delivered} of ${own.total ?? '?'} delivered`, ...[...places.entries()].map(([place, n]) => `${n} ${place}`)];
  if (returned > 0) parts.push(`${returned} returned`);
  if (short > 0) parts.push(`${short} short or lost`);
  const damaged = own.damaged + sum(p => p.damaged);
  return {
    pieces: { total: own.total, delivered, damaged, short, returned, on_board: byHolder.vehicle },
    lots: lots.filter(l => l.rawStatus !== 'cancelled').length,
    pieces_total: own.total,
    delivered,
    damaged,
    short,
    returned,
    held: byHolder.consignor + byHolder.vehicle + byHolder.hub,
    by_holder: byHolder,
    weight_kg: master.weightKg,
    progress_text: parts.join(' · '),
  };
}

/** Lots a caller may see: all for staff, customers and vendors of the master; a driver only those on their vehicle. */
async function visibleLots(lots: Consignment[], user?: TokenData | null): Promise<Consignment[]> {
  if (!user || user.role !== 'driver') return lots;
  const mine = await getDriverVehicleIds(user.user_id);
  const out: Consignment[] = [];
  for (const l of lots) {
    const v = l.vehicleId ?? (await plannedVehicleOf(l));
    if (v && mine.includes(v)) out.push(l);
  }
  return out;
}

/** `GET /cargo/where` for a master: the rollup, the pieces added up, and its lots. */
export async function masterWhere(master: Consignment, opts: { redacted?: boolean; user?: TokenData | null } = {}): Promise<WhereView & { lots: LotView[]; totals: LotTotals }> {
  const all = await lotsOf(master.kind, master.id);
  const [views, inCases] = await Promise.all([
    Promise.all(all.map(l => lotView(l, opts))),
    lotsInOpenCases(master.kind, all),
  ]);
  const status = rollupStatus(rollupInput(all, inCases), master.pieces);
  const holder = rollupHolder(rollupInput(all, inCases), master.pieces);
  const totals = lotTotals(master, all, views);
  const open = all.map((l, i) => ({ l, v: views[i] })).filter(({ l }) => !FINAL.includes(l.rawStatus) && (piecesHeld(l.pieces) ?? 0) > 0);

  const vehicles = new Set(open.filter(o => o.l.holder === 'vehicle').map(o => o.l.vehicleId));
  const depots = new Set(open.filter(o => o.l.holder === 'hub').map(o => o.l.depotId));
  // The carrying vehicle, the hub, the open cases of the master and the lots the caller may see are independent reads
  const vehicleP = (async (): Promise<WhereView['vehicle']> => {
    if (holder === 'vehicle' && vehicles.size === 1 && depots.size === 0) {
      const v = await vehicleSummary([...vehicles][0]);
      if (v) return { id: v.id, plate_number: v.plate_number ?? null, driver_name: opts.redacted ? null : v.driver_name ?? null, lat: v.latitude ?? null, lng: v.longitude ?? null, last_seen_at: v.last_heartbeat ?? null };
    }
    return null;
  })();
  const depotP = (async (): Promise<WhereView['depot']> => {
    if (holder === 'hub' && depots.size === 1 && vehicles.size === 0) {
      const { data } = await supabase.from('depots').select('id, name, address').eq('id', [...depots][0]).maybeSingle();
      return data ? { id: data.id, name: data.name ?? null, address: data.address ?? null } : null;
    }
    return null;
  })();
  const [vehicle, depot, masterCases, shown] = await Promise.all([vehicleP, depotP, openExceptionsFor(master), visibleLots(all, opts.user)]);
  const cases = new Map<string, WhereView['open_exceptions'][number]>();
  for (const e of masterCases) cases.set(e.id, { id: e.id, code: e.code, type: e.type, severity: e.severity, status: e.status, sla_due_at: e.sla_due_at ?? null });
  for (const v of views) for (const e of v.open_exceptions) cases.set(e.id, e);

  const shownIds = new Set(shown.map(l => l.id));
  return {
    ref: refOf(master),
    code: master.code,
    status: master.kind === 'shipment' ? status : manifestStatusFor(status),
    current_holder: holder,
    vehicle,
    depot,
    pieces: {
      total: totals.pieces_total,
      delivered: totals.delivered,
      damaged: totals.damaged,
      short: totals.short,
      returned: totals.returned,
      on_board: totals.by_holder.vehicle,
    },
    seal_number: null,
    open_exceptions: [...cases.values()],
    delivery_attempts: all.reduce((m, l) => Math.max(m, l.attempts), 0),
    max_delivery_attempts: master.maxAttempts,
    delivery_otp_required: master.kind === 'shipment' && all.some(l => l.row.delivery_otp_required === true && !FINAL.includes(l.rawStatus)),
    rto: open.length > 0 && open.every(o => o.l.rto),
    on_hold_reason: opts.redacted ? null : open.find(o => o.l.onHoldReason)?.l.onHoldReason ?? null,
    is_master: true,
    lot: null,
    lot_label: null,
    master: null,
    eway_bill_ref: master.row.eway_bill_ref ?? null,
    eway_part_b_required: all.some(l => l.row.eway_part_b_required === true && !FINAL.includes(l.rawStatus)),
    lots: views.filter((_, i) => shownIds.has(all[i].id)),
    totals,
  };
}

/** A master's timeline: its own events and every lot's, oldest first, each tagged with its lot. */
export async function masterTimeline(master: Consignment, opts: { redacted?: boolean; user?: TokenData | null } = {}): Promise<{ events: any[] }> {
  // The master's own events and every lot's are read together (in lot order, so ties sort as before)
  const [own, lots] = await Promise.all([
    timelineOf(master, { ...opts, own: true }),
    lotsOf(master.kind, master.id).then(all => visibleLots(all, opts.user)),
  ]);
  const events: any[] = own.events.map(e => ({ ...e, lot: null }));
  const lotTimelines = await Promise.all(lots.map(l => timelineOf(l, { ...opts, own: true })));
  lots.forEach((l, i) => {
    for (const e of lotTimelines[i].events) events.push({ ...e, lot: { label: l.lotLabel, code: l.code, ref: refOf(l) } });
  });
  events.sort((a, b) => String(a.recorded_at).localeCompare(String(b.recorded_at)));
  return { events };
}

/** `GET /cargo/lots/:ref`: the master (from itself or any of its lots), its lots and the totals. */
export async function lotsOverview(c: Consignment, opts: { redacted?: boolean; user?: TokenData | null } = {}) {
  const master = await masterOf(c);
  if (!master) throw new HttpError(404, `${c.code} is not split into lots.`);
  const all = master.isMaster ? await lotsOf(master.kind, master.id) : [];
  const [shown, views, where] = await Promise.all([
    visibleLots(all, opts.user),
    Promise.all(all.map(l => lotView(l, opts))),
    master.isMaster ? masterWhere(master, opts) : Promise.resolve(null),
  ]);
  const totals = lotTotals(master, all, views);
  const shownIds = new Set(shown.map(l => l.id));
  return {
    master: {
      ref: refOf(master),
      code: master.code,
      is_master: master.isMaster,
      status: where?.status ?? master.rawStatus,
      current_holder: where?.current_holder ?? master.holder,
      pieces: where?.pieces ?? piecesView(master.pieces, master.holder),
      weight_kg: master.weightKg,
      declared_value: numOrNull(master.row.declared_value),
      freight_share: opts.redacted ? null : numOrNull(master.row.freight_share),
      /** The whole consignment's freight (a load's: none on the row) */
      freight_charge: opts.redacted || master.kind !== 'shipment' ? null : numOrNull(master.row.freight_charge),
    },
    lots: views.filter((_, i) => shownIds.has(all[i].id)),
    totals,
  };
}

/** A plain-words line for a lot, as the customer app shows it: "Lot B (25 pieces): delivered to Sharma Traders, Patna". */
export function describeLot(v: LotView): string {
  const n = v.pieces.total ?? 0;
  const who = v.consignee?.name ?? v.drop?.name ?? 'the consignee';
  const where = v.drop?.address ? `, ${v.drop.address}` : '';
  let state: string;
  switch (v.status) {
    case 'delivered':
    case 'completed':
      state = `delivered to ${who}${where}`;
      break;
    case 'partially_delivered':
      state = `partly delivered to ${who}${where}`;
      break;
    case 'picked_up':
    case 'in_transit':
    case 'out_for_delivery':
      state = `on the way to ${who}${where}${v.vehicle?.plate_number ? ` on ${v.vehicle.plate_number}` : ''}`;
      break;
    case 'at_hub':
      state = `at our ${v.depot?.name ? `${v.depot.name} ` : ''}hub`;
      break;
    case 'on_hold':
      state = v.current_holder === 'hub' ? `at our ${v.depot?.name ? `${v.depot.name} ` : ''}hub` : 'on hold while our team sorts out a problem';
      break;
    case 'exception':
      state = 'delayed; our team is on it';
      break;
    case 'returning':
      state = 'on the way back to the sender';
      break;
    case 'returned':
      state = 'returned to the sender';
      break;
    case 'lost':
      state = 'reported missing; we have opened a case';
      break;
    case 'assigned':
    case 'scheduled':
      state = `waiting for pickup, going to ${who}${where}`;
      break;
    default:
      state = `going to ${who}${where}`;
  }
  return `Lot ${v.label ?? ''} (${n} ${n === 1 ? 'piece' : 'pieces'}): ${state}`.replace('Lot  (', 'Lot (');
}

/** The lots of a booking's shipment for the customer app, each with a plain line and its own POD. */
export async function customerLots(c: Consignment): Promise<(LotView & { text: string; pod: any })[]> {
  const master = await masterOf(c);
  if (!master) return [];
  const { getProofOfDelivery } = await import('../pod.service');
  const out = [];
  for (const l of await lotsOf(master.kind, master.id)) {
    if (l.rawStatus === 'cancelled') continue;
    const v = await lotView(l, { redacted: true });
    const delivered = ['delivered', 'partially_delivered', 'returned', 'completed'].includes(l.rawStatus);
    out.push({ ...v, text: describeLot(v), pod: delivered ? await getProofOfDelivery(l.id) : null });
  }
  return out;
}

// ── Split ───────────────────────────────────────────────────

export interface LotSummary {
  ref: { shipment_id: string } | { manifest_id: string };
  code: string;
  label: string;
  pieces: number;
  weight_kg: number;
  declared_value: number | null;
  freight_share: number | null;
  status: string;
  /** The planned transfer that takes this lot to its vehicle or hub, when one was asked for. */
  transfer: { id: string; code: string } | null;
}

export interface SplitResult {
  master: { ref: { shipment_id: string } | { manifest_id: string }; code: string };
  /** The consignment that was split (the master itself, or the lot split again). */
  source: { ref: { shipment_id: string } | { manifest_id: string }; code: string };
  lots: LotSummary[];
}

/** The status a lot starts with: its source's, except that a remainder after a partial delivery is on its way again. */
function lotStartStatus(c: Consignment): string {
  if (c.status === 'partially_delivered') return c.holder === 'vehicle' ? 'in_transit' : c.status;
  return c.status;
}

/** Where the goods are, in words, for a refusal. */
function placeOf(l: Consignment, plates: Map<string, string>, depots: Map<string, string>): string {
  if (l.holder === 'vehicle') return `on ${plates.get(l.vehicleId ?? '') ?? 'a vehicle'}`;
  if (l.holder === 'hub') return `at ${depots.get(l.depotId ?? '') ?? 'a'} hub`;
  if (l.holder === 'consignee') return 'delivered';
  return 'with the sender';
}

async function refuseMasterSplit(c: Consignment): Promise<never> {
  const lots = (await lotsOf(c.kind, c.id)).filter(l => !FINAL.includes(l.rawStatus) && (piecesHeld(l.pieces) ?? 0) > 0);
  const vehicleIds = [...new Set(lots.map(l => l.vehicleId).filter(Boolean))] as string[];
  const depotIds = [...new Set(lots.map(l => l.depotId).filter(Boolean))] as string[];
  const plates = new Map<string, string>();
  const depots = new Map<string, string>();
  if (vehicleIds.length) for (const v of (await supabase.from('vehicles').select('id, plate_number').in('id', vehicleIds)).data ?? []) plates.set(v.id, v.plate_number);
  if (depotIds.length) for (const d of (await supabase.from('depots').select('id, name').in('id', depotIds)).data ?? []) depots.set(d.id, d.name);
  const places = new Map<string, number>();
  for (const l of lots) places.set(placeOf(l, plates, depots), (places.get(placeOf(l, plates, depots)) ?? 0) + (piecesHeld(l.pieces) ?? 0));
  const where = [...places.entries()].map(([p, n]) => `${n} ${p}`).join(', ');
  throw new HttpError(
    409,
    places.size > 1
      ? `The goods of ${c.code} are with more than one holder (${where}). Only goods with one holder in one place can be split: split one of its lots instead.`
      : `${c.code} is already split into lots${where ? ` (${where})` : ''}. Split one of its lots instead.`,
    { use: 'lots', lots: lots.map(l => ({ ref: refOf(l), code: l.code, label: l.lotLabel, current_holder: l.holder })) },
  );
}

async function vehicleOperating(vehicleId: string): Promise<boolean> {
  const { data } = await supabase.from('vehicles').select('status').eq('id', vehicleId).maybeSingle();
  return !!data && (OPERATING_VEHICLE_STATUSES as readonly string[]).includes(String(data.status));
}

/** The freight a consignment carries: a lot's or master's share, a won bid, the freight charge, or a load's agreed cost. */
async function freightBasis(c: Consignment, row: Record<string, any>): Promise<number | null> {
  if ((c.parentId || c.isMaster) && row.freight_share != null) return Number(row.freight_share);
  if (c.kind === 'shipment') {
    if (row.bid_id) {
      const { data: bid } = await supabase.from('capacity_bids').select('bid_amount, status').eq('id', row.bid_id).maybeSingle();
      if (bid?.status === 'won' && Number(bid.bid_amount) > 0) return Number(bid.bid_amount);
    }
    return row.freight_charge != null && Number.isFinite(Number(row.freight_charge)) ? Number(row.freight_charge) : null;
  }
  if (!row.vendor_request_id) return null;
  const { data: req } = await supabase.from('vendor_shipment_requests').select('cost').eq('id', row.vendor_request_id).maybeSingle();
  return req?.cost != null && Number(req.cost) > 0 ? Number(req.cost) : null;
}

/** What the goods are declared worth: the column, else the HSN lines or the vendor's declared value. */
async function valueBasis(c: Consignment, row: Record<string, any>): Promise<number | null> {
  if (row.declared_value != null) return Number(row.declared_value);
  if (c.parentId) return null;
  const { declaredValueOf } = await import('./claim.service');
  return declaredValueOf(c);
}

/** The settled record a lot keeps when all its held pieces went to new lots. */
function emptiedStatus(p: Pieces): string {
  if (p.delivered + p.short + p.returned === 0) return 'cancelled';
  if (p.delivered > 0) return p.short + p.returned === 0 ? 'delivered' : 'partially_delivered';
  if (p.returned > 0) return 'returned';
  return 'lost';
}

interface DropPoint { id?: string; name: string | null; address: string | null; latitude: number | null; longitude: number | null; demand_kg?: number | null }

/**
 * Splits the pieces a consignment holds into lots (see the contract). The lots' pieces add up to
 * what is held; fewer make a remainder lot that stays where it is. Weight, declared value and
 * freight are shared by pieces unless a lot names its own (then they must add up within ±0.5 kg /
 * ₹1); the last lot takes the rounding remainder. A lot with a drop gets its own delivery point;
 * a lot with to_vehicle_id or to_depot_id gets a planned transfer (goods on a vehicle), a stop on
 * that vehicle (goods at a hub) or that vehicle assigned (goods with the sender).
 */
export async function splitConsignment(
  target: Consignment,
  input: { reason: SplitReason; lots: LotInput[]; note?: string | null },
  actor: Actor | null,
  opts: { via?: 'api' | 'transfer' | 'create'; dispatch?: boolean } = {},
): Promise<SplitResult> {
  const c = await reload(target);
  if (c.isMaster) await refuseMasterSplit(c);
  if (FINAL.includes(c.status) || c.rawStatus === 'completed') throw new HttpError(409, `${c.code} is ${c.status.replace(/_/g, ' ')} and can't be split.`);
  const held = piecesHeld(c.pieces);
  if (held == null || c.pieces.total == null) throw new HttpError(409, `Count the pieces of ${c.code} before splitting it.`);
  if (held < 1 || (held < 2 && c.pieces.delivered + c.pieces.short + c.pieces.returned === 0)) {
    throw new HttpError(409, `${c.code} holds ${held} ${held === 1 ? 'piece' : 'pieces'}, too few to split.`);
  }

  // Only goods with one holder in one place
  if (c.holder === 'consignee') throw new HttpError(409, `${c.code} was delivered and can't be split.`);
  if (c.holder === 'vehicle' && !c.vehicleId) throw new HttpError(409, `The vehicle holding ${c.code} is not on record, so it can't be split.`);
  if (c.holder === 'hub' && !c.depotId) throw new HttpError(409, `The hub holding ${c.code} is not on record, so it can't be split.`);
  const transfers = await openTransfersOf(c);
  const moving = transfers.find(t => t.status === 'in_progress');
  if (moving) throw new HttpError(409, `${c.code} is being handed over on transfer ${moving.code}, so its pieces are in two places. Finish the transfer first.`, { transfer_id: moving.id });
  if (transfers.length > 0 && opts.via !== 'transfer') {
    throw new HttpError(409, `${c.code} is on transfer ${transfers[0].code}. Cancel it, or split once it is done.`, { transfer_id: transfers[0].id });
  }

  // What the reason needs
  switch (input.reason) {
    case 'partial_transfer':
      if (c.holder !== 'vehicle') throw new HttpError(409, 'A partial transfer splits goods on a vehicle.');
      break;
    case 'hub_crossdock':
      if (c.holder !== 'hub') throw new HttpError(409, `${c.code} is not at a hub, so it can't be cross-docked.`);
      break;
    case 'partial_delivery_remainder':
      if (c.pieces.delivered === 0) throw new HttpError(409, `Nothing of ${c.code} was delivered yet, so there is no remainder to split.`);
      if (input.lots.some(l => !l.drop && !l.consignee_name)) {
        throw new HttpError(400, 'A remainder lot goes to another consignee or place: give it a drop or a consignee. The same consignee\'s re-attempt needs no split.');
      }
      break;
    case 'multi_drop':
      if (wasPickedUp(c)) throw new HttpError(409, 'A multi-drop split is made at booking, before pickup.');
      if (input.lots.some(l => !l.drop)) throw new HttpError(400, 'Each drop of a multi-drop split needs its drop point.');
      break;
    default:
      break;
  }

  // The lots, and a remainder that stays where it is
  const lots: (LotInput & { remainder?: boolean })[] = input.lots.map(l => ({ ...l }));
  const asked = lots.reduce((s, l) => s + l.pieces, 0);
  if (asked > held) throw new HttpError(409, `The lots have ${asked} pieces, but ${c.code} holds ${held}.`);
  if (asked < held) lots.push({ pieces: held - asked, remainder: true });
  // One lot is enough when the consignment keeps pieces it already accounted for (a remainder after a partial delivery)
  const accountedBefore = c.pieces.delivered + c.pieces.short + c.pieces.returned;
  if (lots.length < 2 && accountedBefore === 0) throw new HttpError(400, 'A split makes at least two lots. To move all the goods, move the shipment itself.');
  if (lots.length > 26) throw new HttpError(400, 'At most 26 lots at a time');

  // Where each lot goes next must suit where the goods are
  for (const l of lots) {
    if (l.to_depot_id && c.holder !== 'vehicle') throw new HttpError(400, 'Only goods on a vehicle can be sent to a hub (to_depot_id). At a hub, name the vehicle that takes the lot on.');
    if (l.to_vehicle_id) {
      if (l.to_vehicle_id === c.vehicleId && c.holder === 'vehicle') throw new HttpError(400, 'That lot is already on this vehicle.');
      const { data: v } = await supabase.from('vehicles').select('id, plate_number, status').eq('id', l.to_vehicle_id).maybeSingle();
      if (!v) throw new HttpError(404, 'Vehicle not found');
      if (!(OPERATING_VEHICLE_STATUSES as readonly string[]).includes(String(v.status)) || isPlaceholderPlate(v.plate_number)) {
        throw new HttpError(409, `${v.plate_number ?? 'That vehicle'} is ${String(v.status).replace(/_/g, ' ')} and can't take a lot.`);
      }
    }
    if (l.to_depot_id) {
      const { data: d } = await supabase.from('depots').select('id').eq('id', l.to_depot_id).maybeSingle();
      if (!d) throw new HttpError(404, 'Hub not found');
    }
    if (l.drop && c.kind === 'manifest' && c.holder !== 'consignor' && c.holder !== 'hub' && c.holder !== 'vehicle') {
      throw new HttpError(409, 'This load can not take a new drop.');
    }
  }

  // Conservation: the held part of the weight, value and freight is shared by the lots
  const source = await fullRow(c);
  const total = c.pieces.total;
  const pcs = lots.map(l => l.pieces);
  const heldWeight = total > 0 ? round2((c.weightKg * held) / total) : c.weightKg;
  const value = await valueBasis(c, source);
  const freight = await freightBasis(c, source);
  const heldValue = value == null ? null : round2((value * held) / total);
  const heldFreight = freight == null ? null : round2((freight * held) / total);
  const weights = allocate(heldWeight, pcs, lots.map(l => l.weight_kg), { tolerance: 0.5, label: 'weights (kg)' });
  const values = heldValue == null ? lots.map(l => l.declared_value ?? null) : allocate(heldValue, pcs, lots.map(l => l.declared_value), { tolerance: 1, label: 'declared values (₹)' });
  const freights = heldFreight == null ? lots.map(l => l.freight_share ?? null) : allocate(heldFreight, pcs, lots.map(l => l.freight_share), { tolerance: 1, label: 'freight shares (₹)' });

  // The master and the labels: a lot of a lot belongs to the same master (the tree stays flat)
  const master = c.parentId ? await loadById(c.kind, c.parentId) : c;
  if (!master) throw new HttpError(404, 'The master of this lot was not found');
  const masterRow = c.parentId ? await fullRow(master) : source;
  const siblings = c.parentId ? await lotsOf(c.kind, master.id) : [];
  const taken = new Set(siblings.map(s => s.lotLabel));
  let seq = siblings.reduce((m, s) => Math.max(m, Number(s.row.lot_seq) || 0), 0);
  const labels: string[] = [];
  let k = 0;
  for (let i = 0; i < lots.length; i++) {
    let label: string;
    do {
      k++;
      label = c.parentId && c.lotLabel ? childLabel(c.lotLabel, k) : lotLabel(k);
    } while (taken.has(label));
    taken.add(label);
    labels.push(label);
  }
  const masterCode = master.code;

  // The lot rows
  const startStatus = lotStartStatus(c);
  const now = Date.now();
  const ids = lots.map(() => crypto.randomUUID());
  const rows = lots.map((l, i) => {
    const common: Record<string, any> = {
      ...carrierStamp(),
      ...ownersOf(masterRow),
      id: ids[i],
      status: c.kind === 'shipment' ? startStatus : manifestStatusFor(startStatus),
      current_holder: c.holder,
      current_vehicle_id: c.holder === 'vehicle' || c.holder === 'consignor' ? c.vehicleId : null,
      current_depot_id: c.holder === 'hub' ? c.depotId : null,
      pieces_total: l.pieces,
      pieces_delivered: 0,
      pieces_damaged: 0,
      pieces_short: 0,
      pieces_returned: 0,
      seal_number: c.seal,
      delivery_attempts: l.drop ? 0 : c.attempts,
      max_delivery_attempts: c.maxAttempts,
      rto: c.rto,
      on_hold_reason: c.onHoldReason,
      [parentColumn(c.kind)]: master.id,
      lot_seq: seq + i + 1,
      lot_label: labels[i],
      is_master: false,
      declared_value: values[i],
      freight_share: freights[i],
      consignee_name: l.consignee_name ?? (l.remainder || !l.drop ? source.consignee_name ?? null : null),
      consignee_phone: l.consignee_phone ?? (l.remainder || !l.drop ? source.consignee_phone ?? null : null),
      consignee_gstin: l.consignee_gstin ?? (l.remainder || !l.drop ? source.consignee_gstin ?? null : null),
      split_reason: input.reason,
      eway_bill_ref: l.eway_bill_ref ?? null,
      eway_part_b_required: false,
      created_at: new Date(now + i).toISOString(),
      updated_at: new Date(now + i).toISOString(),
    };
    if (c.kind === 'shipment') {
      const metadata = { ...(masterRow.metadata ?? {}) };
      delete metadata.customer_booking_id;
      delete metadata.scoring_engine;
      return {
        ...common,
        tracking_id: `${masterCode}-${labels[i]}`,
        priority: source.priority ?? 'medium',
        origin_name: source.origin_name ?? null,
        origin_address: source.origin_address ?? null,
        origin_lat: source.origin_lat ?? null,
        origin_lng: source.origin_lng ?? null,
        total_items: l.pieces,
        total_weight_kg: weights[i],
        freight_charge: freights[i],
        required_vehicle_type: source.required_vehicle_type ?? null,
        delivery_otp_required: source.delivery_otp_required === true,
        metadata: { ...metadata, lot_of: masterCode },
      };
    }
    return {
      ...common,
      vehicle_id: c.holder === 'vehicle' || c.holder === 'consignor' ? source.vehicle_id ?? c.vehicleId : null,
      vendor_request_id: source.vendor_request_id ?? null,
      capacity_kg: weights[i],
      pickup_location: source.pickup_location ?? null,
      pickup_lat: source.pickup_lat ?? null,
      pickup_lng: source.pickup_lng ?? null,
      drop_location: l.drop ? l.drop.address : source.drop_location ?? null,
      drop_lat: l.drop ? l.drop.lat : source.drop_lat ?? null,
      drop_lng: l.drop ? l.drop.lng : source.drop_lng ?? null,
    };
  });
  const { data: inserted, error: insErr } = await supabase.from(tableOf(c.kind)).insert(rows).select(columnsOf(c.kind));
  if (insErr || !inserted) {
    if (insErr?.code === '23505') throw new HttpError(409, `A lot of ${masterCode} with that label already exists. Refresh and try again.`);
    throw new Error(`Failed to save the lots: ${insErr?.message}`);
  }
  const lotCs = ids.map(id => toConsignment(c.kind, (inserted as any[]).find(r => r.id === id)!));

  // The consignment split becomes the master, or (a lot split again) keeps only what it accounted for
  const sum = (xs: (number | null)[]) => xs.reduce<number>((s, x) => s + (x ?? 0), 0);
  const retainedFreight = freight == null ? null : Math.max(0, round2(freight - sum(freights)));
  const retainedValue = value == null ? null : Math.max(0, round2(value - sum(values)));
  let patch: Record<string, unknown>;
  let emptied: string | null = null;
  if (!c.parentId) {
    patch = {
      is_master: true,
      freight_share: retainedFreight,
      current_vehicle_id: null,
      current_depot_id: null,
      ...(source.declared_value == null && value != null ? { declared_value: value } : {}),
      ...(c.kind === 'manifest' ? { vehicle_id: null, updated_at: new Date().toISOString() } : {}),
    };
  } else {
    const accounted = c.pieces.delivered + c.pieces.short + c.pieces.returned;
    emptied = emptiedStatus(c.pieces);
    const keepsHolder = emptied === 'lost';
    patch = {
      status: c.kind === 'shipment' ? emptied : manifestStatusFor(emptied),
      pieces_total: accounted,
      [weightColumn(c.kind)]: Math.max(0, round2(c.weightKg - sum(weights))),
      declared_value: retainedValue,
      freight_share: retainedFreight,
      current_holder: keepsHolder ? c.holder : c.pieces.delivered > 0 ? 'consignee' : 'consignor',
      current_vehicle_id: keepsHolder ? c.vehicleId : null,
      current_depot_id: keepsHolder ? c.depotId : null,
      ...(c.kind === 'shipment' ? { total_items: accounted, freight_charge: retainedFreight } : { updated_at: new Date().toISOString() }),
    };
  }
  const { data: moved, error: mvErr } = await supabase.from(tableOf(c.kind)).update(patch).eq('id', c.id).eq('status', c.rawStatus).select('id').maybeSingle();
  if (mvErr || !moved) {
    await supabase.from(tableOf(c.kind)).delete().in('id', ids);
    if (mvErr) throw new Error(`Failed to update the consignment split: ${mvErr.message}`);
    throw new HttpError(409, 'This shipment was just changed by someone else. Refresh and try again.');
  }

  // Drops and stops (shipments): each lot gets its own delivery points; the source's open stops go
  const vehicleForStops = c.holder === 'vehicle' || c.holder === 'consignor' ? c.vehicleId : null;
  const canPlan = vehicleForStops ? await vehicleOperating(vehicleForStops) : false;
  const pointsByLot = new Map<string, DropPoint[]>();
  if (c.kind === 'shipment') {
    const sourcePoints = (await openDropPoints(c.id, c.rto)) as DropPoint[];
    const pointRows: Record<string, unknown>[] = [];
    lots.forEach((l, i) => {
      const lot = lotCs[i];
      const base: DropPoint[] = l.drop
        ? [{ name: l.drop.name ?? l.consignee_name ?? 'Drop', address: l.drop.address, latitude: l.drop.lat, longitude: l.drop.lng }]
        : sourcePoints.filter(p => !(p.name ?? '').startsWith('Return to ') || c.rto);
      const made = base.map((p, j) => ({
        id: crypto.randomUUID(),
        name: p.name,
        address: p.address,
        latitude: p.latitude,
        longitude: p.longitude,
        demand_kg: round2(weights[i] / Math.max(1, base.length)),
        pieces: j === base.length - 1 ? l.pieces : null,
        consignee_name: lot.row.consignee_name ?? null,
        consignee_phone: lot.row.consignee_phone ?? null,
        shipment_id: lot.id,
        lot_shipment_id: lot.id,
        status: 'pending',
        created_at: new Date(now + i * 50 + j).toISOString(),
      }));
      pointsByLot.set(lot.id, made as DropPoint[]);
      pointRows.push(...made);
    });
    if (pointRows.length > 0) {
      const { error } = await supabase.from('delivery_points').insert(pointRows);
      if (error) throw new Error(`Failed to save the lots' drops: ${error.message}`);
    }
    // The lots take the source's place on its vehicle's route before the source's stops go
    if (vehicleForStops && canPlan) {
      for (const lot of lotCs) {
        const pts = pointsByLot.get(lot.id) ?? [];
        if (pts.length > 0) await planStopsOnVehicle(pts as any, vehicleForStops, actor, { note: `Lot ${lot.lotLabel} of ${masterCode}` });
      }
    }
    const vehicles = await cancelOpenStops(sourcePoints.map(p => p.id!).filter(Boolean));
    for (const v of new Set([...vehicles, ...(vehicleForStops ? [vehicleForStops] : [])])) await ShipmentService.recalculateVehicleCapacity(v);
  }

  // Open cases on the source now cover its lots too
  const refColumn = c.kind === 'shipment' ? 'shipment_id' : 'manifest_id';
  const { data: items } = await supabase.from('cargo_exception_items').select('exception_id, pieces_affected, condition').eq(refColumn, c.id);
  if (items && items.length > 0) {
    const { data: openCases } = await supabase.from('cargo_exceptions').select('id').in('id', [...new Set(items.map((i: any) => i.exception_id))]).in('status', ['open', 'investigating', 'action_planned']);
    const openIds = new Set((openCases ?? []).map((e: any) => e.id));
    const copies = [];
    for (const item of items as any[]) {
      if (!openIds.has(item.exception_id)) continue;
      for (const lot of lotCs) {
        const affected = item.pieces_affected == null ? null : Math.min(Number(item.pieces_affected), lot.pieces.total ?? 0);
        copies.push({
          exception_id: item.exception_id, ...refColumns(lot), pieces_affected: affected,
          weight_affected_kg: weightOf(lot, affected ?? lot.pieces.total), condition: item.condition ?? null,
          note: `Lot ${lot.lotLabel}, split from ${c.code}`,
        });
      }
    }
    if (copies.length > 0) {
      const { error } = await supabase.from('cargo_exception_items').insert(copies);
      if (error) throw new Error(`Failed to add the lots to their cases: ${error.message}`);
    }
  }

  // Custody: a split event on the master (and the lot split again), and on every new lot
  const list = lotCs.map((l, i) => `${l.lotLabel} (${lots[i].pieces})`).join(', ');
  const why = `${REASON_TEXT[input.reason]}${input.note ? `; ${input.note}` : ''}`;
  const sourceLabel = c.parentId ? `Lot ${c.lotLabel}` : null;
  const place = { holder: c.holder, vehicleId: c.vehicleId, depotId: c.depotId };
  const at = (x: Consignment): Consignment => ({ ...x, ...place });
  const splitLog = { split_reason: input.reason, lots: lotCs.map(l => ({ id: l.id, code: l.code, pieces: l.pieces.total })), source_id: c.id };
  await recordLotEvent(at(master), 'split', { pieces: held, weight_kg: heldWeight, notes: `${sourceLabel ? `${sourceLabel} split` : 'Split'} into lots ${list} (${why})` }, actor, splitLog);
  if (c.parentId) await recordLotEvent(at(c), 'split', { pieces: held, weight_kg: heldWeight, notes: `Split into lots ${list} (${why})` }, actor, splitLog);
  for (let i = 0; i < lotCs.length; i++) {
    await recordLotEvent(lotCs[i], 'split', {
      pieces: lots[i].pieces, weight_kg: weights[i],
      notes: `Lot ${lotCs[i].lotLabel}: ${lots[i].pieces} of the ${held} pieces of ${c.code}${lots[i].remainder ? ', the rest that stays' : ''} (${why})`,
    }, actor, { split_reason: input.reason, master_id: master.id, source_id: c.id });
  }

  // A lot emptied into its children that had delivered pieces is settled now: bill its own part
  if (emptied && emptied !== c.status) {
    if (c.kind === 'shipment') {
      await ShipmentService.recordShipmentLog(c.id, emptied, null, null, { split_into: lotCs.map(l => l.code) }, actor);
      if (emptied === 'delivered' || emptied === 'partially_delivered') await InvoiceService.onShipmentDelivered(c.id);
    } else if (emptied === 'delivered') {
      await InvoiceService.onManifestDelivered(c.id);
    }
  }

  // Where each lot goes next
  const transferOf = new Map<string, { id: string; code: string }>();
  const toDispatch = new Set<string>();
  for (let i = 0; i < lots.length; i++) {
    const l = lots[i];
    const lot = lotCs[i];
    if (!l.to_vehicle_id && !l.to_depot_id) continue;
    if (c.holder === 'vehicle') {
      const { planTransfer } = await import('./transfer.service');
      const t = await planTransfer({
        from_vehicle_id: c.vehicleId!,
        ...(l.to_vehicle_id ? { to_vehicle_id: l.to_vehicle_id } : { to_depot_id: l.to_depot_id! }),
        items: [{ ref: refOf(lot), pieces: l.pieces }],
        note: `Lot ${lot.lotLabel} of ${masterCode}`,
      }, actor ?? { id: 'system', role: 'system' });
      transferOf.set(lot.id, { id: t.id, code: t.code });
    } else if (c.holder === 'hub') {
      // The goods leave the hub with hub_out on this vehicle; its route gets the lot's drop now
      if (c.kind === 'shipment') {
        const pts = pointsByLot.get(lot.id) ?? [];
        if (pts.length > 0) await planStopsOnVehicle(pts as any, l.to_vehicle_id!, actor, { note: `Lot ${lot.lotLabel} of ${masterCode} from the hub` });
      }
    } else if (c.kind === 'shipment') {
      // Goods still with the sender: the lot is assigned to that vehicle (its drop on the vehicle's route)
      await ShipmentService.assertVehicleCanTake(l.to_vehicle_id!, lot.weightKg, source.required_vehicle_type ?? null, lot.id);
      const planned = await planStopsOnVehicle((pointsByLot.get(lot.id) ?? []) as any, l.to_vehicle_id!, actor, { note: `Lot ${lot.lotLabel} of ${masterCode}` });
      if (planned.route_id) {
        const fresh = await reload(lot);
        await markAssigned({ id: lot.id, status: fresh.rawStatus, origin_lat: source.origin_lat ?? null, origin_lng: source.origin_lng ?? null }, { id: l.to_vehicle_id! }, { id: planned.route_id }, actor ? { id: actor.id, role: actor.role } : null);
        if (planned.created) toDispatch.add(planned.route_id);
      }
    } else {
      await writeConsignment(await reload(lot), { vehicle_id: l.to_vehicle_id, current_vehicle_id: l.to_vehicle_id });
    }
  }

  // A route made for lots assigned at the sender starts, as for any assigned shipment, except a
  // shipment created with a vehicle: that trip waits unless the caller asked to send it
  for (const routeId of opts.via === 'create' && opts.dispatch !== true ? [] : toDispatch) {
    try {
      const { routeService } = await import('../route.service');
      await routeService.changeStatus(routeId, 'active');
    } catch (e) {
      console.error(`[cargo] Route ${routeId} for the lots of ${masterCode} could not be started:`, e);
    }
  }
  for (const v of new Set(lots.map(l => l.to_vehicle_id).filter(Boolean) as string[])) await ShipmentService.recalculateVehicleCapacity(v);

  await rollupMaster(c.kind, master.id, actor);
  const fresh = await Promise.all(lotCs.map(l => reload(l)));
  return {
    master: { ref: refOf(master), code: masterCode },
    source: { ref: refOf(c), code: c.code },
    lots: fresh.map((l, i) => ({
      ref: refOf(l),
      code: l.code,
      label: l.lotLabel ?? labels[i],
      pieces: lots[i].pieces,
      weight_kg: weights[i],
      declared_value: values[i],
      freight_share: freights[i],
      status: l.rawStatus,
      transfer: transferOf.get(l.id) ?? null,
    })),
  };
}

// ── Merge ───────────────────────────────────────────────────

const normName = (s: unknown) => (typeof s === 'string' ? s.trim().toLowerCase().replace(/\s+/g, ' ') : '');
const normPhone = (s: unknown) => (typeof s === 'string' ? s.replace(/\D/g, '').slice(-10) : '');

async function dropKey(l: Consignment): Promise<string> {
  if (l.kind === 'manifest') return [normName(l.row.drop_location), numOrNull(l.row.drop_lat)?.toFixed(4), numOrNull(l.row.drop_lng)?.toFixed(4)].join('|');
  const points = await openDropPoints(l.id, l.rto);
  return points.map(p => [normName(p.address), numOrNull(p.latitude)?.toFixed(4), numOrNull(p.longitude)?.toFixed(4)].join('|')).sort().join(';');
}

/**
 * Merges lots back into one (the lowest-numbered): only lots of the same master with the same
 * holder, place, consignee and drop, none of which has left since the split. The counts, weight,
 * value and freight add back up; the others are closed (cancelled, with nothing left on them).
 */
export async function mergeLots(refs: unknown[], actor: Actor): Promise<{ ref: { shipment_id: string } | { manifest_id: string }; code: string; label: string | null; pieces: number | null }> {
  const cs: Consignment[] = [];
  for (const r of refs) {
    const c = await resolveRef(r);
    if (!cs.some(x => x.id === c.id)) cs.push(c);
  }
  if (cs.length < 2) throw new HttpError(400, 'Name at least two different lots to merge');
  if (cs.some(c => c.isMaster)) throw new HttpError(409, 'A master holds no goods of its own. Merge its lots.');
  const kind = cs[0].kind;
  const masterId = cs[0].parentId;
  if (!masterId || cs.some(c => c.kind !== kind || c.parentId !== masterId)) throw new HttpError(409, 'Only lots of the same shipment can be merged.');
  const first = cs[0];
  if (cs.some(c => c.holder !== first.holder || (c.vehicleId ?? null) !== (first.vehicleId ?? null) || (c.depotId ?? null) !== (first.depotId ?? null))) {
    throw new HttpError(409, 'These lots are not with the same holder in the same place, so they can\'t be merged.');
  }
  if (cs.some(c => c.status !== first.status)) throw new HttpError(409, 'These lots are at different stages, so they can\'t be merged.');
  if (cs.some(c => normName(c.row.consignee_name) !== normName(first.row.consignee_name) || normPhone(c.row.consignee_phone) !== normPhone(first.row.consignee_phone))) {
    throw new HttpError(409, 'These lots go to different consignees, so they can\'t be merged.');
  }
  const drops = await Promise.all(cs.map(dropKey));
  if (drops.some(d => d !== drops[0])) throw new HttpError(409, 'These lots go to different drops, so they can\'t be merged.');
  const column = kind === 'shipment' ? 'shipment_id' : 'manifest_id';
  for (const c of cs) {
    if (FINAL.includes(c.status) || c.pieces.delivered + c.pieces.short + c.pieces.returned > 0) {
      throw new HttpError(409, `${c.code} has already been delivered in part or in full, so it can't be merged.`);
    }
    const { data: events } = await supabase.from('cargo_custody_events').select('kind').eq(column, c.id);
    if ((events ?? []).some((e: any) => LEFT_KINDS.includes(e.kind))) {
      throw new HttpError(409, `${c.code} has moved since it was split, so it can't be merged.`);
    }
    const t = await openTransfersOf(c);
    if (t.length > 0) throw new HttpError(409, `${c.code} is on transfer ${t[0].code}. Cancel it before merging.`, { transfer_id: t[0].id });
  }

  const sorted = [...cs].sort((a, b) => Number(a.row.lot_seq) - Number(b.row.lot_seq));
  const [survivor, ...others] = sorted;
  const add = (f: (c: Consignment) => unknown) => round2(sorted.reduce((s, c) => s + (Number(f(c)) || 0), 0));
  const hasValue = sorted.some(c => c.row.declared_value != null);
  const hasFreight = sorted.some(c => c.row.freight_share != null);
  const pieces = sorted.reduce((s, c) => s + (c.pieces.total ?? 0), 0);
  const weight = add(c => c.weightKg);
  const freight = hasFreight ? add(c => c.row.freight_share) : null;

  // The others close first (nothing left on them), then the survivor takes their counts
  for (const o of others) {
    const { data, error } = await supabase.from(tableOf(kind)).update({
      status: kind === 'shipment' ? 'cancelled' : 'cancelled',
      pieces_total: 0,
      [weightColumn(kind)]: 0,
      declared_value: o.row.declared_value == null ? null : 0,
      freight_share: o.row.freight_share == null ? null : 0,
      current_holder: 'consignor',
      current_vehicle_id: null,
      current_depot_id: null,
      ...(kind === 'shipment' ? { total_items: 0, freight_charge: o.row.freight_share == null ? o.row.freight_charge ?? null : 0 } : { vehicle_id: null, updated_at: new Date().toISOString() }),
    }).eq('id', o.id).eq('status', o.rawStatus).select('id').maybeSingle();
    if (error) throw new Error(`Failed to merge ${o.code}: ${error.message}`);
    if (!data) throw new HttpError(409, `${o.code} was just changed by someone else. Refresh and try again.`);
  }
  const { data: kept, error: keptErr } = await supabase.from(tableOf(kind)).update({
    pieces_total: pieces,
    [weightColumn(kind)]: weight,
    ...(hasValue ? { declared_value: add(c => c.row.declared_value) } : {}),
    ...(hasFreight ? { freight_share: freight } : {}),
    ...(kind === 'shipment' ? { total_items: pieces, ...(hasFreight ? { freight_charge: freight } : {}) } : { updated_at: new Date().toISOString() }),
  }).eq('id', survivor.id).eq('status', survivor.rawStatus).select('id').maybeSingle();
  if (keptErr) throw new Error(`Failed to merge into ${survivor.code}: ${keptErr.message}`);
  if (!kept) throw new HttpError(409, `${survivor.code} was just changed by someone else. Refresh and try again.`);

  if (kind === 'shipment') {
    const keptPoints = await openDropPoints(survivor.id, survivor.rto);
    const last = keptPoints[keptPoints.length - 1];
    if (last) await supabase.from('delivery_points').update({ pieces, demand_kg: weight }).eq('id', last.id);
    const closedPoints: string[] = [];
    for (const o of others) closedPoints.push(...(await openDropPoints(o.id, o.rto)).map(p => p.id));
    const vehicles = await cancelOpenStops(closedPoints);
    for (const v of new Set([...vehicles, ...(survivor.vehicleId ? [survivor.vehicleId] : [])])) await ShipmentService.recalculateVehicleCapacity(v);
  }

  // Open cases on the merged lots cover the survivor
  const { data: items } = others.length ? await supabase.from('cargo_exception_items').select('exception_id, condition').in(column, others.map(o => o.id)) : { data: [] as any[] };
  const { data: already } = await supabase.from('cargo_exception_items').select('exception_id').eq(column, survivor.id);
  const have = new Set((already ?? []).map((i: any) => i.exception_id));
  const caseIds = [...new Set((items ?? []).map((i: any) => i.exception_id))].filter(id => !have.has(id));
  if (caseIds.length) {
    const { data: openCases } = await supabase.from('cargo_exceptions').select('id').in('id', caseIds).in('status', ['open', 'investigating', 'action_planned']);
    const fresh = await reload(survivor);
    const rows = (openCases ?? []).map((e: any) => ({ exception_id: e.id, ...refColumns(fresh), pieces_affected: null, weight_affected_kg: fresh.weightKg, condition: null, note: `Lots merged into ${fresh.code}` }));
    if (rows.length) await supabase.from('cargo_exception_items').insert(rows);
  }

  const master = await loadById(kind, masterId);
  const list = sorted.map(c => c.lotLabel).join(', ');
  const note = `Lots ${list} merged into lot ${survivor.lotLabel} (${pieces} pieces)`;
  const merged = await reload(survivor);
  if (master) await recordLotEvent({ ...master, holder: first.holder, vehicleId: first.vehicleId, depotId: first.depotId }, 'merge', { pieces, weight_kg: weight, notes: note }, actor, { merged: sorted.map(c => c.code), into: survivor.code });
  await recordLotEvent(merged, 'merge', { pieces, weight_kg: weight, notes: note }, actor, { merged: others.map(c => c.code) });
  for (const o of others) await recordLotEvent({ ...o, holder: first.holder, vehicleId: first.vehicleId, depotId: first.depotId }, 'merge', { pieces: o.pieces.total, weight_kg: o.weightKg, notes: `Merged into lot ${survivor.lotLabel}` }, actor, { into: survivor.code });
  await rollupMaster(kind, masterId, actor);
  return { ref: refOf(merged), code: merged.code, label: merged.lotLabel, pieces: merged.pieces.total };
}

// ── E-way bill per lot ──────────────────────────────────────

/** Sets a lot's own e-way bill reference (a master has none: each lot carries its own). */
export async function setLotEway(c: Consignment, ewayBillRef: string): Promise<LotView> {
  if (c.isMaster) throw new HttpError(409, `${c.code} was split into lots; each lot carries its own e-way bill.`, { use: 'lots' });
  await writeConsignment(c, { eway_bill_ref: ewayBillRef });
  return lotView(await reload(c));
}

// ── Multi-drop booking ──────────────────────────────────────

/**
 * A shipment with more than one drop: the master is created with the whole consignment (pieces,
 * weight, value, freight, parcels), then split with one lot per drop, each with its own delivery
 * point and consignee. With a vehicle named, every lot is assigned to it (the vehicle must take
 * the whole weight). Returns the master's id.
 */
export async function createMultiDrop(input: ShipmentCreate, actor: LogActor | null): Promise<string> {
  const drops = (input.drops ?? []) as DropInput[];
  if (drops.length < 2) throw new HttpError(400, 'A multi-drop shipment has at least two drops');
  if (input.open_bidding) throw new HttpError(400, 'A multi-drop shipment can\'t be opened for bidding. Book one shipment per drop instead.');
  const pieces = drops.reduce((s, d) => s + d.pieces, 0);
  const namedWeights = drops.filter(d => d.weight_kg != null).length;
  if (namedWeights > 0 && namedWeights < drops.length) throw new HttpError(400, 'Give the weight of every drop, or of none (they are then shared by pieces)');
  const namedValues = drops.filter(d => d.declared_value != null).length;
  if (namedValues > 0 && namedValues < drops.length) throw new HttpError(400, 'Give the declared value of every drop, or of none');
  const parcelsKg = (input.parcels ?? []).reduce((s, p) => s + (Number(p.weight_kg) || 0), 0);
  const dropsKg = drops.reduce((s, d) => s + (d.weight_kg ?? 0), 0);
  const weight = Number(input.total_weight_kg) || parcelsKg || (namedWeights ? dropsKg : 0);
  const dropsValue = namedValues ? drops.reduce((s, d) => s + (d.declared_value ?? 0), 0) : null;
  const declared = input.declared_value ?? dropsValue;
  if (input.vehicle_id) await ShipmentService.assertVehicleCanTake(input.vehicle_id, weight);

  const id = crypto.randomUUID();
  const trackingId = input.tracking_id || `RTX-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`;
  const { error } = await supabase.from('shipments').insert({
    ...carrierStamp(),
    id,
    tracking_id: trackingId,
    priority: input.priority,
    status: 'created',
    origin_name: input.origin_name ?? null,
    origin_address: input.origin_address ?? null,
    origin_lat: input.origin_lat ?? null,
    origin_lng: input.origin_lng ?? null,
    total_items: pieces,
    total_weight_kg: weight,
    freight_charge: input.freight_charge ?? null,
    metadata: { ...(input.metadata ?? {}), drops: drops.length },
    pieces_total: pieces,
    current_holder: 'consignor',
    declared_value: declared ?? null,
    ...(input.eway_bill_ref ? { eway_bill_ref: input.eway_bill_ref } : {}),
  });
  if (error?.code === '23505') throw new HttpError(409, `Tracking ID ${trackingId} is already in use`);
  if (error) throw new Error(`Failed to create shipment: ${error.message}`);
  if (input.parcels && input.parcels.length > 0) {
    await supabase.from('parcels').insert(input.parcels.map(p => ({
      id: crypto.randomUUID(), shipment_id: id, weight_kg: p.weight_kg, length_cm: p.length_cm, width_cm: p.width_cm, height_cm: p.height_cm,
      category: p.category, is_hazardous: p.is_hazardous, is_fragile: p.is_fragile,
    })));
  }
  await ShipmentService.recordShipmentLog(id, 'created', null, null, { drops: drops.length }, actor);

  const master = await resolveRef({ shipment_id: id });
  const splitActor: Actor | null = actor ? { id: actor.id, role: actor.role } : null;
  const result = await splitConsignment(master, {
    reason: 'multi_drop',
    lots: drops.map(d => ({
      pieces: d.pieces,
      weight_kg: d.weight_kg ?? null,
      declared_value: d.declared_value ?? null,
      consignee_name: d.consignee_name,
      consignee_phone: d.consignee_phone ?? null,
      consignee_gstin: d.consignee_gstin ?? null,
      drop: { name: d.name ?? d.consignee_name, address: d.address, lat: d.lat, lng: d.lng },
      to_vehicle_id: input.vehicle_id ?? null,
      eway_bill_ref: d.eway_bill_ref ?? null,
    })),
  }, splitActor, { via: 'create', dispatch: input.dispatch === true });

  // Lots waiting for a vehicle go through the matching engine like any new shipment
  if (!input.vehicle_id) {
    import('../matching.service').then(({ matchingService }) => {
      for (const lot of result.lots) {
        const lotId = (lot.ref as { shipment_id: string }).shipment_id;
        matchingService.cascadeEscalation(lotId).catch(err => console.error('Matching Engine failed to run on a new lot:', err));
      }
    });
  }
  return id;
}

/** Lots summary for the shipments list: a master shows how its lots stand. */
export async function lotsSummaries(kind: RefKind, masterIds: string[]): Promise<Map<string, { count: number; delivered_lots: number; pieces_delivered: number; lots: any[] }>> {
  const out = new Map<string, { count: number; delivered_lots: number; pieces_delivered: number; lots: any[] }>();
  if (masterIds.length === 0) return out;
  const { data, error } = await supabase.from(tableOf(kind)).select(columnsOf(kind)).in(parentColumn(kind), masterIds);
  if (error) throw new Error(`Failed to read the lots: ${error.message}`);
  const rows = ((data ?? []) as any[]).sort((a, b) => Number(a.lot_seq) - Number(b.lot_seq));
  for (const r of rows) {
    const l = toConsignment(kind, r);
    const key = l.parentId!;
    const entry = out.get(key) ?? { count: 0, delivered_lots: 0, pieces_delivered: 0, lots: [] };
    if (l.rawStatus !== 'cancelled') {
      entry.count++;
      if (['delivered', 'completed'].includes(l.rawStatus)) entry.delivered_lots++;
      entry.lots.push({ id: l.id, code: l.code, label: l.lotLabel, status: l.rawStatus, current_holder: l.holder, current_vehicle_id: l.vehicleId, pieces_total: l.pieces.total, pieces_delivered: l.pieces.delivered, consignee_name: l.row.consignee_name ?? null });
    }
    entry.pieces_delivered += l.pieces.delivered;
    out.set(key, entry);
  }
  return out;
}

/** The lots of a shipment for its detail page (staff), each with its drops. */
export async function shipmentLotsDetail(masterId: string): Promise<any[]> {
  const lots = await lotsOf('shipment', masterId);
  const out = [];
  for (const l of lots) {
    const { data: points } = await supabase.from('delivery_points').select('id, name, address, latitude, longitude, pieces, consignee_name, consignee_phone, created_at').eq('shipment_id', l.id);
    out.push({
      id: l.id, tracking_id: l.code, lot_label: l.lotLabel, lot_seq: l.row.lot_seq ?? null, status: l.rawStatus,
      current_holder: l.holder, current_vehicle_id: l.vehicleId, current_depot_id: l.depotId,
      pieces_total: l.pieces.total, pieces_delivered: l.pieces.delivered, total_weight_kg: l.weightKg,
      declared_value: numOrNull(l.row.declared_value), freight_share: numOrNull(l.row.freight_share),
      consignee_name: l.row.consignee_name ?? null, consignee_phone: l.row.consignee_phone ?? null, consignee_gstin: l.row.consignee_gstin ?? null,
      eway_bill_ref: l.row.eway_bill_ref ?? null, eway_part_b_required: l.row.eway_part_b_required === true, split_reason: l.row.split_reason ?? null,
      delivery_points: points ?? [],
    });
  }
  return out;
}

/** Whether the caller may split, merge or set e-way refs: staff only. */
export function assertLotStaff(user: TokenData): void {
  if (!isStaff(user)) throw new HttpError(403, 'Only staff split and merge lots');
}
