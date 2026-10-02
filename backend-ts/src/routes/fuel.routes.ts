/**
 * margixindia — Fuel log routes, mounted under /api/v1/fleet
 *
 * Every fill-up of a vehicle, with or without a bill, the mileage worked out from them and the
 * anomalies found. Staff can do everything. A driver can log fuel for, and read the log of,
 * their own vehicle. See services/fuel-engine.ts for the maths.
 */
import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../core/supabase';
import { settings } from '../core/config';
import { requireAuth, requireRole } from '../core/auth';
import { STAFF_ROLES, canAccessVehicle, isStaff } from '../core/ownership';
import { guardOfVehicle, visibleVehicleIds } from '../core/org-guards';
import { HttpError, sendError } from '../core/errors';
import { isUuid } from '../core/validate';
import { indianDateKey } from '../core/istDate';
import { rateLimitByUser } from '../core/rate-limit';
import { idempotent } from '../core/idempotency';
import { auditService } from '../services/audit.service';
import { TPL_UPLOAD_CONTENT_TYPES } from '../services/tpl.service';
import { cacheDeletePattern } from '../core/redis';
import { FUEL_FLAGS, FuelInputError, analyzeFills, odometerProblem, resolveAmounts, type FuelFlag } from '../services/fuel-engine';
import {
  FUEL_LOG_COLUMNS, PAYMENT_MODES, getFleetSummary, getVehicleStats, loadLogs, loadVehicle, newestFirst, normalizeLog, recomputeVehicle, toFill,
  type FuelLogRow, type FuelVehicle,
} from '../services/fuel.service';
import { carrierStamp } from '../core/org-context';

const router = Router();
const staff = [requireAuth, requireRole(...STAFF_ROLES)] as const;

/** Clock differences between a phone and the server are allowed for this long. */
const FUTURE_SLACK_MS = 5 * 60 * 1000;
/** A driver can log a fill-up made in the last week; older ones are entered by staff. */
const DRIVER_BACKDATE_MS = 7 * 24 * 60 * 60 * 1000;
const BILL_PATH_RE = /^expenses\/[\w-]+\/[\w.-]+$/;

const positive = (label: string) => z.number({ invalid_type_error: `${label} must be a number` }).positive(`${label} must be more than 0`).max(1e9);

const FuelBody = z.object({
  litres: positive('Litres').optional(),
  price_per_litre: positive('Price per litre').max(10000).optional(),
  total_amount: positive('Total amount').optional(),
  filled_at: z.string().datetime({ offset: true, message: 'Enter the date and time of the fill' }).optional(),
  odometer_km: z.number({ invalid_type_error: 'Odometer must be a number' }).min(0).max(9_999_999).nullable().optional(),
  is_full_tank: z.boolean().optional(),
  station_name: z.string().trim().max(120).nullable().optional(),
  payment_mode: z.enum(PAYMENT_MODES).optional(),
  fill_latitude: z.number().min(-90).max(90).nullable().optional(),
  fill_longitude: z.number().min(-180).max(180).nullable().optional(),
  bill_path: z.string().regex(BILL_PATH_RE, 'The bill was not uploaded correctly. Upload it again.').nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

const UpdateBody = FuelBody.extend({ reviewed: z.boolean().optional() });

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);
  return parsed.data;
}

async function requireVehicle(id: string): Promise<FuelVehicle> {
  const vehicle = await loadVehicle(id);
  if (!vehicle) throw new HttpError(404, 'Vehicle not found');
  return vehicle;
}

async function requireVehicleAccess(req: Request, vehicleId: string): Promise<void> {
  if (!(await canAccessVehicle(req.user!, vehicleId))) throw new HttpError(403, 'Not authorized for this vehicle');
}

function amountsOrThrow(input: Parameters<typeof resolveAmounts>[0]) {
  try {
    return resolveAmounts(input);
  } catch (e) {
    if (e instanceof FuelInputError) throw new HttpError(400, e.message);
    throw e;
  }
}

/** The bill must really be in storage; that is what "verified with bill" means. */
async function assertBillUploaded(path: string): Promise<void> {
  const { data, error } = await supabase.storage.from(settings.KYC_DOCUMENTS_BUCKET).createSignedUrl(path, 60);
  if (error || !data) throw new HttpError(400, 'The bill file was not found. Upload it again.');
}

function checkFilledAt(iso: string, req: Request): void {
  const at = Date.parse(iso);
  if (at > Date.now() + FUTURE_SLACK_MS) throw new HttpError(400, 'The fill date cannot be in the future');
  if (!isStaff(req.user) && at < Date.now() - DRIVER_BACKDATE_MS) throw new HttpError(400, 'Fill-ups older than 7 days must be entered by the office');
}

/**
 * Refuses (422) an odometer reading that cannot be right: below the fill before it, above the fill after it, or
 * further than a truck drives between fills. Fills already flagged as wrong readings are not measured against, so
 * one bad row never blocks the fills after it; staff correct or delete it (PUT or DELETE /fleet/fuel-logs/:id).
 */
async function assertOdometer(vehicleId: string, odometer: number, filledAt: string, excludeId?: string): Promise<void> {
  const at = Date.parse(filledAt);
  const logs = await loadLogs(vehicleId);
  // Judge the stored readings afresh, so a bad row that was saved before this check existed is skipped too
  const analysis = analyzeFills(logs.map(toFill));
  const trusted = logs.filter(l =>
    l.id !== excludeId && l.odometer_km != null
    && !analysis.annotations.get(l.id)!.flags.some(f => f === 'odometer_backwards' || f === 'odometer_jump' || f === 'duplicate'));
  const before = trusted.filter(l => Date.parse(l.filled_at) <= at).sort((a, b) => Date.parse(b.filled_at) - Date.parse(a.filled_at))[0];
  const after = trusted.filter(l => Date.parse(l.filled_at) > at).sort((a, b) => Date.parse(a.filled_at) - Date.parse(b.filled_at))[0];
  const problem = odometerProblem(odometer, before?.odometer_km ?? null, after?.odometer_km ?? null);
  if (problem) throw new HttpError(422, problem, { field: 'odometer_km' });
}

/** The fuel expense that lets finance see the real fuel cost. Failing to write it does not lose the fill. */
async function writeExpense(log: FuelLogRow, userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('expenses')
    .insert({
      ...carrierStamp(),
      vehicle_id: log.vehicle_id,
      category: 'fuel',
      amount: log.total_amount,
      expense_date: indianDateKey(new Date(log.filled_at)),
      litres: log.litres,
      note: log.station_name ? `Fuel at ${log.station_name}` : 'Fuel fill-up',
      receipt_path: log.bill_path,
      created_by: userId,
    })
    .select('id')
    .single();
  if (error) {
    console.warn('Fuel fill was stored on the fuel log only (no expense row):', error.message);
    return null;
  }
  return data?.id ?? null;
}

async function syncExpense(log: FuelLogRow): Promise<void> {
  if (!log.expense_id) return;
  const { error } = await supabase
    .from('expenses')
    .update({
      amount: log.total_amount,
      expense_date: indianDateKey(new Date(log.filled_at)),
      litres: log.litres,
      note: log.station_name ? `Fuel at ${log.station_name}` : 'Fuel fill-up',
      receipt_path: log.bill_path,
      updated_at: new Date().toISOString(),
    })
    .eq('id', log.expense_id);
  if (error) console.warn('Fuel expense could not be updated:', error.message);
}

async function loadLog(id: string): Promise<FuelLogRow> {
  if (!isUuid(id)) throw new HttpError(404, 'Fuel entry not found');
  const { data, error } = await supabase.from('vehicle_fuel_logs').select(FUEL_LOG_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'Fuel entry not found');
  return normalizeLog(data);
}

/** Staff-entered readings that are higher than the vehicle's own count raise it; a driver's only fill an empty one. */
async function raiseOdometer(vehicle: FuelVehicle, log: FuelLogRow, byStaff: boolean): Promise<void> {
  if (log.odometer_km == null || log.flags.some(f => f === 'odometer_backwards' || f === 'duplicate')) return;
  const current = vehicle.odometer_km;
  if (current != null && (!byStaff || log.odometer_km <= current)) return;
  await supabase.from('vehicles').update({ odometer_km: log.odometer_km, odometer_updated_at: new Date().toISOString() }).eq('id', vehicle.id);
  await cacheDeletePattern('vehicles:list:*');
}

// ── Fills of one vehicle ───────────────────────────────────

// GET /fleet/vehicles/:id/fuel-logs — newest first
router.get('/vehicles/:id/fuel-logs', requireAuth, async (req: Request, res: Response) => {
  try {
    await requireVehicleAccess(req, req.params.id);
    await requireVehicle(req.params.id);
    const limit = Math.min(500, Math.max(1, Number.parseInt(String(req.query.limit ?? '100'), 10) || 100));
    res.json((await loadLogs(req.params.id)).slice(0, limit));
  } catch (e) {
    sendError(req, res, e);
  }
});

// POST /fleet/vehicles/:id/fuel-logs — log a fill-up, with or without a bill
router.post('/vehicles/:id/fuel-logs', requireAuth, idempotent('fuel_log'), async (req: Request, res: Response) => {
  try {
    await requireVehicleAccess(req, req.params.id);
    const vehicle = await requireVehicle(req.params.id);
    const b = parse(FuelBody, req.body);
    const amounts = amountsOrThrow(b);
    const filledAt = b.filled_at ?? new Date().toISOString();
    checkFilledAt(filledAt, req);
    if ((b.fill_latitude == null) !== (b.fill_longitude == null)) throw new HttpError(400, 'Send both the latitude and the longitude of the fill');
    if (b.bill_path) await assertBillUploaded(b.bill_path);
    if (b.odometer_km != null) await assertOdometer(vehicle.id, b.odometer_km, filledAt);

    const { data, error } = await supabase
      .from('vehicle_fuel_logs')
      .insert({
        vehicle_id: vehicle.id,
        filled_at: filledAt,
        ...amounts,
        // Prefilled from the vehicle's own reading when the caller does not send one
        odometer_km: b.odometer_km === undefined ? vehicle.odometer_km : b.odometer_km,
        is_full_tank: b.is_full_tank ?? true,
        station_name: b.station_name || null,
        payment_mode: b.payment_mode ?? 'cash',
        fill_latitude: b.fill_latitude ?? null,
        fill_longitude: b.fill_longitude ?? null,
        bill_path: b.bill_path ?? null,
        bill_status: b.bill_path ? 'with_bill' : 'no_bill',
        logged_by: req.user!.user_id,
        logged_by_role: req.user!.role,
        note: b.note || null,
      })
      .select(FUEL_LOG_COLUMNS)
      .single();
    if (error || !data) throw new Error(`Failed to save the fuel entry: ${error?.message}`);
    let log = normalizeLog(data);

    const expenseId = await writeExpense(log, req.user!.user_id);
    if (expenseId) {
      await supabase.from('vehicle_fuel_logs').update({ expense_id: expenseId }).eq('id', log.id);
      log = { ...log, expense_id: expenseId };
    }

    const { logs } = await recomputeVehicle(vehicle.id);
    log = logs.find(l => l.id === log.id) ?? log;
    await raiseOdometer(vehicle, log, isStaff(req.user));
    res.status(201).json({ ...log, expense_recorded: expenseId != null });
  } catch (e) {
    sendError(req, res, e);
  }
});

// POST /fleet/vehicles/:id/fuel-logs/bill-upload — signed upload URL for the bill photo or PDF
router.post('/vehicles/:id/fuel-logs/bill-upload', requireAuth, rateLimitByUser('fuel-bill-upload', 60, 60 * 60), async (req: Request, res: Response) => {
  try {
    await requireVehicleAccess(req, req.params.id);
    await requireVehicle(req.params.id);
    const extension = typeof req.body?.content_type === 'string' ? TPL_UPLOAD_CONTENT_TYPES[req.body.content_type.toLowerCase()] : undefined;
    if (!extension) throw new HttpError(415, 'Upload a PDF, JPG or PNG file');
    const bytes = Number(req.body?.size);
    if (!Number.isInteger(bytes) || bytes <= 0) throw new HttpError(400, 'File size is required');
    if (bytes > settings.EXPENSE_RECEIPT_MAX_BYTES) {
      throw new HttpError(413, `The bill must be at most ${Math.floor(settings.EXPENSE_RECEIPT_MAX_BYTES / 1024 / 1024)} MB`);
    }
    // Same folder as expense receipts, so finance can open the bill from the expense too
    const path = `expenses/${crypto.randomUUID()}/fuel_bill_${crypto.randomUUID()}.${extension}`;
    const { data, error } = await supabase.storage.from(settings.KYC_DOCUMENTS_BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw new Error(`Failed to create upload URL: ${error?.message}`);
    res.json({ path: data.path, token: data.token, signed_url: data.signedUrl, bucket: settings.KYC_DOCUMENTS_BUCKET });
  } catch (e) {
    sendError(req, res, e);
  }
});

// GET /fleet/vehicles/:id/fuel-stats — average km/l, last km/l, cost per km, this month's spend
router.get('/vehicles/:id/fuel-stats', requireAuth, async (req: Request, res: Response) => {
  try {
    await requireVehicleAccess(req, req.params.id);
    await requireVehicle(req.params.id);
    res.json(await getVehicleStats(req.params.id));
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── One fill ───────────────────────────────────────────────

// PUT /fleet/fuel-logs/:logId — staff correct an entry, or mark it reviewed
router.put('/fuel-logs/:logId', ...staff, guardOfVehicle('vehicle_fuel_logs', 'logId', 'Fuel entry not found'), async (req: Request, res: Response) => {
  try {
    const existing = await loadLog(req.params.logId);
    const b = parse(UpdateBody, req.body);
    const patch: Record<string, unknown> = {};

    const given = (['litres', 'price_per_litre', 'total_amount'] as const).filter(k => b[k] !== undefined);
    if (given.length) {
      // One changed figure is worked out against the litres (or the price, when the litres are what changed)
      const input: Record<string, number> = {};
      for (const k of given) input[k] = b[k]!;
      if (given.length === 1) input[given[0] === 'litres' ? 'price_per_litre' : 'litres'] = given[0] === 'litres' ? existing.price_per_litre : existing.litres;
      Object.assign(patch, amountsOrThrow(input));
    }
    if (b.filled_at !== undefined) { checkFilledAt(b.filled_at, req); patch.filled_at = b.filled_at; }
    if (b.odometer_km !== undefined) {
      if (b.odometer_km != null) await assertOdometer(existing.vehicle_id, b.odometer_km, b.filled_at ?? existing.filled_at, existing.id);
      patch.odometer_km = b.odometer_km;
    }
    if (b.is_full_tank !== undefined) patch.is_full_tank = b.is_full_tank;
    if (b.station_name !== undefined) patch.station_name = b.station_name || null;
    if (b.payment_mode !== undefined) patch.payment_mode = b.payment_mode;
    if (b.note !== undefined) patch.note = b.note || null;
    if (b.fill_latitude !== undefined) patch.fill_latitude = b.fill_latitude;
    if (b.fill_longitude !== undefined) patch.fill_longitude = b.fill_longitude;
    if (b.bill_path !== undefined) {
      if (b.bill_path) await assertBillUploaded(b.bill_path);
      patch.bill_path = b.bill_path;
      patch.bill_status = b.bill_path ? 'with_bill' : 'no_bill';
    }
    if (b.reviewed !== undefined) {
      patch.reviewed_at = b.reviewed ? new Date().toISOString() : null;
      patch.reviewed_by = b.reviewed ? req.user!.user_id : null;
    }
    if (!Object.keys(patch).length) throw new HttpError(400, 'Nothing to update');

    const { data, error } = await supabase
      .from('vehicle_fuel_logs')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select(FUEL_LOG_COLUMNS)
      .maybeSingle();
    if (error) throw new Error(`Failed to update the fuel entry: ${error.message}`);
    if (!data) throw new HttpError(404, 'Fuel entry not found');
    await syncExpense(normalizeLog(data));

    const { logs } = await recomputeVehicle(existing.vehicle_id);
    res.json(logs.find(l => l.id === existing.id) ?? normalizeLog(data));
  } catch (e) {
    sendError(req, res, e);
  }
});

// DELETE /fleet/fuel-logs/:logId — staff remove an entry, with its expense row and bill file
router.delete('/fuel-logs/:logId', ...staff, guardOfVehicle('vehicle_fuel_logs', 'logId', 'Fuel entry not found'), async (req: Request, res: Response) => {
  try {
    const existing = await loadLog(req.params.logId);
    const { error } = await supabase.from('vehicle_fuel_logs').delete().eq('id', existing.id);
    if (error) throw new Error(`Failed to delete the fuel entry: ${error.message}`);
    if (existing.expense_id) await supabase.from('expenses').delete().eq('id', existing.expense_id);
    if (existing.bill_path) await supabase.storage.from(settings.KYC_DOCUMENTS_BUCKET).remove([existing.bill_path]).catch(() => undefined);
    await auditService.record('staff-console', req.user!, 'fuel_log_deleted', { fuel_log_id: existing.id, vehicle_id: existing.vehicle_id, litres: existing.litres, total_amount: existing.total_amount });
    await recomputeVehicle(existing.vehicle_id);
    res.status(204).end();
  } catch (e) {
    sendError(req, res, e);
  }
});

// GET /fleet/fuel-logs/:logId/bill-url — short-lived link to the bill
router.get('/fuel-logs/:logId/bill-url', requireAuth, async (req: Request, res: Response) => {
  try {
    const log = await loadLog(req.params.logId);
    // Someone who may not see the vehicle gets the answer for an entry that does not exist, never a 403 that says it does
    try {
      await requireVehicleAccess(req, log.vehicle_id);
    } catch (e) {
      if (e instanceof HttpError && (e.status === 403 || e.status === 404)) throw new HttpError(404, 'Fuel entry not found');
      throw e;
    }
    if (!log.bill_path) throw new HttpError(404, 'This entry has no bill');
    const { data, error } = await supabase.storage.from(settings.KYC_DOCUMENTS_BUCKET).createSignedUrl(log.bill_path, 600);
    if (error || !data) throw new HttpError(404, 'The bill file is no longer available');
    res.json({ url: data.signedUrl });
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── Fleet-wide ─────────────────────────────────────────────

// GET /fleet/fuel-summary — fleet km/l and spend, best and worst vehicles
router.get('/fuel-summary', ...staff, async (req: Request, res: Response) => {
  try {
    res.json(await getFleetSummary());
  } catch (e) {
    sendError(req, res, e);
  }
});

// GET /fleet/fuel-anomalies?type=&vehicle_id=&reviewed= — flagged entries, newest first.
// By default only entries not yet reviewed; reviewed=true shows the reviewed ones, reviewed=all both.
router.get('/fuel-anomalies', ...staff, async (req: Request, res: Response) => {
  try {
    const type = typeof req.query.type === 'string' ? req.query.type : undefined;
    if (type && !(FUEL_FLAGS as readonly string[]).includes(type)) throw new HttpError(400, `type must be one of ${FUEL_FLAGS.join(', ')}`);
    const reviewed = req.query.reviewed === 'true' ? 'true' : req.query.reviewed === 'all' ? 'all' : 'false';
    let query = supabase.from('vehicle_fuel_logs').select(FUEL_LOG_COLUMNS).order('filled_at', { ascending: false }).limit(2000);
    if (typeof req.query.vehicle_id === 'string' && req.query.vehicle_id) query = query.eq('vehicle_id', req.query.vehicle_id);
    const { data, error } = await query;
    if (error) throw error;
    const mine = await visibleVehicleIds();
    const rows = newestFirst((data ?? []).map(normalizeLog)).filter(l => {
      if (mine && !mine.has(l.vehicle_id)) return false;
      if (!l.flags.length) return false;
      if (type && !l.flags.includes(type as FuelFlag)) return false;
      if (reviewed === 'false') return !l.reviewed_at;
      if (reviewed === 'true') return !!l.reviewed_at;
      return true;
    });
    const ids = [...new Set(rows.map(r => r.vehicle_id))];
    const plates = new Map<string, string>();
    if (ids.length) {
      const { data: vs } = await supabase.from('vehicles').select('id, plate_number').in('id', ids);
      for (const v of vs ?? []) plates.set((v as any).id, (v as any).plate_number);
    }
    res.json(rows.map(r => ({ ...r, plate_number: plates.get(r.vehicle_id) ?? null })));
  } catch (e) {
    sendError(req, res, e);
  }
});

export default router;
