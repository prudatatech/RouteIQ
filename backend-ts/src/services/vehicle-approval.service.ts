/**
 * margixindia — Vehicle approval
 *
 * A vehicle a driver registers from the app (first-login onboarding or "add a
 * vehicle") is `pending_approval` until admin or manager decides:
 *  - approve -> `available`, the vehicle joins dispatch;
 *  - reject  -> `archived`, with the reason kept on the row. Archiving frees the
 *    driver link like any archive (one live vehicle per driver, and endpoints
 *    that look up "the driver's vehicle" never see it), so the vehicle stays tied
 *    to the driver through `submitted_by`: the app shows the reason, and when
 *    they fix the details and submit again the same vehicle goes back to
 *    `pending_approval` and is linked to them again.
 * Who decided and when is recorded on the vehicle and in the audit log, and
 * the driver gets a notification. Vehicles staff create on the web skip all
 * this (they are approved when created).
 *
 * The vehicle stays out of dispatch, bidding and the live map while pending:
 * all of them list the operating statuses (see core/transitions.ts).
 */
import crypto from 'crypto';
import { supabase } from '../core/supabase';
import { HttpError, parseRejectionReason } from '../core/errors';
import { PENDING_VEHICLE_STATUS, VEHICLE_REVIEW_TRANSITIONS, assertTransition } from '../core/transitions';
import { changeVehicleStatus, findDriverPlaceholder, isPlaceholderPlate, isRejected, isTempPlate } from '../core/vehicles';
import type { DriverVehicleRegister } from '../schemas';
import { notificationService } from './notification.service';
import { auditService } from './audit.service';
import { listPhotosFor, listVehiclePhotos, primaryPhoto, type VehiclePhoto } from './vehicle-photos.service';

type Row = Record<string, any>;

export const isUniqueViolation = (e: { code?: string } | null | undefined) => e?.code === '23505';

/** A plate as stored for driver registrations: upper case, without spaces or dashes. */
export function normalizePlate(raw: string): string {
  const upper = raw.trim().toUpperCase();
  if (isPlaceholderPlate(upper)) throw new HttpError(400, 'Enter the real number plate of the vehicle');
  const plate = upper.replace(/[\s-]+/g, '');
  if (!/^[A-Z0-9]{4,20}$/.test(plate)) throw new HttpError(400, 'Number plate can only have letters and digits (4 to 20)');
  return plate;
}

const PLATE_TAKEN = 'This number plate is already registered. If it is your vehicle, ask dispatch to assign it to you.';

// ── The driver's side ───────────────────────────────────────

/**
 * Register the driver's vehicle. The vehicle waits for approval; one live
 * vehicle per driver (migration 20260930009400), so the request:
 *  - fills their TEMP-… placeholder from first login, or
 *  - updates their request that is still waiting (same or corrected plate), or
 *  - resubmits their rejected vehicle (back to pending, review cleared);
 * and is refused when they already have an approved vehicle, or the plate
 * belongs to somebody else.
 */
export async function registerDriverVehicle(driverId: string, input: DriverVehicleRegister): Promise<{ vehicle: Row; created: boolean; resubmitted: boolean }> {
  const plate = normalizePlate(input.plate_number);

  const { data: me, error: meErr } = await supabase.from('users').select('id, full_name, phone').eq('id', driverId).maybeSingle();
  if (meErr) throw meErr;
  if (!me) throw new HttpError(404, 'Driver account not found');

  const { live: liveRows, rejected: rejectedRows } = await loadDriverVehicles(driverId);
  const live = liveRows;
  const approved = live.find(v => !isTempPlate(v.plate_number) && v.status !== PENDING_VEHICLE_STATUS);
  if (approved) throw new HttpError(409, `You already have an approved vehicle (${approved.plate_number}). Ask dispatch if it has to be changed.`);
  const pending = live.find(v => v.status === PENDING_VEHICLE_STATUS);
  const temp = live.find(v => isTempPlate(v.plate_number));

  const { data: same, error: sameErr } = await supabase.from('vehicles').select('id').eq('plate_number', plate).maybeSingle();
  if (sameErr) throw sameErr;
  // The plate must be the driver's own request (waiting), or one of theirs that was rejected and comes back
  if (same && !live.some(v => v.id === same.id) && !rejectedRows.some(v => v.id === same.id)) throw new HttpError(409, PLATE_TAKEN);

  let target: Row | undefined = pending ?? temp ?? rejectedRows[0];
  if (same && same.id !== pending?.id) {
    // The plate of a rejected vehicle of theirs comes back as that vehicle, whichever row would be used otherwise
    if (pending) throw new HttpError(409, 'You already have a vehicle request waiting for approval. Wait for the decision first.');
    target = rejectedRows.find(v => v.id === same.id);
  }

  const now = new Date().toISOString();
  const fields: Row = {
    ...input,
    plate_number: plate,
    status: PENDING_VEHICLE_STATUS,
    driver_id: driverId,
    driver_name: me.full_name ?? null,
    driver_phone: me.phone ?? null,
    submitted_at: now,
    submitted_by: driverId,
    reviewed_at: null,
    reviewed_by: null,
    review_decision: null,
    rejection_reason: null,
  };

  let vehicle: Row;
  const created = !target;
  const wasPending = target?.status === PENDING_VEHICLE_STATUS;
  if (target) {
    // A placeholder still linked would be a second live vehicle for the driver
    if (temp && temp.id !== target.id) await changeVehicleStatus(temp.id, 'archived');
    if (wasPending) fields.submitted_at = target.submitted_at ?? now;
    const { data, error } = await supabase.from('vehicles').update(fields).eq('id', target.id).select('*').single();
    if (isUniqueViolation(error)) throw new HttpError(409, PLATE_TAKEN);
    if (error || !data) throw error ?? new Error('Failed to update the vehicle request');
    vehicle = data;
  } else {
    const { data, error } = await supabase.from('vehicles').insert({ id: crypto.randomUUID(), ...fields }).select('*').single();
    if (isUniqueViolation(error)) throw new HttpError(409, PLATE_TAKEN);
    if (error || !data) throw error ?? new Error('Failed to register the vehicle');
    vehicle = data;
  }

  if (!wasPending) {
    notificationService
      .notifyStaff(
        'New vehicle request',
        `${me.full_name ?? 'A driver'} registered ${plate} and is waiting for approval.`,
        'vehicle_request',
        { vehicle_id: vehicle.id, driver_id: driverId },
      )
      .catch(e => console.error('[vehicles] vehicle request notification failed:', e));
  }
  return { vehicle, created, resubmitted: !!target && !wasPending && isRejected(target) };
}

/**
 * A driver's vehicles: those they drive now (driver_id, not archived), and the
 * ones staff rejected (archived, tied to them by submitted_by), newest decision first.
 */
async function loadDriverVehicles(driverId: string): Promise<{ live: Row[]; rejected: Row[] }> {
  const [driving, submitted] = await Promise.all([
    supabase.from('vehicles').select('*').eq('driver_id', driverId),
    supabase.from('vehicles').select('*').eq('submitted_by', driverId),
  ]);
  if (driving.error) throw driving.error;
  if (submitted.error) throw submitted.error;
  const live = ((driving.data ?? []) as Row[]).filter(v => v.status !== 'archived');
  const rejected = ((submitted.data ?? []) as Row[])
    .filter(v => isRejected(v))
    .sort((a, b) => Date.parse(String(b.reviewed_at ?? 0)) - Date.parse(String(a.reviewed_at ?? 0)));
  return { live, rejected };
}

export type RegistrationState = 'none' | 'pending' | 'approved' | 'rejected';

/**
 * Where the driver's registration stands: the live vehicle (waiting or
 * approved) or else their latest rejected one. A driver whose only vehicle is
 * a TEMP-… placeholder has not registered yet ('none').
 */
export async function getMyRegistration(driverId: string): Promise<{ state: RegistrationState; vehicle: Row | null; photos: VehiclePhoto[] }> {
  const { live: liveRows, rejected: rejectedRows } = await loadDriverVehicles(driverId);
  const vehicle = liveRows.find(v => !isTempPlate(v.plate_number)) ?? rejectedRows[0] ?? null;
  if (!vehicle) return { state: 'none', vehicle: null, photos: [] };
  const state: RegistrationState = vehicle.status === PENDING_VEHICLE_STATUS ? 'pending' : vehicle.status === 'archived' ? 'rejected' : 'approved';
  return { state, vehicle, photos: await listVehiclePhotos(vehicle.id) };
}

// ── The review ──────────────────────────────────────────────

export interface VehicleRequest {
  vehicle: Row;
  driver: { id: string; full_name: string | null; phone: string | null; email: string | null } | null;
  photos: VehiclePhoto[];
  primary_photo_url: string | null;
  submitted_at: string | null;
}

/** Vehicles waiting for a decision, oldest first, with their driver and photos. */
export async function listVehicleRequests(limit = 100): Promise<VehicleRequest[]> {
  const { data, error } = await supabase
    .from('vehicles')
    .select('*')
    .eq('status', PENDING_VEHICLE_STATUS)
    .order('submitted_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  const vehicles: Row[] = data ?? [];
  const driverIds = [...new Set(vehicles.map(v => v.driver_id).filter(Boolean))] as string[];
  const [{ data: drivers }, photos] = await Promise.all([
    driverIds.length ? supabase.from('users').select('id, full_name, phone, email').in('id', driverIds) : Promise.resolve({ data: [] as Row[] }),
    listPhotosFor(vehicles.map(v => v.id)),
  ]);
  const byId = new Map<string, Row>((drivers ?? []).map(d => [d.id, d]));
  return vehicles.map(vehicle => {
    const driver = vehicle.driver_id ? byId.get(vehicle.driver_id) : undefined;
    const list = photos.get(vehicle.id) ?? [];
    return {
      vehicle,
      driver: driver ? { id: driver.id, full_name: driver.full_name ?? null, phone: driver.phone ?? null, email: driver.email ?? null } : null,
      photos: list,
      primary_photo_url: primaryPhoto(list)?.url ?? null,
      submitted_at: vehicle.submitted_at ?? null,
    };
  });
}

export async function countVehicleRequests(): Promise<number> {
  const { count, error } = await supabase.from('vehicles').select('id', { count: 'exact', head: true }).eq('status', PENDING_VEHICLE_STATUS);
  if (error) throw error;
  return count ?? 0;
}

interface Actor { user_id: string; role: string }

async function loadReviewable(vehicleId: string): Promise<Row> {
  const { data, error } = await supabase.from('vehicles').select('*').eq('id', vehicleId).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'Vehicle not found');
  return data;
}

function notifyDriver(vehicle: Row, driverId: string | null, title: string, body: string, decision: 'approved' | 'rejected') {
  if (!driverId) return;
  notificationService
    .sendNotification(driverId, title, body, 'vehicle_approval', { vehicle_id: vehicle.id, decision })
    .catch(e => console.error('[vehicles] driver notification failed:', e));
}

/**
 * Approve a vehicle waiting for approval (or, later, one that was rejected):
 * it becomes available. Refused when its driver already has another live
 * vehicle (one live vehicle per driver); a TEMP-… placeholder is replaced.
 */
export async function approveVehicle(vehicleId: string, actor: Actor): Promise<Row> {
  const vehicle = await loadReviewable(vehicleId);
  const from = String(vehicle.status);
  if (from !== PENDING_VEHICLE_STATUS && !isRejected(vehicle)) throw new HttpError(409, 'This vehicle is not waiting for approval.');
  assertTransition(VEHICLE_REVIEW_TRANSITIONS, 'vehicle', from, 'available');

  // A rejected vehicle was freed from its driver; approving it links them again
  const driverId: string | null = vehicle.driver_id ?? (isRejected(vehicle) ? vehicle.submitted_by ?? null : null);
  if (driverId) {
    const placeholderId = await findDriverPlaceholder(driverId, vehicle.id);
    if (placeholderId) await changeVehicleStatus(placeholderId, 'archived');
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('vehicles')
    .update({ status: 'available', driver_id: driverId, reviewed_by: actor.user_id, reviewed_at: now, review_decision: 'approved', rejection_reason: null })
    .eq('id', vehicleId)
    .eq('status', from)
    .select('*')
    .maybeSingle();
  if (isUniqueViolation(error)) throw new HttpError(409, 'This driver is already assigned to another vehicle. Reassign or archive that vehicle first.');
  if (error) throw error;
  if (!data) throw new HttpError(409, 'This vehicle was already decided by someone else.');

  notifyDriver(data, driverId, 'Vehicle approved', `${data.plate_number} is approved. You can now receive work.`, 'approved');
  await auditService.record('staff-console', actor, 'vehicle_approved', { vehicle_id: vehicleId, plate_number: data.plate_number });
  return data;
}

/**
 * Reject a vehicle waiting for approval: it is archived with the reason, and
 * stays linked to its driver so the app can show why and take a corrected
 * submission.
 */
export async function rejectVehicle(vehicleId: string, actor: Actor, rawReason: unknown): Promise<Row> {
  const reason = parseRejectionReason(rawReason);
  const vehicle = await loadReviewable(vehicleId);
  if (vehicle.status !== PENDING_VEHICLE_STATUS) throw new HttpError(409, 'This vehicle is not waiting for approval.');
  assertTransition(VEHICLE_REVIEW_TRANSITIONS, 'vehicle', PENDING_VEHICLE_STATUS, 'archived');

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('vehicles')
    .update({ status: 'archived', driver_id: null, reviewed_by: actor.user_id, reviewed_at: now, review_decision: 'rejected', rejection_reason: reason })
    .eq('id', vehicleId)
    .eq('status', PENDING_VEHICLE_STATUS)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(409, 'This vehicle was already decided by someone else.');

  notifyDriver(data, vehicle.driver_id ?? vehicle.submitted_by ?? null, 'Vehicle not approved', `${data.plate_number} was not approved: ${reason}`, 'rejected');
  await auditService.record('staff-console', actor, 'vehicle_rejected', { vehicle_id: vehicleId, plate_number: data.plate_number }, reason);
  return data;
}
