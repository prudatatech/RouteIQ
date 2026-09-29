/**
 * margixindia — Vehicle Routes
 * Ports: backend/app/api/v1/endpoints/vehicles.py
 */
import { Router, Request, Response } from 'express';
import { supabase } from '../core/supabase';
import { requireAuth, requireRole } from '../core/auth';
import { cacheGet, cacheSet, cacheDeletePattern } from '../core/redis';
import { STAFF_ROLES, canAccessVehicle, invalidateDriverVehicles } from '../core/ownership';
import { VehicleCreateSchema, VehicleUpdateSchema } from '../schemas';
import crypto from 'crypto';
import { HttpError, sendError } from '../core/errors';
import { idempotent } from '../core/idempotency';
import { notificationService } from '../services/notification.service';
import { parseCoordinate, parseDateTime, parseNumberInRange, parseOptionalText } from '../core/validate';
import { OPERATING_VEHICLE_STATUSES } from '../core/transitions';
import { assertVehicleStatusChange, changeVehicleStatus, isPlaceholderPlate, isTempPlate } from '../core/vehicles';
import { rateLimitByUser } from '../core/rate-limit';
import { holdVehicleAfterSos } from '../services/route.service';
import { capacityService } from '../services/capacity.service';
import { withDriverLicenceStatus } from '../services/people-docs.service';

const router = Router();

/**
 * Normalise a driver phone to E.164 the same way driver OTP login does,
 * so the account created here is the one found at login.
 */
function normalizeDriverPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '').replace(/^0+/, '');
  if (digits.startsWith('91') && digits.length === 12) return '+' + digits;
  if (digits.length === 10) return '+91' + digits;
  return '+' + digits;
}

/**
 * Find or create the driver account for a name and phone, so the vehicle is
 * linked to the person who signs in with that phone. Returns the driver's
 * user id, or null when the account could not be found or created.
 * Drivers sign in with phone OTP, so no password is set; the email matches
 * the one driver OTP login uses for the same phone.
 */
async function resolveDriverUser(name: string, rawPhone: string): Promise<string | null> {
  const phone = normalizeDriverPhone(rawPhone);
  const driverEmail = `driver_${phone.replace(/\+/g, '')}@driver.margixindia.local`;

  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email: driverEmail,
    phone: phone.replace(/\+/g, ''),
    email_confirm: true,
    phone_confirm: true,
    app_metadata: { role: 'driver' },
    user_metadata: { full_name: name, role: 'driver', phone },
  });

  if (authError) {
    console.warn('Failed to create driver auth user:', authError.message);
    // Phone or email already registered: link the existing driver if there is one
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('phone', phone)
      .eq('role', 'driver')
      .maybeSingle();
    return existing?.id ?? null;
  }
  if (!authUser.user) return null;
  // Same profile row driver OTP login creates, so login finds this driver
  await supabase.from('users').upsert({
    id: authUser.user.id,
    email: driverEmail,
    phone,
    role: 'driver',
    full_name: name,
  }, { onConflict: 'id' });
  return authUser.user.id;
}

/**
 * A driver drives one vehicle. Before giving `driverId` the vehicle `vehicleId`
 * (null for one not created yet) look at what they already have: a real vehicle
 * is a 409; a TEMP-… placeholder from their first login is returned so the
 * caller can adopt it (create) or archive it (edit of a different vehicle).
 */
async function findDriverPlaceholder(driverId: string, vehicleId: string | null): Promise<string | null> {
  const { data: owned, error } = await supabase
    .from('vehicles')
    .select('id, plate_number, status')
    .eq('driver_id', driverId)
    .neq('status', 'archived');
  if (error) throw error;
  const others = (owned ?? []).filter(v => v.id !== vehicleId);
  const real = others.find(v => !isTempPlate(v.plate_number));
  if (real) throw new HttpError(409, `This driver is already assigned to ${real.plate_number}. Reassign or archive that vehicle first.`);
  return others[0]?.id ?? null;
}

const isUniqueViolation = (e: { code?: string } | null | undefined) => e?.code === '23505';
const DRIVER_TAKEN = 'This driver is already assigned to another vehicle. Reassign or archive that vehicle first.';

/** Vehicle fields a driver may change on their own vehicle. */
const DRIVER_UPDATABLE_FIELDS = new Set(['declared_load_percentage', 'current_load_kg', 'latitude', 'longitude']);

/** Statuses staff may set with the status endpoint (`on_route` comes from starting a route). */
const STAFF_SETTABLE_STATUSES = ['available', 'idle', 'maintenance', 'offline', 'archived'] as const;

/** Drop cached vehicle lists and driver→vehicle lookups after a write. */
async function invalidateVehicleCaches(): Promise<void> {
  await cacheDeletePattern('vehicles:list:*');
  invalidateDriverVehicles();
}

// ── GET / ──────────────────────────────────────────────────
// Stable order (plate, then id) so skip/limit pages never repeat or miss a
// vehicle. Callers that need every vehicle page through with skip, or pass limit (max 500).
router.get('/', requireAuth, requireRole(...STAFF_ROLES, 'driver'), async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const skip = Math.max(parseInt(req.query.skip as string) || 0, 0);
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 500);

    // Scope the key: drivers get only their own vehicles
    const isDriver = req.user!.role === 'driver';
    const cacheKey = isDriver
      ? `vehicles:list:driver:${req.user!.user_id}:${skip}:${limit}`
      : `vehicles:list:staff:${status}:${skip}:${limit}`;
    const cached = await cacheGet(cacheKey);
    if (cached) { res.json(cached); return; }

    let query = supabase.from('vehicles').select('*');

    if (isDriver) {
      query = query.eq('driver_id', req.user!.user_id);
    } else if (status) {
      query = query.eq('status', status);
    }

    query = query
      .order('plate_number', { ascending: true })
      .order('id', { ascending: true })
      .range(skip, skip + limit - 1);

    const { data: found, error } = await query;
    if (error) throw error;

    // Warning data for dispatch: the state of each driver's licence
    const vehicles = await withDriverLicenceStatus(found || []);
    await cacheSet(cacheKey, vehicles, 30);
    res.json(vehicles);
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── POST / ─────────────────────────────────────────────────
router.post('/', requireAuth, requireRole('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const parsed = VehicleCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ detail: parsed.error.issues[0].message });
      return;
    }

    const insertData: any = { ...parsed.data };

    // If driver details are provided, link (or create) the driver user.
    // A saved draft (archived) is not assigned to anyone yet, so it links no driver.
    const isDraft = insertData.status === 'archived';
    if (!isDraft && insertData.driver_phone && insertData.driver_name) {
      const driverId = await resolveDriverUser(insertData.driver_name, insertData.driver_phone);
      if (driverId) insertData.driver_id = driverId;
    }

    // A driver who signed in before any vehicle was registered has a TEMP-…
    // placeholder. The vehicle registered here replaces it rather than
    // becoming the driver's second vehicle.
    if (!isDraft && insertData.driver_id) {
      const placeholderId = await findDriverPlaceholder(insertData.driver_id, null);
      if (placeholderId) {
        const { id: _ignored, ...fields } = insertData;
        const { data: adopted, error: adoptError } = await supabase
          .from('vehicles')
          .update(fields)
          .eq('id', placeholderId)
          .select()
          .single();
        if (isUniqueViolation(adoptError)) throw new HttpError(409, DRIVER_TAKEN);
        if (adoptError) throw adoptError;
        await invalidateVehicleCaches();
        res.status(201).json(adopted);
        return;
      }
    }

    if (!insertData.id) {
      insertData.id = crypto.randomUUID();
    }

    const { data: vehicle, error } = await supabase
      .from('vehicles')
      .insert(insertData)
      .select()
      .single();

    if (isUniqueViolation(error) && insertData.driver_id) throw new HttpError(409, DRIVER_TAKEN);
    if (error) throw error;

    await invalidateVehicleCaches();
    res.status(201).json(vehicle);
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── GET /summary ───────────────────────────────────────────
// Counts the fleet the way the Fleet list shows it: placeholder vehicles
// (TEMP-… from a driver's first login, DRFT-… saved wizard drafts) are not
// fleet assets, so they are counted apart as `drafts` and stay out of every
// other number. `total` is the active fleet (archived vehicles are counted
// under `archived`).
router.get('/summary', requireAuth, requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    const { data: vehicles, error } = await supabase
      .from('vehicles')
      .select('status, plate_number');

    if (error) throw error;

    const counts: Record<string, number> = {};
    let drafts = 0;
    for (const v of vehicles || []) {
      if (isPlaceholderPlate(v.plate_number)) {
        // An archived TEMP-… row is a replaced placeholder, not a pending draft
        if (!(isTempPlate(v.plate_number) && v.status === 'archived')) drafts++;
        continue;
      }
      counts[v.status] = (counts[v.status] || 0) + 1;
    }

    const archived = counts['archived'] || 0;
    const total = Object.values(counts).reduce((a, b) => a + b, 0) - archived;
    res.json({
      total,
      active: counts['on_route'] || 0,
      idle: (counts['idle'] || 0) + (counts['available'] || 0),
      maintenance: counts['maintenance'] || 0,
      offline: counts['offline'] || 0,
      archived,
      drafts,
    });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── GET /:vehicle_id ───────────────────────────────────────
router.get('/:vehicle_id', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!(await canAccessVehicle(req.user!, req.params.vehicle_id))) {
      res.status(403).json({ detail: 'Not authorized to view this vehicle' });
      return;
    }
    const { data: vehicle, error } = await supabase
      .from('vehicles')
      .select('*')
      .eq('id', req.params.vehicle_id)
      .single();

    if (error || !vehicle) {
      res.status(404).json({ detail: 'Vehicle not found' });
      return;
    }

    res.json(vehicle);
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── PATCH /:vehicle_id ─────────────────────────────────────
router.patch('/:vehicle_id', requireAuth, requireRole('driver', 'admin', 'manager'), idempotent('vehicle-update'), async (req: Request, res: Response) => {
  try {
    const parsed = VehicleUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ detail: parsed.error.issues[0].message });
      return;
    }

    if (!(await canAccessVehicle(req.user!, req.params.vehicle_id))) {
      return res.status(403).json({ detail: 'Not authorized to update this vehicle' });
    }

    // Filter undefined values; drivers may only report load and position
    const isDriver = req.user!.role === 'driver';
    const updateData: Record<string, any> = {};
    for (const [key, value] of Object.entries(parsed.data)) {
      if (value === undefined) continue;
      if (isDriver && !DRIVER_UPDATABLE_FIELDS.has(key)) continue;
      updateData[key] = value;
    }

    const { data: current, error: currentErr } = await supabase
      .from('vehicles')
      .select('id, status, capacity_kg, driver_id, driver_name, driver_phone')
      .eq('id', req.params.vehicle_id)
      .maybeSingle();
    if (currentErr) throw currentErr;
    if (!current) {
      res.status(404).json({ detail: 'Vehicle not found' });
      return;
    }

    // A status is only changed when it differs from the stored one, and only
    // along an allowed transition (see VEHICLE_STATUS_TRANSITIONS). An edit
    // form that echoes the status it loaded therefore changes nothing.
    if (updateData.status !== undefined) {
      if (updateData.status === current.status) {
        delete updateData.status;
      } else {
        await assertVehicleStatusChange(current.id, String(current.status), updateData.status);
        if (updateData.status === 'archived') updateData.driver_id = null;
      }
    }

    // Editing the driver's name or phone links the driver account the same way creating does.
    if (!isDriver && (updateData.status ?? current.status) !== 'archived') {
      const phone = updateData.driver_phone !== undefined ? updateData.driver_phone : current.driver_phone;
      const name = updateData.driver_name !== undefined ? updateData.driver_name : current.driver_name;
      const phoneChanged = updateData.driver_phone !== undefined && updateData.driver_phone !== current.driver_phone;
      if (updateData.driver_phone === null || updateData.driver_phone === '') {
        if (updateData.driver_id === undefined) updateData.driver_id = null;
      } else if (phone && name && (phoneChanged || !current.driver_id) && updateData.driver_id === undefined) {
        const driverId = await resolveDriverUser(name, phone);
        if (driverId) updateData.driver_id = driverId;
      }
      if (updateData.driver_id && updateData.driver_id !== current.driver_id) {
        const placeholderId = await findDriverPlaceholder(updateData.driver_id, current.id);
        // The driver's TEMP-… stand-in is replaced by this vehicle
        if (placeholderId) await supabase.from('vehicles').update({ status: 'archived', driver_id: null }).eq('id', placeholderId);
      }
    }

    // If declared_load_percentage is provided, update available_capacity_kg
    if (updateData.declared_load_percentage !== undefined && updateData.declared_load_percentage !== null) {
      if (current.capacity_kg) {
        const used = (updateData.declared_load_percentage / 100) * current.capacity_kg;
        const available = Math.max(0, current.capacity_kg - used);
        updateData.available_capacity_kg = available;

        // If they declared 0% load, they are fully available
        // (a vehicle in maintenance or archived is only changed by staff, never by a load report)
        if (updateData.declared_load_percentage === 0 && updateData.status === undefined
          && (!current.status || (OPERATING_VEHICLE_STATUSES as readonly string[]).includes(String(current.status)))) {
          updateData.status = 'available';
        }
      }
    }

    const { data: vehicle, error } = await supabase
      .from('vehicles')
      .update(updateData)
      .eq('id', req.params.vehicle_id)
      .select()
      .single();

    if (isUniqueViolation(error)) throw new HttpError(409, DRIVER_TAKEN);
    if (error) {
      console.error('Vehicle update error:', error);
      throw error;
    }
    if (!vehicle) {
      res.status(404).json({ detail: 'Vehicle not found' });
      return;
    }
    // A renamed driver keeps one name across the vehicle and their account
    const linkedDriver = vehicle.driver_id;
    if (!isDriver && linkedDriver && updateData.driver_name && updateData.driver_name !== current.driver_name) {
      await supabase.from('users').update({ full_name: updateData.driver_name }).eq('id', linkedDriver).eq('role', 'driver');
    }

    await invalidateVehicleCaches();
    res.json(vehicle);
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── POST /:vehicle_id/status ────────────────────────────────
// Staff change a vehicle's status on purpose: send it to maintenance, return
// it to service (maintenance -> available or idle), archive or unarchive it.
// Allowed moves are in VEHICLE_STATUS_TRANSITIONS; `on_route` is never set by hand.
router.post('/:vehicle_id/status', requireAuth, requireRole('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const next = req.body?.status;
    if (typeof next !== 'string' || !(STAFF_SETTABLE_STATUSES as readonly string[]).includes(next)) {
      throw new HttpError(400, `status must be one of: ${STAFF_SETTABLE_STATUSES.join(', ')}`);
    }
    const change = await changeVehicleStatus(req.params.vehicle_id, next);
    await invalidateVehicleCaches();
    const { data: vehicle } = await supabase.from('vehicles').select('*').eq('id', req.params.vehicle_id).maybeSingle();
    res.json({ ...change, vehicle });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── POST /:vehicle_id/archive and /unarchive ────────────────
for (const [action, target] of [['archive', 'archived'], ['unarchive', 'idle']] as const) {
  router.post(`/:vehicle_id/${action}`, requireAuth, requireRole('admin', 'manager'), async (req: Request, res: Response) => {
    try {
      const { data: existing } = await supabase.from('vehicles').select('status').eq('id', req.params.vehicle_id).maybeSingle();
      if (action === 'unarchive' && existing && existing.status !== 'archived') {
        throw new HttpError(409, 'This vehicle is not archived.');
      }
      const change = await changeVehicleStatus(req.params.vehicle_id, target);
      await invalidateVehicleCaches();
      res.json(change);
    } catch (e: any) {
      sendError(req, res, e);
    }
  });
}

const SOS_ALERT_TYPES = ['panic_button', 'accident', 'breakdown', 'medical', 'theft', 'other'];

// ── POST /:vehicle_id/sos (Emergency Alert) ───────────────
// Staff raise an SOS on a driver's behalf here (the driver app uses
// POST /telemetry/sos/trigger). The alert keeps the vehicle's driver as
// `driver_id`; who raised it is stated at the start of the description,
// since sos_alerts has no column for it. At most 5 alerts a minute per user.
router.post('/:vehicle_id/sos', requireAuth, requireRole('driver', 'admin', 'manager'), rateLimitByUser('vehicle-sos', 5, 60), async (req: Request, res: Response) => {
  try {
    // Ensure the driver is reporting for their own vehicle unless admin
    if (!(await canAccessVehicle(req.user!, req.params.vehicle_id))) {
      return res.status(403).json({ detail: 'Not authorized to report for this vehicle' });
    }
    const requestedType = req.body?.alert_type ?? 'panic_button';
    if (typeof requestedType !== 'string' || ![...SOS_ALERT_TYPES, 'sos'].includes(requestedType)) {
      throw new HttpError(400, `alert_type must be one of: ${SOS_ALERT_TYPES.join(', ')}`);
    }
    const alertType = requestedType === 'sos' ? 'panic_button' : requestedType;
    const severity = req.body?.severity ?? null;
    if (severity !== null && !['serious', 'minor'].includes(severity)) throw new HttpError(400, 'severity must be serious or minor');
    const description = parseOptionalText(req.body?.description, 'description', 500);
    const latitude = parseCoordinate(req.body?.latitude, 'latitude', 90);
    const longitude = parseCoordinate(req.body?.longitude, 'longitude', 180);

    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('plate_number, driver_name, driver_id')
      .eq('id', req.params.vehicle_id)
      .maybeSingle();

    const byDriver = req.user!.role === 'driver';
    let raisedBy = '';
    if (!byDriver) {
      const { data: staffUser } = await supabase.from('users').select('full_name').eq('id', req.user!.user_id).maybeSingle();
      raisedBy = `[Raised by staff${staffUser?.full_name ? `: ${staffUser.full_name}` : ''}] `;
    }
    const body = description || (byDriver ? 'Driver triggered SOS emergency alert' : 'Staff raised an SOS emergency alert');

    const { data: alert, error } = await supabase.from('sos_alerts').insert({
      driver_id: byDriver ? req.user!.user_id : (vehicle?.driver_id ?? null),
      vehicle_id: req.params.vehicle_id,
      alert_type: alertType,
      description: `${raisedBy}${body}`,
      latitude,
      longitude,
      status: 'active',
      ...(severity ? { severity } : {}),
    }).select().single();

    if (error) throw error;

    // The alert itself signals the emergency; the vehicle keeps its status (and keeps
    // reporting its position) unless this is a serious breakdown or accident.
    await holdVehicleAfterSos(req.params.vehicle_id, alertType, severity);

    // Notifications are informative; a failure must not undo the SOS report.
    notificationService
      .notifyStaff(
        'SOS',
        `${vehicle?.driver_name ?? 'A driver'} on ${vehicle?.plate_number ?? 'a vehicle'} triggered an SOS: ${alert.description}`,
        'sos',
        { alert_id: alert.id, vehicle_id: req.params.vehicle_id },
      )
      .catch(e => console.error('[vehicles] SOS notification failed:', e));

    res.status(201).json(alert);
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── POST /:vehicle_id/return-trip ───────────────────────────
router.post('/:vehicle_id/return-trip', requireAuth, requireRole('driver', 'admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};

    if (!(await canAccessVehicle(req.user!, req.params.vehicle_id))) {
      return res.status(403).json({ detail: 'Not authorized to report for this vehicle' });
    }

    // The bidding window: opens now or later, closes within a day, never below a real floor price
    const opensAt = body.opens_at ? parseDateTime(body.opens_at, 'opens_at') : new Date().toISOString();
    const closesAt = body.closes_at
      ? parseDateTime(body.closes_at, 'closes_at')
      : new Date(new Date(opensAt).getTime() + 2 * 60 * 60 * 1000).toISOString(); // 2 hours default
    const length = new Date(closesAt).getTime() - new Date(opensAt).getTime();
    if (length <= 0) throw new HttpError(400, 'The window must close after it opens');
    if (length > 24 * 60 * 60 * 1000) throw new HttpError(400, 'A bidding window can stay open for at most 24 hours');
    if (new Date(closesAt).getTime() <= Date.now()) throw new HttpError(400, 'The window must close in the future');
    // No price given: each bid is checked against the pricing engine for its own weight
    const floorPrice = body.floor_price === undefined || body.floor_price === null
      ? null
      : parseNumberInRange(body.floor_price, 'floor_price', 1, 1_000_000);

    // One way to open a window: checks the vehicle, free space and an already-open window
    const window = await capacityService.openWindow({
      vehicleId: req.params.vehicle_id,
      triggerType: 'return_trip',
      floorPrice,
      opensAt,
      closesAt,
      createdBy: req.user!.user_id,
    });

    res.status(201).json(window);
  } catch (e: any) {
    sendError(req, res, e);
  }
});

/** True when the vehicle has finished work on record: completed routes, delivered manifests, or invoices. */
async function vehicleHasHistory(vehicleId: string): Promise<boolean> {
  const { data: completed, error } = await supabase.from('routes').select('id').eq('vehicle_id', vehicleId).eq('status', 'completed').limit(1);
  if (error) throw error;
  if (completed && completed.length > 0) return true;

  const { data: manifests, error: mErr } = await supabase.from('cargo_manifest').select('id, status').eq('vehicle_id', vehicleId);
  if (mErr) throw mErr;
  if ((manifests ?? []).some(m => m.status === 'delivered' || m.status === 'completed')) return true;
  if (manifests && manifests.length > 0) {
    const { data: invoices, error: iErr } = await supabase.from('invoices').select('id').in('manifest_id', manifests.map(m => m.id)).limit(1);
    if (iErr) throw iErr;
    if (invoices && invoices.length > 0) return true;
  }
  return false;
}

// ── DELETE /:vehicle_id ────────────────────────────────────
// A vehicle with finished work on record is archived, so its trips, invoices
// and earnings keep their vehicle. Only a vehicle without any history is removed.
router.delete('/:vehicle_id', requireAuth, requireRole('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const vehicleId = req.params.vehicle_id;

    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('id, status')
      .eq('id', vehicleId)
      .single();

    if (!vehicle) {
      res.status(404).json({ detail: 'Vehicle not found' });
      return;
    }

    const { data: activeRoutes } = await supabase
      .from('routes')
      .select('id')
      .eq('vehicle_id', vehicleId)
      .eq('status', 'active');

    if (vehicle.status === 'on_route' || (activeRoutes && activeRoutes.length > 0)) {
      res.status(409).json({ detail: "This vehicle is on an active route and can't be deleted. Wait for the route to finish, or cancel it first." });
      return;
    }

    if (await vehicleHasHistory(vehicleId)) {
      const change = await changeVehicleStatus(vehicleId, 'archived');
      await invalidateVehicleCaches();
      res.status(200).json({ archived: true, id: vehicleId, status: change.status, detail: 'This vehicle has trips on record, so it was archived instead of deleted.' });
      return;
    }

    // Delete dependent objects (no CASCADE in DB schema)
    // 1. Get route IDs
    const { data: routeRows } = await supabase
      .from('routes')
      .select('id')
      .eq('vehicle_id', vehicleId);

    if (routeRows && routeRows.length > 0) {
      const routeIds = routeRows.map((r: any) => r.id);
      await supabase.from('route_stops').delete().in('route_id', routeIds);
      await supabase.from('routes').delete().in('id', routeIds);
    }

    // 2. Delete telemetry, maintenance alerts, stoppages, GPS points
    await supabase.from('telemetry').delete().eq('vehicle_id', vehicleId);
    await supabase.from('maintenance_alerts').delete().eq('vehicle_id', vehicleId);
    await supabase.from('vehicle_stoppages').delete().eq('vehicle_id', vehicleId);
    await supabase.from('gps_points').delete().eq('vehicle_id', vehicleId);

    // 3. Delete vehicle
    await supabase.from('vehicles').delete().eq('id', vehicleId);

    await invalidateVehicleCaches();
    res.status(204).send();
  } catch (e: any) {
    sendError(req, res, e);
  }
});

export default router;
