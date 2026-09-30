/**
 * margixindia — Consignments (docs/cargo-plan.md)
 *
 * A consignment is a shipment (tracking RTX-…) or a vendor load (cargo_manifest, code CM-…).
 * This module is what the rest of the cargo services share about them: finding one from a ref,
 * reading its holder, vehicle, depot and pieces, the piece arithmetic, the status mapping for
 * vendor loads, who may act on it, and the compare-and-set write that moves it.
 */
import { z } from 'zod';
import { supabase } from '../../core/supabase';
import { HttpError } from '../../core/errors';
import { manifestParcelCode } from '../../core/parcelCode';
import { recordTripPaySafe } from '../driver-pay.service';
import { getDriverVehicleIds, isStaff, canAccessManifest, canAccessShipment } from '../../core/ownership';
import type { TokenData } from '../../core/auth';
import {
  CARGO_MANIFEST_TRANSITIONS, ON_VEHICLE_STATUSES, assertShipmentTransition, assertTransition,
} from '../../core/transitions';

export const CONDITIONS = ['good', 'damaged_packaging', 'damaged_goods', 'wet', 'seal_tampered', 'shortage', 'excess'] as const;
export type Condition = typeof CONDITIONS[number];

export const HOLDERS = ['consignor', 'vehicle', 'hub', 'consignee'] as const;
export type Holder = typeof HOLDERS[number];

export type RefKind = 'shipment' | 'manifest';

/** A consignment in a request body: `{ shipment_id }`, `{ manifest_id }`, or a uuid, RTX- tracking id or CM- code. */
export const RefSchema = z.union([
  z.string().trim().min(1).max(64),
  z.object({ shipment_id: z.string().uuid() }).strict(),
  z.object({ manifest_id: z.string().uuid() }).strict(),
], { errorMap: () => ({ message: 'ref must be { shipment_id }, { manifest_id }, a tracking id or a load code' }) });

/** How a consignment is named in a request body: one of the two ids. */
export interface RefInput {
  shipment_id?: string | null;
  manifest_id?: string | null;
}

export interface Pieces {
  /** Null while nobody has counted the pieces (no booking count and no pickup yet). */
  total: number | null;
  delivered: number;
  damaged: number;
  short: number;
  returned: number;
}

/** Who is acting. `role` is the token role; null for the scheduler. */
export interface Actor {
  id: string;
  role: string;
}

export interface Consignment {
  kind: RefKind;
  id: string;
  /** Tracking id (RTX-…) or load code (CM-…). */
  code: string;
  /** The status in the shipment vocabulary (a vendor load's scheduled reads as assigned or created). */
  status: string;
  /** The status as stored. */
  rawStatus: string;
  holder: Holder;
  vehicleId: string | null;
  depotId: string | null;
  pieces: Pieces;
  weightKg: number;
  seal: string | null;
  attempts: number;
  maxAttempts: number;
  rto: boolean;
  onHoldReason: string | null;
  /** The master this consignment is a lot of (docs/cargo-plan.md, Lots), or null. */
  parentId: string | null;
  /** A master that was split: it holds no goods of its own, its lots do. */
  isMaster: boolean;
  /** The lot's label (A, B, A1 …), or null for a consignment that is not a lot. */
  lotLabel: string | null;
  row: Record<string, any>;
}

export const SHIPMENT_CUSTODY_COLUMNS =
  'id, tracking_id, status, total_items, total_weight_kg, origin_name, origin_address, origin_lat, origin_lng, received_by, photo_url, signature_url, freight_charge, metadata, ' +
  'current_holder, current_vehicle_id, current_depot_id, pieces_total, pieces_delivered, pieces_damaged, pieces_short, pieces_returned, seal_number, ' +
  'delivery_attempts, max_delivery_attempts, delivery_otp_required, delivery_otp_hash, delivery_otp_expires_at, rto, on_hold_reason, created_at, updated_at, ' +
  'parent_shipment_id, lot_seq, lot_label, is_master, declared_value, freight_share, consignee_name, consignee_phone, consignee_gstin, split_reason, eway_bill_ref, eway_part_b_required';

export const MANIFEST_CUSTODY_COLUMNS =
  'id, vehicle_id, vendor_request_id, status, capacity_kg, pickup_location, pickup_lat, pickup_lng, drop_location, drop_lat, drop_lng, received_by, photo_url, signature_url, ' +
  'current_holder, current_vehicle_id, current_depot_id, pieces_total, pieces_delivered, pieces_damaged, pieces_short, pieces_returned, seal_number, ' +
  'delivery_attempts, max_delivery_attempts, rto, on_hold_reason, created_at, updated_at, ' +
  'parent_manifest_id, lot_seq, lot_label, is_master, declared_value, freight_share, consignee_name, consignee_phone, consignee_gstin, split_reason, eway_bill_ref, eway_part_b_required';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Piece arithmetic ────────────────────────────────────────

/** Pieces still held (on the vehicle or at the hub): the total less what was delivered, found short or returned. */
export function piecesHeld(p: Pieces): number | null {
  return p.total == null ? null : p.total - p.delivered - p.short - p.returned;
}

/**
 * Throws a 409 unless the counters hold: none negative, delivered + short + returned no more than
 * the total, and damaged pieces counted within the delivered or returned ones.
 */
export function assertPieces(p: Pieces): void {
  for (const [name, n] of Object.entries({ delivered: p.delivered, damaged: p.damaged, short: p.short, returned: p.returned })) {
    if (!Number.isInteger(n) || n < 0) throw new HttpError(409, `The ${name} piece count can't be negative.`);
  }
  if (p.total != null) {
    if (!Number.isInteger(p.total) || p.total < 0) throw new HttpError(409, 'The piece total can\'t be negative.');
    const accounted = p.delivered + p.short + p.returned;
    if (accounted > p.total) {
      throw new HttpError(409, `That accounts for ${accounted} pieces, but this consignment has ${p.total}.`);
    }
  }
  if (p.damaged > p.delivered + p.returned) {
    throw new HttpError(409, 'Damaged pieces are counted within the delivered or returned ones.');
  }
}

/** The counters after adding `delta`, checked with assertPieces. */
export function addPieces(p: Pieces, delta: Partial<Omit<Pieces, 'total'>> & { total?: number | null }): Pieces {
  const next: Pieces = {
    total: delta.total !== undefined ? delta.total : p.total,
    delivered: p.delivered + (delta.delivered ?? 0),
    damaged: p.damaged + (delta.damaged ?? 0),
    short: p.short + (delta.short ?? 0),
    returned: p.returned + (delta.returned ?? 0),
  };
  assertPieces(next);
  return next;
}

/** The counters as columns. */
export function piecesPatch(p: Pieces): Record<string, number | null> {
  return {
    pieces_total: p.total,
    pieces_delivered: p.delivered,
    pieces_damaged: p.damaged,
    pieces_short: p.short,
    pieces_returned: p.returned,
  };
}

/** A whole number of pieces from a request, or a 400. */
export function parsePieces(value: unknown, label: string, opts: { min?: number } = {}): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  const min = opts.min ?? 0;
  if (!Number.isInteger(n) || n < min || n > 100_000) throw new HttpError(400, `${label} must be a whole number from ${min} to 100,000`);
  return n;
}

// ── Status for vendor loads ─────────────────────────────────

/** The stored status of a vendor load for a status in the shipment vocabulary. */
export function manifestStatusFor(status: string): string {
  switch (status) {
    case 'created':
    case 'assigned':
      return 'scheduled';
    case 'picked_up':
    case 'in_transit':
    case 'out_for_delivery':
      return 'in_transit';
    case 'at_hub':
      return 'on_hold';
    case 'partially_delivered':
      return 'exception';
    case 'lost':
      return 'cancelled';
    default:
      return status;
  }
}

/** A vendor load's status in the shipment vocabulary. */
function canonicalManifestStatus(row: Record<string, any>): string {
  const status = String(row.status);
  if (status === 'scheduled') return row.vehicle_id ? 'assigned' : 'created';
  if (status === 'completed') return 'delivered';
  if (status === 'on_hold' && row.current_holder === 'hub') return 'at_hub';
  return status;
}

/** Holder for rows written before the holder column existed. */
function derivedHolder(status: string): Holder {
  if (status === 'delivered' || status === 'completed') return 'consignee';
  if ((ON_VEHICLE_STATUSES as readonly string[]).includes(status) && status !== 'on_hold') return 'vehicle';
  return 'consignor';
}

const num = (v: unknown, fallback = 0) => (v == null || !Number.isFinite(Number(v)) ? fallback : Number(v));

/** The master a row is a lot of, or null. */
export function parentIdOf(kind: RefKind, row: Record<string, any>): string | null {
  return (kind === 'shipment' ? row.parent_shipment_id : row.parent_manifest_id) ?? null;
}

/**
 * The code of a consignment: its tracking id (a shipment lot's is the master's with the label,
 * RTX-ABC123-B), or CM-XXXXXXXX for a load (a load lot's is the master's code with the label).
 */
export function codeOf(kind: RefKind, row: Record<string, any>): string {
  if (kind === 'shipment') return String(row.tracking_id ?? row.id);
  const parent = parentIdOf(kind, row);
  return parent && row.lot_label ? `${manifestParcelCode(parent)}-${row.lot_label}` : manifestParcelCode(row.id);
}

export function toConsignment(kind: RefKind, row: Record<string, any>): Consignment {
  const rawStatus = String(row.status);
  const status = kind === 'shipment' ? rawStatus : canonicalManifestStatus(row);
  const bookedPieces = kind === 'shipment' && Number(row.total_items) > 0 ? Number(row.total_items) : null;
  return {
    kind,
    id: row.id,
    code: codeOf(kind, row),
    status,
    rawStatus,
    holder: (row.current_holder as Holder) ?? derivedHolder(rawStatus),
    vehicleId: row.current_vehicle_id ?? (kind === 'manifest' ? row.vehicle_id ?? null : null),
    depotId: row.current_depot_id ?? null,
    pieces: {
      total: row.pieces_total != null ? Number(row.pieces_total) : bookedPieces,
      delivered: num(row.pieces_delivered),
      damaged: num(row.pieces_damaged),
      short: num(row.pieces_short),
      returned: num(row.pieces_returned),
    },
    weightKg: num(kind === 'shipment' ? row.total_weight_kg : row.capacity_kg),
    seal: row.seal_number ?? null,
    attempts: num(row.delivery_attempts),
    maxAttempts: num(row.max_delivery_attempts, 3) || 3,
    rto: row.rto === true,
    onHoldReason: row.on_hold_reason ?? null,
    parentId: parentIdOf(kind, row),
    isMaster: row.is_master === true,
    lotLabel: row.lot_label ?? null,
    row,
  };
}

/**
 * A master holds no goods of its own once split, so nothing is picked up, moved or delivered on
 * it: the lots carry the goods. Throws a 409 naming the lots to act on instead.
 */
export async function assertNotMaster(c: Consignment, action: string): Promise<void> {
  if (!c.isMaster) return;
  const table = c.kind === 'shipment' ? 'shipments' : 'cargo_manifest';
  const column = c.kind === 'shipment' ? 'parent_shipment_id' : 'parent_manifest_id';
  const { data } = await supabase.from(table).select(c.kind === 'shipment' ? SHIPMENT_CUSTODY_COLUMNS : MANIFEST_CUSTODY_COLUMNS).eq(column, c.id);
  const lots = ((data ?? []) as any[])
    .filter(r => r.status !== 'cancelled')
    .sort((a, b) => Number(a.lot_seq) - Number(b.lot_seq))
    .map(r => toConsignment(c.kind, r));
  throw new HttpError(
    409,
    `${c.code} was split into lots (${lots.map(l => l.code).join(', ') || 'none open'}), so it holds no goods of its own. ${action} on a lot instead.`,
    { use: 'lots', master: refOf(c), lots: lots.map(l => ({ ref: refOf(l), code: l.code, label: l.lotLabel })) },
  );
}

/** Whether the goods have ever left the consignor. */
export function wasPickedUp(c: Consignment): boolean {
  if (c.holder !== 'consignor') return true;
  return !['created', 'assigned', 'on_hold', 'exception', 'cancelled'].includes(c.status);
}

/** Weight of `pieces` of this consignment, pro rata to its total (the whole weight when the count is unknown). */
export function weightOf(c: Consignment, pieces: number | null): number {
  if (!c.weightKg) return 0;
  if (pieces == null || !c.pieces.total) return c.weightKg;
  return Math.round((c.weightKg * pieces * 100) / c.pieces.total) / 100;
}

// ── Finding a consignment ───────────────────────────────────

async function loadShipment(filter: { column: 'id' | 'tracking_id'; value: string }): Promise<Consignment | null> {
  const { data, error } = await supabase.from('shipments').select(SHIPMENT_CUSTODY_COLUMNS).eq(filter.column, filter.value).maybeSingle();
  if (error) throw new Error(`Failed to read the shipment: ${error.message}`);
  return data ? toConsignment('shipment', data) : null;
}

async function loadManifest(id: string): Promise<Consignment | null> {
  const { data, error } = await supabase.from('cargo_manifest').select(MANIFEST_CUSTODY_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to read the load: ${error.message}`);
  return data ? toConsignment('manifest', data) : null;
}

/** A vendor load from its CM- code (the first 8 hex characters of its id), or a load lot's (CM-XXXXXXXX-B; a lot of a lot is its letter and a number, CM-XXXXXXXX-A3). */
async function loadManifestByCode(code: string): Promise<Consignment | null> {
  const m = /^CM-([0-9A-F]{8})(?:-([A-Z]{1,2}[0-9]{0,6}))?$/i.exec(code);
  if (!m) return null;
  const prefix = m[1].toLowerCase();
  const label = m[2]?.toUpperCase() ?? null;
  const { data, error } = await supabase
    .from('cargo_manifest')
    .select(MANIFEST_CUSTODY_COLUMNS)
    .gte('id', `${prefix}-0000-0000-0000-000000000000`)
    .lte('id', `${prefix}-ffff-ffff-ffff-ffffffffffff`)
    .limit(1);
  if (error) throw new Error(`Failed to read the load: ${error.message}`);
  const rows = ((data ?? []) as any[]).filter(r => String(r.id).toLowerCase().startsWith(prefix));
  if (!label) {
    // The load whose own code this is (a lot's own id can share the prefix; the master or plain load wins)
    const row = rows.find(r => !r.parent_manifest_id) ?? rows[0];
    return row ? toConsignment('manifest', row) : null;
  }
  for (const master of rows) {
    const { data: lot, error: lotErr } = await supabase
      .from('cargo_manifest').select(MANIFEST_CUSTODY_COLUMNS).eq('parent_manifest_id', master.id).eq('lot_label', label).maybeSingle();
    if (lotErr) throw new Error(`Failed to read the load lot: ${lotErr.message}`);
    if (lot) return toConsignment('manifest', lot);
  }
  return null;
}

/**
 * Finds a consignment from `{ shipment_id }`, `{ manifest_id }`, or a string that is a shipment
 * uuid, a manifest uuid, a tracking id (RTX-…) or a load code (CM-…). 404 when there is none.
 */
export async function resolveRef(ref: unknown): Promise<Consignment> {
  let found: Consignment | null = null;
  if (ref && typeof ref === 'object') {
    const r = ref as RefInput;
    if (typeof r.shipment_id === 'string' && r.shipment_id) found = await loadShipment({ column: 'id', value: r.shipment_id });
    else if (typeof r.manifest_id === 'string' && r.manifest_id) found = await loadManifest(r.manifest_id);
    else throw new HttpError(400, 'ref must name a shipment_id or a manifest_id');
  } else if (typeof ref === 'string' && ref.trim()) {
    const text = ref.trim();
    if (UUID.test(text)) found = (await loadShipment({ column: 'id', value: text })) ?? (await loadManifest(text));
    else if (/^CM-/i.test(text)) found = await loadManifestByCode(text.toUpperCase());
    else found = await loadShipment({ column: 'tracking_id', value: text.toUpperCase() });
  } else {
    throw new HttpError(400, 'ref is required');
  }
  if (!found) throw new HttpError(404, 'Consignment not found');
  return found;
}

/** Re-reads a consignment (after a write). */
export async function reload(c: Consignment): Promise<Consignment> {
  const again = c.kind === 'shipment' ? await loadShipment({ column: 'id', value: c.id }) : await loadManifest(c.id);
  if (!again) throw new HttpError(404, 'Consignment not found');
  return again;
}

/** The ref object for a consignment, as responses carry it. */
export function refOf(c: { kind: RefKind; id: string }): { shipment_id: string } | { manifest_id: string } {
  return c.kind === 'shipment' ? { shipment_id: c.id } : { manifest_id: c.id };
}

/** Column pair for rows that point at a consignment (events, items, claims). */
export function refColumns(c: { kind: RefKind; id: string }): { shipment_id: string | null; manifest_id: string | null } {
  return c.kind === 'shipment' ? { shipment_id: c.id, manifest_id: null } : { shipment_id: null, manifest_id: c.id };
}

// ── The vehicle a consignment is on or planned for ──────────

/**
 * The vehicle whose route carries a shipment: its current vehicle, else the vehicle of the route
 * holding its open stop (pending or failed, on a pending or active route), else null.
 */
export async function plannedVehicleOf(c: Consignment): Promise<string | null> {
  if (c.vehicleId) return c.vehicleId;
  if (c.kind === 'manifest') return c.row.vehicle_id ?? null;
  const { data: points } = await supabase.from('delivery_points').select('id').eq('shipment_id', c.id);
  const pointIds = (points ?? []).map((p: any) => p.id);
  if (pointIds.length === 0) return null;
  const { data: stops } = await supabase.from('route_stops').select('route_id, status').in('delivery_point_id', pointIds);
  const routeIds = [...new Set((stops ?? []).filter((s: any) => s.status === 'pending' || s.status === 'failed').map((s: any) => s.route_id))];
  if (routeIds.length === 0) return null;
  const { data: routes } = await supabase.from('routes').select('id, vehicle_id, status').in('id', routeIds);
  const open = (routes ?? []).find((r: any) => (r.status === 'active' || r.status === 'pending') && r.vehicle_id);
  return open?.vehicle_id ?? null;
}

/** The vehicle a driver drives (one per driver), or a 403. */
export async function driverVehicleId(driverId: string): Promise<string> {
  const ids = await getDriverVehicleIds(driverId);
  if (ids.length === 0) throw new HttpError(403, 'You have no vehicle assigned');
  return ids[0];
}

// ── Who may act or look ─────────────────────────────────────

/**
 * Drivers act only on consignments on their current vehicle: the one holding the goods, or,
 * before pickup, the one planned to carry them. Staff act on any. Everyone else is refused.
 */
export async function assertCanAct(user: TokenData, c: Consignment): Promise<void> {
  if (isStaff(user)) return;
  if (user.role !== 'driver') throw new HttpError(403, 'Only drivers and staff record custody');
  const mine = await getDriverVehicleIds(user.user_id);
  const vehicle = await plannedVehicleOf(c);
  if (!vehicle || !mine.includes(vehicle)) throw new HttpError(403, 'This consignment is not on your vehicle');
}

/** Whether the customer booked this shipment, or the master it is a lot of. */
export async function customerOwnsShipment(customerId: string, shipmentId: string): Promise<boolean> {
  const { data } = await supabase.from('customer_bookings').select('id, customer_id').eq('shipment_id', shipmentId).eq('customer_id', customerId).limit(1);
  if (data && data.length > 0) return true;
  const { data: lot } = await supabase.from('shipments').select('parent_shipment_id').eq('id', shipmentId).maybeSingle();
  if (!lot?.parent_shipment_id) return false;
  const { data: master } = await supabase.from('customer_bookings').select('id, customer_id').eq('shipment_id', lot.parent_shipment_id).eq('customer_id', customerId).limit(1);
  return !!master && master.length > 0;
}

/** The vendor who asked for a load, or null. */
export async function manifestVendorId(manifestId: string): Promise<string | null> {
  const { data: manifest } = await supabase.from('cargo_manifest').select('vendor_request_id').eq('id', manifestId).maybeSingle();
  if (!manifest?.vendor_request_id) return null;
  const { data: request } = await supabase.from('vendor_shipment_requests').select('vendor_id').eq('id', manifest.vendor_request_id).maybeSingle();
  return request?.vendor_id ?? null;
}

/**
 * Who may read a consignment's whereabouts and timeline. Staff see everything; a customer their
 * own booking, a vendor their own load (or a shipment they won), a driver what is on or planned
 * for their vehicle. Returns whether they get the redacted view.
 */
export async function assertCanView(user: TokenData, c: Consignment): Promise<{ redacted: boolean }> {
  if (isStaff(user)) return { redacted: false };
  if (user.role === 'customer') {
    if (c.kind === 'shipment' && (await customerOwnsShipment(user.user_id, c.id))) return { redacted: true };
    throw new HttpError(404, 'Consignment not found');
  }
  if (user.role === 'vendor') {
    const ok = c.kind === 'manifest' ? await canAccessManifest(user, c.id) : await canAccessShipment(user, c.id);
    if (ok) return { redacted: true };
    throw new HttpError(404, 'Consignment not found');
  }
  if (user.role === 'driver') {
    const mine = await getDriverVehicleIds(user.user_id);
    const vehicle = await plannedVehicleOf(c);
    if (vehicle && mine.includes(vehicle)) return { redacted: true };
    throw new HttpError(403, 'This consignment is not on your vehicle');
  }
  throw new HttpError(403, 'Not authorized');
}

// ── Writing ─────────────────────────────────────────────────

/**
 * Moves a consignment and writes its custody columns in one compare-and-set on the status it
 * was read with, so two people acting at once cannot both apply. `patch.status` is in the
 * shipment vocabulary; a vendor load stores its own. Checks the transition first. Returns the
 * status as stored.
 */
export async function writeConsignment(c: Consignment, patch: Record<string, unknown> & { status?: string }): Promise<string> {
  const { status: next, ...columns } = patch;
  let stored = c.rawStatus;
  if (next && next !== c.status) {
    if (c.kind === 'shipment') {
      assertShipmentTransition(c.status, next, { pickedUp: wasPickedUp(c) });
      stored = next;
    } else {
      stored = manifestStatusFor(next);
      if (stored !== c.rawStatus) {
        assertTransition(CARGO_MANIFEST_TRANSITIONS, 'load', c.rawStatus, stored);
        if (stored === 'cancelled' && wasPickedUp(c) && next !== 'lost') {
          throw new HttpError(409, 'These goods are already on a vehicle, so the load can\'t be cancelled. Move them with a transfer or return them first.');
        }
      }
    }
  }
  const table = c.kind === 'shipment' ? 'shipments' : 'cargo_manifest';
  const body: Record<string, unknown> = { ...columns, ...(stored !== c.rawStatus ? { status: stored } : {}) };
  if (c.kind === 'manifest') body.updated_at = new Date().toISOString();
  if (Object.keys(body).length === 0) return stored;
  const { data, error } = await supabase.from(table).update(body).eq('id', c.id).eq('status', c.rawStatus).select('id').maybeSingle();
  if (error) throw new Error(`Failed to update the consignment: ${error.message}`);
  if (!data) throw new HttpError(409, 'This consignment was just changed by someone else. Refresh and try again.');
  // A vendor load delivered is a finished trip: the driver earns it (once; never blocks the delivery)
  if (c.kind === 'manifest' && stored !== c.rawStatus && (stored === 'delivered' || stored === 'completed')) {
    await recordTripPaySafe({ manifest_id: c.id });
  }
  // A lot moved: its master's status and holder are worked out again from its lots
  if (c.parentId) {
    const { rollupMaster } = await import('./lots.service');
    await rollupMaster(c.kind, c.parentId, null);
  }
  return stored;
}

/** Plate, driver and position of a vehicle, for responses and messages. */
export async function vehicleSummary(vehicleId: string | null | undefined) {
  if (!vehicleId) return null;
  const { data } = await supabase
    .from('vehicles')
    .select('id, plate_number, driver_id, driver_name, latitude, longitude, last_heartbeat, status, capacity_kg, available_capacity_kg, current_load_kg, cargo_types, vehicle_type')
    .eq('id', vehicleId)
    .maybeSingle();
  return data ?? null;
}
