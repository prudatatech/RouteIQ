/**
 * margixindia — Cargo exceptions: the case file (docs/cargo-plan.md)
 *
 * Every problem with goods becomes a case with a code (EXC-XXXXXX), an owner and an SLA by
 * severity. Cases open by hand, or by themselves from a serious SOS, a maintenance move or a
 * cancelled route or load with goods on board (holdCargoOnVehicle), a failed stop, a custody
 * condition or piece mismatch (custody.service), and a live ETA slipping (detectDelays).
 * Overdue cases are escalated to staff by the scheduler, like stale SOS alerts.
 */
import crypto from 'crypto';
import { supabase } from '../../core/supabase';
import { HttpError } from '../../core/errors';
import { settings } from '../../core/config';
import { OPERATING_VEHICLE_STATUSES } from '../../core/transitions';
import { isPlaceholderPlate } from '../../core/vehicles';
import { haversineKm, isValidPoint } from '../geo';
import { ShipmentService } from '../shipment.service';
import {
  piecesHeld, refColumns, refOf, reload, resolveRef, toConsignment, weightOf, writeConsignment,
  SHIPMENT_CUSTODY_COLUMNS, MANIFEST_CUSTODY_COLUMNS,
  type Actor, type Condition, type Consignment,
} from './consignment';
import { notifyOwner, notifyStaffSafe } from './notify';
import { estimateMinutes, openDropPoints, planStopsOnVehicle } from './replan';

export const EXCEPTION_TYPES = [
  'vehicle_accident', 'vehicle_breakdown', 'damage', 'shortage', 'excess', 'theft', 'refused', 'undeliverable', 'delay', 'seal_tamper', 'weather', 'other',
] as const;
export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export const EXCEPTION_STATUSES = ['open', 'investigating', 'action_planned', 'resolved', 'closed'] as const;
export const EXCEPTION_SOURCES = ['sos', 'maintenance', 'stop_failed', 'custody', 'eta', 'manual', 'driver'] as const;
export const RESOLUTIONS = [
  'transshipped', 'repaired_continue', 'moved_to_hub', 'returned', 'delivered_with_remarks', 'redelivered', 'written_off', 'claim_settled', 'no_action',
] as const;
export const OPEN_EXCEPTION_STATUSES = ['open', 'investigating', 'action_planned'] as const;

/** Hours to act on a case, by severity. */
export const SLA_HOURS: Record<string, number> = { critical: 1, high: 4, medium: 24, low: 72 };
/** Minutes between escalations of an overdue case, and how many are sent at most. */
export const ESCALATE_EVERY_MIN = 60;
export const MAX_ESCALATIONS = 6;

/** How a case may move. Closed is reachable from any state; resolved only through the resolve action. */
export const EXCEPTION_TRANSITIONS: Record<string, readonly string[]> = {
  open: ['investigating', 'action_planned', 'resolved', 'closed'],
  investigating: ['action_planned', 'resolved', 'closed'],
  action_planned: ['investigating', 'resolved', 'closed'],
  resolved: ['closed'],
  closed: [],
};

const DEFAULT_SEVERITY: Record<string, string> = {
  vehicle_accident: 'critical', vehicle_breakdown: 'high', theft: 'critical', shortage: 'high', seal_tamper: 'high',
  damage: 'medium', refused: 'medium', undeliverable: 'medium', delay: 'medium', weather: 'medium', excess: 'low', other: 'medium',
};

/** What the customer or vendor is told when their goods are in a new case. */
const OWNER_MESSAGES: Record<string, [string, string] | null> = {
  vehicle_accident: ['Your goods are delayed', 'The truck carrying your goods was in an accident. We are checking your goods and arranging the next step.'],
  vehicle_breakdown: ['Your goods are delayed', 'The truck carrying your goods broke down. Your goods are with us and we are arranging the next step.'],
  damage: ['We found damage to your goods', 'Some of your goods were found damaged. We have opened a case and will keep you updated.'],
  shortage: ['Some of your goods are missing', 'Some pieces of your goods are missing. We have opened a case to trace them.'],
  theft: ['Your goods are missing', 'We are investigating the loss of your goods and will keep you updated.'],
  seal_tamper: ['We are checking your goods', 'The seal on your goods did not match. We are checking them.'],
  refused: ['Your delivery was refused', 'The delivery of your goods was refused. We will arrange the next step.'],
  undeliverable: ['Delivery attempt failed', 'We could not deliver your goods this time. We will arrange another attempt.'],
  delay: ['Your goods are running late', 'Your goods are running late. We are on it.'],
  weather: ['Your goods are delayed', 'Bad weather is delaying your goods.'],
  excess: null,
  other: ['We are looking into your goods', 'There is an issue with your goods. We have opened a case and will keep you updated.'],
};

/** The plain-words notice a customer or vendor sees for a case of this type. */
export function ownerNotice(type: string): { title: string; message: string } | null {
  const m = OWNER_MESSAGES[type];
  return m ? { title: m[0], message: m[1] } : null;
}

const EXCEPTION_COLUMNS =
  'id, code, type, severity, status, source, sos_alert_id, maintenance_job_id, vehicle_id, route_id, lat, lng, description, owner_id, sla_due_at, ' +
  'escalation_count, last_escalated_at, resolution, resolution_note, resolved_by, resolved_at, notes, created_by, created_at, updated_at';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A human-readable code: PREFIX-XXXXXX. */
export function makeCode(prefix: 'EXC' | 'TRF' | 'CLM'): string {
  let out = '';
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  return `${prefix}-${out}`;
}

/** Inserts a row whose `code` must be unique, trying new codes on the rare clash. */
export async function insertWithCode(table: 'cargo_exceptions' | 'cargo_transfers' | 'cargo_claims', prefix: 'EXC' | 'TRF' | 'CLM', row: Record<string, unknown>, columns = '*'): Promise<any> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await supabase.from(table).insert({ ...row, code: makeCode(prefix) }).select(columns).single();
    if (!error && data) return data;
    if (error?.code !== '23505') throw new Error(`Failed to save to ${table}: ${error?.message}`);
  }
  throw new Error(`Could not find a free ${prefix} code`);
}

export function slaDueAt(severity: string, from: Date = new Date()): string {
  return new Date(from.getTime() + (SLA_HOURS[severity] ?? 24) * 3600_000).toISOString();
}

type Note = { at: string; by: string | null; role: string | null; kind: 'note' | 'action'; text: string };

export interface ExceptionItemInput {
  consignment: Consignment;
  pieces_affected?: number | null;
  condition?: Condition | null;
  note?: string | null;
}

export interface OpenExceptionInput {
  type: string;
  severity?: string | null;
  source: string;
  description: string;
  items: ExceptionItemInput[];
  vehicle_id?: string | null;
  route_id?: string | null;
  sos_alert_id?: string | null;
  maintenance_job_id?: string | null;
  lat?: number | null;
  lng?: number | null;
  status?: string;
}

async function insertItems(exceptionId: string, items: ExceptionItemInput[]): Promise<void> {
  if (items.length === 0) return;
  const rows = items.map(i => ({
    exception_id: exceptionId,
    ...refColumns(i.consignment),
    pieces_affected: i.pieces_affected ?? null,
    weight_affected_kg: weightOf(i.consignment, i.pieces_affected ?? piecesHeld(i.consignment.pieces)),
    condition: i.condition ?? null,
    note: i.note ?? null,
  }));
  const { error } = await supabase.from('cargo_exception_items').insert(rows);
  if (error) throw new Error(`Failed to save the case items: ${error.message}`);
}

/** Opens a case with its items, tells staff, and tells the goods' owners in plain words. */
export async function openException(input: OpenExceptionInput, actor: Actor | null): Promise<{ id: string; code: string; row: any }> {
  if (!(EXCEPTION_TYPES as readonly string[]).includes(input.type)) throw new HttpError(400, `type must be one of: ${EXCEPTION_TYPES.join(', ')}`);
  const severity = input.severity ?? DEFAULT_SEVERITY[input.type] ?? 'medium';
  if (!(SEVERITIES as readonly string[]).includes(severity)) throw new HttpError(400, `severity must be one of: ${SEVERITIES.join(', ')}`);
  const now = new Date();
  const row = await insertWithCode('cargo_exceptions', 'EXC', {
    type: input.type,
    severity,
    status: input.status ?? 'open',
    source: input.source,
    sos_alert_id: input.sos_alert_id ?? null,
    maintenance_job_id: input.maintenance_job_id ?? null,
    vehicle_id: input.vehicle_id ?? null,
    route_id: input.route_id ?? null,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    description: input.description.slice(0, 2000),
    sla_due_at: slaDueAt(severity, now),
    escalation_count: 0,
    notes: [],
    created_by: actor && ['admin', 'manager', 'superadmin', 'driver', 'vendor'].includes(actor.role) ? actor.id : null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  }, EXCEPTION_COLUMNS);
  await insertItems(row.id, input.items);

  const codes = input.items.map(i => i.consignment.code).join(', ');
  await notifyStaffSafe(
    `Cargo case ${row.code} opened`,
    `${input.type.replace(/_/g, ' ')} (${severity})${codes ? ` for ${codes}` : ''}: ${input.description}`.slice(0, 500),
    'cargo_exception_opened',
    { exception_id: row.id, code: row.code, type: input.type, severity },
  );
  const message = OWNER_MESSAGES[input.type];
  if (message) {
    for (const item of input.items) await notifyOwner(item.consignment, message[0], message[1], 'cargo_exception_opened', { exception_id: row.id });
  }
  return { id: row.id, code: row.code, row };
}

async function loadException(id: string): Promise<any> {
  const { data, error } = await supabase.from('cargo_exceptions').select(EXCEPTION_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to read the case: ${error.message}`);
  if (!data) throw new HttpError(404, 'Cargo case not found');
  return data;
}

/**
 * Applies `patch` to a case only if nobody changed it since it was read (updated_at), adding
 * `note` to its log. Returns the new row.
 */
async function updateException(row: any, patch: Record<string, unknown>, note: Omit<Note, 'at'> | null): Promise<any> {
  const now = new Date().toISOString();
  const notes = Array.isArray(row.notes) ? [...row.notes] : [];
  if (note) notes.push({ at: now, ...note });
  const { data, error } = await supabase
    .from('cargo_exceptions')
    .update({ ...patch, notes, updated_at: now })
    .eq('id', row.id)
    .eq('updated_at', row.updated_at)
    .select(EXCEPTION_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`Failed to update the case: ${error.message}`);
  if (!data) throw new HttpError(409, 'This case was just changed by someone else. Refresh and try again.');
  return data;
}

async function exceptionItems(exceptionId: string): Promise<any[]> {
  const { data, error } = await supabase.from('cargo_exception_items').select('*').eq('exception_id', exceptionId);
  if (error) throw new Error(`Failed to read the case items: ${error.message}`);
  return data ?? [];
}

/** The consignments of a case, freshly read. */
async function itemConsignments(exceptionId: string): Promise<{ item: any; c: Consignment }[]> {
  const out: { item: any; c: Consignment }[] = [];
  for (const item of await exceptionItems(exceptionId)) {
    try {
      out.push({ item, c: await resolveRef(item.shipment_id ? { shipment_id: item.shipment_id } : { manifest_id: item.manifest_id }) });
    } catch (e) {
      if (!(e instanceof HttpError && e.status === 404)) throw e;
    }
  }
  return out;
}

// ── Never strand cargo ──────────────────────────────────────

export interface HoldContext {
  source: 'sos' | 'maintenance' | 'manual' | 'custody';
  type: 'vehicle_breakdown' | 'vehicle_accident' | 'other';
  reason: string;
  sosAlertId?: string | null;
  maintenanceJobId?: string | null;
}

/** Consignments whose goods are on a vehicle right now (optionally only some of them). */
export async function consignmentsOnVehicle(vehicleId: string, only: { shipmentIds?: string[]; manifestIds?: string[] } = {}): Promise<Consignment[]> {
  const out = new Map<string, Consignment>();
  const final = ['delivered', 'returned', 'lost', 'cancelled', 'completed'];
  const add = (c: Consignment) => {
    if (c.holder === 'vehicle' && !final.includes(c.rawStatus) && (c.vehicleId === vehicleId || c.vehicleId == null)) out.set(`${c.kind}:${c.id}`, c);
  };

  if (only.shipmentIds === undefined || only.shipmentIds.length > 0) {
    let q = supabase.from('shipments').select(SHIPMENT_CUSTODY_COLUMNS).eq('current_vehicle_id', vehicleId).eq('current_holder', 'vehicle');
    if (only.shipmentIds) q = q.in('id', only.shipmentIds);
    const { data, error } = await q;
    if (error) throw new Error(`Failed to read the goods on the vehicle: ${error.message}`);
    for (const row of data ?? []) add(toConsignment('shipment', row));
    if (only.shipmentIds) {
      // Rows from before the holder columns: picked up or in transit on this route
      const { data: legacy } = await supabase.from('shipments').select(SHIPMENT_CUSTODY_COLUMNS).in('id', only.shipmentIds).in('status', ['picked_up', 'in_transit']);
      for (const row of (legacy ?? []) as any[]) if (row.current_holder == null && row.current_vehicle_id == null) add(toConsignment('shipment', row));
    }
  }
  if (only.manifestIds === undefined || only.manifestIds.length > 0) {
    let q = supabase.from('cargo_manifest').select(MANIFEST_CUSTODY_COLUMNS).eq('current_vehicle_id', vehicleId).eq('current_holder', 'vehicle');
    if (only.manifestIds) q = q.in('id', only.manifestIds);
    const { data, error } = await q;
    if (error) throw new Error(`Failed to read the loads on the vehicle: ${error.message}`);
    for (const row of data ?? []) add(toConsignment('manifest', row));
    // Loads from before the holder columns: in transit on this vehicle
    let legacy = supabase.from('cargo_manifest').select(MANIFEST_CUSTODY_COLUMNS).eq('vehicle_id', vehicleId).eq('status', 'in_transit');
    if (only.manifestIds) legacy = legacy.in('id', only.manifestIds);
    const { data: old } = await legacy;
    for (const row of (old ?? []) as any[]) if (row.current_holder == null) add(toConsignment('manifest', row));
  }
  return [...out.values()];
}

/** An open case already holding goods on this vehicle (so a second trigger adds to it). */
async function openHoldCase(vehicleId: string, ctx: HoldContext): Promise<any | null> {
  const { data } = await supabase
    .from('cargo_exceptions')
    .select(EXCEPTION_COLUMNS)
    .eq('vehicle_id', vehicleId)
    .in('status', [...OPEN_EXCEPTION_STATUSES])
    .in('type', ['vehicle_breakdown', 'vehicle_accident', 'other'])
    .in('source', ['sos', 'maintenance', 'manual']);
  const rows = (data ?? []) as any[];
  if (ctx.sosAlertId) {
    const same = rows.find(r => r.sos_alert_id === ctx.sosAlertId);
    if (same) return same;
  }
  if (ctx.maintenanceJobId) {
    const same = rows.find(r => r.maintenance_job_id === ctx.maintenanceJobId);
    if (same) return same;
  }
  return rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] ?? null;
}

/**
 * The stranding fix: goods on a vehicle that is losing its work (a serious SOS, a maintenance
 * move, a cancelled route or load) go on_hold on an open case, and current_vehicle_id stays set
 * until a transfer, hub drop or repair resolves it. Adds to the vehicle's open hold case when
 * there is one. Returns the case and the consignments held, or null when nothing is on board.
 */
export async function holdCargoOnVehicle(
  vehicleId: string,
  ctx: HoldContext,
  actor: Actor | null,
  only: { shipmentIds?: string[]; manifestIds?: string[]; routeId?: string | null } = {},
): Promise<{ exception_id: string; code: string; held: ({ shipment_id: string } | { manifest_id: string })[] } | null> {
  const goods = await consignmentsOnVehicle(vehicleId, only);
  if (goods.length === 0) return null;

  let row = await openHoldCase(vehicleId, ctx);
  if (row) {
    const existing = new Set((await exceptionItems(row.id)).map((i: any) => i.shipment_id ?? i.manifest_id));
    const fresh = goods.filter(g => !existing.has(g.id));
    await insertItems(row.id, fresh.map(c => ({ consignment: c, pieces_affected: piecesHeld(c.pieces) })));
    const message = OWNER_MESSAGES[ctx.type !== 'other' ? ctx.type : row.type];
    if (message) for (const c of fresh) await notifyOwner(c, message[0], message[1], 'cargo_exception_opened', { exception_id: row.id });
    row = await updateException(row, {
      ...(ctx.sosAlertId && !row.sos_alert_id ? { sos_alert_id: ctx.sosAlertId } : {}),
      ...(ctx.maintenanceJobId && !row.maintenance_job_id ? { maintenance_job_id: ctx.maintenanceJobId } : {}),
      ...(ctx.type !== 'other' && row.type === 'other' ? { type: ctx.type } : {}),
    }, { by: actor?.id ?? null, role: actor?.role ?? 'system', kind: 'action', text: ctx.reason });
  } else {
    const { data: vehicle } = await supabase.from('vehicles').select('plate_number, latitude, longitude').eq('id', vehicleId).maybeSingle();
    const opened = await openException({
      type: ctx.type,
      severity: ctx.type === 'vehicle_accident' ? 'critical' : 'high',
      source: ctx.source,
      description: `${ctx.reason} ${goods.length} ${goods.length === 1 ? 'consignment is' : 'consignments are'} on ${vehicle?.plate_number ?? 'the vehicle'} and need a plan: transfer, hub drop, repair or return.`,
      items: goods.map(c => ({ consignment: c, pieces_affected: piecesHeld(c.pieces) })),
      vehicle_id: vehicleId,
      route_id: only.routeId ?? null,
      sos_alert_id: ctx.sosAlertId ?? null,
      maintenance_job_id: ctx.maintenanceJobId ?? null,
      lat: vehicle?.latitude ?? null,
      lng: vehicle?.longitude ?? null,
    }, actor);
    row = opened.row;
  }

  const { recordCustody } = await import('./custody.service');
  const held: ({ shipment_id: string } | { manifest_id: string })[] = [];
  for (const c of goods) {
    if (c.status !== 'on_hold') {
      await recordCustody(c, { kind: 'hold', reason: ctx.reason, vehicle_id: vehicleId }, actor, { via: 'system', exceptionId: row.id });
    }
    held.push(refOf(c));
  }
  return { exception_id: row.id, code: row.code, held };
}

/** Links a maintenance job to the hold case it caused (the job is saved after the work is released). */
export async function linkMaintenanceJob(exceptionId: string, jobId: string): Promise<void> {
  const row = await loadException(exceptionId);
  if (row.maintenance_job_id) return;
  await updateException(row, { maintenance_job_id: jobId }, null);
}

// ── Reading ─────────────────────────────────────────────────

function slaView(row: any, nowMs = Date.now()) {
  const due = row.sla_due_at ? Date.parse(row.sla_due_at) : NaN;
  const open = (OPEN_EXCEPTION_STATUSES as readonly string[]).includes(row.status);
  return {
    due_at: row.sla_due_at ?? null,
    overdue: open && Number.isFinite(due) && due < nowMs,
    minutes_left: open && Number.isFinite(due) ? Math.round((due - nowMs) / 60_000) : null,
  };
}

async function itemViews(items: any[]) {
  const shipmentIds = items.map(i => i.shipment_id).filter(Boolean);
  const manifestIds = items.map(i => i.manifest_id).filter(Boolean);
  const [ships, loads] = await Promise.all([
    shipmentIds.length ? supabase.from('shipments').select(SHIPMENT_CUSTODY_COLUMNS).in('id', shipmentIds) : Promise.resolve({ data: [] as any[] }),
    manifestIds.length ? supabase.from('cargo_manifest').select(MANIFEST_CUSTODY_COLUMNS).in('id', manifestIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  const byId = new Map<string, Consignment>();
  for (const r of ships.data ?? []) byId.set(r.id, toConsignment('shipment', r));
  for (const r of loads.data ?? []) byId.set(r.id, toConsignment('manifest', r));
  return items.map(i => {
    const c = byId.get(i.shipment_id ?? i.manifest_id);
    return {
      id: i.id,
      ref: i.shipment_id ? { shipment_id: i.shipment_id } : { manifest_id: i.manifest_id },
      code: c?.code ?? null,
      status: c?.rawStatus ?? null,
      current_holder: c?.holder ?? null,
      current_vehicle_id: c?.vehicleId ?? null,
      current_depot_id: c?.depotId ?? null,
      pieces_held: c ? piecesHeld(c.pieces) : null,
      pieces_total: c ? c.pieces.total : null,
      pieces_affected: i.pieces_affected,
      weight_affected_kg: i.weight_affected_kg != null ? Number(i.weight_affected_kg) : null,
      condition: i.condition,
      note: i.note,
    };
  });
}

export interface ExceptionFilters {
  status?: string;
  type?: string;
  severity?: string;
  vehicle_id?: string;
  ref?: string;
  overdue?: boolean;
}

export async function listExceptions(filters: ExceptionFilters) {
  let q = supabase.from('cargo_exceptions').select(EXCEPTION_COLUMNS).order('created_at', { ascending: false }).limit(300);
  if (filters.status) {
    const statuses = filters.status.split(',').map(s => s.trim()).filter(Boolean);
    if (statuses.some(s => !(EXCEPTION_STATUSES as readonly string[]).includes(s))) throw new HttpError(400, `status must be among: ${EXCEPTION_STATUSES.join(', ')}`);
    q = q.in('status', statuses);
  }
  if (filters.type) {
    if (!(EXCEPTION_TYPES as readonly string[]).includes(filters.type)) throw new HttpError(400, 'Unknown type');
    q = q.eq('type', filters.type);
  }
  if (filters.severity) {
    if (!(SEVERITIES as readonly string[]).includes(filters.severity)) throw new HttpError(400, 'Unknown severity');
    q = q.eq('severity', filters.severity);
  }
  if (filters.vehicle_id) q = q.eq('vehicle_id', filters.vehicle_id);
  if (filters.ref) {
    const c = await resolveRef(filters.ref);
    const { data: items } = await supabase.from('cargo_exception_items').select('exception_id').eq(c.kind === 'shipment' ? 'shipment_id' : 'manifest_id', c.id);
    const ids = [...new Set((items ?? []).map((i: any) => i.exception_id))];
    if (ids.length === 0) return [];
    q = q.in('id', ids);
  }
  const { data, error } = await q;
  if (error) throw new Error(`Failed to list cases: ${error.message}`);
  let rows = (data ?? []) as any[];
  const now = Date.now();
  if (filters.overdue) rows = rows.filter(r => slaView(r, now).overdue);
  if (rows.length === 0) return [];

  const { data: allItems } = await supabase.from('cargo_exception_items').select('*').in('exception_id', rows.map(r => r.id));
  const views = await itemViews(allItems ?? []);
  const itemsBy = new Map<string, any[]>();
  (allItems ?? []).forEach((item: any, i: number) => {
    const list = itemsBy.get(item.exception_id) ?? [];
    list.push(views[i]);
    itemsBy.set(item.exception_id, list);
  });
  const vehicleIds = [...new Set(rows.map(r => r.vehicle_id).filter(Boolean))];
  const vehicles = new Map<string, any>();
  if (vehicleIds.length) {
    const { data: v } = await supabase.from('vehicles').select(CASE_VEHICLE_COLUMNS).in('id', vehicleIds);
    for (const row of (v ?? []) as any[]) vehicles.set(row.id, row);
  }
  const owners = await ownerNames(rows.map(r => r.owner_id));
  return rows.map(r => {
    const { notes: _notes, ...rest } = r;
    const vehicle = r.vehicle_id ? vehicles.get(r.vehicle_id) ?? null : null;
    return {
      ...rest,
      plate_number: vehicle?.plate_number ?? null,
      vehicle,
      owner: r.owner_id ? { id: r.owner_id, full_name: owners.get(r.owner_id) ?? null } : null,
      items: itemsBy.get(r.id) ?? [],
      sla: slaView(r, now),
    };
  });
}

/** The vehicle of a case, as the queue and the case page show it (plate, driver and position for the map). */
const CASE_VEHICLE_COLUMNS = 'id, plate_number, status, vehicle_type, latitude, longitude, driver_name';

/** Full names of staff (case owners, people who acted on a case), by id. */
async function ownerNames(ids: (string | null | undefined)[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  const out = new Map<string, string | null>();
  if (unique.length === 0) return out;
  const { data } = await supabase.from('users').select('id, full_name').in('id', unique);
  for (const u of (data ?? []) as any[]) out.set(u.id, u.full_name ?? null);
  return out;
}

/** The case with its items, merged timeline (custody, SOS, maintenance, notes), transfers and claims. */
export async function getException(id: string) {
  const row = await loadException(id);
  const items = await exceptionItems(id);
  const views = await itemViews(items);

  const timeline: { at: string; source: string; kind: string; text: string; ref?: unknown; by?: string | null; role?: string | null; data?: unknown }[] = [];
  timeline.push({ at: row.created_at, source: 'case', kind: 'opened', text: row.description ?? 'Case opened' });
  for (const n of (Array.isArray(row.notes) ? row.notes : []) as Note[]) {
    timeline.push({ at: n.at, source: 'case', kind: n.kind, text: n.text, by: n.by, role: n.role });
  }
  if (row.resolved_at) timeline.push({ at: row.resolved_at, source: 'case', kind: 'resolved', text: `Resolved: ${String(row.resolution ?? '').replace(/_/g, ' ')}${row.resolution_note ? `. ${row.resolution_note}` : ''}`, by: row.resolved_by });

  const shipmentIds = items.map((i: any) => i.shipment_id).filter(Boolean);
  const manifestIds = items.map((i: any) => i.manifest_id).filter(Boolean);
  const { describeEvent } = await import('./custody.service');
  const eventRows: any[] = [];
  if (shipmentIds.length) eventRows.push(...((await supabase.from('cargo_custody_events').select('*').in('shipment_id', shipmentIds)).data ?? []));
  if (manifestIds.length) eventRows.push(...((await supabase.from('cargo_custody_events').select('*').in('manifest_id', manifestIds)).data ?? []));
  const since = Date.parse(row.created_at) - 24 * 3600_000;
  for (const e of eventRows) {
    if (e.exception_id !== id && Date.parse(e.recorded_at) < since) continue;
    timeline.push({
      at: e.recorded_at, source: 'custody', kind: e.kind, text: describeEvent(e) + (e.notes ? `. ${e.notes}` : ''),
      ref: e.shipment_id ? { shipment_id: e.shipment_id } : { manifest_id: e.manifest_id }, by: e.recorded_by, role: e.recorded_role,
      data: { pieces: e.pieces, condition: e.condition, transfer_id: e.transfer_id },
    });
  }
  let sos: any = null;
  if (row.sos_alert_id) {
    const { data } = await supabase.from('sos_alerts').select('id, alert_type, severity, status, description, created_at, updated_at').eq('id', row.sos_alert_id).maybeSingle();
    sos = data ?? null;
    if (sos) timeline.push({ at: sos.created_at, source: 'sos', kind: 'sos_raised', text: `SOS (${String(sos.alert_type ?? 'emergency').replace(/_/g, ' ')}${sos.severity ? `, ${sos.severity}` : ''}): ${sos.description ?? ''}`.trim() });
  }
  let job: any = null;
  if (row.maintenance_job_id) {
    const { data } = await supabase.from('vehicle_maintenance_jobs').select('id, status, reason_type, workshop, expected_return_date, opened_at, closed_at').eq('id', row.maintenance_job_id).maybeSingle();
    job = data ?? null;
    if (job) {
      timeline.push({ at: job.opened_at, source: 'maintenance', kind: 'maintenance_opened', text: `Moved to maintenance (${String(job.reason_type).replace(/_/g, ' ')}${job.workshop ? ` at ${job.workshop}` : ''})${job.expected_return_date ? `, expected back ${job.expected_return_date}` : ''}` });
      if (job.closed_at) timeline.push({ at: job.closed_at, source: 'maintenance', kind: 'maintenance_closed', text: 'Returned to service' });
    }
  }
  timeline.sort((a, b) => String(a.at).localeCompare(String(b.at)));

  const [{ data: transferRows }, { data: claims }] = await Promise.all([
    supabase.from('cargo_transfers').select('id, planned_at').eq('exception_id', id),
    supabase.from('cargo_claims').select('id, code, claim_type, status, claimed_amount, approved_amount, settled_amount, shipment_id, manifest_id, created_at').eq('exception_id', id),
  ]);
  // Transfers as GET /cargo/transfers/:id shows them: vehicles, hub and items with their codes
  const { getTransfer } = await import('./transfer.service');
  const transfers = [];
  for (const t of [...((transferRows ?? []) as any[])].sort((a, b) => String(a.planned_at).localeCompare(String(b.planned_at)))) {
    transfers.push(await getTransfer(t.id));
  }
  let vehicle = null;
  if (row.vehicle_id) {
    const { data } = await supabase.from('vehicles').select(CASE_VEHICLE_COLUMNS).eq('id', row.vehicle_id).maybeSingle();
    vehicle = data ?? null;
  }
  // Names for the owner and for whoever acted on the case (the timeline's `by` ids)
  const names = await ownerNames([row.owner_id, ...timeline.map(t => t.by)]);
  const named = timeline.map(t => (t.by ? { ...t, by_name: names.get(t.by) ?? null } : { ...t, by_name: null }));
  const { notes: _notes, ...rest } = row;
  return {
    ...rest,
    sla: slaView(row),
    vehicle,
    owner: row.owner_id ? { id: row.owner_id, full_name: names.get(row.owner_id) ?? null } : null,
    items: views,
    timeline: named,
    sos_alert: sos,
    maintenance_job: job,
    transfers,
    claims: claims ?? [],
  };
}

// ── Relief vehicles ─────────────────────────────────────────

/**
 * Vehicles that could take the goods of a case: operating and approved (not in maintenance,
 * archived or waiting for approval, not a placeholder plate), ranked by straight-line distance
 * (to 0.1 km), then whether their free capacity covers the affected weight, then whether they
 * carry the cargo types needed.
 */
export async function reliefVehicles(id: string) {
  const row = await loadException(id);
  const goods = await itemConsignments(id);
  const affectedKg = goods.reduce((sum, { c }) => sum + weightOf(c, piecesHeld(c.pieces)), 0);

  let origin: { lat: number; lng: number } | null = row.lat != null && row.lng != null ? { lat: Number(row.lat), lng: Number(row.lng) } : null;
  let neededTypes: string[] = [];
  if (row.vehicle_id) {
    const { data: v } = await supabase.from('vehicles').select('latitude, longitude, cargo_types').eq('id', row.vehicle_id).maybeSingle();
    if (!origin && v?.latitude != null && v?.longitude != null) origin = { lat: Number(v.latitude), lng: Number(v.longitude) };
    neededTypes = Array.isArray(v?.cargo_types) ? v!.cargo_types : [];
  }
  if (!origin || !isValidPoint(origin)) throw new HttpError(409, 'This case has no location, so nearby vehicles cannot be found.');

  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, plate_number, vehicle_type, status, driver_id, driver_name, latitude, longitude, capacity_kg, available_capacity_kg, current_load_kg, cargo_types, last_heartbeat')
    .in('status', [...OPERATING_VEHICLE_STATUSES]);
  if (error) throw new Error(`Failed to read vehicles: ${error.message}`);

  const candidates = (vehicles ?? [])
    .filter((v: any) => v.id !== row.vehicle_id && !isPlaceholderPlate(v.plate_number) && isValidPoint({ lat: v.latitude, lng: v.longitude }))
    .map((v: any) => {
      const distance = Math.round(haversineKm(origin!, { lat: Number(v.latitude), lng: Number(v.longitude) }) * 10) / 10;
      const capacity = Number(v.capacity_kg) || 0;
      const free = v.available_capacity_kg != null ? Number(v.available_capacity_kg) : Math.max(0, capacity - (Number(v.current_load_kg) || 0));
      const types: string[] = Array.isArray(v.cargo_types) ? v.cargo_types : [];
      const cargoMatch = neededTypes.length === 0 || neededTypes.every(t => types.includes(t));
      return {
        vehicle: { id: v.id, plate_number: v.plate_number, vehicle_type: v.vehicle_type, status: v.status, driver_name: v.driver_name ?? null, latitude: v.latitude, longitude: v.longitude, cargo_types: types },
        distance_km: distance,
        free_kg: Math.round(free),
        fits: free >= affectedKg,
        cargo_match: cargoMatch,
        eta_minutes: estimateMinutes(distance),
      };
    })
    .sort((a, b) => a.distance_km - b.distance_km || Number(b.fits) - Number(a.fits) || Number(b.cargo_match) - Number(a.cargo_match));
  return { affected_kg: Math.round(affectedKg * 100) / 100, origin, vehicles: candidates.slice(0, 25) };
}

// ── Actions ─────────────────────────────────────────────────

export const EXCEPTION_ACTIONS = [
  'assign_owner', 'set_status', 'transship', 'move_to_hub', 'wait_for_repair', 'continue_after_repair', 'return_to_origin',
  'reattempt', 'deliver_with_remarks', 'write_off', 'raise_claim', 'resolve', 'add_note',
] as const;

const openish = (row: any) => (OPEN_EXCEPTION_STATUSES as readonly string[]).includes(row.status);

function assertOpen(row: any) {
  if (!openish(row)) throw new HttpError(409, `This case is ${row.status}.`);
}

async function planned(row: any, actor: Actor, text: string): Promise<any> {
  return updateException(row, row.status === 'action_planned' ? {} : { status: 'action_planned' }, { by: actor.id, role: actor.role, kind: 'action', text });
}

function str(v: unknown, label: string, max = 500, required = true): string | null {
  if (v == null || v === '') {
    if (required) throw new HttpError(400, `${label} is required`);
    return null;
  }
  if (typeof v !== 'string') throw new HttpError(400, `${label} must be text`);
  const t = v.trim();
  if (required && !t) throw new HttpError(400, `${label} is required`);
  if (t.length > max) throw new HttpError(400, `${label} must be at most ${max} characters`);
  return t || null;
}

/** The goods of a case still held on its vehicle (the ones a transfer or repair moves). */
async function goodsOnCaseVehicle(row: any): Promise<{ item: any; c: Consignment }[]> {
  const goods = await itemConsignments(row.id);
  return goods.filter(({ c }) => c.holder === 'vehicle' && (!row.vehicle_id || c.vehicleId === row.vehicle_id) && !['delivered', 'returned', 'lost', 'cancelled', 'completed'].includes(c.rawStatus));
}

export async function exceptionAction(id: string, body: Record<string, any>, actor: Actor): Promise<any> {
  const action = body?.action;
  if (!(EXCEPTION_ACTIONS as readonly string[]).includes(action)) throw new HttpError(400, `action must be one of: ${EXCEPTION_ACTIONS.join(', ')}`);
  let row = await loadException(id);
  const { recordCustody } = await import('./custody.service');

  switch (action) {
    case 'add_note': {
      const note = str(body.note, 'note', 1000)!;
      row = await updateException(row, {}, { by: actor.id, role: actor.role, kind: 'note', text: note });
      break;
    }

    case 'assign_owner': {
      assertOpen(row);
      const ownerId = str(body.owner_id, 'owner_id', 64)!;
      const { data: owner } = await supabase.from('users').select('id, full_name, role, is_active').eq('id', ownerId).maybeSingle();
      if (!owner || !['admin', 'manager', 'superadmin'].includes(String(owner.role)) || owner.is_active === false) throw new HttpError(400, 'The owner must be an active staff member');
      row = await updateException(row, { owner_id: owner.id, ...(row.status === 'open' ? { status: 'investigating' } : {}) }, { by: actor.id, role: actor.role, kind: 'action', text: `Owner set to ${owner.full_name ?? 'a staff member'}` });
      if (owner.id !== actor.id) {
        const { notifyUserSafe } = await import('./notify');
        await notifyUserSafe(owner.id, `Cargo case ${row.code} is yours`, row.description ?? 'A cargo case was assigned to you.', 'cargo_exception_opened', { exception_id: row.id, code: row.code });
      }
      break;
    }

    case 'set_status': {
      const next = str(body.status, 'status', 30)!;
      if (!(EXCEPTION_STATUSES as readonly string[]).includes(next)) throw new HttpError(400, `status must be one of: ${EXCEPTION_STATUSES.join(', ')}`);
      if (next === 'resolved') throw new HttpError(400, 'Use the resolve action, with a resolution');
      if (next === row.status) break;
      if (!(EXCEPTION_TRANSITIONS[row.status] ?? []).includes(next)) throw new HttpError(409, `This case is ${row.status.replace(/_/g, ' ')} and can't be changed to ${next.replace(/_/g, ' ')}.`);
      row = await updateException(row, { status: next }, { by: actor.id, role: actor.role, kind: 'action', text: `Status set to ${next.replace(/_/g, ' ')}` });
      break;
    }

    case 'transship':
    case 'move_to_hub': {
      assertOpen(row);
      const goods = await goodsOnCaseVehicle(row);
      if (goods.length === 0) throw new HttpError(409, 'No goods on this case are on a vehicle.');
      const from = row.vehicle_id ?? goods[0].c.vehicleId;
      const { planTransfer } = await import('./transfer.service');
      const transfer = await planTransfer({
        exception_id: row.id,
        from_vehicle_id: from,
        ...(action === 'transship' ? { to_vehicle_id: str(body.to_vehicle_id, 'to_vehicle_id', 64)! } : { to_depot_id: str(body.depot_id, 'depot_id', 64)! }),
        items: goods.map(({ c }) => ({ ref: refOf(c), pieces: piecesHeld(c.pieces) ?? 0 })),
        meet_lat: body.meet_lat ?? null,
        meet_lng: body.meet_lng ?? null,
        meet_address: body.meet_address ?? null,
        note: body.note ?? null,
      }, actor);
      row = await planned(await loadException(row.id), actor, action === 'transship' ? `Transfer ${transfer.code} planned to a relief vehicle` : `Transfer ${transfer.code} planned to a hub`);
      return { exception: await getException(row.id), transfer };
    }

    case 'wait_for_repair': {
      assertOpen(row);
      const expected = str(body.expected_at, 'expected_at', 40)!;
      const at = Date.parse(expected);
      if (!Number.isFinite(at)) throw new HttpError(400, 'expected_at must be a date and time');
      row = await updateException(row, { status: 'action_planned', sla_due_at: new Date(at).toISOString() }, { by: actor.id, role: actor.role, kind: 'action', text: `Waiting for repair, expected by ${new Date(at).toISOString()}` });
      break;
    }

    case 'continue_after_repair': {
      assertOpen(row);
      if (!row.vehicle_id) throw new HttpError(409, 'This case has no vehicle to continue on.');
      const { data: vehicle } = await supabase.from('vehicles').select('status, plate_number').eq('id', row.vehicle_id).maybeSingle();
      if (!vehicle || !(OPERATING_VEHICLE_STATUSES as readonly string[]).includes(String(vehicle.status))) {
        throw new HttpError(409, `${vehicle?.plate_number ?? 'The vehicle'} is not back in service yet. Return it to service first.`);
      }
      const goods = await goodsOnCaseVehicle(row);
      const { revisedEta } = await import('./custody.service');
      for (const { c } of goods) {
        if (c.status === 'on_hold') await recordCustody(c, { kind: 'release_hold', notes: `Vehicle repaired (case ${row.code})` }, actor, { via: 'exception', exceptionId: row.id });
        const fresh = await reload(c);
        if (fresh.kind === 'shipment') {
          await planStopsOnVehicle(await openDropPoints(fresh.id, fresh.rto), row.vehicle_id, actor, { note: `Continuing after repair (${row.code})` });
        }
        const eta = await revisedEta(fresh);
        await notifyOwner(fresh, 'Your goods are moving again', `The truck carrying your goods is repaired and back on the road.${eta ? ` New ETA ${eta.eta_text}.` : ''}`, 'cargo_exception_resolved', { exception_id: row.id });
      }
      await ShipmentService.recalculateVehicleCapacity(row.vehicle_id);
      row = await resolveRow(await loadException(row.id), 'repaired_continue', body.note ?? null, actor);
      break;
    }

    case 'return_to_origin': {
      assertOpen(row);
      const goods = (await itemConsignments(row.id)).filter(({ c }) => !['delivered', 'returned', 'lost', 'cancelled', 'completed', 'returning'].includes(c.rawStatus));
      if (goods.length === 0) throw new HttpError(409, 'Nothing on this case can be returned.');
      const pending: string[] = [];
      for (const { c } of goods) {
        const vehicleOk = c.holder === 'vehicle' && c.vehicleId
          ? (OPERATING_VEHICLE_STATUSES as readonly string[]).includes(String((await supabase.from('vehicles').select('status').eq('id', c.vehicleId).maybeSingle()).data?.status))
          : false;
        if (vehicleOk) {
          await recordCustody(c, { kind: 'return_pickup', notes: `Return to origin (case ${row.code})` }, actor, { via: 'exception', exceptionId: row.id });
        } else {
          // On a broken vehicle or at a hub: flagged for return; the transfer or hub departure takes it back
          await writeConsignment(c, { rto: true });
          pending.push(c.code);
        }
        await notifyOwner(c, 'Your goods are coming back', 'Your goods are being returned to the sender.', 'cargo_rto_started', { exception_id: row.id });
      }
      await notifyStaffSafe(`Return to origin for case ${row.code}`, `${goods.length} consignment(s) are being returned.${pending.length ? ` Waiting for a vehicle: ${pending.join(', ')}.` : ''}`, 'cargo_rto_started', { exception_id: row.id });
      row = await planned(await loadException(row.id), actor, `Return to origin started${pending.length ? `; ${pending.join(', ')} need a transfer or hub departure first` : ''}`);
      break;
    }

    case 'reattempt': {
      assertOpen(row);
      const when = body.scheduled_for != null ? Date.parse(String(body.scheduled_for)) : Date.now();
      if (!Number.isFinite(when)) throw new HttpError(400, 'scheduled_for must be a date and time');
      const goods = (await itemConsignments(row.id)).filter(({ c }) => ['exception', 'partially_delivered'].includes(c.status) && c.holder === 'vehicle');
      if (goods.length === 0) throw new HttpError(409, 'No failed delivery on this case is waiting on a vehicle.');
      for (const { c } of goods) {
        if (!c.vehicleId) throw new HttpError(409, `${c.code} has no vehicle to re-attempt with.`);
        const { data: vehicle } = await supabase.from('vehicles').select('status, plate_number').eq('id', c.vehicleId).maybeSingle();
        if (!vehicle || !(OPERATING_VEHICLE_STATUSES as readonly string[]).includes(String(vehicle.status))) {
          throw new HttpError(409, `${vehicle?.plate_number ?? 'The vehicle'} is not in service. Transfer the goods first.`);
        }
        if (c.kind === 'shipment') {
          await planStopsOnVehicle(await openDropPoints(c.id, false), c.vehicleId, actor, { note: `Re-attempt (${row.code})` });
        }
        await recordCustody(c, { kind: 'departed', notes: `Re-attempt scheduled for ${new Date(when).toISOString()} (case ${row.code})` }, actor, { via: 'exception', exceptionId: row.id });
      }
      row = await planned(await loadException(row.id), actor, `Re-attempt scheduled for ${new Date(when).toISOString()}`);
      break;
    }

    case 'deliver_with_remarks': {
      assertOpen(row);
      const receiver = str(body.receiver_name, 'receiver_name', 200)!;
      const note = str(body.note, 'note', 500)!;
      const goods = (await itemConsignments(row.id)).filter(({ c }) => ['picked_up', 'in_transit', 'out_for_delivery', 'exception', 'partially_delivered'].includes(c.status));
      if (goods.length === 0) throw new HttpError(409, 'Nothing on this case is waiting to be delivered.');
      for (const { item, c } of goods) {
        await recordCustody(c, {
          kind: 'delivery', receiver_name: receiver, reason: note, notes: `Delivered with remarks (case ${row.code})`,
          condition: (body.condition ?? item.condition ?? null) as Condition | null,
          pieces_damaged: body.pieces_damaged ?? null,
          photo_paths: Array.isArray(body.photo_paths) ? body.photo_paths : [],
          otp: body.otp ?? null,
        }, actor, { via: 'exception', exceptionId: row.id });
      }
      row = await resolveRow(await loadException(row.id), 'delivered_with_remarks', note, actor);
      break;
    }

    case 'write_off': {
      assertOpen(row);
      const note = str(body.note, 'note', 500)!;
      const goods = await itemConsignments(row.id);
      let target = goods[0];
      if (body.ref) {
        const c = await resolveRef(body.ref);
        target = goods.find(g => g.c.id === c.id)!;
        if (!target) throw new HttpError(400, 'That consignment is not on this case');
      } else if (goods.length !== 1) {
        throw new HttpError(400, 'Name the consignment to write off (ref)');
      }
      if (!target) throw new HttpError(409, 'This case has no goods');
      await recordCustody(target.c, { kind: 'lost', pieces: body.pieces ?? null, notes: `Written off: ${note} (case ${row.code})` }, actor, { via: 'exception', exceptionId: row.id });
      row = await updateException(await loadException(row.id), {}, { by: actor.id, role: actor.role, kind: 'action', text: `Wrote off ${body.pieces ?? 'all held'} pieces of ${target.c.code}: ${note}` });
      break;
    }

    case 'raise_claim': {
      const goods = await itemConsignments(row.id);
      let target = goods[0]?.c;
      if (body.ref) target = await resolveRef(body.ref);
      if (!target) throw new HttpError(409, 'This case has no goods to claim for');
      const { createClaim } = await import('./claim.service');
      const claim = await createClaim({ exception_id: row.id, ref: refOf(target), claim_type: body.claim_type, claimed_amount: body.claimed_amount, notes: body.note ?? null }, { id: actor.id, role: actor.role });
      row = await updateException(await loadException(row.id), {}, { by: actor.id, role: actor.role, kind: 'action', text: `Claim ${claim.code} raised (${claim.claim_type})` });
      return { exception: await getException(row.id), claim };
    }

    case 'resolve': {
      const resolution = str(body.resolution, 'resolution', 40)!;
      if (!(RESOLUTIONS as readonly string[]).includes(resolution)) throw new HttpError(400, `resolution must be one of: ${RESOLUTIONS.join(', ')}`);
      row = await resolveRow(row, resolution, body.note ?? null, actor);
      break;
    }
  }
  return getException(row.id);
}

/**
 * Resolves a case. Refused while any of its goods is still on hold: they need a plan (a transfer,
 * repair, return or write-off) before the case can close, so nothing is left stranded.
 */
async function resolveRow(row: any, resolution: string, note: unknown, actor: Actor | null): Promise<any> {
  assertOpen(row);
  const goods = await itemConsignments(row.id);
  const stuck = goods.filter(({ c }) => c.status === 'on_hold');
  if (stuck.length > 0) {
    throw new HttpError(409, `${stuck.map(g => g.c.code).join(', ')} ${stuck.length === 1 ? 'is' : 'are'} still on hold. Plan ${stuck.length === 1 ? 'it' : 'them'} first: transfer, repair, return or write off.`);
  }
  const text = note == null ? null : String(note).trim().slice(0, 1000) || null;
  const now = new Date().toISOString();
  const updated = await updateException(row, {
    status: 'resolved', resolution, resolution_note: text, resolved_by: actor && ['admin', 'manager', 'superadmin'].includes(actor.role) ? actor.id : null, resolved_at: now,
  }, { by: actor?.id ?? null, role: actor?.role ?? 'system', kind: 'action', text: `Resolved: ${resolution.replace(/_/g, ' ')}${text ? `. ${text}` : ''}` });
  await notifyStaffSafe(`Cargo case ${row.code} resolved`, `${resolution.replace(/_/g, ' ')}${text ? `: ${text}` : ''}`, 'cargo_exception_resolved', { exception_id: row.id, code: row.code, resolution });
  return updated;
}

/** Resolves a case when a transfer settled all of its goods (called by transfer.service). */
export async function resolveIfSettled(exceptionId: string, resolution: 'transshipped' | 'moved_to_hub', actor: Actor | null, note: string): Promise<boolean> {
  const row = await loadException(exceptionId);
  if (!openish(row)) return false;
  const goods = await itemConsignments(exceptionId);
  if (goods.some(({ c }) => c.status === 'on_hold' || (row.vehicle_id && c.holder === 'vehicle' && c.vehicleId === row.vehicle_id))) return false;
  await resolveRow(row, resolution, note, actor);
  return true;
}

// ── Manual cases ────────────────────────────────────────────

export async function createManualException(body: Record<string, any>, actor: Actor, opts: { driverVehicleIds?: string[] } = {}) {
  const type = str(body.type, 'type', 40)!;
  const description = str(body.description, 'description', 2000)!;
  const itemsIn = Array.isArray(body.items) ? body.items : [];
  if (itemsIn.length === 0 && !body.vehicle_id) throw new HttpError(400, 'Add the affected consignments (items) or a vehicle');
  if (itemsIn.length > 50) throw new HttpError(400, 'At most 50 items');
  const items: ExceptionItemInput[] = [];
  for (const it of itemsIn) {
    const c = await resolveRef(it?.ref);
    if (opts.driverVehicleIds) {
      const { plannedVehicleOf } = await import('./consignment');
      const v = await plannedVehicleOf(c);
      if (!v || !opts.driverVehicleIds.includes(v)) throw new HttpError(403, `${c.code} is not on your vehicle`);
    }
    const condition = it?.condition ?? null;
    const { CONDITIONS } = await import('./consignment');
    if (condition != null && !(CONDITIONS as readonly string[]).includes(condition)) throw new HttpError(400, 'Unknown condition');
    const pieces = it?.pieces_affected == null ? null : Number(it.pieces_affected);
    if (pieces != null && (!Number.isInteger(pieces) || pieces < 0)) throw new HttpError(400, 'pieces_affected must be a whole number');
    items.push({ consignment: c, pieces_affected: pieces, condition });
  }
  const vehicleId = body.vehicle_id ?? null;
  if (opts.driverVehicleIds && vehicleId && !opts.driverVehicleIds.includes(vehicleId)) throw new HttpError(403, 'Not your vehicle');
  const lat = body.lat == null ? null : Number(body.lat);
  const lng = body.lng == null ? null : Number(body.lng);
  if ((lat != null && (!Number.isFinite(lat) || Math.abs(lat) > 90)) || (lng != null && (!Number.isFinite(lng) || Math.abs(lng) > 180))) throw new HttpError(400, 'lat and lng must be coordinates');
  const opened = await openException({
    type, severity: body.severity ?? null, source: actor.role === 'driver' ? 'driver' : 'manual', description, items,
    vehicle_id: vehicleId ?? (opts.driverVehicleIds?.[0] ?? items[0]?.consignment.vehicleId ?? null), lat, lng,
  }, actor);
  return getException(opened.id);
}

// ── Scheduler: SLA escalation and live-ETA delays ───────────

/**
 * Reminds staff about cases past their SLA, like escalateStaleSos does for SOS alerts: once when
 * the SLA passes, then every ESCALATE_EVERY_MIN minutes, at most MAX_ESCALATIONS times. The
 * escalation count is a compare-and-set, so two servers ticking together send one reminder.
 */
export async function escalateOverdueExceptions(nowMs: number = Date.now()): Promise<number> {
  const { data, error } = await supabase
    .from('cargo_exceptions')
    .select('id, code, type, severity, status, sla_due_at, escalation_count, last_escalated_at, vehicle_id, description')
    .in('status', [...OPEN_EXCEPTION_STATUSES])
    .lt('sla_due_at', new Date(nowMs).toISOString())
    .limit(300);
  if (error) throw new Error(`Failed to read overdue cases: ${error.message}`);
  let escalated = 0;
  for (const row of data ?? []) {
    const count = Number(row.escalation_count) || 0;
    if (count >= MAX_ESCALATIONS) continue;
    if (!row.sla_due_at || Date.parse(row.sla_due_at) >= nowMs) continue;
    if (row.last_escalated_at && nowMs - Date.parse(row.last_escalated_at) < ESCALATE_EVERY_MIN * 60_000) continue;
    const { data: claimed } = await supabase
      .from('cargo_exceptions')
      .update({ escalation_count: count + 1, last_escalated_at: new Date(nowMs).toISOString() })
      .eq('id', row.id)
      .eq('escalation_count', count)
      .select('id')
      .maybeSingle();
    if (!claimed) continue;
    const late = Math.max(1, Math.round((nowMs - Date.parse(row.sla_due_at)) / 60_000));
    await notifyStaffSafe(
      `Cargo case ${row.code} is overdue`,
      `${String(row.type).replace(/_/g, ' ')} (${row.severity}) is ${late} min past its SLA and still ${String(row.status).replace(/_/g, ' ')}. Open the case to act on it.`,
      'cargo_exception_escalated',
      { exception_id: row.id, code: row.code, escalation: count + 1 },
    );
    escalated++;
  }
  return escalated;
}

/**
 * Opens a delay case for a shipment whose live ETA (the vehicle's position to its next drop, at
 * the average road speed) is more than CARGO_DELAY_EXCEPTION_MINUTES past the stop's planned
 * arrival. One open delay case per shipment.
 */
export async function detectDelays(nowMs: number = Date.now()): Promise<number> {
  const threshold = settings.CARGO_DELAY_EXCEPTION_MINUTES;
  if (!(threshold > 0)) return 0;
  const { data: routes } = await supabase.from('routes').select('id, vehicle_id').eq('status', 'active').limit(500);
  if (!routes || routes.length === 0) return 0;
  const { data: stops } = await supabase
    .from('route_stops')
    .select('id, route_id, delivery_point_id, planned_arrival_at, status')
    .in('route_id', routes.map((r: any) => r.id))
    .eq('status', 'pending');
  const due = (stops ?? []).filter((s: any) => s.planned_arrival_at);
  if (due.length === 0) return 0;
  const vehicleOf = new Map(routes.map((r: any) => [r.id, r.vehicle_id]));
  const { data: vehicles } = await supabase.from('vehicles').select('id, latitude, longitude').in('id', [...new Set(routes.map((r: any) => r.vehicle_id).filter(Boolean))]);
  const position = new Map((vehicles ?? []).map((v: any) => [v.id, { lat: Number(v.latitude), lng: Number(v.longitude) }]));
  const { data: points } = await supabase.from('delivery_points').select('id, shipment_id, latitude, longitude').in('id', due.map((s: any) => s.delivery_point_id));
  const pointBy = new Map((points ?? []).map((p: any) => [p.id, p]));

  let opened = 0;
  const seen = new Set<string>();
  for (const stop of due) {
    const point: any = pointBy.get(stop.delivery_point_id);
    const vehicleId = vehicleOf.get(stop.route_id);
    const at = vehicleId ? position.get(vehicleId) : undefined;
    if (!point?.shipment_id || seen.has(point.shipment_id) || !at || !isValidPoint(at)) continue;
    const drop = { lat: Number(point.latitude), lng: Number(point.longitude) };
    if (!isValidPoint(drop)) continue;
    const etaMs = nowMs + estimateMinutes(haversineKm(at, drop)) * 60_000;
    const lateMin = Math.round((etaMs - Date.parse(stop.planned_arrival_at)) / 60_000);
    if (lateMin <= threshold) continue;
    seen.add(point.shipment_id);
    let c: Consignment;
    try {
      c = await resolveRef({ shipment_id: point.shipment_id });
    } catch {
      continue;
    }
    if (c.holder !== 'vehicle' || !['picked_up', 'in_transit', 'out_for_delivery'].includes(c.status)) continue;
    const { openExceptionsFor } = await import('./custody.service');
    if ((await openExceptionsFor(c)).some((e: any) => e.type === 'delay')) continue;
    const eta = new Date(etaMs);
    await openException({
      type: 'delay', severity: lateMin > threshold * 2 ? 'high' : 'medium', source: 'eta',
      description: `Live ETA ${eta.toISOString()} is ${lateMin} min past the planned arrival ${stop.planned_arrival_at}.`,
      items: [{ consignment: c, pieces_affected: piecesHeld(c.pieces) }], vehicle_id: vehicleId, route_id: stop.route_id, lat: at.lat, lng: at.lng,
    }, null);
    opened++;
  }
  return opened;
}
