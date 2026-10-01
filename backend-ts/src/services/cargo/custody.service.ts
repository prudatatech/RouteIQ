/**
 * margixindia — Cargo custody (docs/cargo-plan.md)
 *
 * The one place a consignment changes hands or condition. Every path goes through
 * recordCustody: the custody endpoint, the pickup scan, complete-stop, verify-pod, the vendor
 * load pickup and drop, starting a route, transfers and the exception actions. Each call checks
 * the holder, pieces and status rules, writes the consignment with a compare-and-set on its
 * status, appends a cargo_custody_events row, extends the shipment_logs hash chain (shipments),
 * opens an exception when something is wrong, and tells the people concerned.
 */
import crypto from 'crypto';
import { supabase } from '../../core/supabase';
import { HttpError } from '../../core/errors';
import { settings } from '../../core/config';
import { isStaff } from '../../core/ownership';
import { canTransition, OPERATING_VEHICLE_STATUSES, SHIPMENT_TRANSITIONS } from '../../core/transitions';
import { ShipmentService } from '../shipment.service';
import { InvoiceService } from '../invoice.service';
import { releaseVehicleLoad, setOperatingVehicleStatus, vehicleHasOpenWork } from '../route.service';
import { signedUrl, createKycUploadUrl } from '../pod.service';
import { manifestParcelCode } from '../../core/parcelCode';
import {
  CONDITIONS, addPieces, assertCanAct, assertNotMaster, manifestStatusFor, driverVehicleId, parsePieces, piecesHeld, piecesPatch, plannedVehicleOf,
  refColumns, refOf, reload, resolveRef, vehicleSummary, wasPickedUp, weightOf, writeConsignment,
  type Actor, type Condition, type Consignment, type Holder, type Pieces,
} from './consignment';
import { notifyOwner, notifyStaffSafe, istTime } from './notify';
import { sendDeliveryOtp, verifyDeliveryOtp } from './otp.service';
import { cancelOpenStops, createReturnLeg, estimateMinutes, openDropPoints, planStopsOnVehicle } from './replan';
import type { TokenData } from '../../core/auth';

export const CUSTODY_KINDS = [
  'booked', 'accepted', 'arrived_pickup', 'pickup', 'departed', 'arrived_drop', 'delivery', 'partial_delivery',
  'refused', 'undelivered', 'handover_out', 'handover_in', 'hub_in', 'hub_out', 'return_pickup', 'return_delivery',
  'inspection', 'hold', 'release_hold', 'lost', 'split', 'merge',
] as const;
export type CustodyKind = typeof CUSTODY_KINDS[number];

/** Why a delivery did not happen: the complete-stop reasons, plus goods refused because they were damaged. */
export const DELIVERY_FAILURE_REASONS = ['customer_unavailable', 'address_unreachable', 'customer_refused', 'premises_closed', 'other', 'damaged_refused'] as const;

/** Kinds only staff record through the custody endpoint. */
const STAFF_ONLY_KINDS: readonly string[] = ['hold', 'release_hold', 'lost', 'booked'];
/** Kinds recorded only through a transfer. */
const TRANSFER_ONLY_KINDS: readonly string[] = ['handover_out', 'handover_in'];
/** Kinds recorded only by splitting or merging lots (POST /cargo/lots/split, /cargo/lots/merge). */
const LOT_ONLY_KINDS: readonly string[] = ['split', 'merge'];

export interface CustodyInput {
  kind: CustodyKind;
  pieces?: number | null;
  weight_kg?: number | null;
  condition?: Condition | null;
  seal_number?: string | null;
  photo_paths?: string[];
  signature_path?: string | null;
  receiver_name?: string | null;
  otp?: string | null;
  lat?: number | null;
  lng?: number | null;
  notes?: string | null;
  pieces_refused?: number | null;
  pieces_short?: number | null;
  pieces_damaged?: number | null;
  reason?: string | null;
  /** hub_in: the hub reached; hub_out: the hub left. */
  depot_id?: string | null;
  /** Staff naming the vehicle for a pickup, hub departure or return pickup. */
  vehicle_id?: string | null;
  /** hub_out: where the goods go next (in_transit by default). */
  next_status?: 'in_transit' | 'out_for_delivery' | null;
}

/** What a delivery of goods nobody picked up is refused with. */
export const NEVER_PICKED_UP = 'Record the pickup (pieces and condition) before the delivery. These goods were never picked up.';

export type CustodyVia =
  | 'api' | 'complete_stop' | 'parcel_scan' | 'verify_pod' | 'start_route' | 'accept_route' | 'exception' | 'transfer' | 'tpl' | 'system';

export interface CustodyOptions {
  via?: CustodyVia;
  /**
   * Staff override: goods never picked up may be delivered. A pickup flagged `backfilled` is recorded
   * first, with the staff member's reason, and a problem note (type other) tells dispatch.
   * Without it a delivery (or a delivery attempt) of goods never picked up is refused with 409.
   */
  backfillPickup?: { reason: string };
  /** complete-stop without an outcome: the driver app's older evidence rules (no photo needed). */
  legacyEvidence?: boolean;
  exceptionId?: string | null;
  transferId?: string | null;
  /** Handovers: the vehicle or depot on each side. */
  from?: { holder: Holder; vehicle_id?: string | null; depot_id?: string | null };
  to?: { holder: Holder; vehicle_id?: string | null; depot_id?: string | null };
  /** The route stop being completed (complete-stop settles it itself). */
  stopId?: string | null;
  /** Extra metadata for the shipment_logs entry. */
  logMetadata?: Record<string, unknown>;
}

export interface CustodyResult {
  event: Record<string, any> | null;
  ref: { shipment_id: string } | { manifest_id: string };
  status: string;
  current_holder: Holder;
  pieces: PiecesView;
  exception_ids: string[];
  /** The step had already been recorded; nothing changed. */
  already?: boolean;
}

export interface PiecesView {
  total: number | null;
  delivered: number;
  damaged: number;
  short: number;
  returned: number;
  on_board: number | null;
}

export function piecesView(p: Pieces, holder: Holder): PiecesView {
  const held = piecesHeld(p);
  return { total: p.total, delivered: p.delivered, damaged: p.damaged, short: p.short, returned: p.returned, on_board: holder === 'vehicle' ? held : 0 };
}

// ── Evidence ────────────────────────────────────────────────

/** Storage folder for custody photos and signatures of one consignment or transfer. */
export const cargoFolder = (id: string) => `cargo/${id}/`;

const UPLOAD_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png' };

/** A signed upload URL for a custody photo or signature, in the consignment's (or transfer's) own folder. */
export async function createCustodyUploadUrl(ownerId: string, input: { kind: unknown; content_type: unknown; size: unknown }) {
  if (input.kind !== 'photo' && input.kind !== 'signature') throw new HttpError(400, 'kind must be photo or signature');
  const extension = typeof input.content_type === 'string' ? UPLOAD_TYPES[input.content_type.toLowerCase()] : undefined;
  if (!extension) throw new HttpError(415, 'Upload a JPG or PNG image');
  const bytes = Number(input.size);
  if (!Number.isInteger(bytes) || bytes <= 0) throw new HttpError(400, 'File size is required');
  if (bytes > settings.POD_UPLOAD_MAX_BYTES) throw new HttpError(413, `Image must be at most ${Math.floor(settings.POD_UPLOAD_MAX_BYTES / 1024 / 1024)} MB`);
  return createKycUploadUrl(`${cargoFolder(ownerId)}${input.kind}_${crypto.randomUUID()}.${extension}`);
}

/** A stored file path is accepted only directly inside one of the allowed folders. */
export function isPathIn(path: unknown, folders: string[]): path is string {
  if (typeof path !== 'string' || path.length > 300 || path.includes('..')) return false;
  return folders.some(f => path.startsWith(f) && !path.slice(f.length).includes('/') && path.length > f.length);
}

/** The folders a consignment's evidence may come from: its own, and its route stops' proof-of-delivery folders. */
async function evidenceFolders(c: Consignment, extra: string[] = []): Promise<string[]> {
  const folders = [cargoFolder(c.id), ...extra];
  if (c.kind === 'manifest') return [...folders, `pod/${c.id}_pickup/`, `pod/${c.id}_drop/`];
  const { data: points } = await supabase.from('delivery_points').select('id').eq('shipment_id', c.id);
  const ids = (points ?? []).map((p: any) => p.id);
  if (ids.length > 0) {
    const { data: stops } = await supabase.from('route_stops').select('id').in('delivery_point_id', ids);
    for (const s of stops ?? []) folders.push(`pod/${s.id}/`);
  }
  return folders;
}

function checkPaths(paths: unknown[], folders: string[], field: string): void {
  for (const p of paths) if (!isPathIn(p, folders)) throw new HttpError(400, `${field} must be files uploaded for this shipment`);
}

// ── Exceptions opened by custody ────────────────────────────

/** The exception a condition code opens, or null for good goods. */
export function exceptionTypeFor(condition: Condition | null | undefined): 'damage' | 'seal_tamper' | 'shortage' | 'excess' | null {
  switch (condition) {
    case 'damaged_packaging':
    case 'damaged_goods':
    case 'wet':
      return 'damage';
    case 'seal_tampered':
      return 'seal_tamper';
    case 'shortage':
      return 'shortage';
    case 'excess':
      return 'excess';
    default:
      return null;
  }
}

// ── Shared steps ────────────────────────────────────────────

/** The driver of a vehicle (for the event row). */
async function driverOf(vehicleId: string | null | undefined): Promise<string | null> {
  if (!vehicleId) return null;
  const { data } = await supabase.from('vehicles').select('driver_id').eq('id', vehicleId).maybeSingle();
  return data?.driver_id ?? null;
}

/** Users that can be stored as recorded_by (drivers, staff and vendors are users; customers and 3PL partners are not). */
const USER_ROLES = ['driver', 'admin', 'manager', 'superadmin', 'vendor'];

async function insertEvent(c: Consignment, row: Record<string, unknown>, actor: Actor | null): Promise<Record<string, any>> {
  const { data, error } = await supabase
    .from('cargo_custody_events')
    .insert({
      ...refColumns(c),
      ...row,
      recorded_by: actor && USER_ROLES.includes(actor.role) ? actor.id : null,
      recorded_role: actor?.role ?? 'system',
      recorded_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error || !data) throw new Error(`Failed to record the custody event: ${error?.message}`);
  return data;
}

/** The shipment_logs hash-chain entry for a shipment's custody event. */
async function logShipment(c: Consignment, status: string, event: Record<string, any>, actor: Actor | null, extra: Record<string, unknown> = {}): Promise<void> {
  if (c.kind !== 'shipment') return;
  await ShipmentService.recordShipmentLog(
    c.id, status, (event.lat as number | null) ?? null, (event.lng as number | null) ?? null,
    {
      custody_event_id: event.id,
      custody_kind: event.kind,
      pieces: event.pieces ?? null,
      condition: event.condition ?? null,
      holder: event.to_holder ?? null,
      vehicle_id: event.to_vehicle_id ?? event.from_vehicle_id ?? null,
      depot_id: event.to_depot_id ?? event.from_depot_id ?? null,
      ...(event.receiver_name ? { received_by: event.receiver_name } : {}),
      ...(['delivery', 'partial_delivery', 'return_delivery'].includes(event.kind)
        ? { photo_captured: (event.photo_paths ?? []).length > 0, signature_captured: !!event.signature_path || !!extra.signature_captured }
        : {}),
      ...(event.exception_id ? { exception_id: event.exception_id } : {}),
      ...extra,
    },
    actor ? { id: actor.id, role: actor.role } : null,
  );
}

/** Records the pickup a staff override delivers without, flagged backfilled, and opens a note for dispatch. */
async function backfillPickup(c: Consignment, input: CustodyInput, actor: Actor | null, reason: string): Promise<Consignment> {
  const text = reason.trim().slice(0, 300);
  await recordCustody(
    c,
    { kind: 'pickup', lat: input.lat, lng: input.lng, notes: `Back-filled: no pickup was recorded before the delivery. Reason: ${text}`.slice(0, 500) },
    actor,
    { via: 'system', logMetadata: { backfilled: true, backfill_reason: text } },
  );
  const after = await reload(c);
  await openCustodyException(after, 'other', {
    severity: 'low',
    description: `Delivered with no pickup recorded. Staff back-filled the pickup (backfilled: true). Reason: ${text}`,
    lat: input.lat, lng: input.lng, source: 'custody',
  }, actor);
  return after;
}

async function openCustodyException(
  c: Consignment,
  type: string,
  input: { severity?: string; description: string; pieces?: number | null; condition?: Condition | null; vehicleId?: string | null; lat?: number | null; lng?: number | null; source?: string },
  actor: Actor | null,
): Promise<string> {
  const { openException } = await import('./exception.service');
  const opened = await openException({
    type,
    severity: input.severity,
    source: input.source ?? (actor?.role === 'driver' ? 'driver' : 'custody'),
    description: input.description,
    vehicle_id: input.vehicleId ?? c.vehicleId,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    items: [{ consignment: c, pieces_affected: input.pieces ?? null, condition: input.condition ?? null }],
  }, actor);
  return opened.id;
}

/** Marks the pending stops of a shipment done (or failed) when the goods were settled outside complete-stop. */
async function settleStops(c: Consignment, as: 'completed' | 'failed' | 'cancelled'): Promise<string[]> {
  if (c.kind !== 'shipment') return [];
  const { data: points } = await supabase.from('delivery_points').select('id').eq('shipment_id', c.id);
  return cancelOpenStops((points ?? []).map((p: any) => p.id), { as });
}

async function vehicleIsOperating(vehicleId: string): Promise<boolean> {
  const { data } = await supabase.from('vehicles').select('status').eq('id', vehicleId).maybeSingle();
  return !!data && (OPERATING_VEHICLE_STATUSES as readonly string[]).includes(String(data.status));
}

/** The vehicle a step puts the goods on: the one named by staff, the driver's own, or the planned one. */
async function vehicleFor(c: Consignment, input: CustodyInput, actor: Actor | null): Promise<string | null> {
  if (actor?.role === 'driver') return driverVehicleId(actor.id);
  if (input.vehicle_id) {
    const v = await vehicleSummary(input.vehicle_id);
    if (!v) throw new HttpError(404, 'Vehicle not found');
    return v.id;
  }
  return plannedVehicleOf(c);
}

/** What a manifest delivery has always done besides the status: bill, close the request, free the load. */
async function afterManifestDelivered(c: Consignment): Promise<void> {
  await InvoiceService.onManifestDelivered(c.id);
  // A load lot's request completes when its master (all its lots) is delivered: see lots.service rollupMaster
  if (c.row.vendor_request_id && !c.parentId) await supabase.from('vendor_shipment_requests').update({ status: 'completed' }).eq('id', c.row.vendor_request_id);
  const vehicleId = c.row.vehicle_id ?? c.vehicleId;
  await releaseVehicleLoad(vehicleId, Number(c.row.capacity_kg) || 0);
  if (vehicleId && !(await vehicleHasOpenWork(vehicleId, { manifestId: c.id }))) await setOperatingVehicleStatus(vehicleId, 'available');
}

/** Side effects of a status change, by kind of consignment. */
async function afterStatus(c: Consignment, previous: string, next: string, actor: Actor | null): Promise<void> {
  // A partial delivery whose last pieces are settled later (returned, found short) keeps its status:
  // try the invoice again; it is only issued once nothing is left to hold, and never twice
  if (next === previous && next === 'partially_delivered' && c.kind === 'shipment') {
    await InvoiceService.onShipmentDelivered(c.id);
    try {
      const { onShipmentStatus } = await import('../customer-bookings.service');
      await onShipmentStatus(c.id, next);
    } catch (e) {
      console.error('Failed to update the customer booking:', e);
    }
  }
  if (next === previous) return;
  if (c.kind === 'shipment') {
    await ShipmentService.afterStatusChange(c.id, next, actor);
    return;
  }
  const { vendorService } = await import('../vendor.service');
  const [from, to] = [manifestStatusFor(previous), manifestStatusFor(next)];
  if (from === to) return;
  if (to === 'in_transit' && from === 'scheduled') await vendorService.notifyVendorLoadEvent(c.id, 'picked_up');
  if (to === 'delivered') {
    await afterManifestDelivered(c);
    await vendorService.notifyVendorLoadEvent(c.id, 'delivered');
  }
}

function text(value: unknown, label: string, max: number): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new HttpError(400, `${label} must be text`);
  const t = value.trim();
  if (t.length > max) throw new HttpError(400, `${label} must be at most ${max} characters`);
  return t || null;
}

// ── recordCustody ───────────────────────────────────────────

/**
 * Records one custody step for a consignment (see the contract for what each kind does).
 * `actor` is null for the system (scheduler). Throws HttpErrors with plain messages.
 */
export async function recordCustody(target: Consignment | unknown, input: CustodyInput, actor: Actor | null, opts: CustodyOptions = {}): Promise<CustodyResult> {
  let c = typeof target === 'object' && target !== null && 'kind' in (target as any) && 'rawStatus' in (target as any)
    ? (target as Consignment)
    : await resolveRef(target);
  const via = opts.via ?? 'api';
  const kind = input.kind;
  if (!(CUSTODY_KINDS as readonly string[]).includes(kind)) throw new HttpError(400, `kind must be one of: ${CUSTODY_KINDS.join(', ')}`);
  if (TRANSFER_ONLY_KINDS.includes(kind) && via !== 'transfer') throw new HttpError(400, 'Handovers are recorded through a cargo transfer');
  if (LOT_ONLY_KINDS.includes(kind)) throw new HttpError(400, 'Splits and merges are recorded through /cargo/lots/split and /cargo/lots/merge');
  // A split master holds no goods of its own: its lots are picked up, moved and delivered
  await assertNotMaster(c, 'Record pickups, deliveries and other custody steps');
  if (input.condition != null && !(CONDITIONS as readonly string[]).includes(input.condition)) {
    throw new HttpError(400, `condition must be one of: ${CONDITIONS.join(', ')}`);
  }
  const staff = !!actor && ['admin', 'manager', 'superadmin'].includes(actor.role);
  if (via === 'api' && STAFF_ONLY_KINDS.includes(kind) && !staff) throw new HttpError(403, 'Only staff can record this');

  const notes = text(input.notes, 'notes', 500);
  const photoPaths = Array.isArray(input.photo_paths) ? input.photo_paths : [];
  if (photoPaths.length > 10) throw new HttpError(400, 'At most 10 photos');
  const signaturePath = input.signature_path ?? null;
  if (via === 'api' || via === 'transfer') {
    const folders = await evidenceFolders(c, opts.transferId ? [cargoFolder(opts.transferId)] : []);
    checkPaths(photoPaths, folders, 'photo_paths');
    if (signaturePath) checkPaths([signaturePath], folders, 'signature_path');
  }
  const seal = text(input.seal_number, 'seal_number', 60);
  const receiver = text(input.receiver_name, 'receiver_name', 200);
  const exceptionIds: string[] = [];

  // Base of the event row; each kind fills in holders, pieces and status
  const base: Record<string, unknown> = {
    kind,
    pieces: input.pieces ?? null,
    weight_kg: input.weight_kg ?? null,
    condition: input.condition ?? null,
    seal_number: seal,
    photo_paths: photoPaths,
    signature_path: signaturePath,
    receiver_name: receiver,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    notes,
    exception_id: opts.exceptionId ?? null,
    transfer_id: opts.transferId ?? null,
    driver_id: actor?.role === 'driver' ? actor.id : null,
  };
  const reasonNote = (reason: string | null) => [reason ? `Reason: ${reason.replace(/_/g, ' ')}` : null, notes].filter(Boolean).join('. ') || null;

  const finish = async (previousStatus: string, nextStatus: string, event: Record<string, any>, extraLog: Record<string, unknown> = {}): Promise<CustodyResult> => {
    await logShipment(c, nextStatus, event, actor, { ...(opts.logMetadata ?? {}), ...extraLog });
    await afterStatus(c, previousStatus, nextStatus, actor);
    const after = await reload(c);
    if (nextStatus === 'out_for_delivery' && previousStatus !== 'out_for_delivery' && after.kind === 'shipment' && after.row.delivery_otp_required) {
      try {
        await sendDeliveryOtp(after, actor);
      } catch (e) {
        console.error(`[cargo] Delivery code for ${after.code} was not sent:`, e);
      }
    }
    return {
      event,
      ref: refOf(after),
      status: after.rawStatus,
      current_holder: after.holder,
      pieces: piecesView(after.pieces, after.holder),
      exception_ids: exceptionIds,
    };
  };

  switch (kind) {
    // ── Informational steps ──
    case 'booked':
    case 'accepted':
    case 'arrived_pickup':
    case 'arrived_drop': {
      if (['delivered', 'returned', 'lost', 'cancelled'].includes(c.status)) {
        throw new HttpError(409, `This shipment is ${c.status.replace(/_/g, ' ')}.`);
      }
      const vehicleId = c.vehicleId ?? (await plannedVehicleOf(c));
      const event = await insertEvent(c, {
        ...base, from_holder: c.holder, to_holder: c.holder, from_vehicle_id: vehicleId, to_vehicle_id: vehicleId,
        from_depot_id: c.depotId, to_depot_id: c.depotId, driver_id: base.driver_id ?? (await driverOf(vehicleId)),
      }, actor);
      return finish(c.status, c.status, event);
    }

    // ── Pickup ──
    case 'pickup': {
      if (wasPickedUp(c)) {
        if (via === 'parcel_scan' || via === 'complete_stop' || via === 'tpl') {
          return { event: null, ref: refOf(c), status: c.rawStatus, current_holder: c.holder, pieces: piecesView(c.pieces, c.holder), exception_ids: [], already: true };
        }
        throw new HttpError(409, 'These goods were already picked up.');
      }
      if (!['created', 'assigned', 'on_hold', 'exception'].includes(c.status)) {
        throw new HttpError(409, `This shipment is ${c.status.replace(/_/g, ' ')} and can't be picked up.`);
      }
      // A 3PL partner's truck is not ours; a pickup implied by a delivery or a status change may
      // have no vehicle on record. A pickup recorded through the custody endpoint needs one.
      const vehicleId = via === 'tpl' ? null : await vehicleFor(c, input, actor);
      if (!vehicleId && via === 'api') throw new HttpError(409, 'Assign a vehicle before recording the pickup.');
      let counted: number | null;
      if (input.pieces != null) counted = parsePieces(input.pieces, 'pieces');
      else if (via === 'api') throw new HttpError(400, 'Count the pieces at pickup (pieces)');
      else counted = c.pieces.total;

      let pieces = c.pieces;
      const issues: { type: string; severity: string; description: string; pieces: number | null; condition: Condition | null }[] = [];
      if (counted != null) {
        if (pieces.total == null) {
          pieces = addPieces(pieces, { total: counted });
        } else if (counted > pieces.total) {
          issues.push({ type: 'excess', severity: 'low', description: `${counted} pieces picked up against ${pieces.total} booked.`, pieces: counted - pieces.total, condition: 'excess' });
          pieces = addPieces(pieces, { total: counted });
        } else if (counted < pieces.total) {
          const missing = pieces.total - counted;
          issues.push({ type: 'shortage', severity: 'high', description: `${counted} pieces handed over against ${pieces.total} booked; ${missing} short at pickup.`, pieces: missing, condition: 'shortage' });
          pieces = addPieces(pieces, { short: missing });
        }
      }
      const condType = exceptionTypeFor(input.condition);
      if (condType && condType !== 'shortage' && condType !== 'excess') {
        issues.push({ type: condType, severity: condType === 'seal_tamper' ? 'high' : 'medium', description: `Picked up with condition ${String(input.condition).replace(/_/g, ' ')}.`, pieces: counted, condition: input.condition ?? null });
      }

      const previous = c.status;
      await writeConsignment(c, {
        status: 'picked_up',
        current_holder: 'vehicle',
        current_vehicle_id: vehicleId,
        current_depot_id: null,
        on_hold_reason: null,
        ...piecesPatch(pieces),
        ...(seal ? { seal_number: seal } : {}),
        ...(c.kind === 'manifest' && vehicleId ? { vehicle_id: vehicleId } : {}),
      });
      for (const issue of issues) {
        exceptionIds.push(await openCustodyException(c, issue.type, { ...issue, vehicleId, lat: input.lat, lng: input.lng }, actor));
      }
      const event = await insertEvent(c, {
        ...base, pieces: counted, from_holder: 'consignor', to_holder: 'vehicle', to_vehicle_id: vehicleId,
        driver_id: base.driver_id ?? (await driverOf(vehicleId)), exception_id: opts.exceptionId ?? exceptionIds[0] ?? null,
      }, actor);
      return finish(previous, 'picked_up', event, { via });
    }

    // ── On the road ──
    case 'departed': {
      if (c.status === 'at_hub') throw new HttpError(409, 'These goods are at a hub. Record the hub departure (hub_out) instead.');
      // After a failed or partial delivery, setting off again is the re-attempt: out for delivery
      if (!['picked_up', 'in_transit', 'out_for_delivery', 'exception', 'partially_delivered'].includes(c.status) || c.holder !== 'vehicle') {
        throw new HttpError(409, `This shipment is ${c.status.replace(/_/g, ' ')}, so it can't depart.`);
      }
      const previous = c.status;
      const next = c.status === 'picked_up' ? 'in_transit' : ['exception', 'partially_delivered'].includes(c.status) ? 'out_for_delivery' : c.status;
      if (next !== previous) await writeConsignment(c, { status: next });
      const event = await insertEvent(c, {
        ...base, from_holder: c.holder, to_holder: c.holder, from_vehicle_id: c.vehicleId, to_vehicle_id: c.vehicleId,
        driver_id: base.driver_id ?? (await driverOf(c.vehicleId)),
      }, actor);
      return finish(previous, next, event, { via });
    }

    // ── Delivery ──
    case 'delivery':
    case 'partial_delivery': {
      if (!wasPickedUp(c)) {
        if (!opts.backfillPickup) throw new HttpError(409, NEVER_PICKED_UP);
        c = await backfillPickup(c, input, actor, opts.backfillPickup.reason);
      }
      if (!['picked_up', 'in_transit', 'out_for_delivery', 'exception', 'partially_delivered'].includes(c.status)) {
        throw new HttpError(409, `This shipment is ${c.status.replace(/_/g, ' ')} and can't be delivered.`);
      }
      // Evidence: who received it; the OTP when one is required (or given); and a photo or
      // signature. Staff may rely on a verified OTP or log a reason instead of a photo.
      if (!opts.legacyEvidence && !receiver) throw new HttpError(400, 'Enter who received the goods (receiver_name)');
      let otpVerified: boolean | null = null;
      if (c.kind === 'shipment' && (c.row.delivery_otp_required || (input.otp != null && input.otp !== ''))) {
        await verifyDeliveryOtp(c, input.otp);
        otpVerified = true;
      }
      if (!opts.legacyEvidence) {
        const reason = text(input.reason, 'reason', 300);
        const hasProof = photoPaths.length > 0 || !!signaturePath || (staff && (otpVerified === true || (!!reason && reason.length >= 3)));
        if (!hasProof) throw new HttpError(400, staff ? 'Add a delivery photo or signature, the delivery code, or a reason' : 'Add a delivery photo or the receiver\'s signature');
      }
      let sealOk: boolean | null = null;
      if (seal && c.seal) sealOk = seal === c.seal;

      const held = piecesHeld(c.pieces);
      const damaged = input.pieces_damaged != null ? parsePieces(input.pieces_damaged, 'pieces_damaged') : 0;
      let pieces = c.pieces;
      let next: string;
      let holder: Holder;
      let accepted: number | null;
      let refused = 0;
      let short = 0;
      if (kind === 'delivery') {
        accepted = input.pieces != null ? parsePieces(input.pieces, 'pieces') : held;
        if (held != null && accepted != null && accepted !== held) {
          throw new HttpError(409, accepted < held
            ? `${held} pieces are on board. Record a partial delivery to deliver fewer.`
            : `Only ${held} pieces are on board.`);
        }
        if (accepted != null) pieces = addPieces(pieces.total == null ? { ...pieces, total: pieces.delivered + pieces.short + pieces.returned + accepted } : pieces, { delivered: accepted, damaged });
        next = 'delivered';
        holder = 'consignee';
      } else {
        accepted = parsePieces(input.pieces, 'pieces (accepted)', { min: 1 });
        refused = input.pieces_refused != null ? parsePieces(input.pieces_refused, 'pieces_refused') : 0;
        short = input.pieces_short != null ? parsePieces(input.pieces_short, 'pieces_short') : 0;
        if (refused + short === 0) throw new HttpError(400, 'A partial delivery has pieces refused or short. Record a full delivery otherwise.');
        const counted = accepted + refused + short;
        if (held != null && counted !== held) throw new HttpError(409, `${held} pieces are on board, and this accounts for ${counted}.`);
        const baseTotal = pieces.total == null ? { ...pieces, total: pieces.delivered + pieces.short + pieces.returned + counted } : pieces;
        pieces = addPieces(baseTotal, { delivered: accepted, short, damaged });
        next = 'partially_delivered';
        holder = refused > 0 ? 'vehicle' : 'consignee';
      }
      const vehicleId = c.vehicleId ?? (await plannedVehicleOf(c));
      const previous = c.status;
      await writeConsignment(c, {
        status: next,
        current_holder: holder,
        current_vehicle_id: holder === 'vehicle' ? vehicleId : null,
        current_depot_id: null,
        on_hold_reason: null,
        ...piecesPatch(pieces),
        ...(receiver ? { received_by: receiver } : {}),
        ...(photoPaths[0] ? { photo_url: photoPaths[0] } : {}),
        ...(signaturePath ? { signature_url: signaturePath } : {}),
        ...(c.kind === 'shipment' && otpVerified ? { delivery_otp_hash: null, delivery_otp_expires_at: null } : {}),
      });

      // With remarks (damage), a partial, or a broken seal each open a case
      const condType = exceptionTypeFor(input.condition);
      if (condType === 'damage' || damaged > 0) {
        exceptionIds.push(await openCustodyException(c, 'damage', {
          severity: 'medium', description: `Delivered with remarks: ${damaged || accepted || 'some'} pieces ${String(input.condition ?? 'damaged_goods').replace(/_/g, ' ')}.`,
          pieces: damaged || accepted, condition: input.condition ?? 'damaged_goods', vehicleId, lat: input.lat, lng: input.lng,
        }, actor));
      }
      if (sealOk === false || input.condition === 'seal_tampered') {
        exceptionIds.push(await openCustodyException(c, 'seal_tamper', {
          severity: 'high', description: `Seal at delivery ${seal ?? '(not given)'} does not match seal ${c.seal ?? '(none)'} recorded at pickup.`,
          pieces: accepted, condition: 'seal_tampered', vehicleId, lat: input.lat, lng: input.lng,
        }, actor));
      }
      if (kind === 'partial_delivery') {
        exceptionIds.push(await openCustodyException(c, short > 0 ? 'shortage' : 'refused', {
          severity: short > 0 ? 'high' : 'medium',
          description: `Partial delivery: ${accepted} accepted, ${refused} refused, ${short} short.${input.reason ? ` Reason: ${String(input.reason).replace(/_/g, ' ')}.` : ''}`,
          pieces: refused + short, condition: short > 0 ? 'shortage' : null, vehicleId, lat: input.lat, lng: input.lng,
        }, actor));
      }

      const event = await insertEvent(c, {
        ...base, pieces: accepted, from_holder: 'vehicle', from_vehicle_id: vehicleId, to_holder: 'consignee',
        driver_id: base.driver_id ?? (await driverOf(vehicleId)), otp_verified: otpVerified, seal_ok: sealOk,
        exception_id: opts.exceptionId ?? exceptionIds[0] ?? null,
        notes: reasonNote(text(input.reason, 'reason', 300)),
      }, actor);

      if (via !== 'complete_stop' && !(next === 'delivered' && staff && c.kind === 'shipment')) await settleStops(c, 'completed');
      if (kind === 'partial_delivery') {
        await notifyStaffSafe('Partial delivery', `${c.code}: ${accepted} pieces accepted, ${refused} refused, ${short} short.`, 'cargo_partial_delivery', { ...refOf(c), exception_id: exceptionIds[exceptionIds.length - 1] ?? null });
        await notifyOwner(c, 'Part of your goods delivered', `${accepted} of your pieces were delivered${refused ? `, ${refused} were refused` : ''}${short ? `, and ${short} are missing. We have opened a case to trace them` : ''}.`, 'cargo_partial_delivery');
      }
      return finish(previous, next, event, { via });
    }

    // ── Refused or not delivered ──
    case 'refused':
    case 'undelivered': {
      const reason = input.reason;
      if (typeof reason !== 'string' || !(DELIVERY_FAILURE_REASONS as readonly string[]).includes(reason)) {
        throw new HttpError(400, `reason must be one of: ${DELIVERY_FAILURE_REASONS.join(', ')}`);
      }
      if (!wasPickedUp(c)) {
        if (!opts.backfillPickup) throw new HttpError(409, NEVER_PICKED_UP);
        c = await backfillPickup(c, input, actor, opts.backfillPickup.reason);
      }
      if (!['picked_up', 'in_transit', 'out_for_delivery', 'exception', 'partially_delivered'].includes(c.status)) {
        throw new HttpError(409, `This shipment is ${c.status.replace(/_/g, ' ')}, so no delivery was due.`);
      }
      const attempts = c.attempts + 1;
      const rto = attempts >= c.maxAttempts;
      const previous = c.status;
      const vehicleId = c.vehicleId ?? (await plannedVehicleOf(c));
      let next = previous;
      // A failed attempt is an exception; the last one allowed starts the return to origin
      if (!rto) {
        next = 'exception';
        await writeConsignment(c, { status: next, delivery_attempts: attempts });
      } else if (canTransition(SHIPMENT_TRANSITIONS, previous, 'returning')) {
        next = 'returning';
        await writeConsignment(c, { status: next, delivery_attempts: attempts, rto: true });
      } else {
        await writeConsignment(c, { status: 'exception', delivery_attempts: attempts });
        c = await reload(c);
        next = 'returning';
        await writeConsignment(c, { status: next, rto: true });
      }
      if (!rto) {
        const failedType = kind === 'refused' || reason === 'customer_refused' || reason === 'damaged_refused' ? 'refused' : 'undeliverable';
        exceptionIds.push(await openCustodyException(c, failedType, {
          severity: 'medium',
          description: `Delivery attempt ${attempts} of ${c.maxAttempts} failed: ${reason.replace(/_/g, ' ')}.${notes ? ` ${notes}` : ''} Plan a re-attempt.`,
          pieces: piecesHeld(c.pieces), condition: reason === 'damaged_refused' ? 'damaged_goods' : null, vehicleId,
          lat: input.lat, lng: input.lng, source: via === 'complete_stop' ? 'stop_failed' : undefined,
        }, actor));
      }
      const event = await insertEvent(c, {
        ...base, from_holder: 'vehicle', to_holder: 'vehicle', from_vehicle_id: vehicleId, to_vehicle_id: vehicleId,
        driver_id: base.driver_id ?? (await driverOf(vehicleId)), exception_id: opts.exceptionId ?? exceptionIds[0] ?? null,
        notes: reasonNote(reason),
      }, actor);
      if (via !== 'complete_stop') await settleStops(c, 'failed');
      if (rto) {
        let returnRoute: string | null = null;
        if (c.kind === 'shipment') {
          const leg = await createReturnLeg(c.row as any, vehicleId, actor);
          returnRoute = leg.route_id;
        }
        await notifyStaffSafe('Return to origin started', `${c.code} could not be delivered after ${attempts} attempts and is going back to the sender.`, 'cargo_rto_started', { ...refOf(c), route_id: returnRoute });
        await notifyOwner(c, 'Your goods are coming back', `We tried to deliver your goods ${attempts} times without success, so they are being returned to the sender.`, 'cargo_rto_started');
      }
      return finish(previous, next, event, { via, reason, attempt: attempts, rto });
    }

    // ── Hubs ──
    case 'hub_in': {
      const depotId = input.depot_id;
      if (!depotId) throw new HttpError(400, 'depot_id is required for a hub arrival');
      const { data: depot } = await supabase.from('depots').select('id, name').eq('id', depotId).maybeSingle();
      if (!depot) throw new HttpError(404, 'Hub not found');
      if (c.holder !== 'vehicle') throw new HttpError(409, 'Only goods on a vehicle can be dropped at a hub.');
      const previous = c.status;
      const vehicleId = c.vehicleId;
      const held = piecesHeld(c.pieces);
      const counted = input.pieces != null ? parsePieces(input.pieces, 'pieces') : held;
      let pieces = c.pieces;
      if (held != null && counted != null && counted < held) {
        pieces = addPieces(pieces, { short: held - counted });
        exceptionIds.push(await openCustodyException(c, 'shortage', { severity: 'high', description: `${counted} pieces reached the ${depot.name} hub against ${held} on board.`, pieces: held - counted, condition: 'shortage', vehicleId }, actor));
      } else if (held != null && counted != null && counted > held) {
        exceptionIds.push(await openCustodyException(c, 'excess', { severity: 'low', description: `${counted} pieces reached the ${depot.name} hub against ${held} on board.`, pieces: counted - held, condition: 'excess', vehicleId }, actor));
      }
      const condType = exceptionTypeFor(input.condition);
      if (condType && condType !== 'shortage' && condType !== 'excess') {
        exceptionIds.push(await openCustodyException(c, condType, { description: `Reached the ${depot.name} hub with condition ${String(input.condition).replace(/_/g, ' ')}.`, pieces: counted, condition: input.condition, vehicleId }, actor));
      }
      await writeConsignment(c, { status: 'at_hub', current_holder: 'hub', current_depot_id: depot.id, current_vehicle_id: null, on_hold_reason: null, ...piecesPatch(pieces) });
      const event = await insertEvent(c, {
        ...base, pieces: counted, from_holder: 'vehicle', from_vehicle_id: vehicleId, to_holder: 'hub', to_depot_id: depot.id,
        driver_id: base.driver_id ?? (await driverOf(vehicleId)), exception_id: opts.exceptionId ?? exceptionIds[0] ?? null,
      }, actor);
      // The goods left that vehicle: its stops for them go, and its load is worked out again
      const vehicles = await settleStops(c, 'cancelled');
      for (const v of new Set([...vehicles, ...(vehicleId ? [vehicleId] : [])])) await ShipmentService.recalculateVehicleCapacity(v);
      await notifyOwner(c, 'Your goods reached a hub', `Your goods are at our ${depot.name} hub.`, 'cargo_at_hub', { depot_id: depot.id });
      return finish(previous, 'at_hub', event, { via });
    }

    case 'hub_out': {
      if (c.status !== 'at_hub' || !c.depotId) throw new HttpError(409, 'These goods are not at a hub.');
      if (input.depot_id && input.depot_id !== c.depotId) throw new HttpError(409, 'These goods are at a different hub.');
      const vehicleId = await vehicleFor(c, { ...input, vehicle_id: input.vehicle_id ?? null }, actor);
      if (!vehicleId || vehicleId === c.vehicleId) throw new HttpError(400, 'Name the vehicle collecting the goods (vehicle_id)');
      if (!(await vehicleIsOperating(vehicleId))) throw new HttpError(409, 'That vehicle is not in service.');
      const next = c.rto ? 'returning' : input.next_status === 'out_for_delivery' ? 'out_for_delivery' : 'in_transit';
      const previous = c.status;
      const depotId = c.depotId;
      await writeConsignment(c, {
        status: next, current_holder: 'vehicle', current_vehicle_id: vehicleId, current_depot_id: null,
        ...(c.kind === 'manifest' ? { vehicle_id: vehicleId } : {}),
      });
      const event = await insertEvent(c, {
        ...base, pieces: input.pieces ?? piecesHeld(c.pieces), from_holder: 'hub', from_depot_id: depotId, to_holder: 'vehicle', to_vehicle_id: vehicleId,
        driver_id: base.driver_id ?? (await driverOf(vehicleId)),
      }, actor);
      if (c.kind === 'shipment') {
        const planned = await planStopsOnVehicle(await openDropPoints(c.id, c.rto), vehicleId, actor, { note: 'From the hub' });
        await ShipmentService.recalculateVehicleCapacity(vehicleId);
        return finish(previous, next, event, { via, route_id: planned.route_id });
      }
      return finish(previous, next, event, { via });
    }

    // ── Checks ──
    case 'inspection': {
      if (input.condition == null && input.pieces == null && !seal) throw new HttpError(400, 'Record a condition, a piece count or the seal number');
      const held = piecesHeld(c.pieces);
      const counted = input.pieces != null ? parsePieces(input.pieces, 'pieces') : null;
      let sealOk: boolean | null = null;
      if (seal && c.seal) sealOk = seal === c.seal;
      const vehicleId = c.vehicleId;
      const condType = exceptionTypeFor(input.condition);
      if (condType && condType !== 'shortage' && condType !== 'excess') {
        exceptionIds.push(await openCustodyException(c, condType, { description: `Inspection found ${String(input.condition).replace(/_/g, ' ')}.${notes ? ` ${notes}` : ''}`, pieces: counted ?? held, condition: input.condition, vehicleId, lat: input.lat, lng: input.lng }, actor));
      }
      if (counted != null && held != null && counted !== held) {
        const type = counted < held ? 'shortage' : 'excess';
        exceptionIds.push(await openCustodyException(c, type, { severity: type === 'shortage' ? 'high' : 'low', description: `Inspection counted ${counted} pieces against ${held} held.`, pieces: Math.abs(held - counted), condition: type, vehicleId, lat: input.lat, lng: input.lng }, actor));
      }
      if (sealOk === false) {
        exceptionIds.push(await openCustodyException(c, 'seal_tamper', { severity: 'high', description: `Seal ${seal} does not match ${c.seal} recorded at pickup.`, condition: 'seal_tampered', vehicleId, lat: input.lat, lng: input.lng }, actor));
      }
      const event = await insertEvent(c, {
        ...base, pieces: counted, seal_ok: sealOk, from_holder: c.holder, to_holder: c.holder, from_vehicle_id: vehicleId, to_vehicle_id: vehicleId,
        from_depot_id: c.depotId, to_depot_id: c.depotId, driver_id: base.driver_id ?? (await driverOf(vehicleId)), exception_id: opts.exceptionId ?? exceptionIds[0] ?? null,
      }, actor);
      return finish(c.status, c.status, event, { via });
    }

    // ── Hold and release (staff) ──
    case 'hold': {
      const reason = text(input.reason, 'reason', 300) ?? notes;
      if (!reason) throw new HttpError(400, 'Say why the goods are held (reason)');
      if (c.status === 'on_hold') throw new HttpError(409, 'These goods are already on hold.');
      const previous = c.status;
      await writeConsignment(c, {
        status: 'on_hold',
        on_hold_reason: reason,
        // Rows from before the holder columns get them now, so the goods stay traceable to the vehicle
        ...(c.row.current_holder == null ? { current_holder: c.holder } : {}),
        ...(c.holder === 'vehicle' && c.row.current_vehicle_id == null && (input.vehicle_id ?? c.vehicleId) ? { current_vehicle_id: input.vehicle_id ?? c.vehicleId } : {}),
      });
      const event = await insertEvent(c, {
        ...base, from_holder: c.holder, to_holder: c.holder, from_vehicle_id: c.vehicleId, to_vehicle_id: c.vehicleId,
        from_depot_id: c.depotId, to_depot_id: c.depotId, notes: reason,
      }, actor);
      return finish(previous, 'on_hold', event, { via, reason });
    }

    case 'release_hold': {
      if (c.status !== 'on_hold') throw new HttpError(409, 'These goods are not on hold.');
      let next: string;
      if (c.holder === 'vehicle') {
        if (c.vehicleId && !(await vehicleIsOperating(c.vehicleId))) {
          throw new HttpError(409, 'The vehicle holding these goods is not in service. Transfer the goods, or return the vehicle to service first.');
        }
        next = c.rto ? 'returning' : 'in_transit';
      } else if (c.holder === 'hub') {
        next = 'at_hub';
      } else {
        next = (await plannedVehicleOf(c)) ? 'assigned' : 'created';
      }
      const previous = c.status;
      await writeConsignment(c, { status: next, on_hold_reason: null });
      const event = await insertEvent(c, {
        ...base, from_holder: c.holder, to_holder: c.holder, from_vehicle_id: c.vehicleId, to_vehicle_id: c.vehicleId,
        from_depot_id: c.depotId, to_depot_id: c.depotId,
      }, actor);
      return finish(previous, next, event, { via });
    }

    // ── Returns ──
    case 'return_pickup': {
      if (!['at_hub', 'exception', 'partially_delivered', 'on_hold'].includes(c.status)) {
        throw new HttpError(409, `This shipment is ${c.status.replace(/_/g, ' ')}, so a return pickup does not apply.`);
      }
      const vehicleId = c.holder === 'vehicle' && actor?.role !== 'driver' && !input.vehicle_id ? c.vehicleId : await vehicleFor(c, input, actor);
      if (!vehicleId) throw new HttpError(400, 'Name the vehicle taking the goods back (vehicle_id)');
      const previous = c.status;
      const fromHolder = c.holder;
      await writeConsignment(c, { status: 'returning', rto: true, current_holder: 'vehicle', current_vehicle_id: vehicleId, current_depot_id: null, on_hold_reason: null });
      const event = await insertEvent(c, {
        ...base, pieces: input.pieces ?? piecesHeld(c.pieces), from_holder: fromHolder, from_vehicle_id: c.vehicleId, from_depot_id: c.depotId,
        to_holder: 'vehicle', to_vehicle_id: vehicleId, driver_id: base.driver_id ?? (await driverOf(vehicleId)),
      }, actor);
      if (c.kind === 'shipment') {
        const points = await openDropPoints(c.id, true);
        const returnPoint = points.find(p => (p.name ?? '').startsWith('Return to '));
        if (returnPoint) await planStopsOnVehicle([returnPoint], vehicleId, actor, { note: 'Return to origin' });
        else await createReturnLeg(c.row as any, vehicleId, actor);
      }
      return finish(previous, 'returning', event, { via });
    }

    case 'return_delivery': {
      if (c.status !== 'returning') throw new HttpError(409, 'These goods are not being returned.');
      const held = piecesHeld(c.pieces);
      const counted = input.pieces != null ? parsePieces(input.pieces, 'pieces') : held;
      if (held != null && counted != null && counted > held) throw new HttpError(409, `Only ${held} pieces are being returned.`);
      let pieces = c.pieces;
      if (counted != null) {
        const base0 = pieces.total == null ? { ...pieces, total: pieces.delivered + pieces.short + pieces.returned + counted } : pieces;
        const missing = held != null ? held - counted : 0;
        pieces = addPieces(base0, { returned: counted, short: missing });
        if (missing > 0) exceptionIds.push(await openCustodyException(c, 'shortage', { severity: 'high', description: `${counted} pieces returned to the sender against ${held} on board.`, pieces: missing, condition: 'shortage', vehicleId: c.vehicleId }, actor));
      }
      const previous = c.status;
      const vehicleId = c.vehicleId;
      await writeConsignment(c, { status: 'returned', current_holder: 'consignor', current_vehicle_id: null, current_depot_id: null, ...piecesPatch(pieces), ...(receiver ? { received_by: receiver } : {}) });
      const event = await insertEvent(c, {
        ...base, pieces: counted, from_holder: 'vehicle', from_vehicle_id: vehicleId, to_holder: 'consignor',
        driver_id: base.driver_id ?? (await driverOf(vehicleId)), exception_id: opts.exceptionId ?? exceptionIds[0] ?? null,
      }, actor);
      if (via !== 'complete_stop') await settleStops(c, 'completed');
      if (vehicleId && c.kind === 'shipment') await ShipmentService.recalculateVehicleCapacity(vehicleId);
      await notifyOwner(c, 'Your goods were returned', `Your goods are back with the sender${counted != null ? ` (${counted} pieces)` : ''}.`, 'cargo_rto_started');
      return finish(previous, 'returned', event, { via });
    }

    // ── Lost (staff, or a write-off) ──
    case 'lost': {
      const held = piecesHeld(c.pieces);
      const lostPieces = input.pieces != null ? parsePieces(input.pieces, 'pieces') : held;
      if (held != null && lostPieces != null && lostPieces > held) throw new HttpError(409, `Only ${held} pieces are held.`);
      const pieces = lostPieces != null && c.pieces.total != null ? addPieces(c.pieces, { short: lostPieces }) : c.pieces;
      const remaining = piecesHeld(pieces);
      const previous = c.status;
      // All of it gone: the consignment is lost. Some left: only the count changes.
      const next = remaining == null || remaining === 0 ? (pieces.delivered > 0 || pieces.returned > 0 ? previous : 'lost') : previous;
      // The last known holder and vehicle stay on record for the investigation
      await writeConsignment(c, { status: next, ...piecesPatch(pieces) });
      const event = await insertEvent(c, {
        ...base, pieces: lostPieces, from_holder: c.holder, from_vehicle_id: c.vehicleId, from_depot_id: c.depotId,
        to_holder: c.holder, to_vehicle_id: c.vehicleId, to_depot_id: c.depotId,
      }, actor);
      return finish(previous, next, event, { via });
    }

    default:
      throw new HttpError(400, `Custody kind ${kind} is not recorded here`);
  }
}

// ── Handovers (transfers) ───────────────────────────────────

/**
 * A handover half of a transfer. handover_out records what left the from-vehicle; handover_in
 * moves the goods to the to-vehicle or the hub. Called by transfer.service only.
 */
export async function recordHandover(
  c: Consignment,
  side: 'out' | 'in',
  input: { pieces: number; condition: Condition | null; photo_paths?: string[]; signature_path?: string | null; notes?: string | null; short?: number },
  actor: Actor | null,
  opts: { transferId: string; exceptionId?: string | null; fromVehicleId: string; toVehicleId: string | null; toDepotId: string | null },
): Promise<Record<string, any>> {
  const photoPaths = input.photo_paths ?? [];
  const folders = [cargoFolder(opts.transferId), cargoFolder(c.id)];
  checkPaths(photoPaths, folders, 'photo_paths');
  if (input.signature_path) checkPaths([input.signature_path], folders, 'signature_path');
  const toHolder: Holder = opts.toVehicleId ? 'vehicle' : 'hub';
  const row: Record<string, unknown> = {
    kind: side === 'out' ? 'handover_out' : 'handover_in',
    pieces: input.pieces,
    condition: input.condition ?? null,
    photo_paths: photoPaths,
    signature_path: input.signature_path ?? null,
    notes: input.notes ?? null,
    from_holder: 'vehicle',
    from_vehicle_id: opts.fromVehicleId,
    to_holder: toHolder,
    to_vehicle_id: opts.toVehicleId,
    to_depot_id: opts.toDepotId,
    transfer_id: opts.transferId,
    exception_id: opts.exceptionId ?? null,
    driver_id: actor?.role === 'driver' ? actor.id : await driverOf(side === 'out' ? opts.fromVehicleId : opts.toVehicleId),
  };
  const event = await insertEvent(c, row, actor);
  await logShipment(c, c.rawStatus, event, actor, { transfer_id: opts.transferId });
  return event;
}

// ── Lots: split and merge events ────────────────────────────

/**
 * A split or merge custody event on a consignment (the master, the lot split or merged, and each
 * lot made or merged), in the custody log and the shipment_logs hash chain. Called by lots.service.
 */
export async function recordLotEvent(
  c: Consignment,
  kind: 'split' | 'merge',
  input: { pieces: number | null; weight_kg?: number | null; notes: string },
  actor: Actor | null,
  extraLog: Record<string, unknown> = {},
): Promise<Record<string, any>> {
  const vehicleId = c.holder === 'vehicle' || c.holder === 'consignor' ? c.vehicleId : null;
  const event = await insertEvent(c, {
    kind,
    pieces: input.pieces,
    weight_kg: input.weight_kg ?? null,
    photo_paths: [],
    notes: input.notes.slice(0, 500),
    from_holder: c.holder,
    to_holder: c.holder,
    from_vehicle_id: vehicleId,
    to_vehicle_id: vehicleId,
    from_depot_id: c.depotId,
    to_depot_id: c.depotId,
    driver_id: await driverOf(vehicleId),
  }, actor);
  await logShipment(c, c.rawStatus, event, actor, extraLog);
  return event;
}

// ── Reading: where is it, timeline ──────────────────────────

export interface WhereView {
  ref: { shipment_id: string } | { manifest_id: string };
  code: string;
  status: string;
  current_holder: Holder;
  vehicle: { id: string; plate_number: string | null; driver_name: string | null; lat: number | null; lng: number | null; last_seen_at: string | null } | null;
  depot: { id: string; name: string | null; address: string | null } | null;
  pieces: PiecesView;
  seal_number: string | null;
  open_exceptions: { id: string; code: string; type: string; severity: string; status: string; sla_due_at: string | null }[];
  delivery_attempts: number;
  max_delivery_attempts: number;
  /** A shipment needs the delivery OTP at delivery (always false for a vendor load). */
  delivery_otp_required: boolean;
  rto: boolean;
  on_hold_reason: string | null;
  /** A master that was split (its status, holder and pieces are rolled up from its lots). */
  is_master: boolean;
  /** For a lot: its label and master (also flat as `lot_label` and `master`). */
  lot: { label: string; seq: number | null; master: { ref: { shipment_id: string } | { manifest_id: string }; code: string } } | null;
  lot_label: string | null;
  master: { ref: { shipment_id: string } | { manifest_id: string }; code: string } | null;
  /** A lot's own e-way bill reference, and whether Part B needs updating after a vehicle change. */
  eway_bill_ref: string | null;
  eway_part_b_required: boolean;
}

/**
 * Open cases a consignment is in. For a master, the open cases of all its lots too, each
 * tagged with its lot code (`lot_code`), so a case that sits on one lot shows on the booking.
 */
export async function openExceptionsFor(c: { kind: 'shipment' | 'manifest'; id: string; isMaster?: boolean }) {
  const column = c.kind === 'shipment' ? 'shipment_id' : 'manifest_id';
  const lotCodes = new Map<string, string>();
  const ids = [c.id];
  if (c.isMaster) {
    const { lotsOf } = await import('./lots.service');
    for (const l of await lotsOf(c.kind, c.id)) {
      ids.push(l.id);
      lotCodes.set(l.id, l.code);
    }
  }
  const { data: items } = await supabase.from('cargo_exception_items').select(`exception_id, ${column}`).in(column, ids);
  const codeOf = new Map<string, string>();
  for (const i of (items ?? []) as any[]) {
    const lot = lotCodes.get(i[column]);
    if (lot && !codeOf.has(i.exception_id)) codeOf.set(i.exception_id, lot);
  }
  const caseIds = [...new Set((items ?? []).map((i: any) => i.exception_id))];
  if (caseIds.length === 0) return [];
  const { data } = await supabase
    .from('cargo_exceptions')
    .select('id, code, type, severity, status, sla_due_at, description, created_at')
    .in('id', caseIds)
    .in('status', ['open', 'investigating', 'action_planned']);
  return ((data ?? []) as any[]).map(e => (codeOf.has(e.id) ? { ...e, lot_code: codeOf.get(e.id) } : e));
}

export async function whereIs(c: Consignment, opts: { redacted?: boolean; user?: TokenData | null } = {}): Promise<WhereView> {
  if (c.isMaster) {
    const { masterWhere } = await import('./lots.service');
    return masterWhere(c, opts);
  }
  const vehicleId = c.holder === 'vehicle' || c.holder === 'consignor' ? c.vehicleId ?? (await plannedVehicleOf(c)) : null;
  const vehicle = c.holder === 'vehicle' || (c.holder === 'consignor' && vehicleId) ? await vehicleSummary(vehicleId) : null;
  let depot: WhereView['depot'] = null;
  if (c.holder === 'hub' && c.depotId) {
    const { data } = await supabase.from('depots').select('id, name, address').eq('id', c.depotId).maybeSingle();
    depot = data ? { id: data.id, name: data.name ?? null, address: data.address ?? null } : null;
  }
  const open = await openExceptionsFor(c);
  return {
    ref: refOf(c),
    code: c.code,
    status: c.rawStatus,
    current_holder: c.holder,
    vehicle: vehicle
      ? {
          id: vehicle.id,
          plate_number: vehicle.plate_number ?? null,
          driver_name: opts.redacted ? null : vehicle.driver_name ?? null,
          lat: vehicle.latitude ?? null,
          lng: vehicle.longitude ?? null,
          last_seen_at: vehicle.last_heartbeat ?? null,
        }
      : null,
    depot,
    pieces: piecesView(c.pieces, c.holder),
    seal_number: opts.redacted ? null : c.seal,
    open_exceptions: open.map(e => ({ id: e.id, code: e.code, type: e.type, severity: e.severity, status: e.status, sla_due_at: e.sla_due_at ?? null })),
    delivery_attempts: c.attempts,
    max_delivery_attempts: c.maxAttempts,
    delivery_otp_required: c.kind === 'shipment' && c.row.delivery_otp_required === true,
    rto: c.rto,
    on_hold_reason: opts.redacted ? null : c.onHoldReason,
    is_master: false,
    ...(await lotTag(c)),
    eway_bill_ref: c.row.eway_bill_ref ?? null,
    eway_part_b_required: c.row.eway_part_b_required === true,
  };
}

/** The lot fields of `where`: its label and master, nested and flat. */
async function lotTag(c: Consignment): Promise<Pick<WhereView, 'lot' | 'lot_label' | 'master'>> {
  if (!c.parentId || !c.lotLabel) return { lot: null, lot_label: null, master: null };
  const master = await masterRefOf(c);
  return { lot: { label: c.lotLabel, seq: c.row.lot_seq != null ? Number(c.row.lot_seq) : null, master }, lot_label: c.lotLabel, master };
}

/** The ref and code of a lot's master. */
async function masterRefOf(c: Consignment): Promise<{ ref: { shipment_id: string } | { manifest_id: string }; code: string }> {
  const ref = c.kind === 'shipment' ? { shipment_id: c.parentId! } : { manifest_id: c.parentId! };
  if (c.kind === 'manifest') return { ref, code: manifestParcelCode(c.parentId!) };
  const { data } = await supabase.from('shipments').select('tracking_id').eq('id', c.parentId!).maybeSingle();
  return { ref, code: data?.tracking_id ?? c.code.replace(/-[^-]+$/, '') };
}

/** A plain-words line for one event, as the customer and driver apps show it. */
export function describeEvent(e: { kind: string; pieces?: number | null; receiver_name?: string | null; to_holder?: string | null }, depotName?: string | null): string {
  const pcs = e.pieces != null ? `, ${e.pieces} ${e.pieces === 1 ? 'piece' : 'pieces'}` : '';
  switch (e.kind) {
    case 'booked': return 'Booked';
    case 'accepted': return 'The driver accepted the trip';
    case 'arrived_pickup': return 'The truck reached the pickup point';
    case 'pickup': return `Picked up${pcs}`;
    case 'departed': return 'On the way';
    case 'arrived_drop': return 'The truck reached the delivery point';
    case 'delivery': return `Delivered${e.receiver_name ? ` to ${e.receiver_name}` : ''}${pcs}`;
    case 'partial_delivery': return `Partly delivered${pcs} accepted`;
    case 'refused': return 'The delivery was refused';
    case 'undelivered': return 'The delivery could not be made';
    case 'handover_out': return e.to_holder === 'hub' ? 'Unloaded for a hub' : 'Handed over to another truck';
    case 'handover_in': return e.to_holder === 'hub' ? `Received at the ${depotName ?? ''} hub`.replace('  ', ' ') : `Moved to a relief truck${pcs}`;
    case 'hub_in': return depotName ? `At the ${depotName} hub` : 'At a hub';
    case 'hub_out': return depotName ? `Left the ${depotName} hub` : 'Left the hub';
    case 'return_pickup': return 'On the way back to the sender';
    case 'return_delivery': return `Returned to the sender${pcs}`;
    case 'inspection': return 'Checked by our team';
    case 'hold': return 'On hold';
    case 'release_hold': return 'Moving again';
    case 'lost': return 'Reported missing';
    // Split and merge notes are written by the system in plain words ("Split into lots A (50), B (25)")
    case 'split': return (e as { notes?: string | null }).notes || 'Split into lots';
    case 'merge': return (e as { notes?: string | null }).notes || 'Lots merged';
    default: return e.kind.replace(/_/g, ' ');
  }
}

/**
 * The words for an event with its notes after them. A split or merge is described by its notes,
 * so those are not added a second time.
 */
export function describeEventWithNotes(e: { kind: string; notes?: string | null; pieces?: number | null; receiver_name?: string | null; to_holder?: string | null }, depotName?: string | null): string {
  const text = describeEvent(e, depotName);
  const notes = e.notes?.trim();
  return notes && !text.includes(notes) ? `${text}. ${notes}` : text;
}

/**
 * The custody timeline, oldest first, with signed links to photos and signatures. Redacted: no
 * notes, staff or driver ids. A master's timeline merges its own with its lots' (each event tagged
 * with its lot).
 */
export async function timelineOf(c: Consignment, opts: { redacted?: boolean; own?: boolean; user?: TokenData | null } = {}): Promise<{ events: any[] }> {
  if (c.isMaster && !opts.own) {
    const { masterTimeline } = await import('./lots.service');
    return masterTimeline(c, opts);
  }
  const column = c.kind === 'shipment' ? 'shipment_id' : 'manifest_id';
  const { data, error } = await supabase.from('cargo_custody_events').select('*').eq(column, c.id).order('recorded_at', { ascending: true });
  if (error) throw new Error(`Failed to read the custody timeline: ${error.message}`);
  const rows = ((data ?? []) as any[]).sort((a, b) => String(a.recorded_at).localeCompare(String(b.recorded_at)));

  const depotIds = [...new Set(rows.flatMap(r => [r.to_depot_id, r.from_depot_id]).filter(Boolean))];
  const depots = new Map<string, string>();
  if (depotIds.length > 0) {
    const { data: d } = await supabase.from('depots').select('id, name').in('id', depotIds);
    for (const row of d ?? []) depots.set(row.id, row.name);
  }
  const vehicleIds = [...new Set(rows.flatMap(r => [r.to_vehicle_id, r.from_vehicle_id]).filter(Boolean))];
  const plates = new Map<string, string>();
  if (vehicleIds.length > 0) {
    const { data: v } = await supabase.from('vehicles').select('id, plate_number').in('id', vehicleIds);
    for (const row of v ?? []) plates.set(row.id, row.plate_number);
  }
  const names = new Map<string, string>();
  if (!opts.redacted) {
    const people = [...new Set(rows.flatMap(r => [r.recorded_by, r.driver_id]).filter(Boolean))];
    if (people.length > 0) {
      const { data: u } = await supabase.from('users').select('id, full_name').in('id', people);
      for (const row of u ?? []) names.set(row.id, row.full_name);
    }
  }

  const events = [];
  for (const r of rows) {
    const photos = (await Promise.all(((r.photo_paths ?? []) as string[]).map(p => signedUrl(p)))).filter((u): u is string => !!u);
    const signature = await signedUrl(r.signature_path);
    const depotName = depots.get(r.to_depot_id) ?? depots.get(r.from_depot_id) ?? null;
    const common = {
      id: r.id,
      kind: r.kind,
      summary: describeEvent(r, depotName),
      recorded_at: r.recorded_at,
      from_holder: r.from_holder,
      to_holder: r.to_holder,
      from_vehicle: r.from_vehicle_id ? { id: r.from_vehicle_id, plate_number: plates.get(r.from_vehicle_id) ?? null } : null,
      to_vehicle: r.to_vehicle_id ? { id: r.to_vehicle_id, plate_number: plates.get(r.to_vehicle_id) ?? null } : null,
      from_depot: r.from_depot_id ? { id: r.from_depot_id, name: depots.get(r.from_depot_id) ?? null } : null,
      to_depot: r.to_depot_id ? { id: r.to_depot_id, name: depots.get(r.to_depot_id) ?? null } : null,
      pieces: r.pieces ?? null,
      condition: r.condition ?? null,
      receiver_name: r.receiver_name ?? null,
      otp_verified: r.otp_verified ?? null,
      photo_urls: photos,
      signature_url: signature,
      lat: r.lat ?? null,
      lng: r.lng ?? null,
    };
    events.push(opts.redacted ? common : {
      ...common,
      weight_kg: r.weight_kg ?? null,
      seal_number: r.seal_number ?? null,
      seal_ok: r.seal_ok ?? null,
      notes: r.notes ?? null,
      exception_id: r.exception_id ?? null,
      transfer_id: r.transfer_id ?? null,
      driver: r.driver_id ? { id: r.driver_id, name: names.get(r.driver_id) ?? null } : null,
      recorded_by: r.recorded_by ? { id: r.recorded_by, name: names.get(r.recorded_by) ?? null, role: r.recorded_role ?? null } : null,
      recorded_role: r.recorded_role ?? null,
    });
  }
  return { events };
}

/** A revised arrival estimate for a consignment on a vehicle: from the vehicle's position to its drop. */
export async function revisedEta(c: Consignment): Promise<{ eta_at: string; eta_text: string } | null> {
  if (c.holder !== 'vehicle' || !c.vehicleId) return null;
  const vehicle = await vehicleSummary(c.vehicleId);
  if (vehicle?.latitude == null || vehicle?.longitude == null) return null;
  let drop: { lat: number; lng: number } | null = null;
  if (c.kind === 'manifest') drop = c.row.drop_lat != null ? { lat: Number(c.row.drop_lat), lng: Number(c.row.drop_lng) } : null;
  else {
    const points = await openDropPoints(c.id, c.rto);
    const last = points[points.length - 1];
    if (last?.latitude != null && last?.longitude != null) drop = { lat: Number(last.latitude), lng: Number(last.longitude) };
  }
  if (!drop) return null;
  const { haversineKm } = await import('../geo');
  const minutes = estimateMinutes(haversineKm({ lat: Number(vehicle.latitude), lng: Number(vehicle.longitude) }, drop));
  const at = new Date(Date.now() + minutes * 60_000);
  return { eta_at: at.toISOString(), eta_text: istTime(at) };
}

// ── Access helpers for the routes ───────────────────────────

/** Loads a consignment and checks the caller may record custody on it. */
export async function consignmentForAction(user: TokenData, ref: unknown): Promise<Consignment> {
  const c = await resolveRef(ref);
  await assertCanAct(user, c);
  return c;
}
