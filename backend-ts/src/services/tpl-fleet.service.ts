/**
 * margixindia — A 3PL partner's own fleet (docs/network-design.md, section 2).
 *
 * The fleet is the same `vehicles` table as a company's, with carrier_org_id = the partner's organisation: the
 * same validation (VehicleCreateSchema / VehicleUpdateSchema), the same plate rules and status moves. What differs:
 *   - there is no approval queue: a vehicle is usable (status available) the moment its RC and insurance numbers
 *     are filled in; until then it waits as pending_approval and no dispatch picks it up;
 *   - drivers are invited by phone (the people flow) and join the partner organisation, not a company;
 *   - the company that works with the partner sees counts only (fleetSummary), never the partner's documents.
 */
import crypto from 'crypto';
import { z } from 'zod';
import { supabase } from '../core/supabase';
import { HttpError } from '../core/errors';
import { indianDateKey } from '../core/istDate';
import { cacheDeletePattern } from '../core/redis';
import { invalidateDriverVehicles } from '../core/ownership';
import { PENDING_VEHICLE_STATUS } from '../core/transitions';
import { assertVehicleStatusChange, isPlaceholderPlate } from '../core/vehicles';
import { VehicleCreateSchema, VehicleUpdateSchema } from '../schemas';
import { normalizePlate } from './vehicle-approval.service';
import { createPerson } from './people.service';
import { assertAffiliated, legacyPartnerIdOf } from './tpl-affiliation';
import type { Actor } from './people-common';

/** Days ahead at which a document counts as expiring. */
export const EXPIRING_DAYS = 30;

/** What a partner may send when adding a vehicle: the shared schema without the fields that are not theirs to set. */
export const PartnerVehicleCreateSchema = VehicleCreateSchema.omit({ status: true, driver_name: true, driver_phone: true, current_load_kg: true });
export const PartnerVehicleUpdateSchema = VehicleUpdateSchema.omit({
  driver_name: true, driver_phone: true, latitude: true, longitude: true, declared_load_percentage: true, current_load_kg: true,
});

/** `name` is accepted for `full_name` (the web form calls it that). */
export const DriverInviteSchema = z.object({
  full_name: z.string().trim().optional(),
  name: z.string().trim().optional(),
  phone: z.string({ invalid_type_error: 'A driver needs a phone number: they sign in with an OTP sent to it', required_error: 'A driver needs a phone number: they sign in with an OTP sent to it' }).trim().min(5, 'Enter a valid phone number').max(30),
}).strict().transform(v => ({ full_name: v.full_name || v.name || '', phone: v.phone }))
  .refine(v => v.full_name.length >= 2 && v.full_name.length <= 100, { message: 'Name must be 2 to 100 characters', path: ['full_name'] });

type VehicleRow = Record<string, any>;

// ── Documents ────────────────────────────────────────────────────────

const DOCS = [
  { key: 'rc', label: 'RC', number: 'rc_number', expiry: 'rc_expiry', required: true },
  { key: 'insurance', label: 'Insurance', number: 'insurance_number', expiry: 'insurance_expiry', required: true },
  { key: 'fitness', label: 'Fitness', number: 'fitness_certificate_number', expiry: 'fitness_expiry', required: false },
  { key: 'permit', label: 'Permit', number: 'permit_number', expiry: 'permit_expiry', required: false },
  { key: 'puc', label: 'PUC', number: 'puc_number', expiry: 'puc_expiry', required: false },
] as const;

export type DocState = 'ok' | 'expiring' | 'expired' | 'missing' | 'not_recorded';

export interface DocStatus { key: string; label: string; number: string | null; expiry: string | null; status: DocState }

const blank = (v: unknown) => v == null || String(v).trim() === '';

/** The state of each document of a vehicle: required ones are `missing` without a number, optional ones `not_recorded`. */
export function documentStatuses(vehicle: VehicleRow, today = indianDateKey(new Date())): DocStatus[] {
  const soon = new Date(Date.parse(`${today}T00:00:00Z`) + EXPIRING_DAYS * 86_400_000).toISOString().slice(0, 10);
  return DOCS.map(d => {
    const number = blank(vehicle[d.number]) ? null : String(vehicle[d.number]).trim();
    const expiry = blank(vehicle[d.expiry]) ? null : String(vehicle[d.expiry]).slice(0, 10);
    let status: DocState;
    if (!number) status = d.required ? 'missing' : 'not_recorded';
    else if (expiry && expiry < today) status = 'expired';
    else if (expiry && expiry <= soon) status = 'expiring';
    else status = 'ok';
    return { key: d.key, label: d.label, number, expiry, status };
  });
}

/** A vehicle can take work once its RC and insurance numbers are on file. */
export const hasRequiredDocuments = (vehicle: VehicleRow): boolean => !blank(vehicle.rc_number) && !blank(vehicle.insurance_number);

const vehicleView = (v: VehicleRow) => {
  const documents = documentStatuses(v);
  const states = documents.map(d => d.status);
  return {
    ...v,
    documents,
    docs_status: states.includes('expired') ? 'expired' : states.includes('missing') ? 'missing' : states.includes('expiring') ? 'expiring' : 'ok',
    usable: v.status !== PENDING_VEHICLE_STATUS && v.status !== 'archived' && hasRequiredDocuments(v),
  };
};

async function invalidateVehicleCaches(driverId?: string): Promise<void> {
  await cacheDeletePattern('vehicles:list:*');
  invalidateDriverVehicles(driverId);
}

// ── The partner's vehicles ───────────────────────────────────────────

export async function listVehicles(orgId: string) {
  const { data, error } = await supabase.from('vehicles').select('*').eq('carrier_org_id', orgId)
    .order('plate_number', { ascending: true }).order('id', { ascending: true });
  if (error) throw new Error(`Failed to load vehicles: ${error.message}`);
  return (data ?? []).filter(v => !isPlaceholderPlate(v.plate_number)).map(vehicleView);
}

const isUnique = (e: { code?: string } | null | undefined) => e?.code === '23505';
const PLATE_TAKEN = 'This number plate is already registered';
const DRIVER_TAKEN = 'This driver is already assigned to another vehicle. Reassign or archive that vehicle first.';

function parseInput<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new HttpError(422, issue?.message ?? 'The request is not valid', issue?.path.length ? { field: String(issue.path[0]) } : undefined);
  }
  return result.data;
}

export async function createVehicle(orgId: string, userId: string, body: unknown) {
  const parsed = parseInput(PartnerVehicleCreateSchema, body);
  const now = new Date().toISOString();
  const ready = hasRequiredDocuments(parsed);
  const row = {
    ...parsed,
    id: crypto.randomUUID(),
    plate_number: normalizePlate(parsed.plate_number),
    carrier_org_id: orgId, // always the partner's own organisation, whatever the body says
    status: ready ? 'available' : PENDING_VEHICLE_STATUS,
    review_decision: ready ? 'approved' : null,
    reviewed_at: ready ? now : null,
    submitted_by: userId,
    submitted_at: now,
  };
  const { data, error } = await supabase.from('vehicles').insert(row).select().single();
  if (isUnique(error)) throw new HttpError(409, PLATE_TAKEN);
  if (error) throw new Error(`Failed to add the vehicle: ${error.message}`);
  await invalidateVehicleCaches();
  return vehicleView(data);
}

async function ownVehicle(orgId: string, vehicleId: string): Promise<VehicleRow> {
  const { data, error } = await supabase.from('vehicles').select('*').eq('id', vehicleId).eq('carrier_org_id', orgId).maybeSingle();
  if (error) throw new Error(`Failed to load the vehicle: ${error.message}`);
  if (!data) throw new HttpError(404, 'Vehicle not found');
  return data;
}

/** A driver of the partner organisation (active member, driver role), or a 422. */
async function ownDriver(orgId: string, driverId: string): Promise<{ id: string; full_name: string | null; phone: string | null }> {
  const { data: seat, error } = await supabase.from('org_members').select('user_id, role')
    .eq('org_id', orgId).eq('user_id', driverId).eq('status', 'active').maybeSingle();
  if (error) throw new Error(`Failed to check the driver: ${error.message}`);
  const { data: user } = seat ? await supabase.from('users').select('id, full_name, phone, role').eq('id', driverId).maybeSingle() : { data: null };
  if (!seat || !user || user.role !== 'driver') throw new HttpError(422, 'Choose one of your own drivers', { field: 'driver_id' });
  return user;
}

export async function updateVehicle(orgId: string, vehicleId: string, body: unknown) {
  const parsed = parseInput(PartnerVehicleUpdateSchema, body);
  const current = await ownVehicle(orgId, vehicleId);
  const patch: Record<string, any> = {};
  for (const [k, v] of Object.entries(parsed)) if (v !== undefined) patch[k] = v;
  if (patch.plate_number !== undefined) patch.plate_number = normalizePlate(patch.plate_number);

  const merged = { ...current, ...patch };
  if (current.status === PENDING_VEHICLE_STATUS) {
    // Waiting for its documents: complete ones make it usable, and a status cannot be forced before that
    if (hasRequiredDocuments(merged)) {
      patch.status = 'available';
      patch.review_decision = 'approved';
      patch.reviewed_at = new Date().toISOString();
    } else if (patch.status !== undefined) {
      throw new HttpError(409, 'Add the RC and insurance numbers first. The vehicle can take work after that');
    }
  } else if (patch.status !== undefined && patch.status !== current.status) {
    await assertVehicleStatusChange(current.id, String(current.status), patch.status);
    if (patch.status === 'archived') patch.driver_id = null;
  } else {
    delete patch.status;
  }

  if (patch.driver_id) {
    const driver = await ownDriver(orgId, patch.driver_id);
    patch.driver_name = driver.full_name;
    patch.driver_phone = driver.phone;
  } else if (patch.driver_id === null) {
    patch.driver_name = null;
    patch.driver_phone = null;
  }
  if (Object.keys(patch).length === 0) return vehicleView(current);

  const { data, error } = await supabase.from('vehicles').update(patch).eq('id', vehicleId).eq('carrier_org_id', orgId).select().maybeSingle();
  if (isUnique(error)) throw new HttpError(409, patch.driver_id ? DRIVER_TAKEN : PLATE_TAKEN);
  if (error) throw new Error(`Failed to update the vehicle: ${error.message}`);
  if (!data) throw new HttpError(404, 'Vehicle not found');
  await invalidateVehicleCaches();
  return vehicleView(data);
}

// ── Drivers ──────────────────────────────────────────────────────────

/** The partner's drivers, each with the vehicle they are assigned to. */
export async function listDrivers(orgId: string) {
  const { data: seats, error } = await supabase.from('org_members').select('user_id').eq('org_id', orgId).eq('role', 'driver').eq('status', 'active');
  if (error) throw new Error(`Failed to load drivers: ${error.message}`);
  const ids = (seats ?? []).map(s => s.user_id as string);
  if (ids.length === 0) return [];
  const [{ data: users, error: uErr }, { data: vehicles, error: vErr }] = await Promise.all([
    supabase.from('users').select('id, full_name, phone, status, is_active, role').in('id', ids).eq('role', 'driver'),
    supabase.from('vehicles').select('id, plate_number, driver_id, status').in('driver_id', ids).eq('carrier_org_id', orgId),
  ]);
  if (uErr) throw new Error(`Failed to load drivers: ${uErr.message}`);
  if (vErr) throw new Error(`Failed to load drivers: ${vErr.message}`);
  const byDriver = new Map((vehicles ?? []).filter(v => v.status !== 'archived').map(v => [v.driver_id as string, v]));
  return (users ?? [])
    .map(u => ({
      id: u.id, full_name: u.full_name, phone: u.phone, status: u.status, is_active: u.is_active,
      vehicle: byDriver.has(u.id) ? { id: byDriver.get(u.id)!.id, plate_number: byDriver.get(u.id)!.plate_number } : null,
    }))
    .sort((a, b) => String(a.full_name ?? '').localeCompare(String(b.full_name ?? '')));
}

/**
 * Invites a driver by phone with the existing people flow: the driver signs in with an OTP sent to the phone, joins the
 * partner organisation, and people.profile.employer_partner_id is set to the partner row for the older screens.
 */
export async function inviteDriver(actor: Actor, orgId: string, body: unknown) {
  const { full_name, phone } = parseInput(DriverInviteSchema, body);
  const partnerId = await legacyPartnerIdOf(orgId);
  return createPerson(actor, {
    role: 'driver', full_name, phone,
    ...(partnerId ? { employer_type: 'partner', employer_partner_id: partnerId } : {}),
  }, { partnerOrgId: orgId });
}

// ── What a company sees of a partner's fleet ─────────────────────────

export interface FleetSummary {
  vehicles_total: number;
  available: number;
  on_trip: number;
  maintenance: number;
  by_class: Record<string, number>;
  /** Vehicles whose RC and insurance are on file and with no document expired or expiring. */
  docs_ok: number;
  /** Vehicles with a document that expires within EXPIRING_DAYS. */
  docs_expiring: number;
  docs_expired: number;
  /** Vehicles without an RC or insurance number. */
  docs_missing: number;
}

/** Counts of a partner's vehicles: never a plate, a number or a document. */
export function summarizeFleet(vehicles: VehicleRow[], today = indianDateKey(new Date())): FleetSummary {
  const out: FleetSummary = { vehicles_total: 0, available: 0, on_trip: 0, maintenance: 0, by_class: {}, docs_ok: 0, docs_expiring: 0, docs_expired: 0, docs_missing: 0 };
  for (const v of vehicles) {
    if (v.status === 'archived' || isPlaceholderPlate(v.plate_number)) continue;
    out.vehicles_total++;
    if (v.status === 'available' || v.status === 'idle') out.available++;
    else if (v.status === 'on_route') out.on_trip++;
    else if (v.status === 'maintenance') out.maintenance++;
    const cls = String(v.vehicle_type ?? 'other');
    out.by_class[cls] = (out.by_class[cls] ?? 0) + 1;
    const states = documentStatuses(v, today).map(d => d.status);
    if (states.includes('missing')) out.docs_missing++;
    if (states.includes('expired')) out.docs_expired++;
    if (states.includes('expiring')) out.docs_expiring++;
    if (!states.some(s => s === 'missing' || s === 'expired' || s === 'expiring')) out.docs_ok++;
  }
  return out;
}

/** The company's view of one partner's fleet: counts only, and only for a partner it works with. */
export async function fleetSummaryFor(companyOrgId: string, tplOrgId: string): Promise<FleetSummary> {
  const link = await assertAffiliated(companyOrgId, tplOrgId);
  if (link.status !== 'active' && link.status !== 'paused') throw new HttpError(404, 'Partner not found');
  const { data, error } = await supabase.from('vehicles')
    .select('id, plate_number, status, vehicle_type, rc_number, rc_expiry, insurance_number, insurance_expiry, fitness_certificate_number, fitness_expiry, permit_number, permit_expiry, puc_number, puc_expiry')
    .eq('carrier_org_id', tplOrgId);
  if (error) throw new Error(`Failed to load partner vehicles: ${error.message}`);
  return summarizeFleet(data ?? []);
}
